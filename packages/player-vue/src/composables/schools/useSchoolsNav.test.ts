/**
 * useSchoolsNav — the link tree follows the ROUTE the caller is on, not the
 * read-only `isAdminView` flag.
 *
 * Job #602 (staging, 2026-09-13): under View-as the member /schools shell
 * provides isAdminView=true (to hide write controls), and schoolsLink read
 * that as "I am on the /admin/schools/:id read-view" — so a class row built
 * `/admin/schools/undefined/classes/<id>`, which the admin route guard
 * bounced to the learner home. Same-tree links must stay inside /schools.
 */
import { describe, it, expect, vi } from 'vitest'

const routeRef = { path: '/schools/classes', name: 'classes', params: {} as Record<string, string> }
let injected = false
vi.mock('vue', () => ({ inject: () => injected }))
vi.mock('vue-router', () => ({ useRoute: () => routeRef }))

import { useSchoolsNav } from './useSchoolsNav'

describe('useSchoolsNav.schoolsLink', () => {
  it('under view-as on the member /schools tree, class-detail stays in /schools', () => {
    injected = true // SchoolsContainer provides isAdminView=true while viewing-as
    routeRef.path = '/schools/classes'; routeRef.name = 'classes'; routeRef.params = {}
    const { schoolsLink, isAdminView } = useSchoolsNav()
    expect(isAdminView).toBe(true)
    expect(schoolsLink('class-detail', { classId: 'c1' })).toBe('/schools/classes/c1')
    expect(schoolsLink('classes')).toBe('/schools/classes')
    expect(schoolsLink('students')).toBe('/schools/students')
  })

  it('on the ssi_admin read-view tree, links stay under /admin/schools/:id', () => {
    injected = true
    routeRef.path = '/admin/schools/s9/classes'; routeRef.name = 'admin-school-classes'; routeRef.params = { id: 's9' }
    const { schoolsLink } = useSchoolsNav()
    expect(schoolsLink('class-detail', { classId: 'c1' })).toBe('/admin/schools/s9/classes/c1')
    expect(schoolsLink('classes')).toBe('/admin/schools/s9/classes')
  })

  it('group-scope admin read-view falls back to the group dashboard for class links', () => {
    injected = true
    routeRef.path = '/admin/groups/g1'; routeRef.name = 'admin-group-dashboard'; routeRef.params = { id: 'g1' }
    const { schoolsLink } = useSchoolsNav()
    expect(schoolsLink('class-detail', { classId: 'c1' })).toBe('/admin/groups/g1')
    expect(schoolsLink('schools-list')).toBe('/admin/groups/g1/schools')
  })

  it('a real member with no flag gets member links', () => {
    injected = false
    routeRef.path = '/schools/classes'; routeRef.name = 'classes'; routeRef.params = {}
    expect(useSchoolsNav().schoolsLink('class-detail', { classId: 'c1' })).toBe('/schools/classes/c1')
  })
})
