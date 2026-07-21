# Plan 016: Replace the fake lint script with a real (green) ESLint config

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- packages/player-vue/package.json packages/core`
> If the core eslint setup changed, re-read it before copying its pattern.

## Status

- **Priority**: P2
- **Effort**: M (config is S; the first pass to reach green over a 150K-line package is
  the work)
- **Risk**: MED (a large autofix/rule pass can conflict with in-flight `claude/**`
  branches in this multi-agent repo — land it at a quiet moment; keep rules minimal)
- **Depends on**: none (but its value compounds with plan 001's CI gate)
- **Category**: dx
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

`CLAUDE.md`'s Feedback Loops mandate `pnpm --filter player-vue lint` "must pass" before
every commit — but the script is `echo 'No linter configured yet'`, so it passes
vacuously. In an agent-driven repo (Ralph loops, auto-merge `claude/**` → dev) the
largest package has **no** mechanical floor for unused vars, floating promises, or
Vue-specific mistakes. The documented gate is theater, which erodes trust in the other
two gates. `packages/core` already has real ESLint (`"lint": "eslint src/"`), so the
tooling pattern exists in-repo.

## Current state

- `packages/player-vue/package.json:13` — `"lint": "echo 'No linter configured yet'"`.
- Root `package.json:15` — `"lint": "pnpm -r lint"` (fans out to the stub → vacuous).
- `packages/core/package.json:58` — `"lint": "eslint src/"` (real; copy its
  devDependencies and config approach — inspect `packages/core` for its eslint config
  file / flat config).
- No `.eslintrc*` or `eslint.config.*` at repo root or in player-vue (verified).

## Commands you will need

| Purpose            | Command                                             | Expected |
|--------------------|-----------------------------------------------------|----------|
| Install            | `pnpm install`                                       | exit 0   |
| Lint player        | `pnpm --filter player-vue lint`                     | exit 0 (once green) |
| Lint (autofix)     | `pnpm --filter player-vue lint -- --fix`           | applies fixes |
| Player typecheck   | `pnpm --filter player-vue typecheck`               | exit 0   |
| Player tests       | `pnpm --filter player-vue test`                    | all pass |
| Inspect core setup | `cat packages/core/package.json; ls packages/core` | shows eslint deps/config |

## Scope

**In scope**:
- `packages/player-vue/` — add an ESLint flat config (`eslint.config.js` or
  `.eslintrc.cjs` matching the ESLint major that `packages/core` uses),
  `eslint-plugin-vue` + `@typescript-eslint`, replace the stub `lint` script with a
  real one.
- `packages/player-vue/package.json` — devDependencies + `lint` script.
- Source files ONLY as touched by `--fix` autofix and a minimal set of manual fixes
  needed to reach a green baseline (prefer autofix; disable noisy rules rather than
  hand-fixing hundreds of occurrences).

**Out of scope**:
- Adding a formatter (Prettier) or pre-commit hooks (husky/lefthook) — the CI gate in
  plan 001 is the enforcement mechanism (simpler, per BSC). Note hooks as a possible
  follow-up.
- Turning on aggressive rules that would require large manual refactors — start at a
  minimal, mostly-`warn` ruleset that's actually green as `error`-free.
- `api/` linting (could be a follow-up; this plan is scoped to the player package
  where the stub lives).

## Git workflow

- Branch: `advisor/016-real-lint-player-vue` from `dev`.
- Commit style: `chore(player): add real ESLint config, replace stub lint script`.
- Keep the autofix commit separate from the config commit if the diff is large, so
  review is tractable.

## Steps

### Step 1: Mirror core's ESLint setup

Inspect `packages/core`'s eslint config and devDependencies. Add an equivalent flat
config to `packages/player-vue` extended with `eslint-plugin-vue`'s recommended
Vue-3 config and `@typescript-eslint`. Use the SAME ESLint major as core to avoid
workspace skew.

**Verify**: `pnpm --filter player-vue lint` runs (may report many problems).

### Step 2: Reach a green baseline with a minimal ruleset

Run `--fix` to clear autofixable issues. For the rest, tune the ruleset to a minimal
set that passes as errors: keep high-value correctness rules as `error`
(`no-unused-vars`/`@typescript-eslint/no-unused-vars`, `no-undef`,
`vue/no-parsing-error`, `@typescript-eslint/no-floating-promises` if type-aware config
is feasible), and set stylistic/noisy rules to `warn` or `off` for now. The goal is a
**green** `error`-level lint that can be ratcheted later — not a perfect config.

**Verify**: `pnpm --filter player-vue lint` exits 0 (zero errors; warnings allowed).

### Step 3: Replace the stub script

Set `packages/player-vue/package.json` `"lint": "eslint . --ext .ts,.vue"` (or the
flat-config equivalent). Confirm root `pnpm -r lint` now actually lints player-vue.

**Verify**: `pnpm --filter player-vue lint` exits 0; `pnpm lint` (root) exits 0.

### Step 4: Confirm nothing broke

`--fix` can change source. Run typecheck + tests to confirm the autofixes were safe.

**Verify**: `pnpm --filter player-vue typecheck` and `pnpm --filter player-vue test`
pass.

## Test plan

No unit tests. The gate is: `pnpm --filter player-vue lint` exits 0, and typecheck +
test suite still pass after any autofix. If plan 001 has landed, add the lint gate to
the CI verify job (or note it as a follow-up to 001).

## Done criteria

ALL must hold:

- [ ] `packages/player-vue` has a real ESLint config and `eslint-plugin-vue` +
      `@typescript-eslint` devDependencies.
- [ ] `pnpm --filter player-vue lint` exits 0 (zero errors).
- [ ] The `lint` script no longer echoes a stub.
- [ ] `pnpm --filter player-vue typecheck` and `test` still pass after autofix.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- Reaching green requires large manual source refactors (not just autofix + rule
  tuning) — report the rule(s) causing it so we can decide whether to defer them; do
  not hand-edit hundreds of files.
- An autofix changes runtime behavior (e.g. a mis-applied `no-floating-promises`
  fix) and breaks a test — revert that rule to `warn` and report.
- The core eslint major is incompatible with player-vue's Vue 3 + Vite 7 setup —
  report; pick the eslint-plugin-vue version that matches.

## Maintenance notes

- Ratchet plan: once green, flip selected `warn` rules to `error` over time.
- Follow-ups (not this plan): lint `api/`; add Prettier; add a pre-commit hook.
- Reviewer: this diff may be large due to autofix — focus review on the config and any
  manual (non-autofix) source changes.
- Land at a quiet moment to minimize conflicts with in-flight `claude/**` branches.
