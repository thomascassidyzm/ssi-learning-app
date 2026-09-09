import { describe, it, expect, beforeEach } from 'vitest'
import router from './index'
import { useUserRole } from '@/composables/useUserRole'

// Exercises the real /admin beforeEach guard (index.ts) — a cold session
// (no role cache yet) used to bounce a genuine ssi_admin straight to '/'
// (the bare learner player) because the guard only read the SYNC localStorage
// cache and never awaited the async role fetch. Fixed to fall through (like
// the /schools guard) so AdminContainer can do the definitive reactive gate
// once the role loads from DB.

describe('/admin route guard', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    await router.push('/')
  })

  it('does not bounce on empty localStorage (cold session) — falls through to AdminContainer', async () => {
    await router.push('/admin/users')
    expect(router.currentRoute.value.fullPath).toBe('/admin/users')
  })

  it('lets an ssi_admin through once the role cache is populated', async () => {
    useUserRole().initialize('ssi_admin', null)
    await router.push('/admin/stats')
    expect(router.currentRoute.value.fullPath).toBe('/admin/stats')
  })

  it('restores a persisted ssi_admin role on a fresh (uninitialized) module state', async () => {
    localStorage.setItem('ssi-user-role', JSON.stringify({ platformRole: 'ssi_admin', educationalRole: null }))
    await router.push('/admin/demo-schools')
    expect(router.currentRoute.value.fullPath).toBe('/admin/demo-schools')
    expect(useUserRole().canAccessAdmin.value).toBe(true)
  })

  it('a confirmed non-admin still reaches the route (AdminContainer renders its own sign-in/no-access gate, never a bare-player bounce)', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/admin/users')
    expect(router.currentRoute.value.fullPath).toBe('/admin/users')
  })
})

// /methodology has no container-level auth gate (unlike AdminContainer), so
// it must stay strictly synchronous — unchanged behaviour.
describe('/methodology route guard', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    await router.push('/')
  })

  it('bounces a cold session (no cache) straight to /', async () => {
    await router.push('/methodology')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('lets an ssi_admin through', async () => {
    useUserRole().initialize('ssi_admin', null)
    await router.push('/methodology')
    expect(router.currentRoute.value.fullPath).toBe('/methodology')
  })
})
