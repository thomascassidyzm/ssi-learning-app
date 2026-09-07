# Beuno's pod laps — restored, and who else was zeroed

**Job #656 · 2026-09-05 · Tom's ruling: "Beuno's listening pods should not have been reset, give them back to him on whatever lap he was at."**

---

## 1. Restored — and the numbers, cold

Learner `beunollyn` (`884a23bf-b5ca-4558-b297-c826b04c6dc7`), course `deu_for_eng`, live production row:

| field | before | after |
|---|---|---|
| `completed_pod_rounds` | **0** | **4** |
| `rounds_since_pod` | **5** | **5** — unchanged, as required |
| `pod_activation_round` | `null` | `null` (informational; nothing reads it since #649) |

**4 is not "4 laps".** `completed_pod_rounds` stores **sentences covered**, not laps
(`packages/core/src/pods/podCohorts.ts:212`). Under the cohorts `deu_for_eng` serves today,
4 is the sentence-boundary at the end of **lap 3** — `podCohortRoundFor(cohorts, 4) = 4`,
i.e. he has finished rounds 1-3 and his next lap is round 4.

The write went through `greatest()`, so it could only raise; it was scoped to that one
learner-course; `rounds_since_pod` was never in the SET list. **The database write is the
deployment** — it took effect the instant it ran, independent of any merge, and the row above
was re-read afterwards from a separate connection to confirm it.

## 2. What the lap count was derived from

Not from a report. From his own `player_events` rows, `event_type = 'pod_lap_end'`, filtered to
`payload.abortReason = 'completed'` with `cancelled` and `skippedByUser` both false:

| event id | when | `podRound` | plays expected → completed |
|---|---|---|---|
| 618362 | 2026-08-06 13:10:38Z | 1 | 12 → 14 |
| 633929 | 2026-08-07 12:03:02Z | 2 | 32 → 34 |
| 649686 | 2026-08-08 15:59:32Z | 3 | 44 → 46 |

Three laps, each with a matching `pod_lap_start`, each finishing more plays than it expected.
No aborted or skipped lap exists in his history, so nothing was discarded. Max `podRound` = 3.

## 3. Lap 3 → stored 4, and why that is the conservative reading

Computed with the shipped pure functions, not a reimplementation: today's live pod
`deu_for_eng:pod-1` (231 turn rows → 389 sentences after the per-sentence split) →
`buildPodCohorts` → 388 cohorts (the cold-start floor merges the opening two sentences;
everything after is one sentence per lap). Then `podRatchetAfterLap` applied three times from 0:

```
lap 1 → stored 2   lap 2 → stored 3   lap 3 → stored 4
```

**This is deliberately conservative, and here is the honest gap.** The pod he actually heard in
August was `deu_for_eng:pod-0`, retired 2026-08-22, under the *exchange* cohort model — his lap 3
played 44 clips, far more content than four of today's sentences. Today's live pod is different
content he has never heard. Crediting him with the lap number under today's shape means he
re-hears the opening of pod-1 rather than being credited with content he never met. That is the
right side to err on, and it is the side this whole week's work exists to protect.

## 4. Was Beuno the only one? No.

**The class exists and it has more than one member.** The query: every learner-course with at
least one `pod_lap_end` carrying `abortReason = 'completed'` (cancelled/skipped excluded), joined
to its `course_enrollments` ratchet. That is the query that would have found others, and it did.

Of 153 learner-courses with proven completed laps: 99 carry a healthy ratchet, 30 have no
enrollment row at all, and **24 read `completed_pod_rounds = 0` despite proven laps**.

**But 24 overstates it.** No healthy ratchet anywhere in the fleet has a last completed lap before
**2026-06-12** — before that date the ratchet simply was not being persisted, so a May/early-June
zero is "never written", not "zeroed". Filtering to laps completed *after* the ratchet was live
leaves **seven** genuine members of the class, Beuno excluded (he is now fixed):

| learner | course | completed laps | last completed lap | `pod_activation_round` | internal? |
|---|---|---|---|---|---|
| **paddyhardy** | rus_for_eng | 10 | 2026-09-03 | null | real learner |
| **Stephen** | afr_for_eng | 3 | 2026-08-01 | null | real learner |
| **fransetter** | cym_s_for_eng | 1 | 2026-08-22 | 26 | real learner |
| **jamesharvey1992** | hin_for_eng | 1 | 2026-06-25 | null | real learner |
| Tom | zho_for_eng | 17 | 2026-08-31 | 456 | internal |
| Tom | hrv_for_eng | 4 | 2026-06-16 | null | internal |
| nba4191 | hye_for_eng | 1 | 2026-06-23 | null | internal |

**Nothing was restored for any of them.** Tom ruled on Beuno; a second learner is a second
person's experience changing under them, and that is his call.

### The one-line decision for Tom

> Four real learners — paddyhardy (10 laps, still active three days ago), Stephen (3), fransetter (1),
> jamesharvey1992 (1) — carry Beuno's exact fingerprint. Restore theirs the same way, or leave them?

`paddyhardy` is the one that matters: ten completed laps, last one on 2026-09-03, and a zeroed
ratchet. He is an active learner losing pod position right now.

## 5. Gaps, stated plainly

- **"Reset" is inferred, not logged.** There is no reset audit trail; the fingerprint is
  circumstantial — telemetry proves laps, the counter says none. It is the same fingerprint #648
  identified on Beuno, and Tom has ruled on Beuno regardless, but for the other seven the
  fingerprint is evidence, not proof.
- **Beuno's August content is gone.** `deu_for_eng:pod-0` is retired, so his real position in the
  content he heard cannot be mapped forward exactly. §3 says what was done instead.
- **The 30 learner-courses with no enrollment row** were not investigated — different class,
  out of scope here.

## 6. Files

- `scripts/pod-position-audit/pod-ratchet-restore.cjs` — derivation, `greatest()` restore
  (dry-run default, `--apply`), and the read-only `--fleet` census.
- `docs/pod-position-audit/pod-ratchet-restore-applied-log.json` — the applied log, carrying the
  before-state, so it is also the rollback.
