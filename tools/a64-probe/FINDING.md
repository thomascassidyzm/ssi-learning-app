# Can a learner hear the same prompt more than twice in a row?

**Yes — four times, in Easy mode, in round 2 of every course probed.**

Tom's recollection was that the runtime player refuses a third consecutive identical play.
**A refusal of that shape does exist in the codebase — but it is per-CYCLE, not per-PROMPT, and the
one place that guards by consecutive plays is dead code.** He asked to be checked; this is the check.

---

## (1) What the generated script can contain — counted from real output

Real rounds from the real path: the `/api/courses/:code/cycles` handler run against the live DB,
paginated across the window, fed through `backendCyclesToRounds` with `MODE_NEUTRAL_REPEATS`
exactly as `LearningPlayer.vue` passes it. Prompt identity is the law's own `cyclePromptIdentity`.

| course | rounds | Easy plays | runs ≥3 | runs ≥4 | Fast runs ≥3 |
|---|---|---|---|---|---|
| spa_for_eng | 57 | 1576 | 1 | **1** | 0 |
| fra_for_eng | 62 | 1478 | 1 | **1** | 0 |
| deu_for_eng | 64 | 1536 | 1 | **1** | 0 |
| ita_for_eng | 56 | 1028 | 1 | **1** | 0 |
| eng_for_spa | 57 | 1030 | 1 | **1** | 0 |
| tur_for_eng | 400 | 14508 | 1 | **1** | 0 |
| pol_for_eng | 400 | 11698 | 1 | **1** | 0 |

The script itself never contains four of anything. What it contains is a **lawful pair**: a BUILD
phrase and a USE phrase carrying identical known+target text, adjacent in the round. Two identical
prompts back to back is legal under A-64, and `capRoundCycles` passes them through correctly.

## (2) What the runtime player does with it — read from live code

Three candidate refusals exist. None of them stops this.

**a. `MAX_CYCLE_PLAYS = 2` — `SimplePlayer.ts:363`, applied in `repeatCountFor` (line 1996).**
Real, live, and exactly what Tom remembers. Its own comment says it "is what keeps the live repeat
and any repeat already baked into the script from compounding into four plays." But it clamps
**one cycle's** plays. `currentCyclePlays` is reset to 0 on every cycle-index advance
(`SimplePlayer.ts:2019, 2032`), and `repeatCountFor` is asked per cycle with no argument but the
cycle. The player holds **no memory of the previous cycle's prompt identity**. Two different cycle
objects that happen to say the same thing are, to this clamp, two unrelated cycles — each entitled
to its two plays.

**b. `shouldSkipCycle` — `LearningPlayer.vue:11305-11389`.** Read end to end. Its arms are
adaptation-v2's omit set, `isRepeatCopyCycle` (stale `_x2` copies), mode selection, practising
mode, the INF-PLAY warm-up gate and the offline cache gate. **Not one of them looks at what the
previous cycle said.** The `_x2` arm is the closest relative — its comment says it exists so the two
repeat mechanisms "can never compound into four plays" — and again it is about one cycle repeated,
not two cycles that match.

**c. `useOfflinePlay.getNextPlayableCycle` — `useOfflinePlay.ts:237-300`.** This *is* a genuine
runtime consecutive-play refusal: it keeps a two-deep `a64Recent` list and bans an id that has
already played twice in a row. Two things kill it as a defence. It bans by **`cycle.id`**, so the
identical-text pair slips through it too — and `getNextPlayableCycle` **has no caller anywhere in
the repo**, not even a test. It is dead code on every path.

`PlayerConductor.ts` — the single owner of every SimplePlayer transition — contains no identity or
repeat logic at all. Every use of the law's helpers (`capConsecutiveRepeats`, `cyclePromptIdentity`)
in the codebase is at BUILD time: the generator, the two round adapters, the pod lap scheduler and
the layer-1 scheduler. **Nothing consults them per step.**

So: the runtime refuses a **cycle** playing three times. It does not refuse a **prompt** sounding
three times.

## (3) Therefore what the learner can actually hear

Not inferred — measured. The real `SimplePlayer` class was instantiated over the real round 2 of
spa_for_eng and driven through its own transitions with a mock audio element (the same technique
the shipped `modeLivePerStep` harness uses), with the two runtime overrides transcribed from
`LearningPlayer.vue` and the live `algorithm_config` rows. Every `phase_changed → prompt` the
player actually started was recorded. Only pause/gap DURATIONS were zeroed, so no wall-clock waits;
identity, type, order and repeat count are untouched.

```
=== spa_for_eng [easy] — PROMPTS THE PLAYER ACTUALLY STARTED ===
  1     r1 intro      S0001L01_intro       I want | quiero
  2   * r1 debut      S0001L01_debut       I want | quiero
  3     r2 intro      S0001L02_intro       to speak | hablar
  4   * r2 debut      S0001L02_debut       to speak | hablar
  5     r2 build      S0001L02_build_1     I want to speak | Quiero hablar
  6   * r2 build      S0001L02_build_1     I want to speak | Quiero hablar
  7  !! r2 use        S0001L02_use_1       I want to speak | Quiero hablar
  8  !! r2 use        S0001L02_use_1       I want to speak | Quiero hablar

longest run of identical prompts the PLAYER emitted: 4
```

The player's own log says it plainly:

```
[SimplePlayer] Starting Round 2 (S0001L02): 4 cycles
  [3/4] "I want to speak" → "Quiero hablar"
  [3/4] "I want to speak" → "Quiero hablar"
  [4/4] "I want to speak" → "Quiero hablar"
  [4/4] "I want to speak" → "Quiero hablar"
```

Same walk in Fast: **longest run 2** — the lawful pair, one play each. The breach is Easy's alone,
and it lands in the second round of the course: a beginner's first two minutes.

## Is the build-time cap redundant, then?

**No — it is still doing useful work, and it is the only thing doing any.** It is what keeps the
pair at two rather than three: the server route emits `intro` and `debut` with identical text and
then appends build phrases with no adjacency check, and the cap re-interleaves those. Without it
the script would already breach in Fast. What it cannot do is see a repetition that is decided
after it has run. It caps ITEMS; the learner hears PLAYS; since 2026-08-09 those are different
counts and nothing reconciles them.

`apml/playback/consecutive-repeat-law.apml` (v1.2.1, 2026-08-08) still asserts they are the same:
*"the repeat runs … BEFORE this law's floor, which therefore stands downstream of the repeater."*
On shipped code that ordering is inverted — the repeat runs at play time, downstream of the floor,
outside its reach. The spec is not merely stale; it asserts a safety property the code stopped
providing the day after it was written, which is why nobody looked.

## The fix, in two sentences (NOT applied)

Give the walker the memory the clamp lacks: `SimplePlayer` should track the prompt identity of
recent plays and refuse a cycle's second play when the previous play already carried that identity,
capping consecutive identical **plays** at two rather than capping each cycle's repeats
independently. That is what the abandoned `fix/mode-toggle-fable-2026-08-09` branch reached for
with a live run-tracker, and it belongs in the walker because that is where repetition now lives.

## Reproducing

Both probes are in `tools/a64-probe/` on this branch. Bundle with esbuild, run with the live key:

```
node_modules/.pnpm/esbuild@0.27.0/node_modules/esbuild/bin/esbuild tools/a64-probe/playerwalk.ts \
  --bundle --platform=node --format=cjs --outfile=.a64probe/playerwalk.cjs \
  --external:@supabase/supabase-js --alias:@=./packages/player-vue/src
set -a; source /home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env; set +a
export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_KEY"
CODE=spa_for_eng UPTO=3 MODE=easy node .a64probe/playerwalk.cjs   # the walk above
CODES=spa_for_eng ROUNDS=60 node .a64probe/probe.cjs              # the script-level census
```

## Coverage and limits, honestly

- `probe.ts` drives the route **unauthenticated**, so paid courses are sliced to the free-preview
  window (~56-64 rounds); the two 400-round runs are free courses, unsliced.
- `playerwalk.ts` runs the real `SimplePlayer`, but the two runtime overrides are transcribed from
  `LearningPlayer.vue` rather than executed inside a mounted Vue component. The transcription covers
  the live-normal case: the other `shouldSkipCycle` arms are inert online with adaptation v2 in
  shadow and practising off.
- Not modelled: `resume()` (the spec already logs it as uncapped residue), pod/listening
  interleaving, and adaptation-v2 culling. Each of those can only ADD adjacency, never remove it.
- No browser run. The claim proved here is that the shipped player's state machine starts four
  identical PROMPT phases in a row; what an ear then receives from those four phases is the audio
  layer's business, and nothing in it dedupes.
