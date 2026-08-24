# VAD per-cycle raw latency — does it survive to storage?

*Read-only probe, 2026-08-20. Code traced end to end and confirmed against the live database with a service-role read. No code, schema or data was changed.*

---

## The verdict

**Yes — with one qualification that actually bites, and three that are merely awkward.**

Raw per-learner × per-cycle × per-phrase latency **does** survive to storage un-aggregated. Every voiced speaking cycle writes its own append-only row into `player_events` with `event_type = 'cycle_prosody'`, carrying the learner, the LEGO, a client-stamped millisecond timestamp, the raw latency, the raw speech-start/end marks, and even the 128-point energy contour the derived scalars were computed from. Nothing on the write path averages, buckets, rings, samples or rolls up before the row lands. Ordering is recoverable and, measured on live rows, essentially intact. **The second-order hypothesis — rate of change of latency, and deviation from a rolling average — is computable from what is stored today.**

**The qualification that bites: the number stored as `responseLatencyMs` is not the latency you think it is.** It is measured from the moment the *prompt audio starts*, not from the moment the learner is invited to speak. It therefore contains the duration of the known-language prompt audio, which is different for every phrase — and the prompt-end mark is **not** persisted. So a per-phrase slope over time is clean, but a *cross-phrase* rolling average or z-score for one learner is confounded by prompt length, not difficulty. That is a payload defect, not a storage defect, and it is a one-line fix (§7).

The three lesser qualifications: capture is gated on an opt-in that is **off by default** and on speech actually being detected, so the corpus is a filtered subset of cycles, not all of them; the only read path that exists aggregates and does not even project the latency field, and `player_events` is own-row RLS for *everyone including admins*, so today the raw values are reachable only with a service-role key; and `cycleId` is not unique while `seedId` is always null, so `legoId` + `occurred_at` is the only workable grouping key.

---

## The path, end to end

| Step | Where | What happens |
|---|---|---|
| **Measured** | `packages/core/src/audio/VoiceActivityDetector.ts:521-595` (`continuousAnalyzeLoop`), summarised at `:430-515` (`stopContinuousMonitoring`) | An rAF loop samples mic energy and pushes `{t, db}` into an in-memory timeline. On stop, first speech onset and debounced speech end are converted to ms relative to prompt start, and the energy timeline is reduced to envelope features and then **discarded** (`:497`). |
| **Coordinated** | `packages/core/src/audio/SpeechTimingAnalyzer.ts:60-113` | Thin wrapper: `startCycle` / `onPhaseChange` / `endCycle`. Holds no history — `lastResult` is one cycle deep. |
| **Driven** | `packages/player-vue/src/components/LearningPlayer.vue:1847-1861` | On `prompt` → `startTimingCycle()` (only if the cycle has a pause and a `legoId`); on `pause` → marks `PROMPT_END` **and** `PAUSE`; on `voice1`/`voice2` → marks those. A window left dangling by a skip is `reset()` at the next prompt rather than mis-attributed. |
| **Closed & emitted** | `LearningPlayer.vue:1922-1976` | In `onCycleCompleted`, `endTimingCycle(...)` closes the window, then `logEvent('cycle_prosody', {...})` emits **one row per cycle** with 18 payload keys. |
| **Batched** | `packages/player-vue/src/composables/usePlayerLog.ts:104-166` | Buffered in memory; `occurred_at` is stamped **at `event()` time, client-side** (`:120`) — not at flush, not at insert. Flushes every 5 s or at 10 buffered events, plus a `sendBeacon` on visibilitychange/unmount. |
| **Ingested** | `api/player-events.ts:130-210` | Service-role batch insert, max 50 events. Client `occurred_at` is preserved when parseable (`:170`). Payload capped at 8 KB, collapsing to `{_truncated:true}` above that. Identity dual-written to `user_id` **and** `learner_id`. |
| **Stored** | `public.player_events` (`supabase/schema.sql:8245`) | `id bigserial, occurred_at timestamptz, user_id uuid, learner_id uuid, course_code, session_id uuid, event_type, payload jsonb, client_version, device_type, ip_country, env`. Indexes on `(user_id, occurred_at desc)`, `(learner_id, occurred_at desc)`, `(user_id, session_id, occurred_at)`. **No retention job, no pruning, no TTL** — the only `DELETE` against this table anywhere in the repo is the demo regenerator (`scripts/demo-data/generate-demo-suite.cjs:230`). |
| **Read** | `api/admin/vad-prosody.ts` | The only read path. ssi_admin-gated, **aggregates only**, one record per learner. It projects five scalars and does not project `responseLatencyMs`, `legoId` or `occurred_at` at all. |

The in-code comment at `LearningPlayer.vue:1931-1939` claims `cycle_prosody` is the only thing that persists per-cycle identity and that `learner_lego_metrics` is a ring of 20 that discards it. **Both halves of that claim check out.** `EVIDENCE_SERIES_RING_CAP = 20` (`packages/core/src/learning/evidence.ts:64`), `SERIES_CAP = 20` (`useAdaptationEngine.ts:52`), and both `recent_latency_samples` and `evidence_series` are bare number arrays with no timestamps and no cycle identity. `MetricsTracker` (`packages/core/src/learning/MetricsTracker.ts`) is pure in-memory and contains no Supabase writer at all — its per-response records die with the tab.

---

## Granularity table

| Stage | One record is… | Identity it carries | Time it carries |
|---|---|---|---|
| `VoiceActivityDetector` timeline | one ~16 ms energy sample | none | `performance.now()` — **discarded at cycle end** |
| `SpeechTimingResult` | one cycle | none (caller supplies it) | ms relative to prompt start |
| `cycle_prosody` payload | **one voiced speaking cycle** | `legoId`, `seedId`, `cycleId`, `audioId`, plus `learnerId` in payload | none of its own |
| `player_events` row | **one voiced speaking cycle** | `user_id` / `learner_id` (learner PK), `session_id`, `course_code`, `env` | `occurred_at` (client-stamped, ms) + monotonic `id` |
| `learner_lego_metrics` row | one (learner, LEGO) **summary** | `learner_id`, `lego_id` | `last_seen_at` only — the series has no time axis |
| `learner_speaking_opportunities` | one (learner, **day**) | `learner_id` | day |
| `/api/admin/vad-prosody` response | one **learner** | learner id | none |

**The stable key to group by** for a per-phrase series for one learner is `(coalesce(learner_id, payload->>'learnerId'), payload->>'legoId')`, ordered by `occurred_at` with `id` as tiebreak. Specifically:

- **`legoId` — use this.** Present on 100 % of live rows. It is the course model's unit of learning and what Tom means by "the phrase".
- **`seedId` — unusable. It is `null` on 1433/1433 real player-written rows.** SimplePlayer cycles do not populate it. (The demo seeder *does* fill it, by slicing the legoId — so anyone eyeballing seeded rows would wrongly conclude it works.)
- **`cycleId` — not unique, do not key on it.** Real values look like `S0010L01_build_391` — a deterministic round-position id, reused on replays. Live: 650 distinct values across 1433 rows, with **375 collisions inside a single session**. It identifies a slot in the round, not an occurrence.
- **`audioId` — the voice-1 audio uuid.** Present on 100 % of real rows. Useful as the join key into the model-envelope table; not an occurrence key.
- **Identity itself is a trap.** `player_events.user_id` is `uuid` but holds `learners.id`, never `auth.uid()`. Worse: **987 of the 1433 real rows have `user_id` and `learner_id` NULL** because they came from guest sessions, where the only identity is the string `guest-<uuid>` inside `payload.learnerId`. Any per-learner grouping that reads only the columns silently drops 69 % of the real corpus.

---

## Where the derivative signal is, or could be, aggregated away

Ranked by how badly each hurts the second-order hypothesis.

### 1. The zero point is wrong, and the correction is not stored — **degrades, badly, across phrases**
`responseLatencyMs` is set to `speech_start_ms` (`VoiceActivityDetector.ts:472`), which is measured from `continuousStartTime` — set when **prompt audio begins** (`:366`, called at `phase === 'prompt'`). The mark that would let you subtract the prompt, `PROMPT_END`, is recorded internally (`:458`) and then **never leaves the class**: it is not in `SpeechTimingResult` and not in the payload. So the stored number is `prompt_audio_duration + true_response_latency`.

Within one LEGO the prompt audio is constant, so a per-phrase slope is unaffected. Across phrases it is not: a learner's "deviation from their own rolling average" would largely be measuring which phrases have long prompts. Live confirmation: real latencies span 6.6 ms → 17 553 ms, and the median is **32.5 ms** — physically impossible as a response latency, and exactly what you get when speech is detected during the prompt.

It is *recoverable but ugly*: `audio_play` rows carry the same `cycleId` with `role: 'known'` and the known audio's id in the URL, which joins to `course_audio.duration_ms` — a three-way join per cycle, and only while `audio_play` rows are retained. Storing `promptEndMs` costs one payload key.

### 2. Consent is off by default, and only voiced cycles are logged — **filters the population, does not destroy it**
Two guards stack:
- `isAdaptationActive` = `adaptationConsent === true && vadInitialized` (`LearningPlayer.vue:10502`). Consent defaults to `false` (`:10435-10436`) and is forced to `false` on production deep links (`:10429-10432`). **No consent → no VAD → no timing window → no row at all.**
- Emission requires `cycleTiming?.speech_detected && cycle.legoId && cycle.target?.text` (`:1940`), and the window only opens at all for cycles with `pauseDuration > 0` and a `legoId` (`:1852`).

Consequence Tom needs to hold: **a "rolling average over the learner's cycles" is not available.** What is available is a rolling average over *consented, speaking, voiced* cycles. Silence is the interesting case — a learner who says nothing because they cannot produce the phrase generates **no row**, so the hardest cycles are precisely the ones missing from the series. Any slope computed over the surviving rows is conditioned on the learner having spoken. That is a different quantity, and it biases optimistic.

The cycles that were skipped are not even counted: nothing logs "window opened, no speech". A `cycle_prosody_silent` marker (or a `speechDetected:false` row) would make the denominator knowable.

### 3. The only read path aggregates, and RLS blocks everything else — **makes it unreachable, does not destroy it**
`api/admin/vad-prosody.ts` is explicit: "AGGREGATES ONLY. Nothing per-event and no envelope contour ever leaves here." It folds to one record per learner, and its projection does not even include `responseLatencyMs`, `legoId` or `occurred_at`. The endpoint's own header notes (verified live 2026-08-12) that `player_events` is own-row under RLS for admins too — a real ssi_admin JWT returns 0 of another learner's 321 `cycle_prosody` rows.

So: **the raw series exists in the database and no application code can currently read it.** That is a much cheaper problem than losing it at capture — it is one new server endpoint — but as of today the second-order analysis is only possible from a service-role script (which is how the numbers in this document were obtained). It also silently caps at 100 000 events and folds all environments and demo rows together with no filter.

### 4. Batching — **does not damage ordering or timestamps** (checked, not assumed)
`occurred_at` is stamped inside `event()`, at the moment the cycle completes, before buffering (`usePlayerLog.ts:120`). It is not a flush time and not an insert time. The server preserves it verbatim when parseable (`api/player-events.ts:170`). A whole batch therefore does **not** land with one timestamp.

Measured on the 1433 live player-written rows: 6 order inversions in 1413 within-session consecutive pairs (0.4 %), 10 pairs with identical `occurred_at`, and inter-row gaps of p10 13.0 s / p50 18.5 s / p90 23.1 s — exactly the ~11-20 s cycle cadence you would expect. **Ordering and intervals are sound.** Order by `occurred_at`, tiebreak on `id`.

Real losses in this layer, all silent and all whole-buffer rather than selective: buffer hard-capped at 200 events (`:55, :106`); the entire buffer is dropped without a network attempt when `isOfflineish()` (`:141-144`); the entire buffer is dropped on any fetch failure (`:165`); the `sendBeacon` path is fire-and-forget. Nothing is sampled, coalesced or deduplicated. So an offline stretch loses a contiguous block of cycles — which leaves a *gap* in the series rather than corrupting it, and gaps are detectable because `occurred_at` intervals jump.

### 5. Payload truncation — **not currently a risk**
The 8 KB cap (`api/player-events.ts:74`) versus measured real payloads: p50 **1030 bytes**, max **1132 bytes**. Zero truncated rows live. The contour is peak-normalised to integers 0-100 and capped at 128 points (`envelopeMetadata.ts:77, :96`), which is what keeps it small. Headroom is 7×.

### 6. The rollup and ring tables — **already aggregated, correctly labelled as such**
`learner_lego_metrics.recent_latency_samples` and `.evidence_series` are ring-capped at 20 with no timestamps and no cycle identity; `learner_speaking_opportunities` is day-grained. Neither is a raw store and neither claims to be. Confirmed live: both columns exist on the table (so the 20260714 migration, still marked DRAFT/NOT YET APPLIED in the repo, **has in fact been applied**), with 84 rows carrying a non-default `evidence_series`.

### 7. `response_metrics` and `spike_events` — **still dead, still 0 rows**
Confirmed live 2026-08-20: both tables contain **zero rows**, exactly as the June 2026 migration comment said. Nothing writes to them. They are a false promise of raw storage and should not appear in any plan.

### 8. Retention — **none, and that is the right answer**
No cron, no trigger, no scheduled function touches `player_events`. `vercel.json` has two crons, neither related. The append-only claim holds.

---

## What a rate-of-change analysis could actually compute today

Given a learner and a phrase, this is the query:

```sql
select occurred_at,
       (payload->>'responseLatencyMs')::float8 as latency_ms,
       (payload->>'learnerDurationMs')::float8 as spoken_ms,
       (payload->>'durationDeltaMs')::float8   as delta_ms,
       (payload->>'startedDuringPrompt')::bool as early,
       (payload->>'playbackSpeed')::float8     as speed,
       (payload->>'extractorVersion')::int     as ext_v,
       payload->'envelope'->'contour'          as contour
from   public.player_events
where  event_type = 'cycle_prosody'
  and  coalesce(learner_id::text, payload->>'learnerId') = :learner
  and  payload->>'legoId' = :lego
  and  env is not null                     -- excludes the seeded demo corpus
order  by occurred_at, id;
```

That gives an ordered, evenly-spaced-in-cycles series per (learner, phrase). First difference, rolling mean, deviation-from-rolling-mean and a slope over the last *n* exposures are all straightforwardly computable on it. The envelope contour is stored too, so any future prosody measure can be recomputed retrospectively over the same rows — that part of the design is genuinely good.

**How much series there is to work with (live, and mostly not real learners):** 6217 `cycle_prosody` rows total, of which **1433 were written by the actual player** and 4784 were seeded. The 1433 come from **4 identities across 20 sessions** — one signed-in learner with 437 rows over 6 sessions, one guest with 987 rows over 12 sessions, and two with 8 and 1. Grouped by (learner, LEGO) they form 111 series, of which **61 have ≥3 exposures** and the longest has 139. So the shape is right and the volume is nowhere near enough to test anything — which is what Tom already said.

**Now the things that would make the calculation wrong rather than merely hard:**

1. **The prompt-start zero point (§1).** Cross-phrase comparison for one learner is confounded by prompt audio length. Within-phrase slope is safe. This is the one to fix before anyone runs a cross-phrase z-score.
2. **The current real data is measuring the room, not the learner.** Of the 1433 player-written rows, **1193 (83 %) have `startedDuringPrompt = true`** and the median latency is 32.5 ms. Broken down: the guest identity is 92 % early-start with a p50 of 27 ms; the signed-in learner is 63 % early-start with a p50 of 887 ms. The pattern — speech "starting" milliseconds into the prompt and "ending" 17.5 s later, i.e. spanning the whole cycle — is the VAD hearing the app's own playback, or ambient noise, not a learner responding. **The threshold/echo problem must be fixed before any of this data means anything**, and it is invisible in the seeded corpus.
3. **Demo rows are mixed into the same table and are trivially distinguishable — but only if you know to look.** The seeder writes `player_events` directly with raw SQL (`scripts/demo-data/topup-ime-vad.cjs:275-276`), setting only `(user_id, course_code, session_id, event_type, payload, device_type, occurred_at)`. So seeded rows have `env IS NULL`, `learner_id IS NULL`, `client_version IS NULL`, `ip_country IS NULL`, and no `learnerId` key in the payload. Those five discriminators agree perfectly on the live data (4784 vs 1433 either way). **`env is not null` is a reliable demo filter today** — with the caveat that it would also exclude any genuine rows predating the `env` column, and none exist here because `cycle_prosody` only started in late July 2026.
4. **The seeder's semantics diverge from the player's, in the one field that matters.** `demoTelemetry.cjs:87` generates `responseLatencyMs` in the range **−350 to +1400 ms**, treating negative as "started during the prompt". The real player can never emit a negative value — its zero point is prompt start, so `speechStartMs >= 0` always. Live: 945 negative values, **all of them seeded, none real.** Anyone calibrating a threshold, a rolling average or an anomaly rule off the demo corpus would be calibrating against a different definition of the same field name. This is exactly the trap Tom's "all this VAD data is fake" warning points at, and it is sharper than "the numbers are made up".
5. **`cycleId` collides within a session** (375 of 1433). Do not use it to dedupe, order, or count exposures.
6. **`seedId` is always null** on real rows, so it cannot be a fallback phrase key.
7. **Guest rows have no `learner_id`** — 987 of 1433 real rows. Grouping on the column alone drops them. Coalesce with `payload->>'learnerId'`.
8. **Mixed playback speeds are present but recorded.** Live: 6190 rows at 1.0×, 26 at 0.8×, 1 at 0.9×. Since the latency includes the prompt audio, playback speed rescales the confound — but the value is in the payload, so it is correctable. Nothing else in the pipeline records it.
9. **Extractor version is stable at 1 across every row**, and it is stamped per row, so a future bump would be detectable mid-series rather than silently changing the meaning of the envelope features. That is handled well.
10. **Silence is missing from the denominator** (§2). Any "improvement over exposures" measure is conditioned on the learner having spoken every time it is counted.

---

## Bearing on the adaptation fork — and nothing more

Tom's fork stays open; this is only about what is measurable.

Both strategies — withdraw the hard phrase, or return it more often — need a per-(learner, phrase) exposure series with a slope. **The storage supports that**, at 3+ exposures for 61 of the 111 real series today. What the storage does **not** currently support is the one comparison that would tell the two diagnoses apart cheaply: *"is this phrase hard for this learner relative to their other phrases right now"*, because cross-phrase latency comparison is confounded by prompt length (§1) and by the missing-silence bias (§2). Fixing the zero point makes both strategies equally measurable. That is the whole of my comment on the fork.

---

## Gaps I could not close

- **No real learner data exists, and the 1433 player-written rows are testers.** Four identities, two of which look like a broken VAD. Every number here about *behaviour* is therefore about the equipment, not about learners. I have labelled seeded rows as seeded everywhere.
- **I did not run the player.** The capture-time behaviour (which cycles open a window, what fraction get `speech_detected`) is derived from reading the code and inferred from the stored rows, not from an instrumented session. A live run with the mic on is the only way to measure the real drop rate at guard `LearningPlayer.vue:1940`.
- **I did not verify RLS policy text on `player_events` directly.** I read the endpoint's own note that a real ssi_admin JWT returns 0 rows (verified by someone else on 2026-08-12) and the `20260717` grant-restore migration, and my own reads used a service-role key which bypasses RLS entirely. So "admins cannot read this from the browser" is second-hand, not re-verified by me.
- **`player_events` has no `CREATE TABLE` in a migration file** — only in the dumped `supabase/schema.sql`. Its live shape I confirmed by reading rows, and that matches the dump.
- **The `20260714_lego_metrics_evidence_series.sql` migration is marked "DRAFT — NOT YET APPLIED" in the repo but the column exists live.** So the repo's migration status comments are not reliable as a record of what is applied. I did not audit the rest of them.
- **Contour fidelity unverified against a known signal.** I confirmed the contour is 128 integers and present on 1430/1433 real rows; I did not check that it reconstructs the original envelope faithfully.

---

## What I would fix, if asked — NOT DONE

None of these were made. Read-only job.

1. **Add `promptEndMs` (and `voice1StartMs`) to the `cycle_prosody` payload.** `SpeechTimingResult` already contains `prompt_end_ms` and `voice1_start_ms` (`VoiceActivityDetector.ts:501-502`); they are simply not copied at `LearningPlayer.vue:1942-1975`. Two lines, ~10 bytes per row. **This is the one that matters** — without it, cross-phrase second-order analysis is wrong rather than hard, and once real learners start producing rows the loss is permanent for those rows.
2. **Fix the VAD threshold / echo problem before trusting any latency.** 83 % of real rows have speech "starting" within milliseconds of the prompt. Owner: `VoiceActivityDetector` `energy_threshold_db` and whether the mic stream requests echo cancellation. This is a separate diagnosis job, not a payload change.
3. **Log the silent cycles.** Either a `speechDetected: false` variant row, or a per-round counter of windows opened vs rows emitted, so the denominator is knowable. Currently at `LearningPlayer.vue:1940` a non-speaking cycle vanishes without trace.
4. **Add a raw per-cycle read path** — a new admin-gated endpoint alongside `api/admin/vad-prosody.ts`, taking `learnerId` + optional `legoId` and returning ordered raw rows (latency, occurred_at, flags; contour opt-in). The existing endpoint's aggregates-only guarantee is right for what it does; it just is not the only thing needed.
5. **Filter demo rows in `api/admin/vad-prosody.ts`.** It currently folds seeded and real rows together with no `env` predicate, so the board's numbers are a blend. `.not('env','is',null)` — one line — or an explicit `env` query parameter.
6. **Align the demo seeder's `responseLatencyMs` with the player's definition** (`scripts/demo-data/demoTelemetry.cjs:87`): generate `speechStartMs >= 0` measured from prompt start and derive `startedDuringPrompt` from a prompt-end mark, rather than from a negative latency the real player cannot produce.
7. **Populate `seedId` on SimplePlayer cycles**, or drop the key from the payload. Right now it is dead weight that reads as populated when you inspect seeded rows.
8. **Stop calling the round-slot id `cycleId`.** Rename it `roundSlotId` and add a genuinely unique per-occurrence id, or accept `(session_id, occurred_at)` as the occurrence key and document that `cycleId` is not one.

---

*Probe scripts used were throwaway and read-only (`SELECT` only, service-role key, no writes, no migrations, no RLS changes). Live figures quoted are as of 2026-08-20.*
