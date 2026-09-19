# Live proof on staging: the seed-phase tier is gone, and pods come round by mode

Job #233, the night of 2026-09-18, against `staging.saysomethingin.app` serving build **16589cc**
(`promote: dev→staging`, commit `16589cc0d`, built 21:35Z and verified in every run's own log line).
Nine runs, each a real session on the Mr Tom Tester account, driven through the real transport
control and read back from `player_events`.

The two rulings under test (Tom, 2026-09-18):

1. **A drained seed is never re-served.** Spaced rep stops at offset **89** — the seed-phase review
   tier at offsets ≥144 is deleted on every producer. A drained seed reaches the learner through the
   cups listening interlude and through nothing else.
2. **Pods by mode.** Layer-2 pods every **2** completed rounds on EASY, every **4** on FAST. Cups
   (layer 1) are a different thing and still come every round.

## What the probe drives

`packages/player-vue/e2e/_233-pod-cadence-probe.mjs` — one run per (course × mode). It parks the
learner's mode and the enrolment's `rounds_since_pod` work debt, taps the real centre transport
button (`BottomNav.vue`'s `button.center-btn`, then asserts it has turned into the stop icon),
plays, and reads that run's own rows out of `player_events` **filtered to the run's own course**.

A layer-2 pod is `pod_lap_start` with `isLayer1: false`; a cups lap carries `isLayer1: true`.
A drained-seed review would be an `audio_play` whose `cycleId` matches `_seed_rep_` (walk) or
`_seedrep` (bundle).

## Which producer each course actually used — proved, not assumed

| course | `bundle_boot_path` rows | review cycle ids | producer |
|---|---|---|---|
| `spa_for_eng` | `round_map` / `cycles` / `full_script`, all `outcome: bundle` | `S0001L04_use_03_review_1` | **bundle** |
| `cym_n_for_eng` | none at all | `S0008L02_use_04_spaced_rep_1` | **walk** |
| `eus_for_eng` with `?bundle=0&fullscript=walk` | none | `S0151L01_use_01_spaced_rep_1` | **walk** |

## Results

| run | course · path | mode | rounds | layer-2 pod after round | drained-seed reviews |
|---|---|---|---|---|---|
| A | `spa_for_eng` · bundle | EASY | 4 | **2 and 4** | 0 |
| C | `cym_n_for_eng` · walk | EASY | 2 | **2** | 0 |
| D | `spa_for_eng` · bundle | FAST | 4 | **4**, none at 1–3 | 0 |
| G | `spa_for_eng` · bundle | FAST | 7 | **4**, none at 5–7 | 0 |
| H | `spa_for_eng` · bundle, debt carried from G | FAST | 2 | the **8th** round since the last lap; none on the 9th | 0 |
| B | `cym_n_for_eng` · walk | FAST | 3 | none — debt below 4 | 0 |
| E | `eus_for_eng` · bundle, round **388** | FAST | 1 | none | **0**, and a cups lap fired |
| F | `eus_for_eng` · `?fullscript=walk`, round **389** | FAST | 1 | none | **0**, and a cups lap fired |
| I | `eus_for_eng` · walk forced, rounds **390–391** | FAST | 2 | none | **0**, and a cups lap after each round |

### EASY — the lap lands on rounds 2 and 4

Run A, verbatim from the event rows:

```
22:15:17 round 1 complete  spa_for_eng S0001L01 easy
22:16:16 round 2 complete  spa_for_eng S0001L02 easy
22:16:16 >>> LAYER-2 POD after 2 completed rounds (podRound 1, 8 plays)
22:19:33 round 3 complete  spa_for_eng S0001L03 easy
22:25:22 round 4 complete  spa_for_eng S0001L04 easy
22:25:22 >>> LAYER-2 POD after 4 completed rounds (podRound 2, 12 plays)
```

Run C, the same on the walk: pod after round 2, nothing before it.

### FAST — the lap lands on rounds 4 and 8, and nowhere between

Run G played 45 minutes:

```
round 1 (roundIndex 8)   round 2 (roundIndex 9)   round 3 (roundIndex 10)
round 4 (roundIndex 11)  >>> LAYER-2 POD after 4 completed rounds (podRound 4, 20 plays)
round 5 (roundIndex 12)  round 6 (roundIndex 13)  round 7 (roundIndex 14)   — no pod
```

Run H then continued the same learner with the debt carried at 3, exactly where G left it, because
a round here takes six minutes and eight of them do not fit in one run:

```
round 1 (roundIndex 15)  >>> LAYER-2 POD after the 8th round since the last lap (podRound 5, 24 plays)
round 2 (roundIndex 16)  — no pod
```

### The drained seed, at the deepest position we have

Mr Tom Tester is parked past round **386** on `eus_for_eng`, deep enough that the old ≥144 tier
fired within minutes before the ruling — job #149 captured exactly that, live, four clips per
review. Runs E, F and I played rounds 388–391 on both producers: **zero** cycles whose id names a
seed review, and in every one of them the drained seeds came round as a **cups lap** instead. Run I
is the decisive one for the walk: 17 distinct `_spaced_rep_` review cycles, no bundle involvement
at all, and no seed-phase cycle anywhere.

The live endpoint agrees. `GET /api/courses/eus_for_eng/cycles?from=S0149L03&limit=120` on staging
returns 50 cycles of types `intro`, `debut`, `build`, `spaced_rep`, `use` — and nothing else.

## Why both rulings hold without a DB edit

- The live `algorithm_config.easy_mode` / `fast_mode` rows carry **no** `podRoundInterval`, and the
  global `algorithm_config.pods.roundInterval` is still **5**. The code defaults (`2` on Easy, `4`
  on Fast) are merged UNDER the DB row — `{ ...DEFAULT_EASY, ...loaded.easy_mode }` — so an absent
  key means the code value wins and the global 5 is never reached.
- The live `algorithm_config.script_shape` still carries the long tail
  `[…, 55, 89, 144, 233, …]`. `@ssi/core`'s `reviewOffsets()` caps every configured ladder below
  144 in `resolveShape`, and the walk runs its configured offsets through the same filter, so **89
  is the last review on both producers** whatever the row says.

## Honest gaps

- The FAST pair "4 and 8" is proved across two runs (G then H) rather than one, because a round at
  these positions takes ~6 minutes and 8 of them exceed a single probe run. The debt is per
  enrolment and survives the session boundary, which is exactly what H relies on and shows.
- Run B reached 3 walk rounds, one short of the Fast threshold: it is the negative control, not a
  positive one. Run C is the walk's positive case, on EASY.
- These runs created a `spa_for_eng` enrolment row for the tester that did not exist before, and
  left the tester's mode at `fast`. Debts were restored to their snapshot values after every run.
- Job #232's own probe, run twice on staging before this one, reported PASSes on "no drained-seed
  review" while playing **0 rounds** — it looked for a button named Play/Start/Continue, found none,
  and sat on the "Ready when you are" screen for seven minutes per run. Those PASSes were vacuous;
  the transport tap in this probe is what fixed it.
