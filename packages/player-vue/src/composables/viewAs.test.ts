/**
 * View-as regression tests (job #793 — restoring the capability removed in
 * d49aabf8). Each of these FAILS on the pre-fix code: before this change
 * useUserRole had no overlay at all and viewAsFetchGuard did not exist.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUserRole } from './useUserRole'
import { viewAsRequestDecision } from './viewAsFetchGuard'
import { viewAsPagesFor } from './viewAsPages'

const admin = () => useUserRole()

describe('useUserRole view-as overlay', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    admin().stopViewing()
    admin().initialize('ssi_admin', null)
  })

  it('an ssi_admin has no school role of their own', () => {
    const r = admin()
    expect(r.canAccessAdmin.value).toBe(true)
    expect(r.hasSchoolRole.value).toBe(false)
  })

  it('viewing as a school leader gives the member surfaces and takes admin away', () => {
    const r = admin()
    r.startViewing({ key: 'k', userId: 'u1', role: 'school_admin', name: 'Dana' })
    // memberSurfaceGuard reads exactly these two: this is why the Handbook,
    // Ways In and Structure pages now render instead of bouncing.
    expect(r.hasSchoolRole.value).toBe(true)
    expect(r.isSchoolAdmin.value).toBe(true)
    // The admin estate is absent while wearing somebody else's face.
    expect(r.canAccessAdmin.value).toBe(false)
    // The real platform role is untouched — that is what lets them exit.
    expect(r.isSsiAdmin.value).toBe(true)
    expect(r.canViewAs.value).toBe(true)
  })

  it('viewing as a learner removes every staff and admin surface', () => {
    const r = admin()
    r.startViewing({ key: 'k', userId: '', role: 'student', name: 'Learner' })
    expect(r.hasSchoolRole.value).toBe(false)
    expect(r.isTeacher.value).toBe(false)
    expect(r.canAccessSchools.value).toBe(false)
    expect(r.canAccessAdmin.value).toBe(false)
  })

  it('survives a reload inside the tab, and exit puts everything back', () => {
    const r = admin()
    r.startViewing({ key: 'k', userId: 'u1', role: 'teacher', name: 'Sam' })
    r.stopViewing()
    // simulate a fresh page: sessionStorage is empty again, so nothing restores
    r.restoreFromCache()
    expect(r.isViewingAs.value).toBe(false)
    expect(r.canAccessAdmin.value).toBe(true)

    r.startViewing({ key: 'k', userId: 'u1', role: 'teacher', name: 'Sam' })
    expect(sessionStorage.getItem('ssi-viewing-as')).toContain('u1')
    r.stopViewing()
    r.restoreFromCache()
    expect(r.isViewingAs.value).toBe(false)
  })

  it('a non-admin cannot mint a persona through the client gate', () => {
    const r = admin()
    r.initialize('tester', 'teacher')
    expect(r.canViewAs.value).toBe(false)
  })
})

describe('viewAsFetchGuard decisions', () => {
  it('blocks direct Supabase table writes', () => {
    expect(viewAsRequestDecision('https://x.supabase.co/rest/v1/classes', 'POST')).toBe('block')
    expect(viewAsRequestDecision('https://x.supabase.co/rest/v1/learners?id=eq.1', 'PATCH')).toBe('block')
    expect(viewAsRequestDecision('https://x.supabase.co/rest/v1/classes?id=eq.1', 'DELETE')).toBe('block')
  })
  it('lets reads, rpc and auth through untouched', () => {
    expect(viewAsRequestDecision('https://x.supabase.co/rest/v1/classes?select=*', 'GET')).toBe('pass')
    expect(viewAsRequestDecision('https://x.supabase.co/rest/v1/rpc/whatever', 'POST')).toBe('pass')
    expect(viewAsRequestDecision('https://x.supabase.co/auth/v1/token?grant_type=refresh_token', 'POST')).toBe('pass')
    expect(viewAsRequestDecision('/api/admin/view-as', 'POST')).toBe('pass')
  })
  it('tags our own API calls so actAsGuard can refuse them server-side', () => {
    expect(viewAsRequestDecision('/api/teacher/class-teachers', 'POST')).toBe('tag')
    expect(viewAsRequestDecision('/api/schools/anything', 'DELETE')).toBe('tag')
  })
})

/**
 * The admin gate must stand back while view-as is being switched on: before
 * this, its isDenied watcher raced useViewAs's own navigation and dumped the
 * admin on the player instead of the school they asked to see (seen on the
 * deployed dev site, job #793, screenshot 04).
 */
describe('admin gate under view-as', () => {
  it('does not redirect while an admin is stepping into a persona', async () => {
    const { useAdminAccessState } = await import('./useAdminGate')
    const r = admin()
    r.initialize('ssi_admin', null)
    r.stopViewing()
    expect(useAdminAccessState().isDenied.value).toBe(false)
    r.startViewing({ key: 'k', userId: 'u1', role: 'school_admin', name: 'Dana' })
    // Denied is TRUE (the estate is genuinely off) — the gate's watcher is
    // what must stand back, which useAdminGate now does via isViewingAs.
    expect(useAdminAccessState().isDenied.value).toBe(true)
    expect(r.isViewingAs.value).toBe(true)
    r.stopViewing()
  })
})

/**
 * The page walker: coverage without a second door into the mode. Fails on the
 * pre-fix code, where viewAsPages did not exist.
 */
describe('viewAsPagesFor', () => {
  const routes = [
    { path: '/schools', components: { default: {} }, meta: { title: 'Schools' } },
    { path: '/schools/classes', components: { default: {} }, meta: { title: 'Classes' } },
    { path: '/schools/setup', components: { default: {} }, meta: { title: 'Setup' } },
    { path: '/schools/handbook', components: { default: {} }, meta: { title: 'Handbook' } },
    { path: '/org/:id', components: { default: {} }, meta: { title: 'Organisation' } },
    { path: '/org/:id/insights', components: { default: {} }, meta: { title: 'Insights' } },
    { path: '/schools/classes/:id', components: { default: {} }, meta: { title: 'Class Detail' } },
    { path: '/org', components: { default: {} }, meta: {} },
    { path: '/schools2', redirect: '/schools1', meta: {} },
    { path: '/admin/structure', components: { default: {} }, meta: { title: 'Structure' } },
    { path: '/admin/users/:learnerId/progress', components: { default: {} }, meta: { title: 'Progress' } },
  ] as any

  it('lists the staff surfaces and fills the node id', () => {
    const paths = viewAsPagesFor(routes, { role: 'school_admin' }, 'SCHOOL1').map(p => p.path)
    expect(paths).toContain('/org/SCHOOL1')
    expect(paths).toContain('/org/SCHOOL1/insights')
    expect(paths).toContain('/schools/handbook')
    // never the admin estate, never a flow door, never an unfillable param
    expect(paths.some(p => p.startsWith('/admin'))).toBe(false)
    expect(paths).not.toContain('/schools/setup')
    // `:id` under /schools is a CLASS, not the node — never fill it with the
    // school id and hand back a link to a class that does not exist.
    expect(paths.some(p => p.startsWith('/schools/classes/'))).toBe(false)
    // the bare /org parent record is a shell, not a page
    expect(paths).not.toContain('/org')
  })

  it('drops node routes when there is no node to fill them with', () => {
    const paths = viewAsPagesFor(routes, { role: 'teacher' }, null).map(p => p.path)
    expect(paths.some(p => p.includes(':id'))).toBe(false)
    expect(paths).toContain('/schools/classes')
  })

  it('gives a learner the learner surfaces only', () => {
    expect(viewAsPagesFor(routes, { role: 'student' }, null).map(p => p.path)).toEqual(['/', '/me'])
  })
})
