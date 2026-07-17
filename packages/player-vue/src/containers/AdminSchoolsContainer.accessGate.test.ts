import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'
import AdminSchoolsContainer from './AdminSchoolsContainer.vue'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

// Trinity audit finding #1 (docs/trinity/admin.md): /admin/schools/:id
// renders OUTSIDE AdminContainer with NO admin-role check of its own — it
// relied entirely on the deferring global router guard. A cold-cache
// non-admin deep-linking here fired the school-scoped query and could see
// another school's live data render before any correction landed (the org
// tables — schools/classes/groups/etc — are RLS-off by design; the UI gate
// IS the enforcement). This proves the leak against real component code,
// then proves the fix closes it.

const loadFromSchoolId = vi.fn().mockResolvedValue(undefined)
const clearCtx = vi.fn()
vi.mock('@/composables/schools/useSchoolContext', () => ({
  useSchoolContext: () => ({ loadFromSchoolId, clear: clearCtx }),
}))
vi.mock('@/composables/schools/client', () => ({ setSchoolsClient: vi.fn() }))

const stubs = { AdminTopBar: true }

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/admin/schools/:id',
        component: AdminSchoolsContainer,
        children: [
          { path: '', component: { template: '<div class="dash">dashboard</div>' } },
        ],
      },
      { path: '/', component: { template: '<div class="home">home</div>' } },
    ],
  })
}

const mockSupabase = ref({})

describe('AdminSchoolsContainer — access gate', () => {
  beforeEach(() => {
    loadFromSchoolId.mockClear()
    clearCtx.mockClear()
    localStorage.clear()
    sessionStorage.clear()
    useUserRole().clear()
    useResolvedSession().reset()
  })

  it('a cold-cache non-admin deep link never fetches the target school — denied before any data render', async () => {
    const router = buildRouter()
    router.push('/admin/schools/SCH-OTHER')
    await router.isReady()

    const nonAdminLearner = ref({ id: 'l1', user_id: 'teacher-uid', display_name: 'Teacher', platform_role: null })
    const wrapper = mount(AdminSchoolsContainer, {
      global: {
        plugins: [router],
        stubs,
        provide: { supabase: mockSupabase, auth: { learner: nonAdminLearner, refreshRole: vi.fn() } },
      },
    })
    await flushPromises()

    // The role resolves LATER, to non-admin — the exact cold-cache race.
    useResolvedSession().resolve(true)
    useUserRole().initialize(null, 'teacher')
    await flushPromises()

    expect(loadFromSchoolId).not.toHaveBeenCalled()
    expect(wrapper.find('.dash').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/')
  })

  it('a genuine admin loads the target school cleanly — no false lockout', async () => {
    const router = buildRouter()
    router.push('/admin/schools/SCH-1')
    await router.isReady()
    useUserRole().initialize('ssi_admin', null)

    const adminLearner = ref({ id: 'l-admin', user_id: 'admin-uid', display_name: 'Admin', platform_role: 'ssi_admin' })
    const wrapper = mount(AdminSchoolsContainer, {
      global: {
        plugins: [router],
        stubs,
        provide: { supabase: mockSupabase, auth: { learner: adminLearner, refreshRole: vi.fn() } },
      },
    })
    await flushPromises()

    expect(loadFromSchoolId).toHaveBeenCalledWith('SCH-1', expect.anything(), expect.anything())
    expect(router.currentRoute.value.path).toBe('/admin/schools/SCH-1')
  })
})
