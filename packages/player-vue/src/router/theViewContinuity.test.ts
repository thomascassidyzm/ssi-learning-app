/**
 * Pins for THE VIEW's one-continuous-surface rulings (founder, 2026-07-19):
 *
 * 1. "Group pages should appear from within… rather than paint a whole new
 *    page." Drilling org → group → class must keep the map surface mounted:
 *    /admin/groups/:id and /admin/classes/:id resolve to the SAME container
 *    and view component references, so Vue reuses the mounted instances (the
 *    rail never unmounts) instead of repainting.
 * 2. No scroll-to-top jolt while moving inside the map: every node-home
 *    route carries meta.nodeSurface, which scrollBehavior uses to hold the
 *    scroll position.
 * 3. "There's no need for an individual learner page." The route is GONE —
 *    but its URL redirects (never 404s) to the admin user detail page.
 */
import { describe, it, expect } from 'vitest'
import router from './index'

describe('THE VIEW — one continuous surface', () => {
  it('CONTINUITY PIN: group and class homes share the same container + view components (rail stays mounted)', () => {
    const group = router.resolve('/admin/groups/g-1')
    const cls = router.resolve('/admin/classes/c-1')
    expect(group.matched).toHaveLength(2)
    expect(cls.matched).toHaveLength(2)
    // Same lazy component references at both depths → Vue reuses instances
    // across the navigation; a repaint would need different components.
    expect(cls.matched[0].components?.default).toBe(group.matched[0].components?.default)
    expect(cls.matched[1].components?.default).toBe(group.matched[1].components?.default)
  })

  it('CONTINUITY PIN: node-home routes are flagged nodeSurface (scroll held while drilling)', () => {
    for (const path of ['/admin/groups/g-1', '/admin/classes/c-1', '/admin/schools/s-1']) {
      expect(router.resolve(path).meta.nodeSurface, `${path} must carry meta.nodeSurface`).toBe(true)
    }
  })

  it('LEARNER-PAGE-DEAD PIN: /admin/users/:id/progress is no route of its own — it redirects, never 404s', () => {
    const resolved = router.resolve('/admin/users/learner-9/progress')
    // The URL still matches a record — but that record is a pure redirect
    // (no component to render), pointing at the admin user detail page.
    const record = resolved.matched[resolved.matched.length - 1]
    expect(record).toBeTruthy()
    expect(record.components ?? null).toBeNull()
    expect(typeof record.redirect).toBe('function')
    const target = (record.redirect as (to: unknown) => { path: string })({ params: { learnerId: 'learner-9' } })
    expect(target.path).toBe('/admin/users/learner-9')
    // The redirect target is a real, renderable route (never a 404).
    expect(router.resolve(target.path).name).toBe('admin-user-detail')
    // And the old named route is gone entirely.
    expect(router.hasRoute('admin-user-progress')).toBe(false)
  })
})
