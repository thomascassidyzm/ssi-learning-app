/**
 * Pins for the founder ruling of 2026-08-02: an org/workplace is NOT a
 * schools feature, so its surface lives at TOP-LEVEL /org/:id — never under
 * /schools. Three things must stay true forever:
 *
 * 1. /org/:id and /org/:id/insights resolve to the node surface, inside the
 *    same shell (SchoolsContainer) the schools lane uses — one container, one
 *    guard, one platform gate.
 * 2. The old /schools/org/:id URLs still work: minted invite links, bookmarks
 *    and shared deep links redirect to the new path, carrying query + hash
 *    (?lens=, ?student=, ?mission= all ride along).
 * 3. /orgs (PLURAL) is the self-serve org SIGNUP door (founder instruction
 *    2026-08-02, track: 'org' on the shared Onboarding.vue) — a distinct
 *    route from the member node surface. The org surface must never swallow
 *    it, and isMemberNodeSurface must not mistake it for the member mount.
 */
import { describe, it, expect } from 'vitest'
import router from './index'
import { isMemberNodeSurface } from '@/composables/nodeSurfacePaths'

describe('org surface — top-level /org', () => {
  it('MOUNT PIN: /org/:id + /org/:id/insights are the member node surface', () => {
    const home = router.resolve('/org/node-1')
    expect(home.name).toBe('org-node-home')
    expect(home.meta.nodeSurface).toBe(true)
    expect(home.matched).toHaveLength(2) // shell + view

    const insights = router.resolve('/org/node-1/insights')
    expect(insights.name).toBe('org-node-insights')
    // Same shell component as the node home → the surface never repaints.
    expect(insights.matched[0].components?.default).toBe(home.matched[0].components?.default)
  })

  it('SHELL PIN: /org and /schools share ONE container and ONE guard', () => {
    const org = router.resolve('/org/node-1')
    const schools = router.resolve('/schools/students')
    expect(org.matched[0].components?.default).toBe(schools.matched[0].components?.default)
    expect(org.matched[0].beforeEnter).toBe(schools.matched[0].beforeEnter)
  })

  it('LEGACY PIN: /schools/org/:id redirects to /org/:id, query and hash intact', () => {
    // router.resolve() does not FOLLOW redirects, so assert on the record:
    // it is a pure redirect (no component of its own) and its target is the
    // new path with query + hash carried over.
    for (const [from, to] of [
      ['/schools/org/node-1?lens=schools#top', '/org/node-1'],
      ['/schools/org/node-1/insights?course=cym', '/org/node-1/insights'],
    ] as const) {
      const resolved = router.resolve(from)
      const record = resolved.matched[resolved.matched.length - 1]
      expect(record.components?.default, `${from} must be a pure redirect`).toBeUndefined()
      const target = (record.redirect as (r: typeof resolved) => any)(resolved)
      expect(target.path).toBe(to)
      expect(target.query).toEqual(resolved.query)
      expect(target.hash).toBe(resolved.hash)
    }
  })

  it('UPGRADE PIN: the org lane has its own billing door — no /schools URL for an org leader', () => {
    expect(router.resolve('/org/upgrade').name).toBe('org-upgrade')
  })

  it('/orgs PIN: the plural is the signup door, never the member node surface', () => {
    // Not the org node surface, and not swallowed by /org/:id.
    expect(router.resolve('/orgs').name).not.toBe('org-node-home')
    expect(isMemberNodeSurface('/orgs')).toBe(false)
    expect(isMemberNodeSurface('/orgs/why')).toBe(false)
    // …while the real member mount still reads as the member mount.
    expect(isMemberNodeSurface('/org/node-1')).toBe(true)
    expect(isMemberNodeSurface('/schools/org/node-1')).toBe(true)
    expect(isMemberNodeSurface('/admin/groups/node-1')).toBe(false)
  })
})
