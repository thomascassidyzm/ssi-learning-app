# The six learner journeys — repeatable baseline

Measures what a learner actually waits for, against a real deployed build.
Built 2026-09-01 because four separate beliefs about this app turned out to be
wrong the moment somebody measured them.

## Re-run it

```bash
cd packages/player-vue && BASE_URL=https://staging.saysomethingin.app ./e2e/journeys/run-all.sh
```

One journey at a time:

```bash
BASE_URL=https://staging.saysomethingin.app JOURNEY=j3 NET=slow3g RUNS=5 node e2e/journeys/run.mjs
```

## The journeys

| | Journey | t0 (the learner's action) | t1 (what they got) |
|---|---|---|---|
| j1 | New user, cold device, brand new account | app opened | first lesson word audible |
| j2 | Existing learner opens a course they've never opened | tap on the course | first lesson word audible |
| j3 | Returning learner, content already cached | app opened | first lesson word audible |
| j4 | Switch to a course with SOME content cached | tap on the course | first lesson word audible |
| j5 | Screen switching | tap | painted, then interactive |
| j6 | Intermittent signal mid-session | signal drops/returns | did it recover, stall, lie, lose the place |

`NET` is the robustness axis and applies to j1–j5:
`good` (12/4 Mbps, 40ms) · `fast3g` (1.6/0.75, 150ms) · `slow3g` (0.4/0.4, 400ms) ·
`highlatency` (8/2 Mbps but 900ms RTT) · `intermittent` · `none`.

## What it refuses to fake

- **Audible ≠ `play()`, and audible ≠ a clock that moves.** A resolved
  `play()` promise proves nothing, and `currentTime > 0.05s` proves only that
  playback PROGRESSED — total silence progresses perfectly well. Measured
  2026-09-10: a one-second WAV of 16,000 zero PCM samples scored
  `firstLessonAudible=538.5ms` under the old rule, as did a clip that is 95%
  silence with one 100ms tone at the end. The harness now hooks
  `HTMLMediaElement.prototype.play` at document-start, routes each element
  through a Web Audio `AnalyserNode`, and requires RMS above **−45 dBFS** for
  at least **20%** of elapsed play time and at least **150ms** absolute. The
  predicate is pure and unit-tested in `audibility.mjs`; the browser copy is
  built from that same source, so the two cannot drift. Brand chimes and
  silent keepalives are still excluded by URL pattern — which is a filter,
  never the test, since it cannot see inside a `blob:` URL.
- **The level is reported, not just a boolean.** Every journey row carries
  `lessonLevel` (peak dBFS, RMS dBFS, above-floor %) and `audibleLagMs`, the
  gap between the energy criterion being satisfied and the old progress
  inference firing. A clip that is technically audible but recorded far too
  quietly is a real content problem, and this is where it shows.
- **A tap that could not be made is a gap, not silence.** If
  `createMediaElementSource` throws, the error is recorded in
  `audioTapErrors` rather than being read as a quiet clip.
- **Controls, both directions.** `e2e/release-audible-control.mjs` runs three
  clips through the real instrument: silence must be refused, a 95%-silent
  clip with a click at the end must be refused, a real bundled lesson clip
  must be heard. `node --test e2e/journeys/audibility.test.mjs` runs those
  plus the pure predicate.
- **Painted ≠ "the DOM changed".** A MutationObserver waits for real
  structural change, then a double `requestAnimationFrame`, so the number is
  when pixels could have hit the glass.
- **A journey that never produces sound is recorded as one.** It is never
  dropped from the median to improve it.
- **Warm caches are earned, not simulated.** j2–j5 boot the app, play it, and
  let it write its own caches, then restart the browser on the same on-disk
  profile.
- **Spread is always reported.** A metric that varies 3x between runs is
  itself the finding.

Results (per-run JSON, waterfalls, screenshots, summary) land in
`$CS_SCRATCH/journeys/<journey>-<net>/`.
