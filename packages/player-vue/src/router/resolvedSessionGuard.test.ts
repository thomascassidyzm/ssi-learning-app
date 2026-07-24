import { describe, it, expect, beforeEach } from 'vitest'
import router from './index'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

// Exercises the admin/methodology top-level guard (index.ts) — used to make
// a final yes/no decision straight off the synchronous localStorage role
// cache; a fresh browser (no cache) read as "no", bouncing an about-to-
// resolve ssi_admin off every /admin deep link. The '/' bare-player route
// carries no redirect at all any more (owner ruling 2026-07-24: everyone
// lands in the player by default — see schoolsGuard.test.ts).

describe('/admin + /methodology guard', () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
    await router.push('/')
  })

  it('does not bounce on an uninitialized role cache — defers rather than guessing', async () => {
    await router.push('/admin/structure')
    expect(router.currentRoute.value.fullPath).toBe('/admin/structure')
  })

  it('bounces a KNOWN non-admin to /', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/admin/structure')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('lets a known ssi_admin straight through', async () => {
    useUserRole().initialize('ssi_admin', null)
    await router.push('/admin/structure')
    expect(router.currentRoute.value.fullPath).toBe('/admin/structure')
  })

  it('/methodology is covered by the same guard', async () => {
    useUserRole().initialize(null, 'teacher')
    await router.push('/methodology')
    expect(router.currentRoute.value.fullPath).toBe('/')
  })

  it('a non-admin route is never gated by this guard', async () => {
    await router.push('/schools1')
    expect(router.currentRoute.value.fullPath).toBe('/schools1')
  })
})
