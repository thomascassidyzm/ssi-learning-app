# The audible check now measures sound, not time

**2026-09-10 · job #168 · branch `cs/168-fix-the-audio-audible-check-to-m` · not merged**

Tom: *"it has no ears though, so it should use some kind of volume energy detections."*
This is what that came to.

## The defect, reproduced

`packages/player-vue/e2e/journeys/lib.mjs` decided "the learner heard a word" from a
`timeupdate` event with `currentTime > 0.05`. That establishes playback **progressed**.
Total silence progresses perfectly well.

Measured on the pre-fix code, in a bare page, no network:

| clip | old verdict |
|---|---|
| 1s WAV, 16,000 **zero** PCM samples | **lesson audible at 538.5ms** |
| 2s WAV, 95% silence + one 100ms tone at the very end | **lesson audible** |

Every learner-journey baseline and the schools harness stand on that call.

## The fix

Each media element is routed through a Web Audio `AnalyserNode`, connected onward to
the destination so playback is unchanged, and polled every 20ms. Two conditions, both
load-bearing:

- **Floor — RMS above −45 dBFS** over an analyser window. Below that is dither and
  room tone, not a word.
- **Fraction — at least 20% of elapsed play time above the floor, and at least 150ms
  absolute.** Energy at a single instant is a click. Without the absolute minimum the
  first two ticks of any clip are 100% of elapsed time and everything passes at 40ms.

The predicate is pure and unit-tested in `e2e/journeys/audibility.mjs`. The in-page copy
is **built from that same source** by `toString`, so the tested code and the running
code cannot drift.

## The controls — both directions, with numbers

`node packages/player-vue/e2e/release-audible-control.mjs` (extends the control written
by job #157·G, whose finding started this).

| control | expected | measured | verdict |
|---|---|---|---|
| 1s of zero PCM | refused | peak **−120 dBFS**, RMS **−120 dBFS**, **0%** of 980ms above floor | **refused ✓** |
| 2s, 95% silence + 100ms tone at end | refused | peak −4.3 dBFS, RMS −7.3 dBFS, **5%** of 1980ms above floor | **refused ✓** |
| real bundled lesson clip `0B3EB395…mp3` | heard | peak **−3.9 dBFS**, RMS **−12 dBFS**, **79.9%** of 300ms above floor | **heard ✓** |

Run under `--mute-audio`, the flag the journey harness itself launches with: the
analyser still sees real samples under it, which was the trap worth checking.

## How the thresholds were chosen — and what they cost

Not by tuning until everything passed. Every one of the 16 clips bundled in
`packages/player-vue/public/audio/` was measured through the new instrument:

- RMS across the 15 real lesson clips: **−7.7 to −13.0 dBFS**
- above-floor share: **74% to 96%**
- digital silence: **−120 dBFS**, 0%

The −45 dBFS floor sits about **30 dB below the quietest real clip** and about 75 dB
above silence. The gap is enormous, which is the point: the floor is nowhere near any
real content, so it was not calibrated to agree with the old false greens. The 20%
fraction has similar headroom — the worst real clip is 74%.

## Impact count

**Clips that passed the old check and fail the new one: 0 of 16.**

| set | old passes | new passes | newly failing |
|---|---|---|---|
| 15 bundled lesson mp3s + 1 brand wav | 16 | 16 | **0** |

**Honest gap.** That is the enumerable offline set. Live-course clips served through
`/api/audio/<id>` and the IndexedDB blob path were **not** swept — doing so needs a real
account, staging traffic and a full journey run, which is outside this job's price. The
new check is strictly more likely to refuse than the old one, so any change there is a
refusal, never a new false green. If a live clip is quiet enough to fail, that is a
content problem the check now surfaces, and `lessonLevel` on every journey row is where
it will appear.

## What changed, and what deliberately did not

Additive only. `waitAudible(page, deadlineMs)` keeps its signature and its
null-on-timeout contract; the verdict shape is unchanged; `journeys/run.mjs` and
`schools/run.mjs` needed no structural change. New fields:

- `window.__audio.lessonLevel` — `{ peakDbfs, rmsDbfs, aboveFloorPct, aboveFloorMs, elapsedMs }`
- `window.__audio.firstLessonProgressed` — the **old** inference, kept as a separate
  field so the shift in the recorded baselines is measurable rather than silent
- `window.__audio.tapErrors` — a tap that could not be made is a gap, never a silent verdict
- journey rows: `lessonLevel`, `audibleLagMs`, `audioTapErrors`; summary: `lessonRmsDbfs`,
  `lessonPeakDbfs`, `audibleLagMs`, `audioTapErrorRuns`

`firstLessonAudible` now means *the moment the energy criterion was first satisfied*,
which is the honest reading of "first word heard". It will sit later than the old number
by roughly the time it takes to accumulate 150ms of signal. `audibleLagMs` records that
distance per run, so the next baseline can state the shift instead of quietly absorbing it.

**No bypass flag.** There is no switch back to the old behaviour.

## Still carrying the same defect — reported, not fixed

Six standalone probes keep their own private copy of the old instrument and still infer
audible from `currentTime > 0.05`. They were deliberately out of scope tonight:

- `e2e/first-play-latency-probe.mjs`
- `e2e/cold-start-readiness-probe.mjs`
- `e2e/returning-learner-latency-probe.mjs`
- `e2e/upfront-download-budget-probe.mjs`
- `e2e/_bootfallback-probe.mjs`

(`e2e/versioned-clip-cache-probe.mjs` was named in the brief but does not test audibility
at all — it has no `timeupdate` or `currentTime` logic.)

Any number those five have produced about "first word heard" carries the same risk.

## The proving test

`node --test packages/player-vue/e2e/journeys/audibility.test.mjs` — eight pure-predicate
cases plus the three browser controls. Seen **failing on the pre-fix code** (the browser
control exits 1: silence and click-at-end both misclassified as audible) and **passing on
the post-fix code** (exit 0, all three correct). `e2e/journeys/run.guard.test.mjs`, which
guards this area, still passes.
