# Is Tom's two-part parity bar enforced? — audit, 2026-09-18

Read-only audit of the bundle-cutover parity gate against the tree at `d73662013`
(`origin/dev` == `origin/staging` == `origin/main` today, so this IS production).

**The bar** (Tom, 2026-08-29, memory `delivery-is-the-methodology`) — a parity test across all
cut-over courses asserting, as properties:
**PART 1 FIRST DELIVERY** — for a LEGO's debut, which phrases are delivered and in what order.
**PART 2 THE URN** — pool membership, no repeat before the pool is exhausted, correct refill.

---

## 1. Does the test exist?

**Yes for both parts, in one file:** `packages/core/src/script/selectionParity.test.ts` (509 lines,
landed in `522bcfe56` "fix(script): one selection algorithm, called by both producers"). It is the
only executable assertion of either part anywhere in the repo. Everything else named below is a
hand-run harness, not a test.

### `packages/core/src/script/selectionParity.test.ts` — asserts BOTH parts

What it asserts, by block:

| Lines | Assertion | Which part |
|---|---|---|
| 208-227 | For every one of the 15 cut-over courses, for every fixture LEGO: the shared selector's BUILD list and CONSOLIDATE list are `toEqual` an **independent transcription of the walk** (`walkDebutSelection`, lines 104-150) — same phrases, **same order**. | **Part 1** |
| 230-243 | Anti-vacuity: at least one real LEGO must order differently by DB position than by syllable, so the above cannot pass by coincidence. | Part 1 |
| 266-280 | Every drawn review phrase is a member of that LEGO's own capped USE pool, on real fixture pools, all 15 courses. | **Part 2 membership** |
| 282-290 | Over the full Fibonacci offset ladder (17 reviews), every sliding window of length `poolLength` contains `poolLength` distinct indices, for pools 1..24 — i.e. **no repeat before exhaustion**. | **Part 2 non-repeat** |
| 292-307 | Wraparound is exactly `+1 mod poolLength` per draw, and the first `poolLength` draws cover the pool exactly once — **correct refill**. | **Part 2 refill** |
| 309-322 | A suppressed draw still consumes its turn (`['a', null, 'c']`), so rotation stays in step with the walk. | Part 2 |
| 324-334 | `reviewCursorStart` is position-independent — the closed form the paged bundle path needs. | Part 2 |
| 369-480 | **End-to-end**: builds a real `CourseBundle` per fixture course and runs the production `generateScript`, asserting round 1's emitted BUILD and USE cycle texts equal the walk's debut selection **in order**, plus every later round's BUILD half. This is what stops `generateScript` quietly reverting to DB-position order. | **Part 1, on the live producer** |
| 482-508 | An unplayable phrase never consumes a BUILD slot, with its own anti-vacuity guard. | — |

**What it does NOT assert — three real holes:**

1. **Part 2 is asserted on the helpers, never on `generateScript`'s output.** The urn block calls
   `reviewCursorStart` / `drawReviewPhrases` (`phraseSelection.ts`) directly. Nothing asserts the
   emitted `spaced_rep` cycles of a generated script obey non-repeat or refill. Part 1 has that
   end-to-end block (369-480); Part 2 does not. `generateScript.ts:442` and `:553` do call
   `drawReviewPhrases`, so the wiring is there today — but a future edit that stopped calling it,
   or called it with a wrong cursor, would keep all 40 tests green.
2. **The walk side is a frozen transcription, not the code.** `walkDebutSelection` is hand-copied
   from `providers/generateLearningScript.ts` (deliberately — the file header explains the
   non-circularity reason). `generateLearningScript.ts` imports nothing from `phraseSelection.ts`
   except `countTargetSyllables` (line 17). So if the **walk** drifts, this test still passes. The
   walk is not dead code: `LearningPlayer.vue:601-657` falls back to it on any bundle failure, and
   `?fullscript=walk` forces it.
3. **The fixture is a 2026-08-29 snapshot with no liveness or completeness guard.** Nothing compares
   the fixture's 15 course codes against `BUNDLE_BOOTSTRAP_COURSES` in `useInstantPlayback.ts:189-238`
   — only `expect(COURSE_CODES).toHaveLength(15)` (line 210). Cut over a 16th course and no test
   fails. Change a course's phrases in Supabase and the gate keeps grading 2026-08-29 data.

### `packages/core/src/script/phraseSelection.ts` — the subject, not a test
The shared selector: `orderLegoPools`, `capPhrasesByLength`, `selectDebutPhrases`,
`reviewCursorStart`, `drawReviewPhrases`. Called by `generateScript.ts` at lines 205, 309, 442, 553.
It has no test of its own besides `selectionParity.test.ts`.

### `tools/bundle-cutover/parity-cycles.mjs` — cycle-level diff, asserts NEITHER part as a property
Diffs `@ssi/core generateScript` (default) or `providers/bundleToBackendCycles` (`--wire`) against
the **live** legacy `/api/courses/:code/cycles` on the deployed dev alias, page by page. It proves
**the two producers agree on the cycles the player would keep** — a mutual agreement test. It never
states what first-delivery order should be, and never checks the urn: if both producers repeated the
same review phrase every round, every case would still read IDENTICAL. Its own verdicts are
`IDENTICAL` / `SUPERSET_SEED_PHASE_ONLY` / `NO_AUDIO` / `DRIFT`.

### `tools/bundle-cutover/parity-infplay.mjs` — asserts urn MEMBERSHIP only, in infinite play
Checks four things per case: the spaced-rep LEGO schedule matches exactly, round-size ranges overlap,
**pool legality** (every emitted cycle's known/target pair is a real USE phrase of the LEGO it is
filed under — `illegalDraws`), and main-loop-count agreement. So it covers **half of Part 2
(membership)** and explicitly declines non-repeat: "cycle-for-cycle equality is not a property either
producer has". It says nothing about Part 1.

### `tools/bundle-cutover/parity-fullscript.mjs` — whole-script diff, asserts neither part
Runs both real producers — the walk against live anon Supabase, the bundle path against a fetched
`/api/courses/:code/bundle` — and diffs the player `Round[]` by LEGO-id sequence, cycle types,
texts and audio ids. Again mutual agreement, not a property. Four documented exemptions
(listening/pod cycles, round numbering, the inf-play tail, premium preview truncation).

### `tools/bundle-cutover/capture-selection-fixture.mjs` — the fixture writer
Snapshots the first 20 LEGOs of each of 15 hardcoded courses into
`packages/core/src/script/__fixtures__/selection-pools.json`. Needs
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY`. Its own header states the intent plainly: *"The parity guard
has to run on every commit, offline, in CI."* Section 3 is about whether that intent was delivered.

### `docs/bundle-cutover-parity/*.json` — dated evidence, not a gate
Nine committed result files, all `generatedAt` 2026-08-29. Evidence of one afternoon, re-read in
section 5.

---

## 2. Does it cover every cut-over course?

| Thing | Courses | Positions per course | Committed fixture or live network? |
|---|---|---|---|
| `selectionParity.test.ts` | **15/15** — fixture keys are exactly the 15 in `useInstantPlayback.ts` | LEGOs **1-20 only** (14 courses × 20, `zho_for_gle` × 15; 295 LEGOs, 1,952 phrases total) | **Committed fixture**, `__fixtures__/selection-pools.json`, 327 KB, captured `2026-08-29T22:14:47Z`. No network, no DB, runs offline in 0.5s |
| `parity-cycles.mjs` (committed run `parity-gen.json` / `parity-wire.json`) | 16 (the 15 + `fin_for_eng`, which came back NO_AUDIO ×3 and proves nothing) | 3 start fractions (0, 0.25, 0.6) × 6 rounds = 48 cases | **Live** deployed dev alias, read-only, no credentials |
| `parity-infplay.mjs` (`parity-infplay.json`) | 16, same list | 3 from-rounds (1, 7, 95) × 15 rounds | **Live** dev alias; `PARITY_TOKEN` required for premium |
| `parity-fullscript.mjs` (`parity-fullscript-final-2026-08-29.json`) | **6 of 15** — hun, gle, nld, tur, spa, cym_s | whole script; spa and cym_s `previewOnly=true`, so proven only to seed 19 | **Live** anon Supabase **and** the dev alias |

So: the only artefact that covers all fifteen courses **without a network call** is
`selectionParity.test.ts`, and its reach is the first 20 rounds of each course. Everything past round
20 — the whole spaced-rep tail, the seed-phase tier, infinite play — is covered only by harnesses
that need the deployed dev alias, which by Tom's own test is not a gate.

---

## 3. Does it run in CI or premerge?

**No. Nothing runs it. Flatly: not premerge, not the nightly, not any npm script.**

- `package.json` `test:premerge` = `test:invariants && test:changed`.
  `test:invariants` is a named list of `api/**` files plus `pnpm --filter player-vue test:invariants`
  (a named list of `packages/player-vue/src/**` files). `test:changed` is
  `vitest -c vitest.api.config.ts --changed` plus `pnpm --filter player-vue test:changed`.
  **Neither leg touches `packages/core`.**
- `vitest.api.config.ts` `include` is `['api/**/*.test.ts', 'scripts/**/*.test.ts']`.
  `packages/player-vue/vitest.config.ts` `include` is `['src/**/*.test.ts']` rooted at player-vue.
  **No config includes `packages/core/src/**`.** `packages/core` has no vitest config at all.
- The nightly, `~/command-surface/ops/ci/ci-checks.sh` lines 174-184, runs exactly:
  `@ssi/core build`, `player-vue lint`, `player-vue typecheck`, `typecheck:api`,
  `player-vue test`, `test:api`, `test:release-train`.
  **`@ssi/core build` is `tsup` — it compiles core and runs none of core's 40 test files.**
- `packages/core/package.json` `"test": "vitest"` — watch mode, no `run`. Reachable only via
  `pnpm -r test` (root `test`), which no gate invokes.
- `grep -rn "bundle-cutover"` over `*.json`/`*.mjs`/`*.ts`/`*.yml`/`*.sh`: **`tools/bundle-cutover/*.mjs`
  is referenced by no npm script anywhere** — only by its own file headers and by prose comments in
  `bundleToBackendCycles.ts`, `bundleFullScript.ts` and their tests.

A human must remember to run a `.mjs` by hand, against a live deployment, with credentials for the
full-script leg — and must also remember to run a vitest file that no script names.

**Cheapest possible repair, for the parent room's consideration:** the test costs 0.5 s and needs no
network. Adding `packages/core/src/script/selectionParity.test.ts` to a config the premerge list
already runs, or adding `pnpm --filter @ssi/core test -- --run` to `ci-checks.sh`'s learning-app leg,
converts a hand-run file into the gate Tom asked for. No new test is needed for Part 1; Part 2 would
still need its end-to-end assertion (hole 1 above).

---

## 4. Verdict

**PARTIALLY ENFORCED — the test for both parts exists and passes, but NOTHING RUNS IT**: no premerge
leg, no vitest config and no nightly check reaches `packages/core`, so today Tom's bar is enforced
only by whoever remembers to type the command, and the cycle-level harnesses from 2026-08-29 are
hand-run against a live deployment and assert neither part as a property.

---

## 5. What I actually ran

All commands from `/home/tomcassidy/.cs-worktrees/ssi-learning-app/229-cutover-parity-gate` at
`d73662013`. `packages/core/dist` built first with the shared checkout's `tsup` (core has no
`node_modules` in a fresh worktree).

**(a) The test — PASS.**
```
$ node_modules/.bin/vitest run --root packages/core --maxWorkers=2 src/script/selectionParity.test.ts
 ✓ src/script/selectionParity.test.ts (40 tests) 99ms
 Test Files  1 passed (1)
      Tests  40 passed (40)
   Duration  529ms
```

**(b) `parity-cycles.mjs`, generator mode — exit 0, no drift.** Live dev alias, no credentials.
```
$ node tools/bundle-cutover/parity-cycles.mjs --courses=gle_for_eng,nld_for_eng
gle_for_eng from=S0001L01 old=44 new=44 IDENTICAL onlyOld=0 onlyNew=0
gle_for_eng from=S0068L01 old=134 new=137 SUPERSET_SEED_PHASE_ONLY onlyOld=0 onlyNew=3
gle_for_eng from=S0157L01 old=112 new=130 SUPERSET_SEED_PHASE_ONLY onlyOld=0 onlyNew=18
nld_for_eng from=S0001L01 old=42 new=42 IDENTICAL
nld_for_eng from=S0052L01 old=133 new=133 IDENTICAL
nld_for_eng from=S0146L01 old=136 new=136 IDENTICAL
mode=generator: 4 identical, 2 superset (seed-phase only), 0 no-audio, 0 drift/error   [EXIT=0]
```

**(c) `parity-cycles.mjs --wire` — exit 0, no drift, but only after I fixed my own confound.**
My first `--wire` run reported **DRIFT on all three gle cases**. That was an artefact, and it is
worth recording as a finding about the harness: `--wire` imports
`providers/bundleToBackendCycles.ts`, which resolves `@ssi/core` through
`packages/player-vue/node_modules` — which in a fresh worktree does not exist, so I had symlinked it
to the shared checkout's, silently pointing the harness at the **shared checkout's** core
(`ebddb73fb`, dirty, `dist` built 2026-09-10) instead of the worktree's. The harness has no version
or provenance guard and reported the mismatch as product drift. After repointing `@ssi/core` at the
worktree's freshly built core:
```
$ node --experimental-strip-types tools/bundle-cutover/parity-cycles.mjs --wire --courses=gle_for_eng,nld_for_eng
mode=wire: 4 identical, 2 superset (seed-phase only), 0 no-audio, 0 drift/error        [EXIT=0]
```

**(d) `parity-infplay.mjs` — exit 0, every extra attributed, zero illegal draws.**
```
$ node --experimental-strip-types tools/bundle-cutover/parity-infplay.mjs --courses=gle_for_eng --rounds=1,7
gle_for_eng from=1 rounds=15 SCHEDULE_SUPERSET_EXPLAINED scheduleDiffs=0 supersetRounds=15
  illegalDraws=0 extras={"seedPhase":60,...} roundLen old=[4,16] new=[9,19]
gle_for_eng from=7 rounds=15 SCHEDULE_SUPERSET_EXPLAINED scheduleDiffs=0 supersetRounds=15
  illegalDraws=0 extras={"seedPhase":60,...} roundLen old=[4,13] new=[9,17]
0 schedule-identical, 2 superset (every extra attributed), 0 drift/error               [EXIT=0]
```

**(e) `parity-fullscript.mjs` — exit 1, DRIFT — and the committed "final" record was already red.**
Run with the shared checkout's anon Supabase credentials copied into the worktree.
```
$ node tools/bundle-cutover/parity-fullscript.mjs --courses=gle_for_eng
gle_for_eng previewOnly=false verdict=DRIFT oldMain=772 newMain=772 legoSeqIdentical=true
  onlyOld=0 onlyNew=0 windowRoundDiffs=21 runtimeOnlyStripped=0 tail(old=30,new=30,comparable=true)
0 identical, 1 drift/error                                                             [EXIT=1]
```
`docs/bundle-cutover-parity/parity-fullscript-final-2026-08-29.json` — the file named "final" —
records `verdict=DRIFT` on **all six** courses it ran, with `gle_for_eng windowRoundDiffCount=21`.
My run today reproduces that number exactly. So step 6's committed evidence has never been a green
run, and the step-6 harness is red on today's production tree.

The diffs are `spaced_rep` composition, not debut order (`legoSequence.identical=true` on every
course). In the gle window at `S0106L05` the **walk** side emits the same review phrase three to four
times in one round, several with missing audio-id slots
(`spaced_rep|it's interesting when you understand enough words|…||f94c95ed…|` ×3), where the bundle
side emits distinct phrases with complete audio triples. On its face that is the bundle path being
right and the walk repeating inside a round — which is a **Part 2 urn violation on the walk side** —
but I did not confirm it, because the walk here runs against live anon Supabase and its own log says
it skipped 730 phrases for missing audio ids, so a local-environment cause cannot be ruled out from
inside this audit. **Named as an explicit gap, and the single most worthwhile thing to chase next.**

### Explicit gaps
- **Whether the fullscript DRIFT is a real defect or an environment artefact — not determined.** It
  needs a run with the same credentials the 2026-08-29 run used, and a look at whether the walk's
  review draw can legitimately repeat within a round. It reproduces the committed number exactly,
  which argues the behaviour is old and stable, not new.
- **`parity-cycles` / `parity-infplay` run on 2 of 15 courses and `parity-fullscript` on 1.** I
  bounded them deliberately: each case is a live network walk, and the coverage question (section 2)
  is answered by the committed 2026-08-29 results, not by re-running all 15 today.
- **`PARITY_TOKEN` was never set**, so `parity-infplay` was exercised on a free course only; the
  premium courses' inf-play leg is unrun by me.
- **No test was written and no code was changed** — this was a read-only audit by instruction.
