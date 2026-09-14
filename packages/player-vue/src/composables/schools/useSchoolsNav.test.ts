/**
 * useSchoolsNav — the link tree follows the ROUTE the caller is on, not the
 * read-only `isAdminView` flag.
 *
 * Job #602 (staging, 2026-09-13): under View-as the member /schools shell
 * provides isAdminView=true (to hide write controls), and schoolsLink read
 * that as "I am on the /admin/schools/:id read-view" — so a class row built
 * `/admin/schools/undefined/classes/<id>`, which the admin route guard
 * bounced to the learner home. Same-tree links must stay inside /schools.
 *
 * Job #651 (Chepstow, 2026-09-14): ONE CLASS PAGE for every role. A class
 * link is the class node home, /org/:classId, for a teacher as much as for a
 * leader; the flat /schools/classes/:id page is the class's TOOLS page and is
 * reached only through 'class-tools'.
 */
import { describe, it, expect, vi } from 'vitest'

const routeRef = { path: '/schools/classes', name: 'classes', params: {} as Record<string, string> }
let injected = false
vi.mock('vue', () => ({ inject: () => injected }))
vi.mock('vue-router', () => ({ useRoute: () => routeRef }))

import { useSchoolsNav } from './useSchoolsNav'

describe('useSchoolsNav.schoolsLink', () => {
  it('under view-as on the member /schools tree, links stay on the member tree', () => {
    injected = true // SchoolsContainer provides isAdminView=true while viewing-as
    routeRef.path = '/schools/classes'; routeRef.name = 'classes'; routeRef.params = {}
    const { schoolsLink, isAdminView } = useSchoolsNav()
    expect(isAdminView).toBe(true)
    expect(schoolsLink('class-detail', { classId: 'c1' })).toBe('/org/c1')
    expect(schoolsLink('class-tools', { classId: 'c1' })).toBe('/schools/classes/c1')
    expect(schoolsLink('classes')).toBe('/schools/classes')
    expect(schoolsLink('students')).toBe('/schools/students')
  })

  it('on the ssi_admin read-view tree, links stay under /admin/schools/:id', () => {
    injected = true
    routeRef.path = '/admin/schools/s9/classes'; routeRef.name = 'admin-school-classes'; routeRef.params = { id: 's9' }
    const { schoolsLink } = useSchoolsNav()
    expect(schoolsLink('class-detail', { classId: 'c1' })).toBe('/admin/schools/s9/classes/c1')
    expect(schoolsLink('class-tools', { classId: 'c1' })).toBe('/admin/schools/s9/classes/c1')
    expect(schoolsLink('classes')).toBe('/admin/schools/s9/classes')
  })

  it('group-scope admin read-view falls back to the group dashboard for class links', () => {
    injected = true
    routeRef.path = '/admin/groups/g1'; routeRef.name = 'admin-group-dashboard'; routeRef.params = { id: 'g1' }
    const { schoolsLink } = useSchoolsNav()
    expect(schoolsLink('class-detail', { classId: 'c1' })).toBe('/admin/groups/g1')
    expect(schoolsLink('schools-list')).toBe('/admin/groups/g1/schools')
  })

  // ONE CLASS PAGE for EVERY role (jobs #624 and #651): a class link is the
  // class node home whoever taps it — a teacher as much as a leader.
  it('a member with no flag — a teacher — opens a class on /org/:classId; the tools link is the flat page', () => {
    injected = false
    routeRef.path = '/schools/classes'; routeRef.name = 'classes'; routeRef.params = {}
    expect(useSchoolsNav().schoolsLink('class-detail', { classId: 'c1' })).toBe('/org/c1')
    expect(useSchoolsNav().schoolsLink('class-tools', { classId: 'c1' })).toBe('/schools/classes/c1')
  })

  it('a class link with no id falls back to the classes list rather than /org/', () => {
    injected = false
    routeRef.path = '/schools'; routeRef.name = 'schools-dashboard'; routeRef.params = {}
    expect(useSchoolsNav().schoolsLink('class-detail')).toBe('/schools/classes')
  })
})
