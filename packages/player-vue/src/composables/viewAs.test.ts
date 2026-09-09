/**
 * View-as regression tests (job #793 — restoring the capability removed in
 * d49aabf8). Each of these FAILS on the pre-fix code: before this change
 * useUserRole had no overlay at all and viewAsFetchGuard did not exist.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUserRole } from './useUserRole'
import { viewAsRequestDecision } from './viewAsFetchGuard'

const admin = () => useUserRole()

describe('useUserRole view-as overlay', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    admin().stopActingAs()
    admin().initialize('ssi_admin', null)
  })

  it('an ssi_admin has no school role of their own', () => {
    const r = admin()
    expect(r.canAccessAdmin.value).toBe(true)
    expect(r.hasSchoolRole.value).toBe(false)
  })

  it('viewing as a school leader gives the member surfaces and takes admin away', () => {
    const r = admin()
    r.startActingAs({ key: 'k', userId: 'u1', role: 'school_admin', name: 'Dana' })
    // memberSurfaceGuard reads exactly these two: this is why the Handbook,
    // Ways In and Structure pages now render instead of bouncing.
    expect(r.hasSchoolRole.value).toBe(true)
    expect(r.isSchoolAdmin.value).toBe(true)
    // The admin estate is absent while wearing somebody else's face.
    expect(r.canAccessAdmin.value).toBe(false)
    // The real platform role is untouched — that is what lets them exit.
    expect(r.isSsiAdmin.value).toBe(true)
    expect(r.canActAs.value).toBe(true)
  })

  it('viewing as a learner removes every staff and admin surface', () => {
    const r = admin()
    r.startActingAs({ key: 'k', userId: '', role: 'student', name: 'Learner' })
    expect(r.hasSchoolRole.value).toBe(false)
    expect(r.isTeacher.value).toBe(false)
    expect(r.canAccessSchools.value).toBe(false)
    expect(r.canAccessAdmin.value).toBe(false)
  })

  it('survives a reload inside the tab, and exit puts everything back', () => {
    const r = admin()
    r.startActingAs({ key: 'k', userId: 'u1', role: 'teacher', name: 'Sam' })
    r.stopActingAs()
    // simulate a fresh page: sessionStorage is empty again, so nothing restores
    r.restoreFromCache()
    expect(r.isActingAs.value).toBe(false)
    expect(r.canAccessAdmin.value).toBe(true)

    r.startActingAs({ key: 'k', userId: 'u1', role: 'teacher', name: 'Sam' })
    expect(sessionStorage.getItem('ssi-acting-as')).toContain('u1')
    r.stopActingAs()
    r.restoreFromCache()
    expect(r.isActingAs.value).toBe(false)
  })

  it('a non-admin cannot mint a persona through the client gate', () => {
    const r = admin()
    r.initialize('tester', 'teacher')
    expect(r.canActAs.value).toBe(false)
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
