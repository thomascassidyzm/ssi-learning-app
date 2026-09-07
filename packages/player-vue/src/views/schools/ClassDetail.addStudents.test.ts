/**
 * The class page's ADD-STUDENTS affordance.
 *
 * Owner observation, verbatim: "Adding students to a class is not obvious — no
 * clear flow for it on the class page." The class page HAD a door — the join
 * link — but it is addressed to the pupil, sits last in the right-hand rail,
 * and cannot help with the pupil who is already in the school and in the wrong
 * set. A teacher standing on the roster had nothing to press.
 *
 * Two properties, both of which fail on the pre-fix component:
 *   1. the roster itself carries a visible "Add students" control that opens a
 *      searchable list of the school's pupils, and tapping one puts them in;
 *   2. an empty class is DRAWN empty — the empty places, not a table of column
 *      headings with a sentence underneath.
 *
 * And the honesty property this codebase keeps everywhere else: a lookup that
 * FAILED must never render as "nobody left to add".
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ClassDetail from './ClassDetail.vue'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useStudentsData } from '@/composables/schools/useStudentsData'
import { isDemoMode } from '@/composables/demo/demoMode'

const stubs = {
  BeltDot: true,
  BeltStrip: true,
  Bench: true,
  HealthDot: true,
  InviteLinkField: true,
  JourneyBar: true,
}

const CANDIDATES = [
  { user_id: 'u-ana', learner_id: 'L-ana', display_name: 'Ana Lewis', current_classes: [{ id: 'c2', name: 'Grade 7A' }] },
  { user_id: 'u-bo', learner_id: 'L-bo', display_name: 'Bo Rhys', current_classes: [] },
]

let fetchMock: ReturnType<typeof vi.fn>

function makeStudent(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'u-sam', learner_id: 'L-sam', display_name: 'Sam Pugh',
    class_id: 'c1', class_name: 'Grade 6B', course_code: 'cym_for_eng',
    seeds_completed: 4, legos_mastered: 3, total_practice_minutes: 20,
    last_active_at: '2026-09-01T10:00:00Z', joined_class_at: '2026-08-01T10:00:00Z',
    ...overrides,
  }
}

async function mountAsTeacher() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/schools/classes', name: 'classes', component: { template: '<div/>' } },
      { path: '/schools/classes/:id', name: 'class-detail', component: ClassDetail },
    ],
  })
  router.push('/schools/classes/c1')
  await router.isReady()
  const wrapper = mount(ClassDetail, { global: { plugins: [router], stubs } })
  await flushPromises()
  return wrapper
}

describe('ClassDetail — putting students into the class', () => {
  beforeEach(() => {
    isDemoMode.value = true
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain, is: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
    }
    setSchoolsClient({
      from: () => chain,
      auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
    } as any)

    useSchoolContext().currentUser.value = {
      user_id: 't1',
      learner_id: 'L-t1',
      display_name: 'Class Teacher',
      educational_role: 'teacher',
      platform_role: null,
      school_id: 'SCH1',
    } as any

    const { classes, teachersLoaded, teachersError } = useClassesData()
    classes.value = [{
      id: 'c1', class_name: 'Grade 6B', course_code: 'cym_for_eng', school_id: 'SCH1',
      teacher_user_id: 't1', student_join_code: 'AAA', current_seed: 10, last_lego_id: null,
      class_learner_id: null, is_active: true, student_count: 1, avg_seeds_completed: 10,
      avg_practice_minutes: 5, created_at: '2026-01-01',
      teachers: [{ user_id: 't1', is_lead: true }],
    } as any]
    teachersLoaded.value = true
    teachersError.value = null
    useStudentsData().students.value = [makeStudent()] as any

    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('/api/teacher/class-students') && (!init || init.method !== 'POST')) {
        return { ok: true, json: async () => ({ candidates: CANDIDATES }) } as any
      }
      if (String(url) === '/api/teacher/class-students') {
        return { ok: true, json: async () => ({ ok: true, still_in: [{ id: 'c2', name: 'Grade 7A' }] }) } as any
      }
      return { ok: true, json: async () => ({}) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('offers "Add students" on the roster itself', async () => {
    const wrapper = await mountAsTeacher()
    const btn = wrapper.find('[data-walk="class-student-add"]')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('Add students')
    // On the roster, not buried in the rail — the rail is below the table on a
    // phone, which is how the co-teacher panel came to be invisible.
    expect(btn.element.closest('.rail')).toBeNull()
    expect(btn.element.closest('.roster')).not.toBeNull()
  })

  it('opens a searchable list of the school\'s students and adds the one you tap', async () => {
    const wrapper = await mountAsTeacher()
    await wrapper.find('[data-walk="class-student-add"]').trigger('click')
    await flushPromises()

    const picker = wrapper.find('[data-walk="class-student-picker"]')
    expect(picker.exists()).toBe(true)
    // The dropdown ruling: whatever you open carries a search box.
    expect(picker.find('input[type="search"]').exists()).toBe(true)
    expect(picker.text()).toContain('Ana Lewis')
    // The classes they are in NOW, so the teacher can see what the tap leaves.
    expect(picker.text()).toContain('Grade 7A')
    // And a pupil in no class at all says so, rather than showing a blank.
    expect(picker.text()).toContain('In no class')

    await picker.find('input[type="search"]').setValue('bo')
    expect(wrapper.find('[data-walk="class-student-picker"]').text()).not.toContain('Ana Lewis')
    await picker.find('input[type="search"]').setValue('')

    await wrapper.findAll('.add-student-row')[0].trigger('click')
    await flushPromises()

    const posted = fetchMock.mock.calls.find(([, init]: any[]) => init?.method === 'POST')
    expect(posted).toBeTruthy()
    expect(JSON.parse((posted as any)[1].body)).toEqual({ class_id: 'c1', target_user_id: 'u-ana' })
    expect(wrapper.text()).toContain('Ana Lewis is in this class now')
    // An add is an ADD. The page says the old membership is still standing and
    // links to the class whose roster carries the Remove button.
    expect(wrapper.text()).toContain('Still in')
    const stillIn = wrapper.find('.add-student-link')
    expect(stillIn.text()).toBe('Grade 7A')
    expect(stillIn.attributes('href')).toContain('c2')
    // The filter that found them is spent — left standing it reads as
    // "nobody matches ana" directly under "Ana Lewis is in this class now".
    expect(wrapper.text()).not.toContain('Nobody in your school matches')
    // And one search box at a time: while the picker is open, its box is the
    // one the teacher means.
    expect(wrapper.findAll('.roster input[type="search"]').length).toBe(1)
  })

  it('never says the school is exhausted when the lookup FAILED', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({ error: 'boom' }) }) as any)
    const wrapper = await mountAsTeacher()
    await wrapper.find('[data-walk="class-student-add"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('Everyone in your school is already in this class')
    expect(wrapper.text()).toContain("Couldn't load the school's students")
  })

  // Walked on a real class page, 2026-09-07: on a COLD load the class id lands
  // after the first paint, and a picker opened in that window sat on "Looking
  // up your school's students…" for ever. It now asks the moment the class
  // arrives — the same late-arrival trap the co-teacher-link button already had.
  it('asks for the candidates once a late-arriving class id lands', async () => {
    const { classes, currentClass } = useClassesData()
    const cls = classes.value[0]
    classes.value = []
    currentClass.value = null as any

    const wrapper = await mountAsTeacher()
    await wrapper.find('[data-walk="class-student-add"]').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.some(([u]: any[]) => String(u).startsWith('/api/teacher/class-students'))).toBe(false)

    currentClass.value = cls as any
    await flushPromises()

    expect(fetchMock.mock.calls.some(([u]: any[]) => String(u).startsWith('/api/teacher/class-students'))).toBe(true)
    expect(wrapper.find('[data-walk="class-student-picker"]').text()).toContain('Ana Lewis')
  })

  it('draws an empty class as empty, with the way in inside it', async () => {
    useStudentsData().students.value = [] as any
    const wrapper = await mountAsTeacher()

    const empty = wrapper.find('[data-walk="class-roster-empty"]')
    expect(empty.exists()).toBe(true)
    // Drawn, not annotated: the places themselves, and no table of headings.
    expect(empty.findAll('.empty-seat').length).toBe(6)
    expect(wrapper.find('.roster .ssi-table').exists()).toBe(false)
    expect(empty.text()).toContain('Nobody is in this class yet')
    // Both doors, in the empty class itself.
    expect(empty.text()).toContain('Add students')
    expect(empty.text()).toContain('Invite students')
  })

  // The roster now carries the doing, so it must not be pushed below the rail
  // on an empty class the way it used to be — on a phone the grid collapses to
  // one column and document order IS reading order.
  it('keeps the roster ABOVE the rail on an empty class', async () => {
    useStudentsData().students.value = [] as any
    const wrapper = await mountAsTeacher()

    const roster = wrapper.find('.roster')
    const rail = wrapper.find('.rail')
    expect(roster.exists()).toBe(true)
    expect(rail.exists()).toBe(true)
    expect(rail.classes()).not.toContain('rail-first')
    expect(roster.element.compareDocumentPosition(rail.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never claims a transfer that did not happen when the pupil is in no other class', async () => {
    const wrapper = await mountAsTeacher()
    await wrapper.find('[data-walk="class-student-add"]').trigger('click')
    await flushPromises()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url) === '/api/teacher/class-students' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, still_in: [] }) } as any
      }
      return { ok: true, json: async () => ({ candidates: CANDIDATES }) } as any
    })
    await wrapper.findAll('.add-student-row')[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Bo Rhys is in this class now')
    expect(wrapper.text()).not.toContain('Still in')
  })

  it('keeps the roster table when the class HAS students', async () => {
    const wrapper = await mountAsTeacher()
    expect(wrapper.find('[data-walk="class-roster-empty"]').exists()).toBe(false)
    expect(wrapper.find('.roster .ssi-table').exists()).toBe(true)
  })
})
