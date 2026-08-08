/**
 * Regression tests for the class page's TEACHER MANAGEMENT affordance.
 *
 * Tom, on staging as a school leader on 2026-08-08, went looking for a way to
 * add a second teacher to a class, to move a teacher between classes, and to
 * put one teacher on several classes — and reported that none of it existed.
 * The add/remove half DID exist: it was the fourth card in the right-hand
 * rail, and at =<960px the grid collapses to one column and puts the whole
 * rail BELOW the student roster. A verb nobody can find is, to the person
 * looking for it, a verb that is not there.
 *
 * So the discoverability property is now an INVARIANT with a test, not a
 * layout accident: the Teachers card must precede the roster in document
 * order, on every viewport. jsdom has no layout engine, so DOM order is the
 * honest thing to assert — it is also exactly what determines reading order
 * once the grid has collapsed to a single column.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import ClassDetail from './ClassDetail.vue'
import AssignClassesModal from '@/components/schools/AssignClassesModal.vue'
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

function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/schools/classes', name: 'classes', component: { template: '<div/>' } },
      { path: '/schools/classes/:classId', name: 'class-detail', component: ClassDetail },
    ],
  })
  router.push('/schools/classes/c1')
  return router
}

async function mountAsLeader() {
  const router = makeRouter()
  await router.isReady()
  const wrapper = mount(ClassDetail, { global: { plugins: [router], stubs } })
  await flushPromises()
  return wrapper
}

describe('ClassDetail — the leader can find and use teacher management', () => {
  beforeEach(() => {
    isDemoMode.value = true
    const chain: any = {
      select: () => chain, eq: () => chain, in: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
    }
    setSchoolsClient({ from: () => chain } as any)

    useSchoolContext().currentUser.value = {
      user_id: 'admin-uid',
      learner_id: 'L-admin',
      display_name: 'Harbour Leader',
      educational_role: 'school_admin',
      platform_role: null,
      school_id: 'SCH1',
    }

    const { classes, teachersLoaded, teachersError } = useClassesData()
    classes.value = [
      {
        id: 'c1', class_name: 'Grade 6B', course_code: 'cym_for_eng', school_id: 'SCH1',
        teacher_user_id: 't1', student_join_code: 'AAA', current_seed: 10, last_lego_id: null,
        class_learner_id: null, is_active: true, student_count: 1, avg_seeds_completed: 10,
        avg_practice_minutes: 5, created_at: '2026-01-01',
        teachers: [{ user_id: 't1', is_lead: true }],
      } as any,
      {
        id: 'c2', class_name: 'Grade 7A', course_code: 'cym_for_eng', school_id: 'SCH1',
        teacher_user_id: null, student_join_code: 'BBB', current_seed: 20, last_lego_id: null,
        class_learner_id: null, is_active: true, student_count: 1, avg_seeds_completed: 20,
        avg_practice_minutes: 8, created_at: '2026-01-01',
        teachers: [],
      } as any,
    ]

    // classDetail is a COMPUTED over currentClass — drive the source, never
    // the derived value, or the assignment silently does nothing.
    teachersLoaded.value = true
    teachersError.value = null
    useStudentsData().students.value = []
  })

  // (a) — the capability existed all along; what was missing was being able to
  // see it. Position, not presence, is the thing under test.
  it('puts the Teachers card BEFORE the roster in document order', async () => {
    const wrapper = await mountAsLeader()

    const teachersCard = wrapper.find('[data-walk="class-teachers"]')
    const roster = wrapper.find('.roster')
    expect(teachersCard.exists()).toBe(true)
    expect(roster.exists()).toBe(true)

    // Node.compareDocumentPosition: DOCUMENT_POSITION_FOLLOWING (4) means the
    // roster comes AFTER the teachers card — i.e. a leader reads the teachers
    // first, which on a collapsed single-column phone layout is the whole point.
    const position = teachersCard.element.compareDocumentPosition(roster.element)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is not nested inside the rail, so collapsing the grid cannot bury it', async () => {
    const wrapper = await mountAsLeader()
    const teachersCard = wrapper.find('[data-walk="class-teachers"]')
    expect(teachersCard.element.closest('.rail')).toBeNull()
  })

  // Tom's language, not ours: "add a second teacher", never "co-teacher".
  it('offers "Add another teacher" to a school leader', async () => {
    const wrapper = await mountAsLeader()
    const addBtn = wrapper.find('[data-walk="class-teacher-add"]')
    expect(addBtn.exists()).toBe(true)
    expect(addBtn.text()).toBe('Add another teacher')
  })

  // (b) and (c) — reachable from the class page too, not only from Teachers.
  it('offers "Other classes" per teacher, opening the assign modal on them', async () => {
    const wrapper = await mountAsLeader()
    const verb = wrapper.find('[data-walk="class-teacher-other-classes"]')
    expect(verb.exists()).toBe(true)
    expect(verb.text()).toBe('Other classes')

    const modal = wrapper.findComponent(AssignClassesModal)
    expect(modal.props('isOpen')).toBe(false)

    await verb.trigger('click')
    await flushPromises()

    // Opened, and aimed at the teacher whose row was clicked — this is the
    // same modal the Teachers page uses, so ticking another class here is how
    // one teacher comes to belong to several, and unticking this one is a move.
    expect(modal.props('isOpen')).toBe(true)
    expect(modal.props('teacherName')).toBeTruthy()
  })

  it('spells out in plain English that a teacher can take several classes', async () => {
    const wrapper = await mountAsLeader()
    expect(wrapper.text()).toContain('a teacher can take')
    expect(wrapper.text()).toContain('as many classes as you like')
  })

  // The honesty property must survive the move: a failed read is never
  // allowed to read as an empty class. The state is set AFTER mount because
  // the mount itself runs a demo fetch that would overwrite it.
  it('never claims the class has no teachers when the read FAILED', async () => {
    const wrapper = await mountAsLeader()
    // Demo fetchClassDetail forces teachersLoaded=true, so the failed-read
    // state is applied AFTER the mount has settled, then rendered on nextTick.
    const { teachersLoaded, teachersError, currentClass } = useClassesData()
    currentClass.value = { ...(currentClass.value as any), teachers: [] } as any
    teachersLoaded.value = false
    teachersError.value = 'boom'
    await nextTick()

    expect(wrapper.text()).not.toContain('No teachers are linked to this class yet')
    expect(wrapper.text()).toContain("Couldn't load the teacher list")
  })

  it('says the class has no teachers only when the read came back clean and empty', async () => {
    // Emptiness set at SOURCE so the demo read genuinely observes it.
    const { classes } = useClassesData()
    classes.value[0] = { ...(classes.value[0] as any), teachers: [] } as any

    const wrapper = await mountAsLeader()

    expect(wrapper.text()).toContain('No teachers are linked to this class yet')
  })

  // A co-teacher teaches the class but does not recruit into it — founder
  // ruling, 2026-08-06. They must not be shown a verb the server would refuse.
  it('hides the management verbs from a plain co-teacher', async () => {
    useSchoolContext().currentUser.value = {
      user_id: 't2',
      learner_id: 'L-t2',
      display_name: 'Co Teacher',
      educational_role: 'teacher',
      platform_role: null,
      school_id: 'SCH1',
    }
    const { classes } = useClassesData()
    classes.value[0] = {
      ...(classes.value[0] as any),
      teachers: [{ user_id: 't1', is_lead: true }, { user_id: 't2', is_lead: false }],
    } as any

    const wrapper = await mountAsLeader()
    expect(wrapper.find('[data-walk="class-teacher-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-walk="class-teacher-other-classes"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('You teach this class alongside its lead teacher')
  })
})
