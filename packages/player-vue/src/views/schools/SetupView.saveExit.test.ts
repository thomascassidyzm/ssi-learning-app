/**
 * "Save & exit puts you back on your dashboard with everything you have
 * entered kept" — the label's promise, over code that called persistClasses(),
 * threw the answer away and navigated regardless. A class that failed to save
 * left the head on a dashboard without it, told nothing.
 *
 * Both properties fail on the pre-fix component:
 *   1. a failed class save keeps her on the wizard, with the reason on screen
 *      and what she typed still in the boxes;
 *   2. a class named but not given a course is refused out loud rather than
 *      silently skipped — that row was being dropped on the floor.
 * And the third holds either way: when the save works, it exits.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

const createClass = vi.fn()
const classesError = ref<string | null>(null)

vi.mock('@/composables/schools/useSchoolContext', () => ({
  useSchoolContext: () => ({
    currentUser: ref({ user_id: 'u1', display_name: 'Head', educational_role: 'school_admin', school_id: 'SCH1' }),
  }),
}))
vi.mock('@/composables/schools/useSchoolData', () => ({
  useSchoolData: () => ({
    activeSchool: ref({ id: 'SCH1', school_name: 'Ysgol Bryn', teacher_join_code: 'TJC', admin_join_code: 'AJC' }),
    currentSchool: ref({ id: 'SCH1', school_name: 'Ysgol Bryn' }),
    fetchSchools: vi.fn(async () => {}),
  }),
}))
vi.mock('@/composables/schools/useClassesData', () => ({
  useClassesData: () => ({
    classes: ref([]),
    fetchClasses: vi.fn(async () => {}),
    createClass,
    error: classesError,
  }),
}))
vi.mock('@/composables/schools/useSchoolCourseCatalogue', () => ({
  useSchoolCourseCatalogue: () => ({
    availableCourses: ref([{ course_code: 'cym_for_eng', display_name: 'Welsh for English speakers' }]),
    schoolTrialCourse: ref('cym_for_eng'),
    fetchCatalogue: vi.fn(async () => {}),
    loadSchoolPlatformState: vi.fn(async () => {}),
  }),
}))
vi.mock('@/composables/schools/useTeachersData', () => ({
  useTeachersData: () => ({ teachers: ref([]), fetchTeachers: vi.fn(async () => {}) }),
}))

import SetupView from './SetupView.vue'

async function mountWizardOnStep4() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/schools', name: 'dash', component: { template: '<div>dash</div>' } },
      { path: '/schools/setup', name: 'setup', component: SetupView },
      { path: '/schools/settings', name: 'settings', component: { template: '<div/>' } },
    ],
  })
  router.push('/schools/setup')
  await router.isReady()

  const wrapper = mount(SetupView, {
    global: {
      plugins: [router],
      provide: {
        supabase: ref({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }),
      },
      stubs: { FrostSelect: true, InviteLinkField: true },
    },
  })
  await flushPromises()

  // Step 1 saves the school on the way past; the wizard's own step rail.
  const rail = wrapper.findAll('.step-rail-item')
  await rail[3].trigger('click')
  await flushPromises()
  return { wrapper, router }
}

describe('SetupView — Save & exit keeps what it says it keeps', () => {
  beforeEach(() => {
    createClass.mockReset()
    classesError.value = null
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('stays put and says why when the class could not be saved', async () => {
    createClass.mockResolvedValue(null)
    classesError.value = 'Could not reach the server'

    const { wrapper, router } = await mountWizardOnStep4()
    const name = wrapper.find('input[placeholder="Class name"]')
    await name.setValue('Blwyddyn 7')

    await wrapper.find('[data-walk="setup-save-exit"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/schools/setup')
    expect(wrapper.text()).toContain('Could not reach the server')
    // What she typed is still in front of her.
    expect((name.element as HTMLInputElement).value).toBe('Blwyddyn 7')
  })

  it('refuses to drop a class that has a name but no course', async () => {
    createClass.mockResolvedValue({ id: 'c1', student_join_code: 'ABC' })

    const { wrapper, router } = await mountWizardOnStep4()
    const rows = wrapper.findAll('.class-draft-row')
    await rows[0].find('input[placeholder="Class name"]').setValue('Blwyddyn 8')
    // Clear the preselected course, the way untick-and-forget leaves it.
    await rows[0].findComponent({ name: 'FrostSelect' }).vm.$emit('update:modelValue', '')
    await flushPromises()

    await wrapper.find('[data-walk="setup-save-exit"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/schools/setup')
    expect(wrapper.text()).toContain('Blwyddyn 8')
    expect(createClass).not.toHaveBeenCalled()
  })

  it('exits to the dashboard when the save works', async () => {
    createClass.mockResolvedValue({ id: 'c1', student_join_code: 'ABC' })

    const { wrapper, router } = await mountWizardOnStep4()
    await wrapper.find('input[placeholder="Class name"]').setValue('Blwyddyn 9')

    await wrapper.find('[data-walk="setup-save-exit"]').trigger('click')
    await flushPromises()

    expect(createClass).toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe('/schools')
  })
})
