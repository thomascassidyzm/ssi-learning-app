# Plan 022 (SPIKE): Wire the Insight Engine's deferred real-data paths

> **Executor instructions**: This is a **spike/design + first-widget** plan. Deliverable
> is: confirm which rates are real-and-populated now, wire the two safest through a
> server-mediated endpoint (replacing demo fixtures), and document the pattern. Do NOT
> fake data or present seeded demo as live. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/src/insight packages/player-vue/src/views/schools/AnalyticsView.vue`

## Status

- **Priority**: P2 (the spine bet's first real-consumer moment)
- **Effort**: M
- **Risk**: LOW–MED (additive; risk is showing wrong/empty data — mitigate with
  empty-with-honesty)
- **Depends on**: benefits from 018 (server-mediated reads pattern)
- **Category**: direction
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`WORKLIST.md` (2026-07-14): "ANALYTICS ARE REAL OR ABSENT… never seeded demo presented
as live." The rate-compare widget shipped "DEMO-ONLY (fixtures); live-rate wiring
DEFERRED — no schools onboarded yet (earn-it: wire when the waiting schools go live)."
The region-tier rollout (slices 1-3 shipped) is now meeting that earn-it trigger —
schools/groups are going live. Leaving demo fixtures as the ONLY path risks exactly the
seeded-as-live failure the direction forbids. This is the Insight Engine (the stated
spine) reaching its first real consumer.

## Current state (verify)

- `packages/player-vue/src/insight/` — the Insight Engine surfaces (e.g.
  `TeacherInsightsView.vue`, the Discovery feed). Read the registry/resolver structure.
- `packages/player-vue/src/views/schools/AnalyticsView.vue` (~:290) — class-avg only;
  benchmark/comparison views unwired.
- WORKLIST notes the rate-compare widget is demo-only; engagement/coverage rates are
  cited as the ones already "real + populated."
- `WORKLIST.md:72` flags an authz-pattern fork for these reads — the standing direction
  (and `CLAUDE.md`) favor **server-mediated endpoints** over raw client reads (also the
  RLS-tightening direction). Resolve it that way.
- Demo mode must remain an **explicit toggle**, never the implicit default for live views.

## Commands you will need

| Purpose      | Command                                             | Expected |
|--------------|----------------------------------------------------|----------|
| API tests    | `pnpm test:api`                                     | all pass |
| Player tests | `pnpm --filter player-vue test`                   | all pass |
| Typechecks   | `pnpm typecheck:api` && `pnpm --filter player-vue typecheck` | exit 0 |

## Scope

**In scope**:
- Confirm which Insight rates are real-and-populated today (engagement/coverage per the
  WORKLIST note) vs still-demo.
- Wire the two safest through a **server-mediated endpoint** (per the resolved authz
  fork), replacing the demo fixtures in the live path — with an explicit demo toggle
  retained and an honest empty state when a cohort has no data yet.
- Tests for the endpoint + the widget's real/empty/demo states.
- Document the wiring pattern so remaining widgets follow it.

**Out of scope**:
- Comparison/benchmark views that require cohorts which don't exist yet (school-vs-country,
  student-vs-class) — wire them real ONLY where real cohorts exist; otherwise leave
  empty-with-honesty, do not fake.
- Building new metrics — only wire existing resolvers to real data.

## Steps

### Step 1: Confirm real-vs-demo per rate

Read the insight registry/resolvers. For each rate the widgets show, determine: is
there a real resolver with populated data today? Produce a table: rate → real? →
populated for live cohorts?

**Verify**: table complete; the two safest (engagement/coverage) confirmed real.

### Step 2: Resolve the authz fork → server endpoint

Per `WORKLIST.md:72` and the RLS direction, expose the two rates through a
server-mediated endpoint (reuse the `resolveVisibleScope` pattern / plan 018's endpoint
if it fits). Do not add raw client org-table reads.

**Verify**: endpoint returns the two rates scoped to the caller; api test passes.

### Step 3: Wire the widget to real data with an honest empty state

Replace the demo-fixture source in the live path with the endpoint. Keep demo mode
behind its explicit toggle. When a cohort has no data, show empty-with-honesty (not a
seeded number).

**Verify**: `pnpm --filter player-vue test` — widget tests cover real/empty/demo states.

### Step 4: Document the pattern

Write the "wire an Insight widget to real data" pattern (endpoint + toggle + empty
state) into `docs/methodology/insight-engine*.md` so the remaining widgets follow it.

**Verify**: doc updated.

## Done criteria

ALL must hold:

- [ ] Table of which rates are real vs demo.
- [ ] Two rates wired through a server-mediated endpoint (no new raw client org reads).
- [ ] Live path shows real data or honest-empty — never seeded demo; demo behind an
      explicit toggle.
- [ ] Endpoint + widget tests pass; both typechecks + suites green.
- [ ] Wiring pattern documented.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and deliver design-only if:
- Neither candidate rate is actually populated for live cohorts yet — report; do not
  wire an empty pipe and call it done (or wire it with a prominent honest-empty state
  and say so).
- A widget's only data source would be a benchmark cohort that doesn't exist — leave it
  demo-toggled/empty, do not fabricate.

## Maintenance notes

- This establishes the real-data pattern for the rest of the Insight boards
  (`WORKLIST.md:51` open item).
- Reuses/depends on plan 018's server-mediated scope endpoint where possible.
- Reviewer: the cardinal rule is "real or absent" — reject any seeded-as-live path.
