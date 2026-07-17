# Plan 018: Move schools scope-resolution off the client onto the server's resolveVisibleScope

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. This is an L-effort plan — do it incrementally, one composable
> at a time, keeping the app green between steps. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/composables/schools api/_utils/schoolScope.ts api/school`
> If these changed, re-read them before editing.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED (role-scoping regressions across govt_admin/school_admin/teacher views;
  existing composable tests + the server util reduce it)
- **Depends on**: none (but is also the RLS-tightening prerequisite in `CLAUDE.md`)
- **Category**: perf / architecture
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

Two schools composables re-implement the same hierarchy resolution as **serial query
waterfalls from the browser**: `useStudentsData` runs groups → schools → classes →
progress (4 serial round-trips), and `useAnalyticsData` runs classes → user_tags →
learners → course_enrollments → seed_progress (5 serial round-trips), each ~100ms+ from
a browser. The exact resolution already exists **server-side**, batched, in
`api/_utils/schoolScope.ts` (`resolveVisibleScope`). This is both a perf fix (one round
trip instead of 4-6) and the security prerequisite `CLAUDE.md` names as condition 2 for
tightening org-table RLS: "client org-table reads repointed to server endpoints on the
`resolveVisibleScope` pattern." Every repoint shrinks the future RLS policy surface.

## Current state

- **Server util (the target pattern)** — `api/_utils/schoolScope.ts`, exported:
  - `resolveVisibleScope(svc, authUid): Promise<CallerScope>` (`:223`) — the batched,
    role-aware resolver.
  - helpers: `chunk` (`:44`), `schoolIdForAdmin` (`:74`),
    `schoolsForGroupSubtree` (`:103`), and the `CallerScope` interface (`:22`).
- **Client waterfall #1** — `packages/player-vue/src/composables/schools/useStudentsData.ts:80-138`:
  govt-admin path does `groups` (LIKE on path) → `schools` by group_ids → `classes` by
  school_ids → `class_student_progress` by class_ids, all sequential.
- **Client waterfall #2** — `packages/player-vue/src/composables/schools/useAnalyticsData.ts:116-190`:
  `classes` → `user_tags` → `learners` → `course_enrollments` → `seed_progress`,
  sequential.
- Both support a **demo mode** (fixtures) that must keep working.
- Existing tests: `useStudentsData.test.ts`, `useAnalyticsData.test.ts` (verify names;
  the schools composables dir has 11 test files).
- Existing server endpoints under `api/school/` follow the auth + `resolveVisibleScope`
  pattern — read one (e.g. an existing rollup endpoint) for the request/response shape
  to match.

## Commands you will need

| Purpose          | Command                                                              | Expected |
|------------------|---------------------------------------------------------------------|----------|
| Install          | `pnpm install`                                                        | exit 0   |
| API tests        | `pnpm test:api`                                                       | all pass |
| Player tests     | `pnpm --filter player-vue test`                                     | all pass |
| Typechecks       | `pnpm typecheck:api` && `pnpm --filter player-vue typecheck`        | exit 0   |
| E2E (schools)    | `pnpm --filter player-vue e2e` (if a schools suite exists — check)   | pass     |

## Scope

**In scope**:
- A server endpoint (new, under `api/school/`) that returns the resolved scope + the
  data each composable needs (class IDs / student progress for students-view; learner
  IDs + course/seed rollups for analytics-view) in **one** call, built on
  `resolveVisibleScope`. Reuse `chunk()`/`.in()` batching from `schoolScope.ts`.
- `useStudentsData.ts` and `useAnalyticsData.ts` — repoint the govt_admin/school_admin
  paths to fetch from the new endpoint instead of hand-rolling the hierarchy joins.
  Keep demo mode.
- Tests: an api test for the new endpoint; update the two composable tests.

**Out of scope**:
- Turning on RLS (that's the gated org-table work — this plan is a *prerequisite*, not
  that work).
- Teacher-scoped paths that are already a single query (only repoint the multi-hop
  govt_admin/school_admin waterfalls).
- The other 14 composables (a follow-up sweep; this plan proves the pattern on the two
  worst offenders).

## Git workflow

- Branch: `advisor/018-schools-scope-endpoint` from `dev`.
- Commit style: `perf(schools): resolve visible scope server-side (repoint students+analytics)`.
- Commit per composable so each repoint is independently reviewable/revertible.

## Steps

### Step 1: Design the endpoint contract

Read `resolveVisibleScope` and an existing `api/school/` endpoint. Define one endpoint
(or two, if students-view and analytics-view need genuinely different payloads) that:
verifies the caller's JWT, calls `resolveVisibleScope(svc, authUid)`, and returns the
scope-intersected IDs + the rollup data the composable currently assembles client-side.
Server-side, intersect requested IDs with the resolved scope (the existing rollup
endpoints already do this — match it).

**Verify**: contract written down (request params, response shape) before coding.

### Step 2: Implement the endpoint + tests

Build it under `api/school/`. Batch reads with `chunk()`/`.in()`. Add an api test
(model on existing `api/school/*` tests / `redeem.test.ts` mock) covering: govt_admin
sees the subtree; school_admin sees only their school; a caller sees nothing outside
their scope.

**Verify**: `pnpm test:api -- api/school` passes; `pnpm typecheck:api` exits 0.

### Step 3: Repoint useStudentsData (govt_admin + school_admin paths)

Replace the client waterfall with a single fetch to the new endpoint. Preserve demo
mode (branch on the demo flag before the fetch, exactly as today). Keep the
`students.value = []` empty-state behavior.

**Verify**: `pnpm --filter player-vue test -- useStudentsData` passes (update the test's
mock to the endpoint call); manual/e2e check that the students view still lists the
right students per role.

### Step 4: Repoint useAnalyticsData similarly

Same treatment. Preserve the existing **error-surfacing** on `seed_progress` reads
(the code comment there warns against silently reporting 0 — keep that honesty; the
server endpoint must return an error the composable surfaces, not swallow it).

**Verify**: `pnpm --filter player-vue test -- useAnalyticsData` passes.

### Step 5: Full green + role matrix

Run all suites. Manually (or via e2e) exercise each role × view: govt_admin (group +
drilled-into-school), school_admin, teacher — confirm each sees exactly its scope.

**Verify**: all typechecks + both test suites pass; role matrix behaves.

## Test plan

- New api endpoint test: per-role scope correctness + cross-scope denial.
- Updated composable tests: assert they call the endpoint and render its result;
  demo-mode path still works.
- Manual/e2e: role × view matrix (the highest-risk regression surface).

## Done criteria

ALL must hold:

- [ ] The two composables' govt_admin/school_admin paths make ONE server call instead
      of the 4-6 serial browser queries (no `groups`/`schools`/`classes` hierarchy
      reads remain in those client paths — `grep` to confirm).
- [ ] The new endpoint intersects requested IDs with `resolveVisibleScope` server-side.
- [ ] Demo mode still works in both composables.
- [ ] Analytics `seed_progress` error-surfacing preserved (no silent 0s).
- [ ] All typechecks + `pnpm test:api` + `pnpm --filter player-vue test` pass.
- [ ] Role × view matrix verified.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- `resolveVisibleScope`'s `CallerScope` doesn't carry enough to serve a view without
  extra hierarchy reads — report what's missing (it may need extending, which is fine,
  but flag it).
- A repoint changes what a role can see (scope regression) in the role matrix — STOP,
  do not ship a visibility change.
- The composables no longer match the excerpts (drift).

## Maintenance notes

- This is the template for repointing the remaining schools composables (condition 2
  of the RLS-tightening runbook in `CLAUDE.md`). Each future repoint shrinks the RLS
  policy surface.
- Reviewer: the risk is scope, not perf — scrutinize the per-role visibility, not the
  query count.
- Keep the client↔server hierarchy logic in ONE place (the server util) after this —
  do not let a new client waterfall creep back in.
