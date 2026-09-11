# Cycle 2 (post-#168): two catches, zero misses, four explicit gaps

Measured commit `4bddb1172de5ba6f5236234a12e515c0a7f7d487` on the merge of
`cs/170-stand-up-the-self-improving-test-2` onto `dev` (`d64554741`), with the
one add/add conflict in `e2e/release-audible-control.mjs` resolved in `dev`'s
favour: worker #168's three-case control on the energy predicate in
`e2e/journeys/audibility.mjs`, merged to `dev` as `069ef0c5c`.
Full cycle wall-clock: 46 s (11:49:30 → 11:50:17 UTC, 2026-09-11).

| Breakage | Applied | Suite result | Evidence |
|---|---|---|---|
| Silent lesson audio | Zero PCM WAV substituted in browser | **CATCH** | silence case `correct`, heard=false, clock 1.0 s, RMS -120 dBFS, 0/980 ms above floor. Click and real-clip cases also correct. |
| Belt never advances | Source patch, restored | **GAP: not exercised** | unchanged from cycle 1 |
| Subscribe wall absent | Source patch, restored | **GAP: not exercised** | unchanged from cycle 1 |
| Settings wrong server | Source patch, restored | **GAP: not exercised** | unchanged from cycle 1 |
| Duration not written | Both SessionStore write payloads zeroed, restored | **GAP: not exercised** | unchanged from cycle 1 |
| Blob lesson unrecognised | Shared instrument made to reject blob URLs in scratch | **CATCH** | positive blob GREEN before (exit 0), RED on mutation (exit 1, clock 1.0 s), GREEN after restoration (exit 0) |

Exit 2, for the four gaps. That is honest and expected; they stay GAP until a
safe local learner-level fixture exists for each.

## Red → green proof of the silence control

Same three-case control, same scratch clone at the merged SHA, two instruments:

- **RED** with the pre-#168 `e2e/journeys/lib.mjs` (from `4a1e0bf8d`, the tip
  of cs/170): silence case `wrong`, heard=true, clock 0.204 s, reported audible
  at 573 ms. Click case also wrong. Control exit 1.
- **GREEN** with the merged instrument: silence case `correct`, heard=false,
  clock 1.0 s, -120 dBFS. Control exit 0.

Cycle 1 measured the same transition across branches (`cycle-1.json` red at
clock 0.212616 s; `worker-168-comparison.json` green at `7a3e4a673`). This
cycle reproduces it inside one tree. No threshold in `AUDIBILITY` was touched.

## Finding: the player build dirties the tracked tree

`pnpm --filter player-vue build` runs `tools/walkthrough/compile.mjs --build`
first, which rewrites `docs/handbook-pack.md`, `docs/walkthrough-pack.md` and
`packages/player-vue/src/walkthrough/pack.json` with today's date, same version
hash. Cycle 1 passed the post-build clean-tree assertion only because it ran on
the day those files were last compiled. The runner now restores date-stamp-only
rewrites, records them in `buildRewroteDateStamps`, and still throws on any
other build-time change to tracked files.

`cycle-1.json`, `controls-rerun.json` and `worker-168-comparison.json` are kept
unedited as the pre-fix measurements they are.
