/**
 * ClassDetail — the class tools page's Play as class under View As (job #683).
 * Tom, 2026-09-14 16:17Z: the button "should be prominent next to the class,
 * not invisible". Present and enabled for a signed-in leader; present and
 * disabled under View As. Red on the 2026-07-16 gate, green after.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ClassDetail from './ClassDetail.vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useStudentsData } from '@/composables/schools/useStudentsData'
import { isDemoMode } from '@/composables/demo/demoMode'

const stubs = { BeltDot: true, BeltStrip: true, Bench: true, InviteLinkField: true, JourneyBar: true }

async function mountAsLeader(isAdminView: boolean) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/schools/classes', name: 'classes', component: { template: '<div/>' } },
      { path: '/schools/classes/:classId', name: 'class-detail', component: ClassDetail },
    ],
  })
  router.push('/schools/classes/c1')
  await router.isReady()
  const wrapper = mount(ClassDetail, { global: { plugins: [router], stubs, provide: { isAdminView } } })
  await flushPromises()
  return wrapper
}

describe('ClassDetail — Play as class is shown, and only disabled under View As', () => {
  beforeEach(() => {
    isDemoMode.value = true
    const chain: any = { select: () => chain, eq: () => chain, in: () => chain, single: () => Promise.resolve({ data: null, error: null }) }
    setSchoolsClient({ from: () => chain } as any)
    useSchoolContext().currentUser.value = { user_id: 'admin-uid', learner_id: 'L-admin', display_name: 'Harbour Leader', educational_role: 'school_admin', platform_role: null, school_id: 'SCH1' }
    const { classes, teachersLoaded, teachersError } = useClassesData()
    classes.value = [{
      id: 'c1', class_name: 'Grade 6B', course_code: 'cym_for_eng', school_id: 'SCH1',
      teacher_user_id: 't1', student_join_code: 'AAA', current_seed: 10, last_lego_id: null,
      class_learner_id: null, is_active: true, student_count: 1, avg_seeds_completed: 10,
      avg_practice_minutes: 5, created_at: '2026-01-01', teachers: [{ user_id: 't1', is_lead: true }],
    } as any]
    teachersLoaded.value = true
    teachersError.value = null
    useStudentsData().students.value = []
  })

  it('a signed-in leader sees a live Play as class button', async () => {
    const w = await mountAsLeader(false)
    const btn = w.find('[data-walk="class-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('under View As it is present, disabled, and says why', async () => {
    const w = await mountAsLeader(true)
    const btn = w.find('[data-walk="class-play"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('Read only while you are viewing as someone else')
  })
})
