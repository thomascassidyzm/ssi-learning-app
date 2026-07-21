# Plan 002: Typecheck the whole `api/` surface, not just the audio proxy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> "STOP conditions" item occurs, stop and report. Update this plan's row in
> `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- tsconfig.api.json api`
> If `tsconfig.api.json` changed, compare against the excerpt below before proceeding.

## Status

- **Priority**: P1
- **Effort**: S–M (S to change the config; M if the revealed error burst is large)
- **Risk**: LOW (typecheck-only; no runtime change)
- **Depends on**: none (pairs with 001)
- **Category**: dx
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`pnpm typecheck:api` gives a false sense of safety: it only type-checks
`api/audio/**` plus one helper — about 5 of ~105 `.ts` files under `api/`. The
1,398-line Paddle webhook, every entitlement and subscription handler, `code/redeem`,
and the invite flows are **never** type-checked; they only "compile" at Vercel deploy
time via esbuild, which does no type checking. Type errors in money-critical handlers
ship silently. Widening the config surfaces those errors now, and — combined with
plan 001 — makes them a permanent gate.

## Current state

- `tsconfig.api.json` (verified, full file):

  ```json
  {
    "compilerOptions": {
      "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
      "lib": ["ES2022"], "strict": true, "esModuleInterop": true,
      "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true, "isolatedModules": true, "noEmit": true,
      "noUnusedLocals": true, "noUnusedParameters": true,
      "noImplicitReturns": true, "noFallthroughCasesInSwitch": true,
      "types": ["node"]
    },
    "include": ["api/audio/**/*.ts", "api/_utils/audioAccess.ts"],
    "exclude": ["node_modules", "**/*.test.ts"]
  }
  ```

- `api/` contains ~105 non-test `.ts` files across `access, admin, audio, auth, board,
  code, courses, cron, email, entitlement, govt, groups, invite, me, onboarding,
  school, subscription, teacher, try-link, welcome` plus `_utils`.
- The command is `pnpm typecheck:api` → `tsc --noEmit -p tsconfig.api.json`
  (`package.json:14`).

## Commands you will need

| Purpose        | Command                    | Expected on success |
|----------------|----------------------------|---------------------|
| Install        | `pnpm install`             | exit 0              |
| API typecheck  | `pnpm typecheck:api`       | exit 0, no errors   |
| Count errors   | `pnpm typecheck:api 2>&1 \| grep -c "error TS"` | a number (0 when done) |

## Scope

**In scope**:
- `tsconfig.api.json` (edit `include`)
- Any `api/**/*.ts` file that the widened typecheck reveals a **genuine** type error
  in — minimal, surgical fixes only (add a type annotation, narrow a type, guard a
  possibly-undefined access). Prefer real fixes; use `// @ts-expect-error <reason>`
  only where a proper fix is out of scope and the code is known-correct at runtime.

**Out of scope**:
- Any refactor beyond making the type checker pass. Do not restructure handlers.
- Changing runtime behavior. A type fix that alters what the code *does* is a STOP
  condition — report it instead.
- `**/*.test.ts` (still excluded — they run under vitest's own tsconfig).

## Git workflow

- Branch: `advisor/002-widen-api-typecheck` from `dev`.
- Commit style: `chore(api): typecheck all of api/, not just the audio proxy`.
  If the error-fix burst is large, commit the config change and fixes together but
  in one logical commit; do not push/PR unless instructed.

## Steps

### Step 1: Widen the include glob

Change `tsconfig.api.json`'s `"include"` to `["api/**/*.ts"]`. Leave `exclude`
(which drops `**/*.test.ts`) and all `compilerOptions` unchanged.

**Verify**: `pnpm typecheck:api 2>&1 | grep -c "error TS"` prints the current error
count (likely > 0). Record this number.

### Step 2: Triage the revealed errors

Read every reported error. Classify each:
- **Genuine bug** (e.g. possibly-undefined access, wrong type passed) → fix minimally.
- **Missing dependency types** (e.g. a module has no `@types`) → if adding `@types/*`
  is needed, STOP and report (adds a dependency, out of this plan's scope) unless the
  fix is a one-line local type declaration.
- **Known-correct-at-runtime but hard to express** → `// @ts-expect-error <one-line reason>`.

Fix them file by file, re-running `pnpm typecheck:api` after each file to watch the
count drop.

**Verify**: `pnpm typecheck:api` exits 0.

### Step 3: Confirm no behavior changed

Run the API test suite to confirm your type fixes didn't alter runtime behavior.

**Verify**: `pnpm test:api` → all pass (same count as before Step 1).

## Test plan

No new tests. The type checker itself is the gate. `pnpm test:api` must still pass
unchanged, proving the fixes were type-only.

## Done criteria

ALL must hold:

- [ ] `tsconfig.api.json` `include` is `["api/**/*.ts"]`.
- [ ] `pnpm typecheck:api` exits 0 with zero `error TS` lines.
- [ ] `pnpm test:api` passes with the same test count as before.
- [ ] Every `@ts-expect-error` added carries a one-line reason comment.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- The error count after Step 1 exceeds ~40, or fixes require touching runtime logic
  in the Paddle/Wise webhook or any `subscription`/`entitlement` handler in a way
  that changes behavior — those handlers are money-critical; report the errors as a
  list rather than risking a behavior change without tests (plan 004 adds those tests).
- A fix would require adding a new npm dependency (e.g. `@types/*`).
- `tsconfig.api.json` doesn't match the excerpt above (drift).

## Maintenance notes

- After this lands, plan 001's `pnpm typecheck:api` CI gate protects the whole
  serverless surface automatically.
- New `api/` files are now type-checked by default — no config change needed per file.
- Reviewer: scrutinize every `@ts-expect-error` for whether it hides a real bug.
