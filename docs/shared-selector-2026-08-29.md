# One selection algorithm — what was wired, what was measured

2026-08-29. Landed on `dev` as `522bcfe5`. Nothing promoted.

> Tom's ruling, superseding "align the paths": *"can't we just use the old code's
> selection algorithm but with the new code's approach to doing the whole thing?"*
> Yes. Selection is pedagogy; bundling is plumbing.

---

## 1. The wiring, resolved first — and one correction

A prior worker flagged a possible gap between what is tested and what is
actually wired into the player. Probed live rather than inferred from git:
every deployed environment's JavaScript was crawled (entry chunk plus every
lazy chunk it references) and grepped for the markers that only exist on each
code path.

| environment | build | core `generateScript` present | 15-course flag list | step 6 — whole session from the bundle |
|---|---|---|---|---|
| **dev** | `db54d16` (at probe time) | yes | yes | **yes** |
| **staging** | `991c0c6` | yes | yes | **no** |
| **production** | `8f64eaf` | **no** | no | no |

Markers: `_seedrep` and `legoId not in round map` (core's generator);
`hun_for_eng…gle_for_eng…nld_for_eng` adjacency (the flag list);
`[BundleScript]`, `?fullscript`, `full_script` (step 6 only).

**So the live generator for the fifteen cut-over courses is
`packages/core/src/script/generateScript.ts`**, reached through
`providers/bundleToBackendCycles.ts` for bootstrap and INF PLAY on dev *and*
staging, and additionally through `providers/bundleFullScript.ts` for the whole
session on dev only. `api/courses/[code]/cycles.ts` is not the producer on those
courses on dev/staging; it is still the producer everywhere on production and on
every non-flagged course.

**The brief's description of that generator was stale.** It said the bundle path
"emits every BUILD then every USE phrase in raw DB position order (no cap, no
sort) and draws reviews via unseeded `Math.random()` with no cross-draw memory."
On `dev` it already capped at `maxBuildPhrases`, already ran the two-pass
consolidate, and already used a deterministic closed-form review cursor in the
main loop. Three real gaps remained, and those are what this change closes:

1. **Pool ORDER** — DB position, not shortest-first by target syllables. This is
   the one that moved most rounds.
2. **INF PLAY reviews** — still an unseeded `Math.random()` sample with no
   cross-draw memory, so a LEGO's basket could repeat or be skipped indefinitely
   by chance. INF PLAY is where a learner meets a LEGO most often.
3. **Unplayable phrases** — a row missing any of its three clips consumed a
   BUILD slot and then emitted nothing, so the round came up short. The walk has
   never done this; it drops such rows as it reads them.

---

## 2. What was extracted, and where it lives

**`packages/core/src/script/phraseSelection.ts`** — new, pure, framework-agnostic.
No Vue, no Supabase, no fetch. It holds the whole selection algorithm:

- `countTargetSyllables` — the sort key, moved verbatim out of the walk's
  in-function closure;
- `phraseTextLength`, `courseMaxPhraseLength`, `capPhrasesByLength`,
  `filterReviewPool` / `ReviewPullFilter` — moved out of
  `player-vue/src/composables/useAlgorithmConfig.ts`, which now **re-exports**
  them rather than carrying copies;
- `orderLegoPools` — eligibility, shortest-first sort, length cap, one rule for
  both baskets;
- `selectDebutPhrases` — the BUILD-slot fill and the two-pass consolidate;
- `reviewCursorStart` + `drawReviewPhrases` — the urn.

`@ssi/core`'s `generateScript` calls it for debut selection, main-loop reviews
and INF PLAY reviews. The walk imports the same syllable counter. There is one
implementation, not a parity test policing two.

### The urn cursor is a closed form, deliberately

The walk keeps a per-LEGO `useIndex` in an in-function `Map` and gets away with
it because it always regenerates the whole course from round 1 in one call. **The
bundle path does not have that lifecycle.** It pages by (`fromLegoId`,
`roundLimit`) and is re-entered per page and per INF-PLAY expansion, so a Map
scoped to one invocation would silently restart every LEGO's urn partway through
the course — strictly worse than what it replaces. The cursor therefore has to be
a function of POSITION, and it is exactly that:
`min(n1PhraseCount, poolLength) + (offsetIndex − 1)`, the walk's `useIndex`
written without the counter. It advances on every attempted draw including one a
same-round dedup then suppresses, exactly as the walk increments before its dedup
check. This was investigated rather than assumed, and it is the answer.

### One wire change

`BundlePhrase.targetSyllableCount` now travels, because the walk's sort key is
`target_syllable_count || countTargetSyllables(target_text)` and the stored value
WINS where it exists. Measured across all fifteen courses: mostly NULL, but
**`cym_s_for_eng` has it on 5,323 of 5,365 rows** and `spa_for_eng` on 20 of
16,328. Skipping it would silently reorder cym_s's debuts.

The bundle cache identity is content-version + shape-version + preview only, and
cannot see a wire-shape change, so `useCourseBundle`'s IndexedDB version goes
1 → 2 and the upgrade drops the store. One refetch per learner per course, once.
Verified live (§5).

---

## 3. Parity test — `packages/core/src/script/selectionParity.test.ts`

40 tests. Built so it cannot pass by construction:

- `walkDebutSelection` is an **independent restatement** of
  `generateLearningScript.ts`'s phases 3 and 5, transcribed by hand and importing
  nothing from `phraseSelection.ts`.
- It runs against **real baskets from all fifteen cut-over courses** — the first
  20 LEGOs of each, captured from the live DB by
  `tools/bundle-cutover/capture-selection-fixture.mjs` into a 320 KB committed
  fixture, so the guard runs offline in CI.
- It asserts through **`generateScript` itself**, not only through the helper, so
  the generator cannot quietly stop calling the shared selector.

**(a) Debut — asserted byte-identical**, phrase-for-phrase and in order, per LEGO,
on every one of the fifteen courses; BUILD slots on every round, and CONSOLIDATE
on round 1 where no spaced rep interleaves. A guard test also proves DB-position
order and syllable order genuinely differ on this data, so the comparison is not
vacuous.

**(b) Urn — asserted structurally, not draw-for-draw**, per Tom's ruling that
specific review draws need not match: pool membership equals the debut's pool, no
repeat before the pool is exhausted, exact +1-modulo wraparound, full coverage
once pool length is reached, and the cursor advances through a suppressed draw.

**Mutation-tested, both ways.** Reverting the sort to DB position: **24 of 40
fail**. Swapping the urn draw for `Math.random()`: **1 fails**.

**CI did not run `@ssi/core`'s suite at all** — the guard would never have run
where the drift would land. Both workflows (`verify.yml`,
`auto-merge-claude.yml`) now do, which also brings core's other 704 tests under
the gate for the first time.

---

## 4. Gate — all green

| check | result |
|---|---|
| `pnpm --filter @ssi/core build` | pass |
| `pnpm --filter @ssi/core test` | **34 files, 744 passed**, 9 skipped |
| `pnpm --filter player-vue typecheck` | pass |
| `pnpm --filter player-vue test` | **256 files, 2,647 passed**, 3 skipped, 3 todo |
| `pnpm --filter player-vue lint` | **0 errors**, 156 warnings (pre-existing) |
| `pnpm typecheck:api` | pass |
| `pnpm test:api` | **132 files, 1,456 passed**, 5 skipped, 8 todo |

---

## 5. Speed — no regression, measured two ways

### Isolated: the generator's own CPU cost

Whole-course build over the **full entitled `spa_for_eng` bundle** (1,339 LEGOs,
15,205 phrases), same box, 9 runs per arm, median:

| arm | median | range |
|---|---|---|
| `origin/dev` before this change | **56 ms** | 51–70 |
| this change | **97 ms** | 89–113 |

**+41 ms** on the whole course. Cycle count is byte-identical between the arms
(30,121 both).

A first cut of this change measured **388 ms** — ordering was being recomputed on
every review draw, up to twelve times per round across the whole course. The
per-LEGO memo in `makePoolOrderer` is load-bearing, not tidiness, and is
documented as such at the definition.

### End-to-end: deployed dev, cold profile per run

Headless Chromium, `packages/player-vue/e2e/first-play-wait-probe.mjs`, signed
in, unthrottled, against the deployed dev build `522bcfe`. "Pressable" is when
`.center-btn` loses `is-disabled`.

**Arms interleaved on the same run** so both meet the same serverless warmth:

| arm | pressable, median | range | Supabase queries |
|---|---|---|---|
| bundle path, this change (n=4) | **5,375 ms** | 5,173 – 6,052 | 74 |
| pre-cutover control `?bundle=0` (n=4) | 8,119 ms | 7,818 – 8,673 | 122–124 |

A separate 5-run block of the bundle arm gave a median of **5,278 ms**
(4,885 – 6,050), 74 queries, zero fallbacks.

**The control is what makes this comparable.** `?bundle=0` is step 6's own before
arm; it measured **7,938 ms / 124 queries** when step 6 landed and measures
**8,119 ms / 123 queries** today — within ~2%, so this box and link are like for
like. Against that calibration, step 6's committed after-arm was
**5,121 ms (4,654 – 5,566)** and this change measures **5,278–5,375 ms**: inside
the committed range, a few per cent above its median, and well inside the
run-to-run spread of either. **No measurable regression. Still sub-5.5 s median,
2.7 s faster than pre-cutover, still 74 queries, zero fallbacks.**

### The IndexedDB upgrade, verified live

The one change that touches existing learner state. A **stale v1 database was
seeded deliberately** — the exact state every current learner is in — then the
app loaded three times in one browser context:

| pass | pressable | bundle fetches | IndexedDB |
|---|---|---|---|
| 1 (stale v1 present) | 5,140 ms | 2 (spa + fra) | v2, both courses cached |
| 2 | 3,762 ms | **0** | v2 |
| 3 | 3,821 ms | **0** | v2 |

The upgrade drops the stale entry, refetches once at no worse than a normal cold
start, and warm visits serve from cache with zero network.

---

## 6. Scope kept

`api/courses/[code]/cycles.ts` and everything it feeds is **untouched** — that
migration is Tom's separate call. The shared module is deliberately placed and
shaped so `/cycles` can call it when he makes it, without a rewrite.

## 7. Not reproduced, not repeated

The 97.6% / +8% figures from earlier reports are not used here. They could not be
reproduced from committed evidence by the blast-radius investigation, and nothing
in this document depends on them. Every number above was measured for this change.
