# Voice / VAD / Prosody Capture — Ground-Truth Inventory (2026-07-28)

Read-only recon. All claims cite `file:line`. No code was modified.

---

## 0. Executive summary

- The live play path (`generateLearningScript` → `toSimpleRounds` → `SimplePlayer`) does **not** write `response_metrics` or `spike_events`. Those tables and their writer (`SessionStore.saveMetrics`/`saveSpikes`) are **dead code** in production — reachable only from a `useLearningSession` legacy branch that never fires under `SimplePlayer`, confirmed by an explicit in-code comment.
- The one live, persisted, per-LEGO (not per-phrase) signal is `learner_lego_metrics`, written by `useAdaptationEngine.ts` → `LegoMetricsStore`. It carries three co-located series: `mastery_state` (ladder), `recent_latency_samples` (ring-20, latency-only), and `evidence_series` (ring-20, **merged** latency+behavioural, adaptation-v2 WP-0/WP-4).
- Adaptation v2 stage 1 (behavioural + latency evidence, rate-policy `planRound`) is **live in shadow mode** today: `algorithm_config.adaptation_v2` defaults to `enabled:true, shadow:true` — every round boundary computes a `RoundPlan` and logs it to `player_events` (`adaptation_plan`), but nothing is applied to playback.
- Adaptation v2 stage 2 (envelope/VAD-shape evidence) is **wired but flagged off**: `stage2_enabled:false` by default. The extractor (WP-6), model-schema+cache (WP-7a), and delta producer (WP-8, `recordEnvelopeEvidence`) are all implemented and called from `LearningPlayer.vue`'s cycle-complete path — but the call is gated on `stage2_enabled`, so it does not run today. (`useEnvelopeEvidence.ts`'s own file-level comment/TODO claiming it's "NOT wired into LearningPlayer.vue" is **stale** — it is wired; the flag, not the wiring, is what's off.)
- `course_audio_envelope` (model-voice envelope numbers) exists in the DB schema (confirmed in `supabase/schema.sql`, generated 2026-07-18) but there is **no evidence in this repo** that the dashboard-repo pipeline job (WP-7b, lives in `ssi-dashboard-v7-clean`) has ever populated it. Cannot confirm row count — see §3.
- **No persisted store today links (learner, specific phrase/cycle id, timestamp, latency, envelope numbers) at per-cycle grain, retained forever.** The only per-cycle-with-timestamp data that reaches the server is `player_events` rows (JSONB payload, keyed by `event_type`), which is a diagnostic log, not a metrics table with stable columns — see §4 for why this matters for a longitudinal study.
- `ProsodyFeedback.vue`/`PronunciationOverlay.vue` are real, reachable, mic-based, and compute pitch-contour comparison client-side — but persist **nothing**. It's a one-shot in-session feedback loop; the recording, contour, and score are discarded on close.
- `SessionComplete.vue` shows belt/points/items-practiced/time/contribution-minutes. No voice, latency, or prosody data.

I could not query the live database — no Supabase credentials or query tooling were present in this working directory/environment (checked `env`, `.env*`, `supabase/` tooling, `tools/`). All "row count" questions in §3 are answered "cannot verify" rather than guessed.

---

## 1. Does the live path write response_metrics / spike_events / learner_lego_metrics / player_events?

**Definitive answer: response_metrics and spike_events are dead-write. learner_lego_metrics and player_events are live-write.**

Evidence chain:
- `SessionStore.saveMetrics`/`saveSpikes` write `response_metrics`/`spike_events` (`packages/core/src/persistence/SessionStore.ts:205-276`).
- `saveMetrics` is exposed by `useLearningSession.ts:634-645` and returned at `useLearningSession.ts:690` — but grepping the whole of `packages/player-vue/src` for actual **invocations** (`.saveMetrics(`) turns up only its own definition and the class-aware wrapper (`useClassSessionStore.ts:82`), never a call from `LearningPlayer.vue`. It is dead: exposed, never called.
- `useClassSessionStore.ts:18-21` states outright: *"saveMetrics is a no-op in class mode (response_metrics is per-individual-learner data; the metrics arrays useLearningSession passes are empty today regardless)."*
- `useLearningSession.ts:436-450` (comment on `recordCycleComplete`) states outright: *"`recordCycleComplete` below expects a `LearningItem` from the legacy round-based playback path (`currentPlayableItem`), which the new SimplePlayer doesn't populate."*
- `LearningPlayer.vue:1745-1760` is the smoking gun: on every cycle-complete, `currentPlayableItem.value` is checked — under `SimplePlayer` (the live path) it is **always falsy**, so the branch that calls `learningSession.recordCycleComplete(completedItem)` (which is the only path that touches `progressStore`/session bookkeeping) never fires. Only `learningSession.bumpOpportunity()` fires (a counter increment via RPC, no per-cycle row).
- Repo-wide grep for `response_metrics`/`spike_events` (excluding tests) turns up only: `SyncService.ts`/`SessionStore.ts` (the dead writer), `useClassSessionStore.ts` (the no-op wrapper), and three account-hygiene files (`api/account/delete.ts`, `api/account/reset-progress.ts:31`, `scripts/verify-schema.cjs`, `supabase/secfix-toolkit/2026-06-09/b0_canary.cjs`) — all cleanup/verification tooling that references the tables to *delete/check* rows, not write them. **No live write path exists anywhere in the repo.**

By contrast:
- `learner_lego_metrics` is written every 10 cycles + pagehide by `useAdaptationEngine.ts`'s `flush()` (`packages/player-vue/src/composables/useAdaptationEngine.ts:366-450`), via `LegoMetricsStore.upsertMany`/`upsertSeries`/`upsertEvidenceSeries` (`packages/core/src/persistence/LegoMetricsStore.ts:118-193`). `recordCycle` (which drives this) is called unconditionally on every cycle completion with a measured latency, live in `LearningPlayer.vue:1689-1694`.
- `player_events` is written via `usePlayerLog.ts` → `POST /api/player-events` (`packages/player-vue/src/composables/usePlayerLog.ts:103-152`, `api/player-events.ts:200-208`), batched every 5s or 10 events, with a `sendBeacon` flush on visibility-hidden/unmount. Confirmed live call sites: `audio_play` (`LearningPlayer.vue:1639`, `:4247`), `phase_skip` (`:6204`), `lego_skip` (`:8466`, `:8642`), `tap_skip` (`:8044`, `:8139`, `:8445`), `tap_pause`/`tap_play` (`:7053`, `:7093`), `turbo_toggle` (`:9585`, `:9599`), `belt_skip` (`:8774`), `round_complete` (`:1792`), `session_complete` (`:1915`), `cold_start` (`:12901`), `adaptation_plan` (`:4592`), `adaptation_persistence_error` (`:3872`).

**Verdict table:**

| Table | Writer | Live-called from SimplePlayer path? |
|---|---|---|
| `response_metrics` | `SessionStore.saveMetrics` (`persistence/SessionStore.ts:205`) | **No — dead code**, unreachable |
| `spike_events` | `SessionStore.saveSpikes` (`persistence/SessionStore.ts:242`) | **No — dead code**, unreachable (no caller at all, not even a dead exposed wrapper) |
| `learner_lego_metrics` | `LegoMetricsStore.upsertMany/upsertSeries/upsertEvidenceSeries` (`persistence/LegoMetricsStore.ts:118/148/175`) | **Yes**, every cycle via `useAdaptationEngine.recordCycle` (`LearningPlayer.vue:1689`) |
| `player_events` | `POST /api/player-events` insert (`api/player-events.ts:201`) | **Yes**, ~15 event types, per-tap/per-cycle-boundary |

---

## 2. Adaptation v2 stage 2 (envelope) — landed vs dormant

**Landed (code-complete, tested, wired):**
- WP-6 (client extractor): `VoiceActivityDetector.ts` accumulates **timestamped** samples — `continuousEnergyTimeline: TimedEnergySample[]` (`packages/core/src/audio/VoiceActivityDetector.ts:66`), pushed during the continuous-monitoring loop (`:302`, `:528`), consumed by `extractEnvelopeMetadata(speechWindow, learnerDurationMs)` at cycle end (`:487-513`), and the result is carried on `SpeechTimingResult.envelope` (`:513`). `envelopeMetadata.ts` implements the exact spec-§5.1 pipeline (20ms grid, 3-tap smoothing, prominence-gated peak detection).
- WP-7a (model-metadata cache): `useEnvelopeMetadataCache.ts` batch-fetches `course_audio_envelope` in chunks of 150, in-memory cache, `null`-caches confirmed-misses (`packages/player-vue/src/composables/useEnvelopeMetadataCache.ts:39-81`).
- WP-8 (delta producer): `useEnvelopeEvidence.ts`'s `recordEnvelopeEvidence` computes the weighted delta (duration/peaks/shape, weights 0.5/0.3/0.2) and emits one `MasteryEvidence{source:'envelope'}` into the shared aggregator (`packages/player-vue/src/composables/useEnvelopeEvidence.ts:65-131`).
- **Wired into the live cycle-complete path**: `LearningPlayer.vue:1696-1729` calls `envelopeMetadataCache.value.fetchBatch([audioId]).then(() => recordEnvelopeEvidence({ sink: sharedEvidenceAggregator, ... }))`, resolving the cycle's target1 audio id from its URL. This directly **contradicts** the stale TODO comment at the bottom of `useEnvelopeEvidence.ts:133-137` ("Not touched here — WP-3 is a concurrent worker's file") — that comment was never updated after WP-3 landed the wiring. Treat the code, not that comment, as ground truth.

**Dormant (flagged off):**
- The whole block above is gated: `LearningPlayer.vue:1703` checks `adaptationV2Config.value.stage2_enabled`, whose **default is `false`** (`packages/player-vue/src/composables/useAlgorithmConfig.ts:306`, `DEFAULT_ADAPTATION_V2`). So in production today, this code path does not execute — no envelope evidence is recorded, no `EnvelopeMetadata` numbers reach the aggregator, `evidence_series` on `learner_lego_metrics` today reflects `latency`+`behaviour` sources only (see §1's stage-1 confirmation).
- Stage 1 itself (rate policy / `planRound`) **is** live, but in shadow mode only (`enabled:true, shadow:true`, `useAlgorithmConfig.ts:305`) — computed and logged (`player_events.adaptation_plan`, `LearningPlayer.vue:4592-4608`), never applied to playback (`applyingAdaptationV2 = !shadow`, `:4591`, `:4609-4637`).

**Net:** stage 2 is fully built and integration-tested, sitting behind one boolean nobody has flipped yet. Flipping `stage2_enabled:true` in `algorithm_config` (a DB row edit, no deploy) is the only step needed to start collecting envelope evidence — assuming mic-consenting learners AND populated `course_audio_envelope` rows (see §3, unconfirmed).

---

## 3. course_audio_envelope — populated?

- **Schema exists.** `CREATE TABLE public.course_audio_envelope` is present in `supabase/schema.sql:5542` (a full schema dump last touched 2026-07-18, i.e. after the 2026-07-14 migration file). The migration itself (`supabase/migrations/20260714_course_audio_envelope.sql`) is headed "Gated migration for Tom to apply — never ad-hoc" with no explicit "APPLIED" marker in this repo, but its presence in the 2026-07-18 schema dump is strong (not certain) evidence it was applied.
- **No pipeline evidence in this repo.** The populating job (WP-7b) is explicitly scoped to the *other* repo: `docs/adaptation/adaptation-v2-build-spec.md:295` — *"Dashboard-repo pipeline job (ssi-dashboard-v7-clean)... own brief."* This repo's migration comment (`20260714_course_audio_envelope.sql:1-8`) names the expected pipeline file (`services/audio-envelope.cjs`) and a shared constants file (`packages/core/src/audio/envelope-extractor-v1.json`) — I confirmed the constants file exists client-side (`packages/core/src/audio/` — referenced from `useEnvelopeEvidence.ts:25`), which is necessary-but-not-sufficient evidence the pipeline was ever built or run. **I found no seed data, no backfill script, no fetch-fallback comment, and no test fixture in this repo indicating real rows exist.**
- **Row counts: cannot verify.** No Supabase credentials, `.env` file, or query tooling were available in this environment (checked `env | grep -i supabase`, `.env*` at repo root, `supabase/` subdirectories, `tools/`). I did not guess. The honest state is: **schema is live, population status is unknown from this repo alone** — would need either DB credentials or a status check from the dashboard-repo side.
- Consequence for stage 2: even if `stage2_enabled` were flipped on today, `useEnvelopeMetadataCache` would very plausibly get all-`null` results (no model row for any `audio_id`), and `recordEnvelopeEvidence` would no-op every cycle (`useEnvelopeEvidence.ts:113-114`, `model` check). Flipping the flag alone is necessary but likely not sufficient.

---

## 4. Per-phrase granularity — grain and retention per store

| Store | Grain | Retention | Key fields | Writer (file:line) | Status |
|---|---|---|---|---|---|
| `response_metrics` | Would-be per-cycle (one row per response) | Would-be append-only | `lego_id`, `response_latency_ms`, `normalized_latency`, `timestamp`, `thread_id`, `triggered_spike` | `SessionStore.ts:205-240` | **Dead** — never written |
| `spike_events` | Would-be per-spike-detection | Would-be append-only | `lego_id`, `latency`, `rolling_average`, `spike_ratio`, `response` | `SessionStore.ts:242-276` | **Dead** — never written |
| `learner_lego_metrics` | **Per-(learner, LEGO) aggregate**, one row per pair, NOT per-cycle/per-phrase | Overwritten in place (upsert on `(learner_id, lego_id)`); the two array columns are **ring buffers capped at 20** samples (`EVIDENCE_SERIES_RING_CAP = 20`, `packages/core/src/learning/evidence.ts:64`; mirrored cap `SERIES_CAP = 20` in `useAdaptationEngine.ts:52`) — oldest samples silently fall off | `mastery_state`, `recent_latency_samples: number[]` (latency-only ring), `evidence_series: {values:number[], x:number[]}` (merged latency+behaviour[+envelope] ring, timestamps in `x`) | `LegoMetricsStore.ts:118/148/175`, called from `useAdaptationEngine.ts:396/426/445` | **Live** |
| `player_events` | **Per-event, timestamped** (`occurred_at`), including per-cycle events (`phase_skip`, `audio_play`, `adaptation_plan`) with `cycleId`/`legoId`/`roundNumber`/`slot` in the JSONB `payload` | **Append-only forever** (no ring, no overwrite) — a genuine timestamped log | `event_type`, `payload` (jsonb, shape varies per event type), `learner_id`, `session_id`, `occurred_at` | `api/player-events.ts:164-201` | **Live** |
| `course_audio_envelope` | Per-audio-file (model side only — one row per mastered clip, not per learner) | Static reference data, no learner dimension at all | `duration_ms`, `peak_count`, `peak_to_mean_ratio`, `mean_peak_width_ms`, `extractor_version` | dashboard-repo pipeline (WP-7b, not in this repo) | **Schema live, population unconfirmed** |

**Direct answer to the framing question — "is there ANY persisted record today linking (learner, specific phrase/cycle id, timestamp, latency, envelope numbers)?":**

**Partially, and only in `player_events`, not in a metrics table with stable typed columns.** `phase_skip` events (`LearningPlayer.vue:6187-6204`) carry `legoId`, `cycleId`, `roundNumber`, `slot`, `elapsed_in_phase_ms`, and `occurred_at` — that is learner (via `learner_id` column) + cycle id + timestamp + a latency-like duration, append-only. But:
- It's a **diagnostic event log**, not a metrics table — the payload shape is per-event-type JSONB, undocumented as a queryable schema, and was explicitly built as "diagnostic," (`usePlayerLog.ts:1-11`) not as a research dataset.
- It does **not** carry the derived VAD `response_latency_ms`/`normalized_latency` used for adaptation, nor any envelope numbers — `adaptationEngine.recordCycle`'s latency value and `recordEnvelopeEvidence`'s delta value only ever reach `learner_lego_metrics`, which is a **rolling aggregate that discards per-cycle identity** (the ring stores `values`/`x` arrays per LEGO, not per phrase-id — you can reconstruct "20 most recent normalized-latency readings for this LEGO" but not "which specific phrase/cycle produced sample #7").
- **Conclusion for the CEFR-anchor study question: not today, in a form that's practical to query.** A longitudinal per-phrase study would need to either (a) mine `player_events.phase_skip`/`audio_play` JSONB payloads keyed by `cycleId` and manually stitch to whatever `adaptationEngine.recordCycle` computed at the same instant (that computed value is never itself logged to `player_events` — only the *plan* is, via `adaptation_plan`, which is round-level not cycle-level), or (b) add a genuine per-cycle metrics event to the pipe. Nothing today gives you `(learner, phrase_id, timestamp, latency, envelope)` as a joinable row out of the box.

---

## 5. ProsodyFeedback.vue / PronunciationOverlay.vue

- **Real, mic-based, reachable by real learners** — not dev-only. Entry point: a "Pronunciation Practice" mode toggle in the player (`handlePronunciationMode`/`handlePronunciationToggle`, `LearningPlayer.vue:9514-9542`), also referenced by an onboarding tip schedule (`TIP_SCHEDULE.pronunciation`, `LearningPlayer.vue:4992`) and a mode-description string ("Record yourself and compare with native speakers," `LearningPlayer.vue:4987`). Lazy-loaded (`defineAsyncComponent`, `LearningPlayer.vue:75`) and mounted via `v-if="showPronunciationOverlay"` (`LearningPlayer.vue:14264`).
- **What it does:** `PronunciationOverlay.vue` uses `AudioRecorder`, `extractPitchContour`, `compareProsody`, `getNativePitchContour` from `@ssi/core/audio` (`PronunciationOverlay.vue:3-8`) to record the learner, extract a pitch contour, compare it against a precomputed native contour, and bucket the result into one of 5 human-readable bands (`crystal`/`clear`/`getting`/`practise`/`tryagain`, `PronunciationOverlay.vue:45-51`) rendered via `ProsodyFeedback.vue` (`PronunciationOverlay.vue:9, :754`).
- **Persistence: none.** The only Supabase calls in either file are `SELECT`s against `course_practice_phrases` (content, to pick which phrases to practice — `PronunciationOverlay.vue:167-185`). No `insert`/`update`/`upsert`/`.from()` write call exists anywhere in either file. The recording, pitch contour, comparison score, and band are computed client-side and shown to the learner, then discarded when the overlay closes — **this is real pitch/F0 analysis that exists in the codebase but produces zero durable data**, and is architecturally separate from the adaptation-v2 envelope pipeline (which deliberately avoids pitch/F0 per the build spec's §8: "No pitch/F0/spectral features — owner decision B is envelope-only").

---

## 6. SessionComplete.vue — what it shows, what data it has

`packages/player-vue/src/components/SessionComplete.vue`. Props-driven, all data passed in from the parent (belt/points/time state computed elsewhere in `LearningPlayer.vue`), plus one own fetch:

- **Displayed:** belt name + progress ring (`:47-49`, `:150-155`), time-to-next-belt estimate (`:158-160`), full belt-journey dot strip (`:163-178`), quick stats — items practiced count, formatted time spent, an encouragement string keyed off item count (`:181-187`, `:52-58`), a `SessionMirror` sub-component fed `pointsEarned`/`newPhrases`/`sessionDuration` (`:190-195`), a "you added N minutes of {language}" contribution snippet fetched via `useLearnerJourney(client).fetchContribution(courseId, learnerId)` on mount (`:97-105`, `:198-203`), and (guests only, after 1+ completed sessions) a signup prompt (`:214-219`).
- **Not displayed, not held:** no latency, VAD, envelope, or prosody data of any kind. `itemsPracticed`/`timeSpentSeconds` are the only session-performance numbers, both coarse counters (not per-item timing). Nothing here reads `learner_lego_metrics`, `player_events`, or any adaptation-v2 state.

---

## Open items / what I could not confirm

1. **`course_audio_envelope` row count and whether the dashboard-repo pipeline (WP-7b) has ever run** — needs either live DB credentials or a check from `ssi-dashboard-v7-clean`.
2. **Whether the two 2026-07-14 migrations (`course_audio_envelope`, `evidence_series`) are actually applied to the live prod/staging DB** — inferred from `supabase/schema.sql`'s 2026-07-18 dump containing both, but that inference is one step removed from a direct `\d` on the live DB.
3. **`response_metrics`/`spike_events` current row counts** — likely nonzero from pre-SimplePlayer history (the tables and their old writer predate the SimplePlayer migration), but stale/frozen since the cutover; exact counts unconfirmed, no DB access.
4. I did not check `docs/adaptation/adaptation-v2-build-spec.md`'s dependent files exhaustively for every WP (e.g., WP-9 boundary sensing) — out of scope for this capture-inventory task, which was about what's captured today, not the full v2 build status.
