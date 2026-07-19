/**
 * Pin: NO auto-refresh on dashboard surfaces (founder ruling, 2026-07-19).
 *
 * Data loads on navigation and then HOLDS STILL until a deliberate refresh.
 * This test fails loudly if `setInterval` (or a visibility/focus auto-refetch)
 * creeps back into any dashboard surface — the one way polling silently
 * returned before. Refresh is only ever the shared useDashboardRefresh action.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '..')

// Every data-bearing dashboard surface on the refresh protocol.
const GUARDED = [
  'views/schools/SchoolsView.vue',
  'views/schools/DashboardView.vue',
  'views/schools/TeacherDashboard.vue',
  'views/schools/ClassDetail.vue',
  'views/admin/NodeHomeView.vue',
  'views/admin/AdminStructure.vue',
  'views/admin/AdminUsers.vue',
  'views/admin/AdminStatsView.vue',
  'views/admin/AdminActivity.vue',
  'views/admin/AdminUserDetail.vue',
  'views/admin/AdminClassHome.vue',
  'views/admin/AdminAnalytics.vue',
  'composables/admin/useAdminActivity.ts',
]

// NOTE ON useAdminGate.ts (deliberately NOT guarded here): it runs a 60s
// `refreshRole()` DB re-validation + a visibilitychange re-check on every admin
// surface. That is a documented SECURITY control, not dashboard-data
// auto-refresh — the org tables it protects are RLS-off by design, so this
// UI gate IS the live-revocation enforcement (see useAdminGate's header and
// docs/trinity/admin.md). It shows up as ~1 idle request/min on admin pages;
// whether that periodic access-revalidation stays is a founder call, tracked
// separately from the no-data-auto-refresh pin. Do NOT add it to GUARDED
// without resolving that — the test would fail by design.

describe('no auto-refresh on dashboard surfaces', () => {
  for (const rel of GUARDED) {
    it(`${rel} registers no polling interval`, () => {
      const src = readFileSync(resolve(srcRoot, rel), 'utf8')
      expect(src, `${rel} must not use setInterval (no polling)`).not.toMatch(/setInterval/)
    })

    it(`${rel} has no visibility/focus auto-refetch`, () => {
      const src = readFileSync(resolve(srcRoot, rel), 'utf8')
      // The old SchoolsView pattern: refetch on visibilitychange / window focus.
      expect(src).not.toMatch(/addEventListener\(\s*['"]visibilitychange['"]/)
      expect(src).not.toMatch(/addEventListener\(\s*['"]focus['"]/)
    })
  }
})
