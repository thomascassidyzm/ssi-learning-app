# The dead Welsh intro was a 404, not the clip, the cache or the device

*19 September 2026, job #256. Reproduced, fixed, and verified live on staging.*

## What was wrong

`S0006L01_intro` in `cym_s_for_eng` ("I can't" / "alla i ddim") failed for 35 of the 36
learners who reached it in the week to 19 September — 96 failures, mobile and desktop,
five builds — while the very same three clips played clean in the debut cycle seconds
later. Job #253 proved the clips are healthy and found the exact correlate: the only three
LEGOs in the course with no `presentation_audio_id` are the only three that fail.

The prompt those three intros played was never the known clip. It was
`/api/audio/62889c49-03e0-436d-a009-4aa40ccc6fbe`, and that answers
**404 `{"error":"Audio not found"}`**. The media element got a JSON body, reported
`MEDIA_ERR_SRC_NOT_SUPPORTED` with `readyState 0`, and the intro was skipped. "Starts then
dies 250 ms in" was two error events 140 ms apart — nothing ever sounded.

The id comes from a backfill. When a LEGO has no `presentation_audio_id`, both the client
walk and the bundle route read a 2025 `lego_introductions` row and take its `audio_uuid`
on trust. All three of cym's rows — S0006L01, S0041L01, S0154L02 — name audio that exists
in neither `course_audio` nor `shared_audio`. 47,668 `lego_introductions` rows exist
estate-wide; nothing keeps them honest.

## The two candidates in the memo are both refuted

- **The service worker.** It has cached no audio since 2026-05-24 — `vite.config.js` says
  so in a standing comment where the route used to be. There is no cache entry for an
  undrained `fetch` to poison. Tested anyway, arm by arm, against the live proxy in
  headless Chromium (`e2e/_256-intro-audio-repro.mjs`): bare fetch before, during and
  after `play()`, and a drained fetch first — every arm plays to `ended`.
- **The WAV-blob lane.** It never ran. `readyState 0` means the element never got usable
  bytes from any source.

## The fix, in two layers

1. **A legacy id is not proof of audio.** A `course_audio` row is its own existence proof;
   a `lego_introductions` id is now checked against `course_audio` before use, in BOTH
   backfills — `api/courses/[code]/bundle.ts` (the live path for bundle courses, which is
   cym) and `generateLearningScript.ts` (the walk). One extra `in.(…)` over a handful of
   ids, only on courses that have unlinked LEGOs at all.
2. **A dead narration is not a dead intro.** Every intro whose prompt IS a narration now
   carries the LEGO's own known clip as `known.fallbackUrl` — all three producers emit it,
   and it survives the bundle wire round-trip — and SimplePlayer plays it rather than
   skipping the prompt. The failure is still reported so a dead narration stays visible in
   telemetry; it is no longer counted as a silent skip, because a clip did sound. This is
   the general repair: the estate has thousands of NULL-presentation LEGOs in quieter
   courses, and the next one degrades instead of dying.

## Verified on staging, build `6a89249`

Replaying `S0006L01_intro` on the fix build logs `audio_play` for known, target1 and
target2 — all three sounded — and **zero** `audio_failed` rows of any kind. On the
previous build the same replay logged the known + target1 failures every time. All three
dangling ids are gone from the staging bundle.

## Gaps, stated plainly

- **S0041L01 could not be replayed as a guest.** Seed 41 is past the free preview ceiling,
  so `/cycles` refuses it without a subscription. Its dangling id is gone from the staging
  bundle and it takes the identical code path, but I did not hear it play.
- **Production still fails.** Nothing went to `main`, per the brief. Learners on
  `saysomethingin.app` keep hitting this until the next promotion.
- **The recordings are still missing.** Job #253's item 2 — three short human narrations
  for S0006L01, S0041L01, S0154L02 — is untouched. The intro is now a quiet one, which is
  a degradation, not the article.
- **The watchdog paths do not consult the fallback.** A narration that hangs rather than
  erroring is still skipped. The observed failure class goes through `skipFailedClip`,
  which does.
- **The estate is not swept.** I did not count how many of the 47,668
  `lego_introductions` rows are dangling. The code now refuses them wherever they are, so
  the count is a curiosity rather than a risk.
