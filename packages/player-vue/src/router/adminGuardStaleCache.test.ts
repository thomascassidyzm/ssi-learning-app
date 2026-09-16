import { describe, it, expect, beforeEach } from 'vitest'
import router from './index'
import { useUserRole } from '@/composables/useUserRole'

// Job #34: Tom, a real ssi_admin, opened /admin/insights-lab on his phone and
// was thrown to the player. Reproduced on staging: an ssi_admin session whose
// localStorage still held a previous visit's non-admin role was bounced by
// this guard milliseconds before the DB answered 'ssi_admin'. The cache is
// the LAST visit's answer — it may let someone through, it must never deny.

describe('/admin route guard and the localStorage role cache', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    await router.push('/')
  })

  it('does not bounce a deep link on a role known only from the cache', async () => {
    // Exactly the phone state: a remembered non-admin role, nothing live yet.
    localStorage.setItem('ssi-user-role', JSON.stringify({ platformRole: null, educationalRole: null }))
    await router.push('/admin/insights-lab')
    expect(router.currentRoute.value.fullPath).toBe('/admin/insights-lab')
    expect(useUserRole().isRoleAuthoritative.value).toBe(false)
  })

  it('still bounces a non-admin whose role came from a live source', async () => {
    useUserRole().setAuthoritative(null, 'teacher')
    await router.push('/admin/insights-lab')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('lets a live ssi_admin through', async () => {
    useUserRole().setAuthoritative('ssi_admin', null)
    await router.push('/admin/insights-lab')
    expect(router.currentRoute.value.fullPath).toBe('/admin/insights-lab')
  })
})

// Job #34, second defect: the guest hand-off (useAdminGate.deniedDestination)
// sends an unplaceable visitor to /schools carrying ?next=<admin path>, and
// SchoolsContainer replays it once the role resolves. An ssi_admin whose role
// was ALREADY cached never reached that replay — memberSurfaceGuard ejected
// them to /admin/structure first and the destination was lost. Reproduced on
// staging from a phone context: /schools?next=/admin/insights-lab landed on
// /admin/structure with the role cached, and on the lab with it cold.
describe('the guest hand-off survives an admin whose role is already known', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    await router.push('/')
  })

  it('sends an ssi_admin carrying ?next= to the page they asked for', async () => {
    useUserRole().setAuthoritative('ssi_admin', null)
    await router.push('/schools?next=/admin/insights-lab')
    expect(router.currentRoute.value.fullPath).toBe('/admin/insights-lab')
  })

  it('still ejects an ssi_admin with no next to the org tree', async () => {
    useUserRole().setAuthoritative('ssi_admin', null)
    await router.push('/schools')
    expect(router.currentRoute.value.fullPath).toBe('/admin/structure')
  })

  it('refuses a next that is not an in-app admin path', async () => {
    useUserRole().setAuthoritative('ssi_admin', null)
    await router.push('/schools?next=//evil.example/x')
    expect(router.currentRoute.value.fullPath).toBe('/admin/structure')
  })
})
