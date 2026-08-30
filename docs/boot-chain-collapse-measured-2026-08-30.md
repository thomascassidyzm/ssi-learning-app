# Collapsing the returning learner's boot chain — measured 2026-08-30

> Brief: collapse the thirty sequential per-seed database lookups in the
> returning-learner boot into one batched query, without changing what data
> the learner receives; and overlap the subscription check / course-list fetch
> with progress loading if that is low-risk.
>
> Branch `perf/boot-chain-collapse-2026-08-30`, off `dev` at `463d46b5`.
> Everything below is from real headless-Chromium runs against **deployed**
> builds — `dev` for BEFORE, this branch's Vercel preview for AFTER — as a
> real signed-in tester with deep mid-course progress. Harness:
> `packages/player-vue/e2e/returning-learner-latency-probe.mjs`, unchanged.

---

## 0. The headline

Thirty `course_practice_phrases` reads became **one**. Every measured run
confirms it: 30 `seed_number=eq.N` requests before, **0 after**, replaced by a
single `seed_number=in.(1,…,30)`.

Total Supabase requests on the boot fall by ~30, and first genuinely-audible
lesson audio is **0.8–0.9 s faster** on the warm and cold cases.

## 1. What was actually there

`useLearningSession.loadBasketsForItems` took the seed ids of its 1..30
inventory and called `CourseDataProvider.getLegoBasketsForSeed(seedId)` once
per seed inside a `Promise.all`. Parallel in JavaScript, but thirty separate
HTTP requests all the same, every one with an identical filter apart from
`seed_number`. Measured landing at ~t+2.4–3.3 s — the middle of the boot
window, competing with the audio the learner is waiting for.

The batched form already existed and was **unused** (`getBasketsBatch`), but
its contract differs — it keys on lego ids and manufactures empty baskets. So
rather than repoint the caller at a method with different semantics, the
per-seed method was rewritten as `getLegoBasketsForSeeds(seedIds[])` using
`.in('seed_number', …)`, and `getLegoBasketsForSeed` now delegates to it.

**Why the rows are identical, not merely similar:** a `lego_id` encodes its
own `seed_number` (`S0002L01` can never collide with `S0001L01`), so grouping
the union is the same as unioning the groups. The ordering clauses are the
per-seed ones with `seed_number` prepended, so row order *within* any one lego
is untouched — which is what the basket's duration sort depends on. Pinned by
`src/providers/legoBasketsBatch.test.ts`.

Paginated defensively: a dense 30-seed window can approach a thousand phrase
rows and PostgREST truncates silently at its server-side max-rows. A short
page ends the walk, so the normal case is still exactly one request — and the
measurement confirms exactly one.

## 2. The second change — the catalogue fetch stops queueing behind auth

`await auth.initialize()` costs ~600 ms on a cold boot, and the course
catalogue read ran strictly after it. But that query filters on
`new_app_status` only — nothing in it is learner-scoped. Only the course
*selection* that follows needs the learner.

Checked rather than assumed: **anonymous and service-role readers both see 83
live/beta courses** (verified live 2026-08-30). So the fetch is started
alongside auth init and claimed once by the first `fetchEnrolledCourses`; any
later caller (PlayerContainer's refresh) finds the slot empty and issues its
own, so a refresh can never be served a stale catalogue.

## 3. The numbers

Deep returning learner: signed-in tester on `rus_for_eng` (position S0300L02),
Slow-4G emulation (4 Mbit down / 80 ms), 3 runs per cache state, medians.
`rus_for_eng` is deliberately **not** on the bundle-bootstrap flag list — on a
flagged course these thirty reads were already deferred to idle, so an
unflagged course is where the change is visible.

| cache state | metric | before (dev) | after (branch) | delta |
|---|---|---|---|---|
| **warm** | first lesson audio | 3889 ms | **3040 ms** | **−849 ms** |
| | play button ready | 2883 ms | 2617 ms | −266 ms |
| | Supabase requests | 78 | **49** | −29 |
| | per-seed phrase reads | **30** | **0** | −30 |
| | catalogue fetch starts | 674 ms | **263 ms** | −411 ms |
| **cold** | first lesson audio | 4230 ms | **3377 ms** | **−853 ms** |
| | play button ready | 3395 ms | 2983 ms | −412 ms |
| | Supabase requests | 77 | **47** | −30 |
| | per-seed phrase reads | **30** | **0** | −30 |
| | catalogue fetch starts | 968 ms | **484 ms** | −484 ms |
| **evicted** | first lesson audio | 4109 ms | **3550 ms** | **−559 ms** |
| | play button ready | 3664 ms | 3127 ms | −537 ms |
| | Supabase requests | 90 | **61** | −29 |
| | per-seed phrase reads | **30** | **0** | −30 |
| | catalogue fetch starts | 1037 ms | **403 ms** | −634 ms |

Per-run, so the spread is on the record rather than hidden behind a median —
first-lesson-audio, ms:

| state | before | after |
|---|---|---|
| warm | 3889 · 3496 · 4035 | 3092 · 2855 · 3040 |
| cold | 3800 · 4230 · 4279 | 3800 · 3364 · 3377 |
| evicted | 3945 · 4239 · 4109 | 3409 · 3605 · 3550 |

Warm and evicted do not overlap at all. Cold overlaps at one point (3800 ms
appears in both) — three runs a side is enough to state the direction, not
enough to put a confidence interval on it.

The two changes are not separable in these numbers: both landed in the same
build. The request census separates their *mechanisms* cleanly (30→0 reads is
the batch; the catalogue start time halving is the parallelisation), but the
~850 ms of first-audio is their joint effect.

## 4. What was NOT done, and why

- **The subscription/entitlement check was already non-blocking.** The brief
  described it as serial before the course list; on current `dev` both
  `initEntitlements()` and `initSubscription()` are fired without `await` and
  nothing at boot waits on them. That half of the brief was already fixed;
  reporting it as newly done would be false.
- **`deferItemLoad` was not widened to all courses.** Bundle-flagged courses
  already push this whole item load to idle. Extending that to unflagged
  courses would change *when* the legacy path's inventory exists, which is a
  behaviour change rather than a round-trip saving. Batching is the scoped
  win; the defer is somebody's deliberate call.
- **The unused `getBasketsBatch` was left alone.** It has a different contract
  and no callers; deleting it is a tidy-up this branch did not ask for.

## 5. Gates

`pnpm --filter player-vue typecheck` ✅ · `test` ✅ (2653 passed, 3 skipped,
257 files) · `lint` ✅ (0 errors; 159 pre-existing warnings, unchanged).
No `api/` files touched, so the API gates were not run.

## 6. Fixture note

The probe reads the tester's saved course. `preferences.last_course_code` for
`thomas.cassidy+ssi@gmail.com` was moved from `hun_for_eng` to `rus_for_eng`
for the duration of the measurement (a flagged course would have measured
nothing) and **restored to `hun_for_eng` afterwards** — verified after the
write. Any future run of this harness moves that value again.
