# Correcting Tom's Chinese pod counter — and the counter that inflated it

Job #706, 2026-09-06. One learner, one course, one column. The code fix came first.

## Headline

Tom's `zho_for_eng` pod counter read **461**. His own listening justifies **44**.

And the inflation did not come from where #704 said it did. It was not inherited from an old
position-coupled model, and #657 did not faithfully restore an already-inflated number. **#657
created the whole of it, on 2026-09-05, five hours before Tom heard the result** — because its
derivation read a round LABEL as a lap COUNT, and counted a Layer-1 seed cup as a pod lap.

## The root cause, precisely

`scripts/pod-position-audit/pod-ratchet-restore.cjs` derived "laps completed" as:

```js
laps: podRounds.length ? Math.max(...podRounds) : 0
```

Two defects in one line.

**1. A label read as a count.** `podRound` is the round a lap represents, not a tally of laps. One
lap labelled round 326 was credited as 326 laps.

**2. Layer-1 cups counted as pod laps.** A Layer-1 "seeds in the cup" lap is shaped into a `PodLap`
and played down the same path, so it emits `pod_lap_start` / `pod_lap_end` under the same name —
and its `podRound` is the **main round number** (`LearningPlayer.vue`, the L1 block:
`podRound: completedMainRound`, with the comment "L1 has no ratchet — nothing to persist").
Layer 1 shipped 2026-06-03 (`76a6af1a`).

Tom's two "laps with a 416-place jump behind them" were cups:

| when | podRound | plays | child `audio_play` rows |
|---|---|---|---|
| 2026-07-31 00:51 | 188 | 8 | 6 × `ps` + 2 × `trans`, **all `stage: 0`** → Layer 1 |
| 2026-08-31 09:58 | 459 | 32 | 24 × `ps` + 8 × `trans`, **all `stage: 0`** → Layer 1 |
| 2026-09-06 12:42 | 460 | 383 | **367 × `ps2x` at `stage: 8`** → a real pod lap |

`stage: 0` is the Layer-1 signature; a pod play carries its ladder stage. The 111–114 anomaly of
2026-06-03 14:27–15:01 is the same thing, and it appears on the very day Layer 1 shipped.

The #657 fleet applied log records the consequence in its own numbers:

| learner | course | before | `telemetry.laps` | completed events | written |
|---|---|---|---|---|---|
| Tom | zho_for_eng | **0** | 459 | 17 | **460** |
| Tom | hrv_for_eng | **0** | 223 | 4 | **224** |
| fransetter | cym_s_for_eng | **0** | 326 | 1 | **327** |
| jamesharvey1992 | hin_for_eng | 0 | 1 | 1 | 2 |
| nba4191 | hye_for_eng | 0 | 1 | 1 | 2 |

`laps` and `completed events` disagreeing by two orders of magnitude is the defect, stated by the
log itself. Tom's row was **0** before #657 — a course reset had zeroed it — so every one of the
461 came from that script.

**The app's own ratchet is sound.** `markLapCompleted()` advances via `podRatchetAfterLap` and is
called only on a completed Layer-2 lap; `persistRatchet()` writes what that produced; `reset()`
zeroes. Nothing writes the counter from a position. `git log -S completed_pod_rounds` across the
column's whole life shows no backfill and no position-coupled write since the 2026-05-04 migration,
which added the column with `DEFAULT 0` and no backfill. The defect was in the repair tool, not in
the thing it repaired.

## The fix

`scripts/pod-position-audit/podLapTelemetry.ts` — the derivation, layer-aware and counting laps as
laps. The discriminator ladder: the `isLayer1` boolean (added 2026-08-31) when present; then "it
happened before Layer 1 shipped, so it is a pod lap"; then the child `audio_play` rows' max
`stage`; otherwise **unknown, and an unknown lap is never counted**.

`scripts/pod-position-audit/podLapTelemetry.test.ts` pins it. Against the old shape 5 of its 10
tests fail, including `expected 459 to be 11`. It rides `pnpm test:api` (1786 passed).

## The derivation — what Tom actually earned

Unit first. `completed_pod_rounds` stores **sentences covered**, never laps (`podCohorts.ts:212`).
`zho_for_eng:pod-1` serves 231 turn rows → **367 sentences → 366 cohorts** (a two-sentence
cold-start pair, then one sentence per lap).

His genuine Layer-2 pod laps, from `player_events`:

* **2026-05-07 → 2026-06-10**: laps labelled podRound **19 through 43**, continuously, 25 distinct
  rounds. Under that era's model `podRound ≡ completed_pod_rounds + 1`, so completing the lap
  labelled 43 left the counter at **43**.
* Rounds 1–18 have no telemetry at all: `pod_lap_start`/`pod_lap_end` only shipped on 2026-05-07
  16:06 (`1e5f87bd`), an hour before his first recorded lap. Those laps were played; the events
  simply did not exist yet.
* **2026-06-10 → 2026-09-06**: no pod laps. The two events in that gap are the Layer-1 cups above.
* **2026-09-06 12:42**: one genuine completed pod lap (383 plays over all 367 sentences at stage 8 —
  the immersion wall he described). `podRatchetAfterLap(cohorts, 43) = 44`.

**Target: 44.**

### The alternative figure, and why it is not the one written

Replaying `podRatchetAfterLap` once per completed pod lap from 0 gives **37** (36 completed laps).
That method is right for a learner whose whole history is telemetered — it is what restored
beunollyn correctly — but it is wrong here in both directions at once:

* it cannot see the 18 laps that predate the telemetry, and
* it over-counts 11 May laps that re-played a podRound already played (the ratchet was not
  persisting across those sessions — 19, 20, 19, 19, 19, 20, …), crediting intake that never
  happened.

43 is read directly off the label of the last lap he completed before the gap, which is the stored
value itself. It is the better-evidenced number, and it is the one he was told and agreed to.

### The completed-vs-all-laps choice

Counted **completed laps only** — a lap the learner abandoned did not earn its intake, and
`markLapCompleted` is only called on completion. For the record: 71 `pod_lap_end` events on
zho_for_eng, of which 36 are completed Layer-2 laps, 9 are completed Layer-1 cups, and the rest were
cancelled or skipped. (#704's "68 events, 43 completed" is superseded: its 43 was the max podRound,
not a count.)

## The write

| | before | after |
|---|---|---|
| `course_enrollments.completed_pod_rounds` (Tom, `zho_for_eng`) | 461 | **44** |

Nothing else on the row was touched — not `pod_activation_round`, not `rounds_since_pod`, not the
main-flow cursor, not `learner_pod_state`. Applied log with the full before-state:
`docs/pod-position-audit/pod-ratchet-correction-applied-log.json`.

Authorised by Tom, 2026-09-06 — asked "Shall I correct your Chinese counter to what you actually
earned?", he answered **"1 - yes"**. The tool's `greatest()` rail, which can only raise a counter,
is bypassed by an explicit `--allow-lower` flag that refuses `--fleet` and carries that ruling in a
comment naming the one account and one course it is authorised for. Every other learner in #704's
census has more real laps than counter — genuinely earned — and lowering one of those would take
listening away from somebody who did it.

## What this means for the sound

At 44 sentences covered, cohorts 1–12 are at the terminal `['ps2x']` stage (alive ≥ 33) and the
rest are mid-ladder. A lap is ~45 sentences, not 367 — minutes, not ten minutes — and most of it
comes with its translation and a 1× rep. The 33-lap ladder is unchanged: Tom ruled that question
"not a well formed questino" and it stays exactly as it is.

## Reported, not written

* **Tom / `hrv_for_eng` (Croatian) — counter 224, true value 13.** This is the row #704's table
  labelled 86%; Tom has no `cym_*` enrollment, so the "Welsh" figure he was shown is Croatian. Both
  derivations agree here: 12 completed pod laps, highest completed pod round 13, replay 13. Same
  #657 defect — one Layer-1 cup at main round 223 on 2026-06-16. **Awaiting Tom's ruling.**
* **The five Welsh counters.** Every `cym_n` and `cym_s` pod is `visibility='held'`, so none of
  these learners hears a Welsh pod today whatever their counter says — the counters address held
  content, not missing delivery.

  | learner | course | counter | real completed pod laps | highest pod round | reading |
  |---|---|---|---|---|---|
  | fransetter | cym_s_for_eng | 327 | **0** | — | pure #657 artefact, from one Layer-1 cup at main round 326 |
  | Morgan | cym_n_for_eng | 82 | 63 | 81 | **earned** — real pod listening through July, on content since held |
  | stormhborum | cym_n_for_eng | 12 | 6 | 5 | modestly ahead of its laps; not #657 |
  | danielwithington91 | cym_n_for_eng | 2 | 1 | 1 | correct (cold-start pair) |
  | michael204351 | cym_n_for_eng | 1 | 1 | 1 | correct |

  Nothing here was written. fransetter's 327 is the loudest and is the same defect as Tom's.
