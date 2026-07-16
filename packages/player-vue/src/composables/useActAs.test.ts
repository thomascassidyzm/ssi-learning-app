import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { setSchoolsClient } from '@/composables/schools/client'
import { useActAs } from './useActAs'

// The real act-as mechanism every restored "View as" entry point (admin
// Users rows/detail, /admin/setup school + group rows) drives — real
// entities only, no fake personas. Exercised against the real useUserRole +
// useSchoolContext singletons and the real router, the same style as
// router/schoolsGuard.test.ts. useActAs() injects 'supabase' the way every
// real caller does, so it's mounted inside a tiny harness component rather
// than called bare.

function mockClient() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
    })),
  } as any
}

const Harness = defineComponent({
  setup(_props, { expose }) {
    expose(useActAs())
    return () => h('div')
  },
})

function mountHarness() {
  return mount(Harness, {
    global: { plugins: [router], provide: { supabase: ref(mockClient()) } },
  })
}

describe('useActAs', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    setSchoolsClient(mockClient())
    await router.push('/admin/access')
  })

  it('canActAs gates the whole feature to ssi_admin', () => {
    role.initialize(null, 'teacher')
    expect(role.canActAs.value).toBe(false)
    role.initialize('ssi_admin', null)
    expect(role.canActAs.value).toBe(true)
  })

  it('actAs() steps into a real persona, sets the role overlay, and opens the live schools app', async () => {
    role.initialize('ssi_admin', null)
    const wrapper = mountHarness()

    await (wrapper.vm as any).actAs({ key: 'teacher:u-teacher-1', userId: 'u-teacher-1', role: 'teacher', name: 'Rhian Griffiths' })

    expect(role.isActingAs.value).toBe(true)
    expect(role.actingAs.value?.userId).toBe('u-teacher-1')
    expect(role.actingAs.value?.role).toBe('teacher')
    // The real platform role is untouched — only the effective school role changes.
    expect(role.isSsiAdmin.value).toBe(true)
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('exitActAs() clears the overlay and returns to /admin/access', async () => {
    role.initialize('ssi_admin', null)
    const wrapper = mountHarness()
    await (wrapper.vm as any).actAs({ key: 'school_admin:u-admin-1', userId: 'u-admin-1', role: 'school_admin', name: 'A School' })
    expect(role.isActingAs.value).toBe(true)

    await (wrapper.vm as any).exitActAs()

    expect(role.isActingAs.value).toBe(false)
    expect(role.actingAs.value).toBe(null)
    expect(router.currentRoute.value.fullPath).toBe('/admin/access')
  })

  it('a persisted act-as overlay survives restoreActAs() (reload-safe)', async () => {
    role.initialize('ssi_admin', null)
    role.startActingAs({ key: 'govt_admin:u-gov-1', userId: 'u-gov-1', role: 'govt_admin', name: 'A Leader' })
    // Simulate a fresh module load losing in-memory state but keeping sessionStorage.
    role.actingAs.value = null

    const wrapper = mountHarness()
    await (wrapper.vm as any).restoreActAs()

    expect(role.actingAs.value?.userId).toBe('u-gov-1')
  })
})
