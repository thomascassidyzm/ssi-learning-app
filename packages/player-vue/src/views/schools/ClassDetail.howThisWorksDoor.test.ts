/**
 * The /schools class page opens the explainer, not the prose Handbook.
 *
 * Tom, on staging as a school leader on a class page, 2026-09-11: "The
 * handbook page seems to still be the prose rather than the explainer 'how
 * this works' clips." The page carried a teacher-only "Show me" row and a
 * question mark into the prose map; nothing on it opened the persona×place
 * explanation the compiled pack already held for a school leader at a class.
 *
 * Fails on the pre-fix page (no How this works door at all) and passes once
 * HowThisWorks is mounted with the viewer's own persona. jsdom only; the
 * persona comes from the same resolver the Handbook page uses.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ClassDetail from './ClassDetail.vue'
import pack from '@/explainer/pack.json'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useStudentsData } from '@/composables/schools/useStudentsData'
import { isDemoMode } from '@/composables/demo/demoMode'

const opening = (ruling: string): string => ruling.replace(/\*\*/g, '').split(/\s+/).slice(0, 8).join(' ')

const stubs = { BeltDot: true, BeltStrip: true, Bench: true, HealthDot: true, InviteLinkField: true, JourneyBar: true }

async function mountAs(educationalRole: 'school_admin' | 'teacher') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/schools/classes', name: 'classes', component: { template: '<div/>' } },
      { path: '/schools/classes/:classId', name: 'class-detail', component: ClassDetail },
      { path: '/schools/handbook', name: 'schools-handbook', component: { template: '<div/>' } },
    ],
  })
  router.push('/schools/classes/c1')
  await router.isReady()
  useSchoolContext().currentUser.value = {
    user_id: 'u1', learner_id: 'L1', display_name: 'Angharad', educational_role: educationalRole,
    platform_role: null, school_id: 'SCH1',
  } as any
  const wrapper = mount(ClassDetail, { global: { plugins: [router], stubs } })
  await flushPromises()
  return wrapper
}

describe('ClassDetail — the How this works door opens the explainer', () => {
  beforeEach(() => {
    isDemoMode.value = true
    localStorage.clear()
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
    }
    setSchoolsClient({ from: () => chain } as any)
    const { classes, teachersLoaded, teachersError } = useClassesData()
    classes.value = [{
      id: 'c1', class_name: '8H', course_code: 'cym_for_eng', school_id: 'SCH1',
      teacher_user_id: 't1', student_join_code: 'AAA', current_seed: 3, last_lego_id: null,
      class_learner_id: null, is_active: true, student_count: 0, avg_seeds_completed: 0,
      avg_practice_minutes: 0, created_at: '2026-01-01', teachers: [{ user_id: 't1', is_lead: true }],
    } as any]
    teachersLoaded.value = true
    teachersError.value = null
    useStudentsData().students.value = []
  })

  it('a school leader taps How this works and reads the pack explanation for school_admin at a class', async () => {
    const w = await mountAs('school_admin')
    const door = w.find('.htw-toggle')
    expect(door.exists()).toBe(true)
    expect(door.text()).toContain('How this works')
    await door.trigger('click')
    const body = w.find('.htw-body')
    expect(body.exists()).toBe(true)
    // The panel folds line breaks to spaces and turns the bold markers into
    // <strong>, so compare on the ruling's opening words.
    expect(body.text()).toContain(opening(pack.explanations.school_admin.class))
  })

  it('lists the class-detail clips for a school leader and keeps the Handbook as the second door', async () => {
    const w = await mountAs('school_admin')
    await w.find('.htw-toggle').trigger('click')
    const offers = w.findAll('[data-walk-offer]').map((b) => b.attributes('data-walk-offer'))
    expect(offers).toContain('run-class-session')
    expect(w.find('.htw-handbook').attributes('href')).toBe('/schools/handbook')
  })

  it('a teacher reads the teacher explanation, not the leader one', async () => {
    const w = await mountAs('teacher')
    await w.find('.htw-toggle').trigger('click')
    expect(w.find('.htw-body').text()).toContain(opening(pack.explanations.teacher.class))
  })
})
