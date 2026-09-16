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
