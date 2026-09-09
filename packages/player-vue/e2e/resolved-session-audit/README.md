# Resolved-session cold-load regression suite

Real-browser (Playwright, run with `node`, not `playwright test`) cold-load
harness for the founder-priority "kill the async user/role bug class" fix
(2026-07-16): the shared `useResolvedSession` gate + its router/container/
data-composable migration. Each surface named in the fix brief is loaded
DIRECTLY (fresh incognito context, no cached role) as the real persona whose
bug report named it, 3x each — a bounce to the bare player, or a permanent
"Loading…" stall, is exactly the class this fix closes.

## Setup

1. Build + serve the app with real Supabase keys. `vite build` only inlines
   `VITE_*` vars from a `.env`/`.env.local` file in `packages/player-vue`
   itself (the monorepo-root `.env.local` is NOT picked up automatically) —
   copy the `VITE_*` lines from the root `.env.local` into a local
   `packages/player-vue/.env.local` (gitignored) before building:
   `pnpm --filter player-vue build && pnpm --filter player-vue preview` (port 4173)
2. Mint sessions (needs `SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_ANON_KEY`
   in the environment). Uses `admin.generateLink` + `verifyOtp`, so **no email
   is ever sent**: `node mint-sessions.mjs` → writes `sessions.json`
   (gitignored — real tokens, four personas: teacher, school_admin,
   govt_admin, ssi_admin).

## Script

`node cold-load.mjs` — for every (role, path) case, opens a fresh browser
context with ONLY a real Supabase auth-token in localStorage (no
`ssi-user-role` cache — the exact cold-load condition), navigates directly to
the URL, waits for network-idle + a settle window, and asserts the route
didn't bounce and the expected content selector is visible. Runs each case
3x; reports `PASS`/`FAIL` with per-run diagnostics (final path, console
errors) on failure.

Covers: `/schools` (teacher/school_admin/govt_admin), `/schools/analytics`
(teacher/school_admin), `/schools/upgrade` (school_admin),
`/admin/{users,stats,demo-schools}` and `/admin/groups/:id` (ssi_admin).

## Verified regression-catching (2026-07-16)

Stashing the router guard + `AdminContainer` gate fixes and re-running
reproduced the exact reported bug: all four `/admin/*` cold loads bounced
straight to `/` (0/3 each). Restoring the fix returns the suite to 3/3 × 10 =
30/30 green. The `UpgradeView`/`TeacherInsightsView` one-shot-fetch fixes are
additionally covered by deterministic unit tests
(`UpgradeView.laneResolution.test.ts`,
`TeacherInsightsView.classesFetch.test.ts`) rather than relied on here — a
fast localhost round-trip to Supabase can mask that particular race in a
real-browser run, so the unit tests (which force the race directly) are the
reliable net for those two.
