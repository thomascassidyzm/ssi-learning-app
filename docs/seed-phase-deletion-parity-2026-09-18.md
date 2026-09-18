# Deleting the seed-phase review tier: parity before and after (job #232)

Tom, 2026-09-18: *"Delete the additional SEED once it's dropped out of the Spaced Rep. Because the
cups handle it."* This is the measurement that went with it. Raw artifacts are committed beside this
file under `docs/bundle-cutover-parity/parity-{cycles,fullscript}-{before,after}-seedphase-deletion-2026-09-18.json`.

## What changed, in one line

Spaced rep stops at offset **89** on all three producers — the walk
(`providers/generateLearningScript.ts`), the shared generator
(`@ssi/core` `generateScript`) and `api/courses/[code]/cycles.ts`, which already stopped there.
Nothing at all is emitted for a drained seed past that offset.

## parity-cycles — generator vs the live `/cycles` endpoint

4 courses × 3 positions, deployed dev alias, read-only.

| | identical | superset (seed-phase only) | drift |
|---|---|---|---|
| before | 10 | 2 | 0 |
| after | **12** | **0** | 0 |

The two supersets were `gle_for_eng` at `S0068L01` (+3 cycles) and at `S0157L01` (+18): the
generator serving the ≥144 tier the endpoint documents itself as not walking. There is now nothing
for that allowance to describe, which is the cleanest possible statement that both paths stop at the
same final offset.

## parity-fullscript — the walk vs the bundle, whole course

6 courses, 3 sampled windows each, 10 rounds per window. Count is ROUNDS that differ.

| course | before | after |
|---|---|---|
| `hun_for_eng` | 1 | 1 |
| `gle_for_eng` | 21 | **1** |
| `nld_for_eng` | 18 | **3** |
| `tur_for_eng` | 21 | **1** |
| `spa_for_eng` (preview) | 1 | 1 |
| `cym_s_for_eng` (preview) | 1 | 1 |
| **total** | **63** | **8** |

Every round that stopped differing was a seed-phase round: the walk was emitting 4–5 sandwich
sub-cycles where the bundle emitted 1–2 plain seed reviews. All of them are now byte-identical.

## The 8 that remain — PRE-EXISTING, and not this ruling's

Both remaining classes are present, identically, in the BEFORE artifact. They are logged here rather
than fixed, because fixing either one is a separate question about phrase selection:

1. **One extra USE cycle on the bundle in an early round, on all six courses.** `hun` `S0001L02`,
   `gle` `S0001L04`, `nld` `S0001L03`, `tur` `S0001L02`, `spa` `S0001L02`, `cym_s` `S0012L02` — the
   bundle's round carries one more `use` cycle than the walk's, always the same phrase the walk
   omits (e.g. hun "i want to speak" / "szeretnék beszélni"). Consistent enough across courses to be
   one rule differing at the consolidation tail, not six accidents.
2. **A different USE phrase drawn for the same review, twice on `nld_for_eng`** (`S0096L01`,
   `S0097L01`): the walk pulls the short one ("no" / "nee"), the bundle the longer sibling ("no, i
   don't want to" / "nee, ik wil niet"). Same LEGO, same slot, different draw — a review-urn or
   pull-filter difference, in exactly the space `selectionParity.test.ts` deliberately does not
   cover (it asserts debut selection byte-identical and review draws structurally only, on Tom's own
   2026-08-29 ruling).

Neither is learner-harmful and neither blocks step 7, but both are real divergences between two live
paths, so they should be closed — or deliberately accepted — before the walk is deleted rather than
after.

## How to re-run

```bash
pnpm --filter @ssi/core build
node tools/bundle-cutover/parity-cycles.mjs      --out=/tmp/cycles.json
node tools/bundle-cutover/parity-fullscript.mjs  --out=/tmp/fullscript.json
```

`parity-fullscript` needs the player-vue anon Supabase credentials
(`packages/player-vue/.env.local`). Both read the deployed dev alias and write nothing.
