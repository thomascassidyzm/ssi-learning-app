/**
 * Regression test: ClassDetail.vue must re-fetch when Vue Router reuses the
 * SAME component instance across two `class-detail` routes that only differ
 * by the class id param (e.g. an admin paging between classes in a school) —
 * onMounted does not fire again on a param-only navigation, so without a
 * watcher on the id the previous class's data stays on screen.
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

// ClassDetail pulls in a handful of shared/BeltDot-style presentational
// components — stub them so the mount only exercises the fetch/routing logic.
const stubs = {
  BeltDot: true,
  BeltStrip: true,
  Bench: true,
  HealthDot: true,
  InviteLinkField: true,
  JourneyBar: true,
}

describe('ClassDetail — refetch on route param change', () => {
  beforeEach(() => {
    isDemoMode.value = true
    // Composables call getSchoolsClient() eagerly. fetchClassDetail/fetchClasses
    // are demo-gated and never issue a real query, but getClassReport (the
    // benchmark fetch) is not — give it a chainable that resolves to nothing
    // rather than let it throw noisily.
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
    }
    setSchoolsClient({ from: () => chain } as any)

    useSchoolContext().currentUser.value = {
      user_id: 'admin-uid',
      learner_id: 'L-admin',
      display_name: 'Admin',
      educational_role: 'school_admin',
      platform_role: null,
      school_id: 'SCH1',
    }

    const { classes } = useClassesData()
    classes.value = [
      {
        id: 'c1', class_name: 'Class One', course_code: 'cym_for_eng', school_id: 'SCH1',
        teacher_user_id: 't1', student_join_code: 'AAA', current_seed: 10, last_lego_id: null,
        class_learner_id: null,
        is_active: true, student_count: 1, avg_seeds_completed: 10, avg_practice_minutes: 5,
        created_at: '2026-01-01',
      },
      {
        id: 'c2', class_name: 'Class Two', course_code: 'cym_for_eng', school_id: 'SCH1',
        teacher_user_id: 't1', student_join_code: 'BBB', current_seed: 20, last_lego_id: null,
        class_learner_id: null,
        is_active: true, student_count: 1, avg_seeds_completed: 20, avg_practice_minutes: 8,
        created_at: '2026-01-01',
      },
    ]

    const { students } = useStudentsData()
    students.value = [
      {
        user_id: 's1-uid', learner_id: 'L-s1', display_name: 'Student One', class_id: 'c1',
        class_name: 'Class One', course_code: 'cym_for_eng', seeds_completed: 10,
        legos_mastered: 5, total_practice_minutes: 30, last_active_at: null, joined_class_at: '2026-01-02',
      },
      {
        user_id: 's2-uid', learner_id: 'L-s2', display_name: 'Student Two', class_id: 'c2',
        class_name: 'Class Two', course_code: 'cym_for_eng', seeds_completed: 20,
        legos_mastered: 8, total_practice_minutes: 60, last_active_at: null, joined_class_at: '2026-01-02',
      },
    ]
  })

  it('shows the new class after a param-only navigation to another class-detail route', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/schools/classes', name: 'classes', component: { template: '<div/>' } },
        { path: '/schools/classes/:classId', name: 'class-detail', component: ClassDetail },
      ],
    })

    router.push('/schools/classes/c1')
    await router.isReady()

    const wrapper = mount(ClassDetail, { global: { plugins: [router], stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('Class One')
    expect(wrapper.text()).toContain('Student One')

    // Param-only navigation — Vue Router reuses this same component instance
    // (no unmount/remount), which is exactly the scenario onMounted misses.
    await router.push('/schools/classes/c2')
    await flushPromises()

    expect(wrapper.text()).toContain('Class Two')
    expect(wrapper.text()).toContain('Student Two')
    expect(wrapper.text()).not.toContain('Class One')
  })
})
