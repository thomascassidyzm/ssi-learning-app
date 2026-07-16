# Demo Schools real-browser verification

Ad-hoc Playwright script (run with `node`, not `playwright test`) that exercises
the full `/admin/demo-schools` flow against a REAL deployed URL and the shared
live Supabase project — mint real sessions via `admin.generateLink` +
`verifyOtp` (no email ever sent), same technique as `../schools-nav`.

Creates one real demo org, signs in as its school leader, walks every schools
dashboard tab, mints a sign-in link, then expires the org (bans the staff
accounts it created) — so each run is self-cleaning.

## Usage

```
BASE_URL=https://ssi-learning-app-git-dev-zenjin.vercel.app \
SUPABASE_SERVICE_ROLE_KEY=... VITE_SUPABASE_ANON_KEY=... \
node e2e/demo-schools/verify-demo-schools.mjs
```

`ADMIN_EMAIL` (default `thomas.cassidy+ssi@gmail.com`) must be a real
`ssi_admin` account. `COURSE_CODE` (default `zho_for_eng`) must be a live
course.

## Hard-won traps

- `/admin/*` routes gate on `useUserRole`'s **synchronous** localStorage cache
  (`ssi-user-role`) via `router.beforeEach` — unlike the async `/schools`
  guard, a cold session injection with an empty cache bounces to `/` before
  the real DB role check ever resolves. Seed `ssi-user-role` alongside the
  Supabase session token (see `injectSession`).
- DashboardView's "Your classes" widget populates via several **sequential**
  (not parallelised) round trips (classes → per-class progress/sessions/
  teachers/lego-totals) — on a cold load this can take 5-6s. Read too early
  and a perfectly healthy dashboard looks like "No classes yet". Give it
  ~7s before judging a tab's render.
