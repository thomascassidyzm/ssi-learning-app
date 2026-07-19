# The refresh protocol — no auto-refresh, one manual affordance everywhere

**Founder ruling (2026-07-19).** NO auto-refresh anywhere on dashboard surfaces —
not even during a live class. Data loads on navigation and then **holds still**.
The only way data updates is a deliberate human action through ONE universal
affordance:

- a **circular-arrow refresh button** in a consistent navbar position, and/or
- **pull-to-refresh** on touch devices,

with a quiet **"Updated 14:32"** stamp near the stats so staleness is honest.

This is consistency law §1.12 applied to freshness: same spot, same icon, same
behaviour on every dashboard page.

## Architecture — one shared composable

Everything routes through **`composables/useDashboardRefresh.ts`** (a module-level
singleton):

- Each dashboard page calls `registerRefresh(loadFn)` in setup. The handler is
  auto-cleaned on unmount (`onScopeDispose`). Pages route their **initial load**
  through the same `refresh()` so the spinner and timestamp are honest from the
  first paint.
- **`components/shared/RefreshButton.vue`** — the circular-arrow button. Lives in
  both top bars (`SchoolsTopBar`, `AdminTopBar`), top-right near identity. Renders
  **only** where a loader is registered (a refresh button on a page with no
  refreshable data would be a dead control), and spins while fetching.
- **`components/shared/UpdatedStamp.vue`** — the "Updated HH:MM" marker, reads the
  same shared timestamp. Shows nothing until the first successful load.
- **`composables/usePullToRefresh.ts`** — touch pull-to-refresh, wired at the
  container scroll root (`SchoolsContainer`, `AdminContainer`), fires the SAME
  `refresh()`.

**A failed refresh never looks "up to date":** `refresh()` advances the timestamp
only when the loader resolves without throwing.

### Navbar position decision

Top-**right**, adjacent to the identity/avatar cluster — the established web
convention (Gmail, Slack, GitHub all put reload/utility actions on the right near
account). Chosen over top-left; noted here per the ruling.

## Auto-refresh removed (the audit)

| Surface | What was removed |
|---|---|
| `composables/admin/useAdminActivity.ts` + `AdminActivity.vue` | `setInterval(fetchActivity, 60_000)` live-activity poll, and the literal "Auto-refresh · 60s" note (replaced by the honest Updated stamp). |
| `views/schools/SchoolsView.vue` | `visibilitychange` + window `focus` auto-refetch (the only remaining implicit auto-refresh on the schools list). |

**Not auto-refresh — deliberately kept:**
- `useAdminGate.ts` 60s `revalidate` interval — an **auth** re-validation (revokes
  access on a mid-session role downgrade), not dashboard data. Removing it would be
  a security regression.
- Player/audio/offline timers (`useCyclePlayback`, `usePlayerLog`, `useOfflineLease`,
  `LearningPlayer`, `ListeningOverlay`, `PwaUpdatePrompt`) — playback mechanics, not
  dashboard data refresh.
- **Play-as-class live stats** — verified there is no polling/realtime here. The
  class-aware progress store (`useClassProgressStore`) is a **write** path; the
  teacher's class stats load on navigation to the dashboard / class detail. Nothing
  to remove; "no auto-refresh, even during a live class" already holds.

## Surfaces on the protocol

Registered loaders + Updated stamp:
`SchoolsView`, `DashboardView`, `TeacherDashboard`, `ClassDetail`,
`NodeHomeView` (the recursive node home, all org levels), `AdminStructure`,
`AdminUsers`, `AdminActivity`.

`AdminStatsView` (the Insight boards) is on the button via a board-remount refresh
— each board owns its own async fetch, so the universal refresh re-mounts the
active board. No Updated stamp there (we can't observe the board's async fetch
completing, so a stamp would be dishonest).

Other, non-data admin/settings pages have no loader and therefore no button — by
design.

## Pin against regression

`composables/noDashboardPolling.test.ts` fails if `setInterval` or a
visibility/focus auto-refetch reappears in any guarded dashboard surface.
`useDashboardRefresh.test.ts` + `usePullToRefresh.test.ts` pin the action,
timestamp-on-success-only, and gesture behaviour.

## Verification

Screenshots (deployed dev, 3 org levels) in this directory:
`refresh-*.png`.
