# Pods playing immersion-only at 2× — what SHOULD happen, what IS happening

Job #704, 2026-09-06. Read-only investigation. No learner progress was changed.

**Headline.** The pods are behaving exactly as the live configuration tells them to. Terminal
stage = one bare target clip at 2×, and the 1.0 speed ceiling was deliberately retired for pods
on 2026-08-24. **But Tom's Chinese state is not earned by listening.** His pod counter says 461
sentences covered; his own telemetry shows 43 completed laps, and during the months he was
actually listening a lap served him about 30 sentences, not 367. The counter was inflated by the
OLD position-coupled model — it climbed 43 → 459 between 10 June and 31 August on **two** played
laps — and job #657 faithfully restored that already-inflated number. So: the sound is correct,
the position that produced it is not.

Seeds: confirmed unconditioned, one line, as Tom's second listen said. `useLayer1Scheduler.ts`
reads `policy.pattern` (target · known · target2 · target) and runs its speed through
`resolveListeningSpeed`, which is hard-clamped at 1.0. The pod-lap ratchet never enters Layer 1.
Nothing was changed there.

---

## SHOULD vs IS

| | SHOULD | IS |
|---|---|---|
| **Seeds (Layer 1)** | t · k · t · t, all 1×, no cascade, no ratchet | Exactly that. Pattern from the shared listening policy; speed through the 1.0 clamp. The `listening` config row's `layer1StagePlaylist` / `layer1Playlist` keys are not on the learner path. |
| **Pods (Layer 2), a new sentence** | "come in at t k t t 1× and then do that again on next play" | Exactly that. Live `pods` row: stage 1 = `['ps','trans','ps','ps']`, `stageDurations: {1: 2}` — two laps at t k t t 1×. |
| **Pods, the cascade** | "cascade up through the stages as defined in the POD-1 configurations" | Exactly that. Live 8-stage fade ladder, 5 laps per stage: 1× → one 2× rep → two → drop the second target → drop the first → drop the translation → `['ps2x']`. Terminal from the 33rd lap a sentence has been alive. |
| **Pods, speed at the top** | (Tom's ruling 2026-08-24) 2× is correct at the end | Correct and deliberate. `usePodLapScheduler.ts` documents it: "THE 1.0 CEILING IS RETIRED FOR PODS, DELIBERATELY (Tom, 2026-08-24) … reaching the eternal bare-target-at-2× stage IS the completion signal." The clamp still binds every non-pod listening path. |
| **Which cohorts are at the top** | the ones the learner has genuinely heard ~33 times | For Tom on Chinese: **all 367 of them.** Counter 461 > 367 sentences + 32 laps of ladder, so every cohort is past the top of the ladder. Hence one lap = 367 sentences × 1 bare 2× clip = 383 plays. That is the "hefty, no drills, immersion only" he heard. |

The mechanism, precisely: a cohort's stage is `podStageFor(1, alive, …)` where `alive` is derived
from the course-wide counter `course_enrollments.completed_pod_rounds` minus that cohort's ordinal.
It is not a per-sentence count of real hearings.

---

## The one question: earned or manufactured?

**Manufactured — but not by #657.** Evidence, all from live rows:

- **Real listening.** 68 `pod_lap_end` events on zho_for_eng for Tom ever, 43 of them completed,
  spread 7 May → 6 September. The May–June laps report `playsExpected` 111–123 — under the
  then-live four-play pattern that is roughly **30 sentences per lap**, not 367.
- **The counter's climb has no laps behind it.** Lap history by `podRound`: 19 → 43 across May and
  June (many laps), then **43 → 188 → 459 with exactly two laps played** (31 July, 31 August).
  A counter that moves 416 places on two laps is not counting listening; it was tracking main-flow
  position, which is what the pre-2026-09-05 model did.
- **#657 restored, it did not invent.** Its applied log takes the maximum `podRound` in Tom's own
  telemetry (459) and stores 460. The restore is faithful to what the app had already served him.
  The inflation predates it. `cursor_untouched: true`, `reread_matches_target: true` — the restore
  did what it said.
- **`learner_pod_state` cannot corroborate anything.** All 367 rows for Tom/zho carry one identical
  `updated_at` (2026-09-06T12:42:29Z) and exposures 95…460 — a single write, values equal to the
  derived floor. That is by design: `usePodLapScheduler` pushes `{exposures: alive}` for every
  sentence a lap serves, so the "second door" mirrors the derived counter rather than witnessing
  anything independently. There is **no** per-sentence record of real hearings anywhere.

So the honest reading: the earliest ~30 Chinese cohorts have genuinely earned their place at the
top of the ladder. The other ~330 inherited it from a counter that grew with his main-course
position while he was not listening.

**Nothing here is proposed as a write.** If the counter should be brought down to something
listening-derived, that is a Tom call and a separate job.

---

## The design fork this exposes — Tom's call, no recommendation offered

**(a) What the code does today.** Terminal stage is eternal: `['ps2x']`, one bare target clip at 2×,
for ever. Once a pod sentence has been alive for 33 laps it never again plays with its translation
and never again plays at 1×. A learner who has been with a course a while therefore ends up with
every pod sentence in immersion-only, and a single lap becomes a long unbroken run of 2× target
audio — 367 clips, in Tom's case.

**(b) The alternative.** The ladder could stop short of bare-target — hold at a stage that keeps
the translation or a 1× rep — or the top stage could cycle rather than pin, so mature material
occasionally drops back to a fuller pattern.

That is a taste call about what "finished" should sound like, and it is yours.

---

## Two smaller findings

1. **A code comment is lying.** `usePodLapScheduler.ts` line ~122 says the nine-stage map is "DEAD
   ON THE LEARNER PATH" because `listeningUseStagePlaylist` "is not" set. The live `listening` row
   in `algorithm_config` has `"listeningUseStagePlaylist": true`, description "stage playlist ON
   2026-08-24". The stage ladder is the live learner path for everybody. Comment corrected in this
   job; no behaviour changed.
2. **This is a config-shaped behaviour, not a code-shaped one.** The ladder, its durations and the
   2× come from two live DB rows (`algorithm_config.listening`, `algorithm_config.pods`), not from
   a deploy. Retuning any of it is a Supabase edit.

---

## Method and gaps

Read-only throughout: PostgREST reads against the live Supabase with the service key, plus the
`#657` applied log from git. No writes, no test suite (read-only work, per the standing rule).

**EXPLICIT GAP — no reproduction by ear.** I did not sign in to staging as Tom and listen; that
would need his session and risks touching his state. The reproduction is by evidence instead: the
12:42Z lap on 6 September recorded `playsExpected: 383, playsCompleted: 385, abortReason:
"completed"` on 367 sentences whose every cohort computes to the terminal `['ps2x']` stage. That is
the sound he described, reconstructed from the row the player itself wrote.

Note also: dev, staging and production share one database, so every number here is a statement
about real production state.
