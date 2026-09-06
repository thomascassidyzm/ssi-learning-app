# SSi Learning App

The language learning player application that delivers SSi courses to learners
(content **delivery**, not content creation — course authoring lives in the
separate `ssi-dashboard-v7-clean` repo). It includes the learner player and
the `/schools` dashboard for teachers/admins.

## Structure

A pnpm monorepo with two packages:

- **`packages/core`** (`@ssi/core`) — framework-agnostic TypeScript core:
  learning-engine types, spaced-repetition/adaptation logic, and data types
  for LEGOs/Seeds/Phrases. No UI.
- **`packages/player-vue`** — the Vue 3 SPA that is the actual product: the
  learner player (4-phase prompt/response cycle) and the `/schools`
  dashboard, sharing one deployment.

## Running it

```bash
pnpm install
pnpm dev            # runs the player-vue dev server
pnpm build           # builds all packages
pnpm test            # runs tests across packages
pnpm lint            # lints all packages
```

Deploys to Vercel: `dev` branch → Vercel git-branch preview, `staging` →
staging.saysomethingin.app, `main` → saysomethingin.app.

## More detail

See [`CLAUDE.md`](./CLAUDE.md) for the fuller agent-facing guide (branch
policy, architecture decisions, RLS/auth patterns, and more).
