# Red dev CI 2026-08-29 — schools hook timeouts at 820316bd

Nightly watson-1 CI on `dev@820316bd`: `pnpm --filter player-vue test` → 3 failed / 247 passed / 1 skipped.
Signature: `Hook timed out in 10000ms` on `beforeEach` in `useSchoolsRail.test.ts` and a
`/schools route guard` describe — no assertion failures.

## Investigation log
- (in progress)

## Verdict: flaky, not a regression. Two distinct root causes.

All three files pass in isolation (3-5 repeats each, clean every time). The suite
takes **43s on an idle box vs 107s on the nightly** — a ~2.5x contention factor,
which is exactly what turns a 4s hook into a >10s one.

### 1. `useOfflineLease.test.ts` — assertion failure (NOT a hook timeout)
The brief reported all three as hook timeouts; the CI log shows this one is
`expected true to be false` at line 208. Root cause is in the test's own
documented race: `grantLease()` fires an un-awaited background `maybeRenew(true)`
that holds an `isRenewing` lock, and the test waited for it with a **fixed
`setTimeout(10)`**. Under load the lock is still held when the test's explicit
`renewLeases(true)` lands, `maybeRenew`'s `if (isRenewing.value) return` swallows
it, the revocation is never applied, and the lease stays valid.

**Fix:** wait on the condition, not the clock — poll until `lease.isRenewing`
clears (5s deadline). The module already exposes `isRenewing` as a computed.

### 2. `schoolsGuard.test.ts` + `useSchoolsRail.test.ts` — hook timeouts
Both `beforeEach` hooks do `await router.push(...)`, and `/schools` is a **lazy
route** (`const SchoolsContainer = () => import('@/containers/SchoolsContainer.vue')`,
router/index.ts:59). So the hook pays, inside the 10s clock, for Vite transforming
SchoolsContainer.vue and its entire import graph. Both failures are the FIRST test
in their file — the one that pays that one-off cost. Corroborating: on the same
red run `resolvedSessionGuard.test.ts` (same shape) took 3930ms without failing.
No leak, no un-torn-down resource, no logic change in the area.

**Fix:** `testTimeout: 20000` / `hookTimeout: 30000` in vitest.config.ts. These
ceilings catch a hung test; they were never meant to police a slow one, and at
10s machine load alone can manufacture a red. Zero cost when tests pass.
