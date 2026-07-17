# Plan 001: Gate every branch on typecheck + tests before it reaches `dev`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 5fb4a42f..HEAD -- .github/workflows`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but is far more useful once 002 and 004 land — see Maintenance notes)
- **Category**: dx
- **Planned at**: commit `5fb4a42f`, 2026-07-17

## Why this matters

This repo has many agents (Ralph loops, `claude/**` web sessions) pushing branches
that **auto-merge into `dev`** with zero verification. The only CI workflow in the
repo merges branches and pushes; it never runs the type checker or the test suite.
`CLAUDE.md` mandates "feedback loops must pass before every commit," but nothing
enforces it — a branch that fails `vue-tsc` or breaks all 562 tests lands on `dev`
anyway, and the human "promote when green" decision has no machine-checked
definition of green. This is the single biggest safety gap given the workflow.

## Current state

- `.github/workflows/auto-merge-claude.yml` — the **only** workflow in the repo.
  It checks out, merges `origin/<branch>` into `dev`, and pushes. Excerpt
  (`auto-merge-claude.yml:30-46`):

  ```yaml
        - name: Merge to dev
          run: |
            git config user.name "github-actions[bot]"
            ...
            git fetch origin dev
            if git merge-base --is-ancestor origin/${{ github.ref_name }} origin/dev; then
              echo "Branch already merged into dev — nothing to do"
              exit 0
            fi
            git checkout dev
            git merge origin/${{ github.ref_name }} --no-edit
            git push origin dev
  ```

  No `verify`/`test` step exists before the merge.

- Verification commands that exist and work (from `package.json` scripts, verified
  during recon):
  - Root: `pnpm typecheck:api` (`tsc --noEmit -p tsconfig.api.json`), `pnpm test:api`
    (`vitest run -c vitest.api.config.ts`)
  - Player: `pnpm --filter player-vue typecheck` (`vue-tsc --noEmit`),
    `pnpm --filter player-vue test` (`vitest run`)
  - Install: `npm install -g pnpm && pnpm install` (matches `vercel.json`'s installCommand)
- Package manager pin: `pnpm@8.15.0` (`package.json:25`), Node `>=18`.

## Commands you will need

| Purpose        | Command                                | Expected on success |
|----------------|----------------------------------------|---------------------|
| Install pnpm   | `npm install -g pnpm@8.15.0`           | exit 0              |
| Install deps   | `pnpm install --frozen-lockfile`       | exit 0              |
| Player typecheck | `pnpm --filter player-vue typecheck` | exit 0, no errors   |
| API typecheck  | `pnpm typecheck:api`                    | exit 0, no errors   |
| Player tests   | `pnpm --filter player-vue test`         | all pass            |
| API tests      | `pnpm test:api`                         | all pass            |
| Lint YAML      | (none configured — visually verify indentation) | — |

Before writing the workflow, run all four verification commands locally and record
which ones currently pass. If any already fails on `dev`, see STOP conditions.

## Scope

**In scope** (the only files you should modify/create):
- `.github/workflows/verify.yml` (create)
- `.github/workflows/auto-merge-claude.yml` (edit — add a job dependency)

**Out of scope** (do NOT touch):
- The merge logic itself (git config / merge / push steps) — only add a gate before it.
- `package.json` scripts — they already exist; do not rename or change them.
- Any application source. This plan adds CI only.

## Git workflow

- Branch: `advisor/001-ci-verify-gate` cut from `dev` (per `CLAUDE.md` branch policy —
  all work goes to `dev`, never `staging`/`main`).
- Commit message style (conventional commits, matching `git log`):
  `ci: gate branches on typecheck + tests before auto-merge to dev`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the reusable verify workflow

Create `.github/workflows/verify.yml` that runs on `push` to `claude/**` and `dev`
and on `pull_request`. It must install pnpm 8.15.0 + Node 20, `pnpm install
--frozen-lockfile`, then run **all four** gates: `pnpm --filter player-vue
typecheck`, `pnpm typecheck:api`, `pnpm --filter player-vue test`, `pnpm test:api`.
Use `actions/checkout@v4.2.2` and `pnpm/action-setup` + `actions/setup-node@v4` with
`cache: pnpm`. Fail the job if any gate fails (default behavior — do not add
`continue-on-error`).

**Verify**: `cat .github/workflows/verify.yml` shows all four commands as separate
`run:` steps; YAML indentation is 2-space and consistent.

### Step 2: Make auto-merge wait for verify to pass

Edit `auto-merge-claude.yml` so the `merge-to-dev` job only runs after verification
succeeds. Two acceptable approaches — pick the simpler one that works with this
repo's setup:

- **Preferred**: add a `needs`-linked verify job *inside* `auto-merge-claude.yml`
  (duplicate the install + four gates into a `verify` job, then
  `merge-to-dev: { needs: verify }`). This keeps the merge trigger's context.
- If you instead rely on the separate `verify.yml` (Step 1), confirm GitHub will
  not merge before it finishes — a separate workflow does NOT block the merge job
  automatically, so the in-file `needs: verify` approach is required for a true gate.
  Choose the in-file approach.

The merge steps (git config, fetch, ancestor check, checkout, merge, push) stay
byte-for-byte identical; only add `needs: verify` and the new `verify` job above it.

**Verify**: `grep -n "needs: verify" .github/workflows/auto-merge-claude.yml`
returns one match; the merge `run:` block is unchanged (diff shows only additions).

### Step 3: Confirm the gates are green on this branch

Run the four verification commands locally. All must pass, proving the gate you just
added won't block legitimate merges on day one.

**Verify**: all four commands exit 0.

## Test plan

This plan adds CI; there is no unit test to write. Verification is:
- The four gate commands pass locally on a clean `dev` checkout.
- The workflow YAML parses (no CI syntax errors). If `act` or a YAML linter is
  available, run it; otherwise a careful visual check of indentation against the
  existing `auto-merge-claude.yml` structure is the gate.

## Done criteria

ALL must hold:

- [ ] `.github/workflows/verify.yml` exists and runs the four gates.
- [ ] `auto-merge-claude.yml`'s `merge-to-dev` job has `needs: verify`, and a
      `verify` job running the four gates precedes it.
- [ ] `pnpm --filter player-vue typecheck` exits 0.
- [ ] `pnpm typecheck:api` exits 0.
- [ ] `pnpm --filter player-vue test` exits 0.
- [ ] `pnpm test:api` exits 0.
- [ ] `git diff` shows the merge steps unchanged (only additions around them).
- [ ] `plans/README.md` status row updated.

## STOP conditions

Stop and report back (do not improvise) if:

- Any of the four gate commands **already fails on a clean `dev` checkout** before
  your changes. That means the gate would block all merges immediately — report the
  failures so they can be fixed first (they are their own findings), and do not land
  a gate that turns CI red for everyone.
- `pnpm install --frozen-lockfile` fails because the lockfile is out of date — report;
  do not "fix" it by regenerating the lockfile (out of scope, changes deps).
- The auto-merge workflow's merge block differs from the excerpt above (drift).

## Maintenance notes

- Once plan 002 widens `tsconfig.api.json` to cover all of `api/`, the
  `pnpm typecheck:api` gate here automatically starts protecting the whole
  serverless surface — no CI change needed.
- Once plan 004 adds webhook tests, `pnpm test:api` covers them automatically.
- Reviewer should confirm the `verify` job actually blocks (an accidental
  `if: always()` or missing `needs` would make the gate cosmetic).
- Future: consider a branch-protection rule on `dev` requiring the verify check,
  as defense-in-depth beyond the `needs:` link.
