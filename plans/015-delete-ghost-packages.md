# Plan 015: Delete the dead workspace packages and the stub app

> **Executor instructions**: Follow step by step; run every verification command.
> Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- pnpm-workspace.yaml package.json packages apps`
> If any package gained source since this plan, re-verify emptiness before deleting.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (verify-then-delete; git makes it reversible)
- **Depends on**: none (pairs with 014 for the doc side)
- **Category**: tech-debt
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

Three workspace packages contain **no source** (only build/`node_modules` artifacts),
and one `apps/` entry is a single markdown file describing a dashboard that actually
lives inside `player-vue`. `pnpm install` resolves and hydrates node_modules for the
ghost packages, and every new agent burns a discovery cycle on phantom structure.
Deleting them shrinks the workspace to what's real.

## Current state (verified)

- `packages/lesson-player/` — contains only `node_modules/` (no `package.json`, no `src`).
- `packages/ui/` — contains only `dist/` + `node_modules/`.
- `packages/demo/` — contains only `dist/` + `node_modules/`.
- `apps/schools-dashboard/` — contains only `DOCUMENTATION.md` (the real schools UI is
  `packages/player-vue/src/views/schools/`, per `CLAUDE.md`).
- `pnpm-workspace.yaml` globs `packages/*` and `apps/*`.
- Root `package.json` `workspaces: ["packages/*", "apps/*"]`.

## Commands you will need

| Purpose               | Command                                                          | Expected |
|-----------------------|-----------------------------------------------------------------|----------|
| Confirm no source     | `find packages/lesson-player packages/ui packages/demo -name '*.ts' -o -name '*.vue' -o -name 'package.json' \| grep -v node_modules` | empty |
| Find imports of them  | `grep -rnE "@ssi/ui|@ssi/demo|lesson-player" packages/player-vue/src api --include=*.ts --include=*.vue` | empty (or only comments) |
| Check Vercel/CI refs  | `grep -rnE "lesson-player|schools-dashboard|@ssi/ui|@ssi/demo" vercel.json .github package.json pnpm-workspace.yaml` | none load-bearing |
| Install after delete  | `pnpm install`                                                   | exit 0   |
| Build player          | `pnpm --filter player-vue build`                                 | exit 0   |
| Player tests          | `pnpm --filter player-vue test`                                 | all pass |

## Scope

**In scope** (delete):
- `packages/lesson-player/`, `packages/ui/`, `packages/demo/`
- `apps/schools-dashboard/` (move `DOCUMENTATION.md` into `docs/` first if it has
  content worth keeping — see Step 2)
- `pnpm-workspace.yaml` and root `package.json` — prune globs only if they enumerate
  these explicitly (they use `packages/*`/`apps/*` globs, so likely no change needed).

**Out of scope**:
- `packages/core`, `packages/player-vue` (real, keep).
- CLAUDE.md structure text — plan 014 owns that (coordinate).
- `packages/react-adapter`/`packages/vue-adapter` — already gone; nothing to delete.

## Git workflow

- Branch: `advisor/015-delete-ghost-packages` from `dev`.
- Commit style: `chore: remove dead workspace packages (lesson-player, ui, demo) + stub app`.

## Steps

### Step 1: Prove each is dead

Run the "Confirm no source" and "Find imports" commands. Every target must have no
source and no importers in `player-vue` or `api`. Also run the Vercel/CI ref check.

**Verify**: no source files, no imports, no build-config references. If ANY target is
imported or referenced by a build, STOP for that target (keep it) and report.

### Step 2: Preserve the one doc, then delete

If `apps/schools-dashboard/DOCUMENTATION.md` has content worth keeping, `git mv` it to
`docs/legacy-schools-dashboard.md`. Then delete the three package dirs and the
`apps/schools-dashboard` dir.

**Verify**: dirs gone; doc relocated if kept.

### Step 3: Reinstall and prove the build is intact

`pnpm install` (regenerates the lockfile without the ghost packages), then build and
test the player.

**Verify**: `pnpm install` exit 0; `pnpm --filter player-vue build` exit 0;
`pnpm --filter player-vue test` all pass; `pnpm typecheck:api` exit 0.

## Test plan

No new tests. The regression gate is a clean install + player build + full test suite
after deletion, proving nothing depended on the removed packages.

## Done criteria

ALL must hold:

- [ ] `packages/lesson-player`, `packages/ui`, `packages/demo`, `apps/schools-dashboard`
      no longer exist.
- [ ] `pnpm install` succeeds; `pnpm-lock.yaml` no longer references them.
- [ ] `pnpm --filter player-vue build` exit 0; `pnpm --filter player-vue test` all pass;
      `pnpm typecheck:api` exit 0.
- [ ] Any kept doc moved under `docs/`.
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report if:
- Any target has real source, is imported, or is referenced by `vercel.json`/CI —
  keep it and report which.
- The build or test suite fails after deletion (something depended on a `dist/` output
  of `ui`/`demo` at runtime — unexpected; report).

## Maintenance notes

- Coordinate with plan 014 so CLAUDE.md's structure diagram is updated in the same
  timeframe.
- If `@ssi/ui`/`@ssi/demo` are ever needed again, they'd be recreated from scratch —
  the deleted dirs held no source to lose.
