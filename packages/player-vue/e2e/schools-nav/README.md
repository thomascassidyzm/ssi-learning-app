# Schools nav real-browser harness

Ad-hoc Playwright scripts (run with `node`, not `playwright test`) that sign in
as REAL schools personas and drive the built app. Written for the 2026-07-16
schools-nav root-cause session; kept because this surface has a history of
bugs that only reproduce in a real browser (jsdom fakes zero-duration
transitions, so the white-page/stacking class is invisible to unit tests).

## Setup

1. Build + serve the app:
   `pnpm --filter player-vue build && pnpm --filter player-vue preview` (port 4173)
2. Mint sessions (needs `SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_ANON_KEY`
   in the environment — see `.env.local`). Uses `admin.generateLink` +
   `verifyOtp`, so **no email is ever sent**:
   `node mint-sessions.mjs` → writes `sessions.json` (gitignored — real tokens).

## Scripts

- `repro-nav.mjs <role> [cycles]` — cycles every top-bar tab for the role,
  sampling the incoming page's bounding box during the swap and the scroll
  container's offset after it. Catches: pages rendering below the fold then
  jumping (the old crossfade), scroll carry-over between tabs, and white
  pages (route changed but view absent). The acceptance bar is
  `stacking=0 scrollCarry=0 whitePages=0` for 20 cycles per role.
- `verify-playasclass.mjs` — asserts the play-as-class matrix: button visible
  for school_admin + teacher on DashboardView, /schools/classes and
  ClassDetail; absent for govt_admin everywhere (incl. ClassDetail
  deep-link); clicking launches /schools/play?class=<id> with the schools
  top bar persistent, the player mounted, and the CLASS's course active.
- `verify-viewas.mjs` — asserts the ssi_admin "View as" (useActAs) reads on
  the DEPLOYED build across the live IME Demo cast (IME Group Leader /
  Lissy Thomas / Anu Varghese). Mints the admin session in-memory (no token
  on disk), primes the act-as persona in sessionStorage, loads /schools, and
  fails on any of: dashboard didn't render, `school_id` null crash, an
  `/api/*` 403 (esp. `school-links`), a "Couldn't refresh" error banner, or a
  write control (Create school) visible under the read-only banner. Writes
  `viewas-<key>.png` per persona. Guards the 2026-07-18 View-as fix batch.

Personas: thomas.cassidy+ang_school_admin / +ang_school_teacher (Angharad 001,
class "Ang School Y7 Welsh", course cym_n_for_eng) and +govtest (Test Gov
Group). All @gmail.com test accounts.

## Hard-won traps

- Don't navigate with a raw `history.pushState` fallback — it bypasses
  vue-router entirely (URL changes, `router.currentRoute` doesn't) and
  manufactures a fake "wedge". Always click the real link and let Playwright
  auto-wait: on a cold boot the tab set only renders once the school context
  resolves.
- A healthy vue-router push emits TWO framenavigated events (replaceState
  scroll-save + pushState); exactly one is the signature of something
  bypassing the router.
