# The Stage 1 explainer repeat is cancelled — one bite, not two

**Tom's ruling, 2026-08-10:** "we don't want it at all — the visualisation covers
the need to explain." The karaoke-scroll teleprompter does the explaining job, so
audio-repeating a sentence's introduction a second time is redundant. Stage 1 now
lasts ONE pod-round, like every other non-repeating stage.

## The honest headline

**No learner was ever hearing it twice.** The commission's premise — "Stage 1
currently runs for 2 pod-rounds so the sentence is heard twice" — is true of the
code's *retired* stage ladder, and not true of what a learner actually gets.

The nine-stage ladder stopped driving listening on 2026-08-07, when the one-mode
redesign landed. I confirmed that against the live database rather than the code
comments: the `listening` row in `algorithm_config` carries no
`listeningUseStagePlaylist` key at all, and the code only enables the ladder on
`=== true`. There is one global `listening` row — no per-course variant — so
there is no course anywhere that turns the ladder back on.

So the ruling needed no behaviour change to be satisfied. That is the answer, and
it is a real answer rather than a fix.

## What I changed anyway, and why

The retired ladder was still *encoding a cancelled intent*. If anyone flips the
escape hatch on later — the admin auditioner is a deliberate audition path — they
would silently get the two-bites behaviour Tom has now ruled out. Aligning the
default is one line and it costs nothing:

- `usePodLapScheduler.DEFAULT_STAGE_DURATIONS`: `{1: 2, 2: 3}` → `{1: 1, 2: 3}`
- `useAlgorithmConfig.DEFAULT_PODS.stageDurations`: `{'1': 2, '2': 3}` → `{'1': 1, '2': 3}`
- comments in both files rewritten to state the current truth and cite the ruling
- `apml/learning/listening-layers.apml` updated with the ruling and its date

**The trap, avoided and pinned:** stage 1 stays *listed* at 1 rather than deleted.
An unlisted stage falls back to `DEFAULT_STAGE_DURATION`, which is 5 — deleting
the key would have made stage 1 last five rounds, the exact opposite of the
ruling. There is now a test asserting that.

## What I deliberately did NOT touch

- **The `'explainer'` slot stays in `DEFAULT_STAGE_PLAYLIST[1]`.** The ruling was
  about the *repeat*, not about the explainer audio existing, and the slot is the
  admin `PodStageAuditioner`'s audition path. Removing it would be a second,
  unasked decision.
- **The live `pods` row in `algorithm_config`**, which still carries
  `stageDurations {'1': 2}` and overrides the code default wherever the ladder
  loads. That is a live-data change on real learners and it is Tom's call — and
  it is moot while the ladder is off the learner path. Flagged, not done.
- **The 86 inflated `completed_pod_rounds` counters** and **the 2026-07-22
  karaoke-scroll decision** — Tom ruled "leave" on both.

## Live evidence

Playwright + chromium against the dev alias, guest path, Chinese-for-English,
White Belt. Real telemetry intercepted from the app's own
`POST /api/player-events` — not inference, not scraping.

Every pod lap played the same four-slot pattern at one speed:

```
pod_lap_start podRound=1 plays=8
  role=pod_intro                              speed=1
  role=ps     stage=1 sentenceIdx=1  speed=1     <- target
  role=trans  stage=1 sentenceIdx=1  speed=1     <- known-language translation
  role=ps     stage=1 sentenceIdx=1  speed=1     <- target
  role=ps     stage=1 sentenceIdx=1  speed=1     <- target
  role=ps     stage=1 sentenceIdx=2  speed=1
  role=trans  stage=1 sentenceIdx=2  speed=1
  role=ps     stage=1 sentenceIdx=2  speed=1
  role=ps     stage=1 sentenceIdx=2  speed=1
  role=pod_outro                              speed=1
pod_lap_end
```

Across the laps observed: the role `explainer` appears **zero** times, every clip
plays at speed 1.0, and the DOM shows `PodTurnDisplay` mounted with `LegoAssembly`
absent throughout — the karaoke scroll, no tile breakdown.

The decisive point is stronger than a count of rounds: under the one-mode policy
there is **no stage-1-specific introduction at all**. Every stage plays the same
pattern, so there is no distinct "explainer introduction" for a sentence to
receive a second time. The behaviour Tom cancelled has no mechanism left to fire.

An independent probe run in parallel (job #66) reproduced this separately: three
consecutive laps, 28 telemetry events, `explainer` zero times, every clip at
speed 1.0, `PodTurnDisplay` mounted and `LegoAssembly` absent. Its own residual
doubt — that some other course might enable the ladder — is closed by the DB read
above: there is a single global `listening` row and the key is absent.

### EXPLICIT GAP — what I could not observe live

**I did not watch a cohort cross from one pod round into the next on the real
(non-preview) learner path.** I tried: a plain `?reset=1&stream` session ran for
~8.5 minutes of continuous speaking cycles (`target1`/`target2`/`known`, all at
speed 1.0) and never reached pod activation — pods fire from main round 5, and
real-time round pacing does not get there inside the window I can hold a
foreground browser session open. An earlier, longer attempt was killed by session
teardown before it flushed any output.

So all pod-lap evidence here — mine and job #66's — comes from the `?podview=1`
preview cheat, which presents laps back-to-back at `podRound: 1` rather than
ageing a cohort. What that evidence proves is that no explainer clip is ever
played and every lap is one identical four-slot pattern at one speed. What it does
not directly show is a specific sentence being served in pod round 2. Under
one-mode those two rounds would be byte-identical anyway, which is why the gap is
narrow — but it is a gap, and it is stated rather than papered over.

## Feedback loops

`@ssi/core` build, `player-vue` typecheck, `player-vue` test (215 files, 2061
tests), `player-vue` lint (0 errors) — all green.

Test assertions deliberately flipped, named for audit:

1. `usePodLapScheduler.test.ts` — "per-stage durations: Phase 0 …" retitled to
   ONE round and its whole ladder recomputed: alive 2 is now stage 2 (was stage 1
   iter 2); alive 4 is stage 2 iter 3; alive 5 is stage 3 iter 1; alive 9 is
   stage 3 iter 5; the transitional total drops from 35 to 34, so the eternal
   stage 9 starts at alive 35 rather than 36.
2. `usePodLapScheduler.test.ts` — cohort-ageing test: sentence 4 at alive=2 now
   reports stage **2**, where it reported stage 1 under the old two-round Phase 0.
   Its title and comment were corrected to match.
3. New test added: stage 1 is listed at 1 and an *unlisted* stage still inherits
   the five-round default — the trap this change had to avoid, pinned shut.

The "string-keyed durations (JSON config shape)" test was left alone: it passes an
arbitrary literal map to prove string-key handling, and does not encode the default.
