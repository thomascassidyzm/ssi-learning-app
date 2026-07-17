# Plan 004: Characterization tests for the payment/entitlement handlers

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- api/teacher api/subscription api/entitlement`
> If these changed, re-read the handlers before writing tests against them.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW (tests only — no production code changes)
- **Depends on**: none (but strongly recommended before plans 009, 021, and any
  webhook refactor)
- **Category**: tests
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

The money spine is untested. `api/teacher/paddle-webhook.ts` (1,398 lines — signature
verify, idempotency, plan-precedence guard, commission accrual, school/tutor/student
branches), `api/teacher/wise-webhook.ts`, all of `api/subscription/`, and
`api/entitlement/offline-lease.ts` have **zero** tests. `WORKLIST.md` records three
webhook bugs found only by manual review (ordering-safety, plan clobbering, seat
drift) — exactly the class a characterization suite catches. A regression here is real
money: overwritten subscriptions, missed commission, wrongly locked/unlocked schools.
These tests also make the later Paddle build (plan 021) and any webhook refactor safe
to attempt.

"Characterization" = tests that pin the handler's **current** behavior (the row writes
and guard outcomes it produces today), so future changes that alter that behavior fail
loudly. Do not "fix" behavior here; capture it.

## Current state

- Untested money handlers (verified by directory listing — no matching `*.test.ts`):
  - `api/teacher/paddle-webhook.ts` (1,398 lines)
  - `api/teacher/wise-webhook.ts`
  - `api/subscription/index.ts`, `api/subscription/cancel.ts`, `api/subscription/portal.ts`
  - `api/entitlement/offline-lease.ts` (310 lines), `api/entitlement/grant.ts`,
    `api/entitlement/grants.ts`, `api/entitlement/list.ts`
- **Existing test pattern to copy** — `api/code/redeem.test.ts`. It builds a
  chainable Supabase mock that records writes per table and lets each test register
  per-table responders. Excerpt (`api/code/redeem.test.ts:1-40`):

  ```ts
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
  vi.mock('../_utils/auth', () => ({
    verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-user-1' })),
  }))
  let writes: Record<string, any[]> = {}
  let responders: Record<string, (calls: any[][]) => any> = {}
  function recordWrite(table, op, payload) { writes[table] = writes[table]||[]; writes[table].push({op,payload}) }
  function makeChainable(table) {
    const builder = {
      select: (c) => {...; return builder},
      insert: (o) => {recordWrite(table,'insert',o); return builder},
      update: (o) => {recordWrite(table,'update',o); return builder},
      upsert: (o,opts) => {recordWrite(table,'upsert',o); return builder},
      eq: (...) => builder, is: (...) => builder,
      resolve: () => { const r = responders[table]; ... },
    }
  }
  ```

  Existing entitlement tests `api/entitlement/create.test.ts` and
  `api/entitlement/user.test.ts` follow the same shape — read them for the
  entitlement-table mocking specifics.
- Webhook signature verification (verified to exist): `api/teacher/paddle-webhook.ts`
  verifies the Paddle signature on the raw body; `api/teacher/wise-webhook.ts` +
  `api/_utils/wise.ts` verify the Wise signature. Tests must construct
  correctly-signed fixture payloads (or mock the verify helper) — see Step 1.
- Test runner: `pnpm test:api` (`vitest run -c vitest.api.config.ts`).

## Commands you will need

| Purpose      | Command                                              | Expected |
|--------------|-----------------------------------------------------|----------|
| Install      | `pnpm install`                                       | exit 0   |
| One test file| `pnpm test:api -- api/teacher/paddle-webhook.test.ts`| pass     |
| All API tests| `pnpm test:api`                                      | all pass |
| API typecheck| `pnpm typecheck:api`                                 | exit 0   |

## Scope

**In scope** (create these test files — do NOT modify the handlers):
- `api/teacher/paddle-webhook.test.ts` (create)
- `api/teacher/wise-webhook.test.ts` (create)
- `api/subscription/cancel.test.ts`, `api/subscription/portal.test.ts` (create)
- `api/entitlement/offline-lease.test.ts` (create)
- Optionally a shared test helper if the Supabase mock is duplicated across 3+ files:
  `api/_utils/__testHelpers/supabaseMock.ts` (create) — but only if it reduces
  duplication; otherwise inline per file to match the existing convention.

**Out of scope**:
- Any change to a handler's source. If writing a test reveals a bug, **do not fix
  it here** — record it and it becomes its own finding/plan (e.g. plan 009 already
  covers the entitlement cap race). Tests should pin current behavior even if that
  behavior looks wrong; add a `// KNOWN ISSUE:` comment and, if the behavior is a
  confirmed bug, mark the test `it.skip` with a pointer rather than encoding a wrong
  expectation as "correct".
- `config/offlineLease.ts` pure-function tests live in the player package — if you
  want to cover them, that is a player-side test file, note it but it's optional here.

## Git workflow

- Branch: `advisor/004-money-path-tests` from `dev`.
- Commit style: `test(api): characterize paddle/wise webhooks + subscription + offline-lease`.

## Steps

### Step 1: Establish the webhook test harness

Read `api/teacher/paddle-webhook.ts` fully first. Decide how to satisfy signature
verification in tests — the cleanest is to `vi.mock` the signature-verify helper/module
so it returns "valid", mirroring how `redeem.test.ts` mocks `../_utils/auth`. Build (or
reuse) the chainable Supabase mock from `redeem.test.ts`.

**Verify**: a trivial "handler rejects non-POST / missing signature" test passes:
`pnpm test:api -- api/teacher/paddle-webhook.test.ts`.

### Step 2: Characterize the Paddle webhook branches

Write one test per meaningful (event-type × subscriber-kind) combination the handler
actually implements. Read the switch/dispatch in the handler and cover each live
branch: e.g. subscription created / updated / past_due / cancelled, for tutor vs
school-platform vs student. For each, assert the **rows written** (via the `writes`
recorder) and the guard outcomes:
- idempotency: replaying the same event id does not double-write.
- plan precedence: the `wouldDowngradePlan`-style guard does not clobber a higher plan.
- commission accrual writes the expected row where applicable.

Pin whatever the code does today. Where a branch's behavior is ambiguous, assert the
observable writes rather than internal calls.

**Verify**: `pnpm test:api -- api/teacher/paddle-webhook.test.ts` — all new tests pass.

### Step 3: Characterize the Wise webhook

Same approach for `api/teacher/wise-webhook.ts` (signature verify mocked; assert the
payout/recipient row writes and idempotency).

**Verify**: `pnpm test:api -- api/teacher/wise-webhook.test.ts` passes.

### Step 4: Cover subscription + offline-lease endpoints

- `subscription/cancel.ts` and `subscription/portal.ts`: assert they scope to the
  caller's own learner (auth mocked) and reject unauthenticated/cross-user requests.
- `entitlement/offline-lease.ts`: assert the active / lapsed / no-subscription
  response shapes and expiry computation for a fixed clock (inject/mocks per the
  handler's clock source).

**Verify**: `pnpm test:api -- api/subscription api/entitlement/offline-lease.test.ts`
passes.

### Step 5: Full suite green

**Verify**: `pnpm test:api` → all pass (original 30 + your new tests);
`pnpm typecheck:api` exits 0.

## Test plan

- New files listed in Scope. Coverage targets, at minimum:
  - Paddle: ≥1 test per live (event × subscriber-kind) branch + idempotency +
    plan-precedence guard.
  - Wise: happy-path payout write + idempotency + bad-signature rejection.
  - subscription cancel/portal: own-scope success + cross-user/unauth rejection.
  - offline-lease: active / lapsed / no-sub + expiry boundary.
- Structural pattern: model every file on `api/code/redeem.test.ts` and
  `api/entitlement/create.test.ts`.
- Verification: `pnpm test:api` all pass, with the new tests counted.

## Done criteria

ALL must hold:

- [ ] The five test files in Scope exist and pass.
- [ ] `pnpm test:api` passes (30 prior + new tests).
- [ ] `pnpm typecheck:api` exits 0.
- [ ] No handler source file under `api/` was modified (`git status` shows only new
      test files, and optionally the shared helper).
- [ ] Any behavior that looks like a bug is flagged with `// KNOWN ISSUE:` +
      `it.skip`, not encoded as a passing "correct" expectation.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- The Paddle signature verification cannot be satisfied or cleanly mocked without a
  source change — report so we can decide on a test seam.
- A handler's control flow is too tangled to characterize confidently in the 1,398-line
  file — report which branches you covered and which you couldn't, rather than writing
  low-confidence tests. (This is itself evidence for the webhook-refactor finding.)
- You find a clear money bug — record it as a new finding; do not fix inline.

## Maintenance notes

- These tests unblock: plan 021 (Paddle group-commercial build) and any future
  webhook decomposition (the 1,398-line file is a separate tech-debt finding).
- When a new Paddle event type is handled, add a characterization test in the same file.
- Reviewer: check that tests assert *row writes / outcomes*, not just that a function
  was called — call-count tests rot; behavioral tests catch regressions.
