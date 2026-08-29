# Bundle cutover — live status

**Read this before touching the script-generation paths.** The design document
lives at `archive/docs-retired-2026-08-24/bundle-cutover-design.md` — it was
archived by the 2026-08-24 docs sweep, which is a large part of why this work
looked shelved for six weeks. Its own status line still says *"No code in this
document has been written"*; that has been false since 2026-08-16. **This file
is the current truth; the design doc is the map of intent.**

Last updated: 2026-08-29.

## Why it exists, in one paragraph

The app builds a learning session by hand in three places. They drift, and the
drift is the root cause of a recurring family of learner-facing bugs. One
unified, pure generator — `packages/core/src/script/generateScript.ts` —
replaces all three, fed by one entitlement-gated door, `GET /api/courses/:code/bundle`.

## The three paths

| Path | What | State |
|---|---|---|
| (a) LIVE walk | `packages/player-vue/src/providers/generateLearningScript.ts` (2,046 lines), six course-wide anon-key table reads, no entitlement check | still live; retired at step 6 |
| (b) JIT | `api/courses/[code]/{cycles,infplay-cycles,round-map}.ts` via `useInstantPlayback` | **being retired now (step 5)** |
| (c) BUNDLE | `api/courses/[code]/bundle.ts` | the destination |

## Phase table

| # | Step | State | Landed in |
|---|---|---|---|
| 1 | Promote the generator to `@ssi/core`; `GENERATOR_VERSION`; re-export shims | **DONE** | `eec98f09` |
| 2 | Enrich the bundle: `scriptShape` + `scriptShapeVersion`, `course_seeds` text+audio, `?head=1` version probe | **DONE** | `eec98f09` |
| 3 | Generator parity: shape injection, SEED-PHASE reviews (≥144), round shape, golden-master harness | **DONE** | `95bd4a1e` |
| 4 | Client bundle store `useCourseBundle` (auth header, IndexedDB, head probe, previewOnly-aware key) | **DONE** | this branch |
| 5 | Cut the bootstrap over (kills path b usage), per-course flag | **STARTED — one course flagged** | this branch |
| 6 | Cut the full walk over (kills path a usage) | not started | |
| 7 | Repoint stragglers, delete, `REVOKE` on the content tables | not started | |

**Turbo tagging (design step 3, item 3) is MOOT** — Turbo was retired in
`d5548fdc` ("two learning modes — easy and fast, turbo retired"). Verified
2026-08-29: no `turboOmit` anywhere in the estate. Do not port it.

## What "parity" means here, and how it is proved

`tools/bundle-cutover/parity-cycles.mjs` diffs, cycle by cycle, against the
**live** `/cycles` endpoint on the deployed dev alias — real courses, real
data, no app boot, no DB credentials, read-only.

```bash
node tools/bundle-cutover/parity-cycles.mjs                       # generator level
node --experimental-strip-types tools/bundle-cutover/parity-cycles.mjs --wire   # wire level (what the cutover actually feeds the player)
```

Result on 2026-08-29, 4 courses × 3 positions, both modes:
**10/12 byte-identical, 2/12 supersets, 0 drift.**

The two supersets differ in exactly one way, and it is intentional: the
generator emits **SEED-PHASE reviews** (spaced-rep offsets ≥144 play the full
parent seed sentence), which `cycles.ts` documents under "KNOWN GAPS vs the
walk" as something it cannot do. The generator is *ahead* of the endpoint
there and matches the walk, which is the source of truth. Nothing the endpoint
emits is ever missing from the generator's output.

The harness earned its keep immediately: it caught a cycle-id collision (a USE
row promoted into a build slot and replayed in the consolidation tail produced
two cycles with the same id, and the client de-dupes by cycle id — the
consolidation cycle would have been silently eaten). Fixed in `95bd4a1e`.

## Step 5 as shipped — how the flag works

`isBundleBootstrapEnabled(courseCode)` in `useInstantPlayback.ts`:

- `BUNDLE_BOOTSTRAP_ALL = false`
- `BUNDLE_BOOTSTRAP_COURSES = { hun_for_eng }` — a full 665-round free course,
  byte-identical parity at every tested position, ~19 player events a month.
- `?bundle=1` / `?bundle=0` overrides per session, for dev testing.

When enabled, `fetchRoundMap` and `fetchCycles` compute their payloads from
one cached `/bundle` fetch (`providers/bundleToBackendCycles.ts`) instead of
hitting `/round-map` and `/cycles`. **The wire shapes are identical**, so the
cycle buffer, partial-LEGO bookkeeping, pagination, `backendCyclesToRounds`,
and every scheduler in `LearningPlayer.vue` are untouched. Any failure on the
bundle path logs and falls through to the network path, so the worst case is
today's behaviour.

## Verified live on dev (2026-08-29)

A headless browser session on the dev alias, same course, flag on vs flag off:

| | `/bundle` | `/cycles` | `/round-map` | audio clips fetched |
|---|---|---|---|---|
| `?course=hun_for_eng` (flag on) | 1 | **0** | **0** | 71 |
| `?course=hun_for_eng&bundle=0` | 0 | 2 | 2 | 75 |

Both reach the same player screen and both stream audio. Zero calls on the two
retired endpoints is the cutover actually working, not just compiling. Getting
there needed one extra fix: `prewarmInstantCaches` is a module-level function
that hits those endpoints directly, bypassing the composable's branch, so a
flagged course was still paying one of each per session (`135ae9f4`).

**Try it:** https://ssi-learning-app-git-dev-zenjin.vercel.app/?course=hun_for_eng
— and the same URL with `&bundle=0` for the old path, side by side.

## Before this flag goes wide — named prerequisites

1. **`gloss_segments` are not in the bundle.** `cycles.ts` ships authored
   `known_gloss_segments` on intro/debut cycles; `BundleLego` has no such
   field. Today this costs nothing — **0 rows estate-wide carry the column**
   (checked 2026-08-29) — but the moment Popty authors one, a bundle-enabled
   course would silently lose it. Additive fix: one column in bundle.ts's
   `course_legos` select, one field on `BundleLego`, pass-through in the
   generator's intro/debut builders.
2. **Bundle weight.** Measured on the flagged course 2026-08-29:
   `hun_for_eng` (665 rounds) is **3.8 MB raw, 654 KB brotli / 696 KB gzip**
   over the wire — one cacheable fetch replacing round-map + N×cycles. That is
   comfortably inside the design's ~2 MB gz threshold, but the biggest courses
   (Irish 786 rounds, Turkish 840, French 1,530) are still unmeasured and
   French is premium, so its full bundle needs an entitled fetch to measure.
3. **INF PLAY is NOT cut over.** `bootstrapInfPlay` still uses
   `/infplay-cycles`; the generator's infplay mode is untested against it.
   Flagging a course only changes its main-loop bootstrap.
4. **Soak.** Design §5 step 5 asks for a staging week with every entry mode
   exercised (fresh, resume, belt-skip, INF-PLAY entry, preview/anonymous,
   try-link) before `ALL`.

## The next phase, concretely

**Step 5b — widen the bootstrap cutover.** Sized at roughly one session:
land the `gloss_segments` bundle field (item 1 above), run the parity harness
across ~10 more courses including a premium/preview one, cut INF PLAY's
bootstrap over to the generator's infplay mode with its own parity pass
against `/infplay-cycles`, then add courses to `BUNDLE_BOOTSTRAP_COURSES` in
batches. Only after that does `BUNDLE_BOOTSTRAP_ALL = true` become a
one-line change, and only then do steps 6 and 7 become reachable.
