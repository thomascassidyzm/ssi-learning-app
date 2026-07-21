# Plan 017: Upgrade vitest off the EOL 1.x line and align TypeScript pins

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- package.json packages/core/package.json packages/player-vue/package.json vitest.api.config.ts`
> If versions changed, re-read them before proceeding.

## Status

- **Priority**: P3
- **Effort**: M (vitest 1→3 has breaking changes across config + mocking APIs)
- **Risk**: MED (test-suite-only blast radius, but the suite is the repo's main safety
  net — do this AFTER plan 001 so regressions are caught)
- **Depends on**: 001 recommended (CI gate makes the upgrade's effect visible)
- **Category**: deps
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

All three package manifests pin `vitest: ^1.0.0` while player-vue builds with
`vite: ^7.2.4` and `@vitejs/plugin-vue: ^6.0.1`. Vitest 1.x (bundling Vite 5) is
unmaintained — no security fixes — and tests therefore execute under a **different Vite
major than production builds**, so transform/resolve behavior can diverge ("passes in
test, differs in build"). `@vitejs/plugin-vue@6` targets Vite 6/7; running it under
vitest 1's bundled Vite 5 is a compatibility cliff. TypeScript is also skewed
(`^5.3.0` in core vs `^5.9.3` in player-vue).

## Current state

- `package.json:23` — `"vitest": "^1.0.0"`; `packages/core/package.json:65` — same;
  `packages/player-vue/package.json:47` — `"vitest": "^1.0.0"`.
- player-vue: `vite: ^7.2.4`, `@vitejs/plugin-vue: ^6.0.1`.
- `typescript`: `^5.3.0` (core), `^5.9.3` (player-vue), `^5.3.0` (root).
- Test entry points: `pnpm --filter player-vue test` (vitest, player), `pnpm test:api`
  (`vitest run -c vitest.api.config.ts`), `pnpm --filter @ssi/core test`.
- ~115 `*.test.ts` files across api + player-vue.

## Commands you will need

| Purpose          | Command                                    | Expected |
|------------------|--------------------------------------------|----------|
| Install          | `pnpm install`                             | exit 0   |
| Player tests     | `pnpm --filter player-vue test`           | all pass |
| API tests        | `pnpm test:api`                           | all pass |
| Core tests       | `pnpm --filter @ssi/core test`            | all pass |
| Player typecheck | `pnpm --filter player-vue typecheck`      | exit 0   |
| API typecheck    | `pnpm typecheck:api`                       | exit 0   |
| Audit            | `pnpm audit --prod`                        | (ws advisory may clear) |

## Scope

**In scope**:
- `package.json`, `packages/core/package.json`, `packages/player-vue/package.json` —
  bump `vitest` to a single aligned `^3` (or `^4` if stable and compatible) across all
  three; align `typescript` to one pin (`^5.9.x`).
- `vitest.api.config.ts` and any per-package vitest config — migrate to the new major's
  config/API shape.
- Test files ONLY where a breaking mocking-API change requires it (e.g. `vi.mock`
  hoisting/`vi.mocked` changes) — minimal, mechanical.
- `pnpm-lock.yaml` — regenerated.

**Out of scope**:
- Rewriting tests beyond what the API break requires.
- Vite/plugin-vue bumps (already current).
- Other deps (plan 003 owns the security bumps).

## Git workflow

- Branch: `advisor/017-upgrade-vitest` from `dev`.
- Commit style: `chore(deps): upgrade vitest 1→3 across workspace, align typescript pins`.

## Steps

### Step 1: Bump vitest across all three packages together

Set the same `vitest` major in all three manifests (never mix majors in one workspace).
Align `typescript` to `^5.9.x` everywhere. `pnpm install`.

**Verify**: `pnpm install` exit 0; `pnpm why vitest` shows a single version.

### Step 2: Migrate config to the new major

Update `vitest.api.config.ts` and any package vitest config for breaking changes
(workspace config shape, `test.environment`, `deps` options, coverage provider). Follow
the vitest migration guide for the chosen major.

**Verify**: each test command at least *starts* (no config-parse error).

### Step 3: Fix test-API breakages mechanically

Run each suite; fix breaks caused by mocking API changes (`vi.mock` factory hoisting,
`vi.mocked`, `spyOn` signatures, fake timers). These are mechanical and localized.

**Verify**: `pnpm --filter player-vue test`, `pnpm test:api`, and
`pnpm --filter @ssi/core test` all pass with the **same test counts** as before.

### Step 4: Confirm typechecks and audit

**Verify**: both typechecks exit 0; `pnpm audit --prod` no longer lists the vitest-line
`ws` advisory (or note if it persists via another path).

## Test plan

The existing ~115 test files ARE the test plan — they must all pass unchanged (same
counts) under the new runner. Any test whose *assertions* change is a red flag (the
upgrade should not change what's asserted, only how the runner executes).

## Done criteria

ALL must hold:

- [ ] `vitest` is one aligned major (`^3`+) across all three manifests; `typescript`
      pins aligned.
- [ ] `pnpm --filter player-vue test`, `pnpm test:api`, `pnpm --filter @ssi/core test`
      all pass with unchanged test counts.
- [ ] Both typechecks exit 0.
- [ ] Only manifests, vitest config, lockfile, and mechanically-broken test files changed.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- More than a handful of test files need non-mechanical changes to pass — report the
  pattern; a large test rewrite is beyond this plan.
- A test's *assertion* (not its setup) must change to pass — that signals the runner
  upgrade altered behavior; investigate before proceeding.
- vitest 3/4 is incompatible with the installed Vite 7 / plugin-vue 6 — report the
  compatible version matrix.

## Maintenance notes

- After this, tests run under the same Vite major as production builds — the
  "passes in test, differs in build" gap closes.
- Do this after plan 001 so any regression is caught by CI, and ideally not
  concurrently with plan 016 (both touch player-vue devDependencies).
