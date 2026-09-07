# Four identical plays in a row: REPRODUCED

**Question.** Can a learner hear the same prompt four times running?
**Answer: yes.** Easy mode, from real generated output, on every course probed.

## The counted result

Real rounds built by the real live path — the `/api/courses/:code/cycles` route handler
invoked directly against the live DB, paginated across the window, fed through
`backendCyclesToRounds` with `MODE_NEUTRAL_REPEATS` exactly as `LearningPlayer.vue` passes it —
then walked exactly as `SimplePlayer.advanceCycle` walks it: mode selection via
`selectCyclesOutForMode` with the **live `algorithm_config` rows**, repeat count via the same
rule as the `getCycleRepeatCount` override. Prompt identity is the law's own
`cyclePromptIdentity`.

| course | rounds | Easy plays | runs ≥3 | runs ≥4 | Fast runs ≥3 |
|---|---|---|---|---|---|
| spa_for_eng | 57 | 1576 | 1 | **1** | 0 |
| fra_for_eng | 62 | 1478 | 1 | **1** | 0 |
| deu_for_eng | 64 | 1536 | 1 | **1** | 0 |
| ita_for_eng | 56 | 1028 | 1 | **1** | 0 |
| eng_for_spa | 57 | 1030 | 1 | **1** | 0 |
| tur_for_eng | 400 | 14508 | 1 | **1** | 0 |
| pol_for_eng | 400 | 11698 | 1 | **1** | 0 |

Every breach is a run of exactly **4**, in **Easy only**, and in every case it sits in
**round 2 or 3** — the learner's first two minutes. 400 rounds of Turkish and Polish
contain exactly one each, both at round 2.

### The sequence (spa_for_eng, round 2)

```
  r2 debut   S0001L02_debut     to speak | hablar
> r2 build   S0001L02_build_1   i want to speak | quiero hablar
> r2 build   S0001L02_build_1   i want to speak | quiero hablar
> r2 use     S0001L02_use_1     i want to speak | quiero hablar
> r2 use     S0001L02_use_1     i want to speak | quiero hablar
  r3 intro   S0001L03_intro     spanish | español
```

Same shape in Turkish (`türkçe istiyorum`, build_2 + use_1), French, German, Italian, eng_for_spa.

## The mechanism — and #308's reading is right in outcome, wrong in detail

There is **no build-time twin pair to stack on**: every live caller of the builders passes
`MODE_NEUTRAL_REPEATS` (`count: 1`), so `repeatPhraseCycles` / `repeatRoundCycles` are inert on
the shipped path. Doubling moved wholly into the player on 2026-08-09.

The stack is instead:

1. **Content** holds a BUILD phrase and a USE phrase with identical known+target text, adjacent
   in the round. That is one prompt twice — perfectly legal under A-64.
2. **`capRoundCycles`** (`backendCyclesToRounds.ts:218`) enforces the law at build time and
   *allows* exactly two in a row. It passes the pair through, correctly.
3. **`SimplePlayer.advanceCycle`** (`SimplePlayer.ts:2003-2020`) then asks `repeatCountFor` per
   cycle and replays each one twice. `MAX_CYCLE_PLAYS = 2` clamps *one cycle's* plays; nothing
   looks at the neighbouring cycle's identity. 2 × 2 = 4.

The legacy walk path is immune by accident: `generateLearningScript`'s consecutive-duplicate
dedup (line 1911) collapses adjacent identical non-intro items to one *before* the cap. The
instant path — which `INSTANT_PLAYBACK_ALL = true` makes the live default for every course,
and which the whole-course `bundleFullScript` also funnels through — has no such pass.

## The .apml is not stale — it is wrong

`apml/playback/consecutive-repeat-law.apml` (v1.2.1, 2026-08-08) states, under `easy_doubling`:

> "ORDERING IS LOAD-BEARING, on BOTH paths. The repeat runs AFTER the generator's
> consecutive-duplicate removal … and BEFORE this law's floor, which therefore stands
> downstream of the repeater."

On the shipped system that ordering is **inverted**: the repeat runs at play time, downstream of
the floor, outside its reach entirely. The spec's guarantee — "the repeat COUNT is config … but is
clamped to 2 in code, so no row can ever ask this law to be broken" — no longer holds, because the
breach is not one row asking for three plays; it is two lawful rows each asking for two. The
document does not merely describe an older arrangement; it asserts a safety property the code
stopped providing the day after it was written, and that assertion is why nobody looked.

## The fix, in two sentences (NOT applied)

Make the live repeat decision identity-aware: `SimplePlayer` should track the prompt identity of
recent plays and refuse a second play of a cycle when the previous play already carried the same
identity, so consecutive identical **plays** are capped at two rather than each cycle's repeats
being capped independently. That is what the abandoned `fix/mode-toggle-fable-2026-08-09` branch
reached for with a live run-tracker, and it belongs in the walker because that is where repetition
now lives.

## Reproducing

`.a64probe/probe.ts` in this branch; bundle with esbuild and run with the live service key:

```
node_modules/.pnpm/esbuild@0.27.0/node_modules/esbuild/bin/esbuild .a64probe/probe.ts \
  --bundle --platform=node --format=cjs --outfile=.a64probe/probe.cjs \
  --external:@supabase/supabase-js --alias:@=./packages/player-vue/src
set -a; source /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_KEY"
CODES=spa_for_eng ROUNDS=60 node .a64probe/probe.cjs
```

## Coverage and limits, honestly

- The probe drives the real route handler **unauthenticated**, so paid courses are sliced to the
  free-preview window (~56–64 rounds). The two 400-round runs are free courses, unsliced.
- The probe models `shouldSkipCycle`'s two live arms that matter here (mode selection, repeat) and
  the live `algorithm_config` rows. It does **not** model adaptation-v2 culling, pod/listening
  interleaving, or `resume()` — each of which can only ADD adjacency, never remove it.
- Fast mode is clean in every run: 0 breaches. This is Easy's alone.
