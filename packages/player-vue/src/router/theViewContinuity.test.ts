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
 *    but its URL redirects (never 404s) — through the dead user-detail fossil —
 *    into the person question (/intel/person), the page that now answers it.
 */
import { describe, it, expect } from 'vitest'
import router from './index'
import { FOSSILS, fossilRouteName } from '@/intel/fossils'

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
    // That page is itself a DEAD FOSSIL since Question 6 was built (a8194fcf2):
    // it renders nothing and redirects on into the person question with the
    // person preserved — so the chain is redirect → redirect → a page.
    const hop = router.resolve(target.path)
    const fossil = hop.matched[hop.matched.length - 1]
    expect(fossil).toBeTruthy()
    expect(fossil.components ?? null).toBeNull()
    expect(typeof fossil.redirect).toBe('function')
    const landing = (fossil.redirect as (to: unknown) => { path: string; query?: Record<string, string> })({
      params: { learnerId: 'learner-9' },
      query: {},
    })
    expect(landing).toEqual({ path: '/intel/person', query: { person: 'learner-9' } })
    // The end of the chain is a real, renderable route (never a 404).
    const end = router.resolve(landing.path)
    expect(end.name).toBe('intel-person')
    expect(end.matched[end.matched.length - 1].components?.default).toBeTruthy()
    // And the old named routes are gone entirely. The fossil's own name is
    // the one fossilRoute() would give it if it came back to life — asserted
    // through the same function the router uses, so a resurrected page fails
    // here. (An earlier pin asserted the absence of 'admin-user-detail', a
    // name no commit ever defined; that line could never fail and is gone.)
    const userFossil = FOSSILS.find((f) => f.path === 'users/:learnerId')!
    expect(fossil.name).toBeUndefined()
    expect(router.hasRoute(fossilRouteName(userFossil))).toBe(false)
    expect(router.hasRoute('admin-user-progress')).toBe(false)
  })
})
