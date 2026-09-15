/**
 * usePlayAsClass — course-switch + permission gating for every Play-as-class
 * entry point (ClassDetail, DashboardView, TeacherDashboard, TeachDashboard).
 *
 * Regression coverage for two 2026-07-16 findings:
 *  1. A localStorage-only course write races App.vue's async course-catalogue
 *     fetch — switchActiveCourseTo must force the switch via handleCourseSelect
 *     directly (with a Supabase fallback fetch), same shape as RedeemCode's
 *     2026-07-15 student class-landing fix.
 *  2. Play-as-class is a school-STAFF capability (teacher + school_admin),
 *     not teacher-only, but group leaders (govt_admin) are excluded by
 *     default — canPlayAsClass must reflect exactly that matrix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { routerKey } from 'vue-router'
// The entitlement snapshot the player gates on. launchClassSession must ask
// for a fresh one before the player mounts (job #734), so the fetch is a spy.
const refreshEntitlements = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../useUserEntitlements', () => ({
  useSharedUserEntitlements: () => ({ refresh: refreshEntitlements }),
}))
import { usePlayAsClass } from './usePlayAsClass'
import { useSchoolContext } from './useSchoolContext'

function mountHarness(provide: Record<string, unknown>) {
  let exposed: ReturnType<typeof usePlayAsClass>
  const Harness = defineComponent({
    setup() {
      exposed = usePlayAsClass()
      return () => h('div')
    },
  })
  mount(Harness, { global: { provide } })
  return exposed!
}

function setRole(role: string | null) {
  const ctx = useSchoolContext()
  ;(ctx.currentUser as any).value = role
    ? { user_id: 'u1', learner_id: 'l1', display_name: 'Test', educational_role: role, platform_role: null }
    : null
}

describe('usePlayAsClass — canPlayAsClass permission matrix', () => {
  it('teacher: allowed', () => {
    setRole('teacher')
    const { canPlayAsClass } = mountHarness({ isAdminView: false })
    expect(canPlayAsClass.value).toBe(true)
  })

  it('school_admin: allowed', () => {
    setRole('school_admin')
    const { canPlayAsClass } = mountHarness({ isAdminView: false })
    expect(canPlayAsClass.value).toBe(true)
  })

  it('govt_admin (group leader): excluded by default', () => {
    setRole('govt_admin')
    const { canPlayAsClass } = mountHarness({ isAdminView: false })
    expect(canPlayAsClass.value).toBe(false)
  })

  it('unaffiliated (no role): excluded', () => {
    setRole(null)
    const { canPlayAsClass } = mountHarness({ isAdminView: false })
    expect(canPlayAsClass.value).toBe(false)
  })

  it('student: excluded', () => {
    setRole('student')
    const { canPlayAsClass } = mountHarness({ isAdminView: false })
    expect(canPlayAsClass.value).toBe(false)
  })

  // Tom, 2026-09-14 16:17Z (job #683): "every single Play as Class button
  // has GONE!!!! That should be prominent next to the class, not invisible".
  // Under View As the button is SHOWN DISABLED, never hidden: canPlayAsClass
  // stays true for a teacher-shaped context, playAsClassReadOnly says why it
  // is inert, and the launch still refuses (the #681 write ban). Red on the
  // 2026-07-16 gate, which hid it; green after.
  it('ssi_admin read-only view: a teacher-shaped context still SEES the button, read-only, and the launch refuses', async () => {
    setRole('teacher')
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const { canPlayAsClass, playAsClassReadOnly, launchClassSession } = mountHarness({ isAdminView: true, handleCourseSelect, enrolledCourses: ref([{ course_code: 'cym_for_eng' }]), supabase: ref(null) })
    expect(canPlayAsClass.value).toBe(true)
    expect(playAsClassReadOnly.value).toBe(true)
    expect(await launchClassSession({ id: 'c1', class_name: '7H', course_code: 'cym_for_eng', class_learner_id: null })).toBe(false)
    expect(handleCourseSelect).not.toHaveBeenCalled()
  })

  it('a live teacher account is not read-only', () => {
    setRole('teacher')
    const { playAsClassReadOnly } = mountHarness({ isAdminView: false })
    expect(playAsClassReadOnly.value).toBe(false)
  })
})

describe('usePlayAsClass — switchActiveCourseTo', () => {
  beforeEach(() => {
    setRole('teacher')
  })

  it('switches using the already-loaded course catalogue', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const enrolledCourses = ref([
      { course_code: 'zho_for_eng', display_name: 'Chinese' },
      { course_code: 'cym_for_eng', display_name: 'Welsh' },
    ])
    const { switchActiveCourseTo } = mountHarness({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses,
      supabase: ref(null),
    })

    await switchActiveCourseTo('cym_for_eng')

    expect(handleCourseSelect).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'cym_for_eng', display_name: 'Welsh' })
    )
  })

  it('falls back to fetching the course row from Supabase when the catalogue has not loaded yet', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const enrolledCourses = ref([]) // catalogue not loaded yet
    const maybeSingle = vi.fn().mockResolvedValue({ data: { course_code: 'cym_for_eng', display_name: 'Welsh' }, error: null })
    const supabase = ref({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle,
      })),
    })
    const { switchActiveCourseTo } = mountHarness({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses,
      supabase,
    })

    await switchActiveCourseTo('cym_for_eng')

    expect(maybeSingle).toHaveBeenCalled()
    expect(handleCourseSelect).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'cym_for_eng' })
    )
  })

  it('no-ops (returns false) when handleCourseSelect is unavailable (never provided)', async () => {
    const { switchActiveCourseTo } = mountHarness({ isAdminView: false })
    await expect(switchActiveCourseTo('cym_for_eng')).resolves.toBe(false)
  })

  it('no-ops for a falsy course code', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const { switchActiveCourseTo } = mountHarness({ isAdminView: false, handleCourseSelect, enrolledCourses: ref([]) })
    await switchActiveCourseTo(undefined)
    expect(handleCourseSelect).not.toHaveBeenCalled()
  })
})

describe('usePlayAsClass — launchClassSession (the ONE schools launch path)', () => {
  // Provide a fake router through vue-router's own injection key so
  // useRouter() inside the composable resolves without a full router setup.
  function mountWithRouter(provide: Record<string, unknown>) {
    const push = vi.fn().mockResolvedValue(undefined)
    const exposed = mountHarness({ ...provide, [routerKey as symbol]: { push } })
    return { exposed, push }
  }

  beforeEach(() => {
    localStorage.clear()
    setRole('school_admin')
  })

  it('refuses a half-loaded class (empty id/course_code) — no storage write, no navigation', async () => {
    // ClassDetail's Play was clickable while its fetch was in flight,
    // navigating to /schools/play?class= (empty id) and leaving the player
    // on the previously-active course (2026-07-16 report).
    const { exposed, push } = mountWithRouter({ isAdminView: false })
    const ok = await exposed.launchClassSession({ id: '', class_name: '', course_code: '', class_learner_id: null })
    expect(ok).toBe(false)
    expect(localStorage.getItem('ssi-active-class')).toBeNull()
    expect(localStorage.getItem('ssi-last-course')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('refuses when not permitted (govt_admin), even for a fully-loaded class', async () => {
    setRole('govt_admin')
    const { exposed, push } = mountWithRouter({ isAdminView: false })
    const ok = await exposed.launchClassSession({ id: 'c1', class_name: 'Y7', course_code: 'cym_for_eng_north', class_learner_id: null })
    expect(ok).toBe(false)
    expect(push).not.toHaveBeenCalled()
  })

  it('launches a ready class: consistent payload + course switch + /schools/play navigation', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const { exposed, push } = mountWithRouter({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses: ref([{ course_code: 'cym_for_eng_north', display_name: 'Welsh (North)' }]),
      supabase: ref(null),
    })
    const ok = await exposed.launchClassSession({
      id: 'c1',
      class_name: 'Ang School Y7 Welsh',
      course_code: 'cym_for_eng_north',
      current_seed: 4,
      class_learner_id: 'cl-123',
    })
    expect(ok).toBe(true)
    expect(localStorage.getItem('ssi-last-course')).toBe('cym_for_eng_north')
    const stored = JSON.parse(localStorage.getItem('ssi-active-class')!)
    expect(stored).toMatchObject({
      id: 'c1',
      name: 'Ang School Y7 Welsh',
      course_code: 'cym_for_eng_north',
      current_seed: 4,
      class_learner_id: 'cl-123',
      teacherUserId: 'u1',
    })
    expect(handleCourseSelect).toHaveBeenCalledWith(
      expect.objectContaining({ course_code: 'cym_for_eng_north' })
    )
    expect(push).toHaveBeenCalledWith({ path: '/schools/play', query: { class: 'c1' } })
  })
})

describe('usePlayAsClass — launchClassSession resolves the class learner id', () => {
  function mountWithRouter(provide: Record<string, unknown>) {
    const push = vi.fn().mockResolvedValue(undefined)
    const exposed = mountHarness({ ...provide, [routerKey as symbol]: { push } })
    return { exposed, push }
  }

  beforeEach(() => {
    localStorage.clear()
    setRole('teacher')
  })

  // Staging, 2026-09-14 21:32Z (job #733): the Classes page row mapper carried
  // no class_learner_id, so the stored payload held null, LearningPlayer's
  // learnerId fell back to the TEACHER's own learner, and every player_events
  // row of a three-minute class session was stamped with the teacher — while
  // the sessions row, resolved server-side from the class id, said class.
  // Red before the fix (stored null); green after (the classes row supplies it).
  it('a launcher that omits class_learner_id: the stored payload carries the id from the classes row', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const maybeSingle = vi.fn().mockResolvedValue({ data: { class_learner_id: 'cl-from-db' }, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    const { exposed, push } = mountWithRouter({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses: ref([{ course_code: 'cym_n_for_eng' }]),
      supabase: ref({ from }),
    })
    // The exact row shape the Classes page handed over: no class_learner_id key at all.
    const ok = await exposed.launchClassSession({ id: 'd52efceb', class_name: 'Y7 Welsh', course_code: 'cym_n_for_eng', current_seed: 1 } as any)
    expect(ok).toBe(true)
    expect(from).toHaveBeenCalledWith('classes')
    expect(eq).toHaveBeenCalledWith('id', 'd52efceb')
    expect(JSON.parse(localStorage.getItem('ssi-active-class')!).class_learner_id).toBe('cl-from-db')
    expect(push).toHaveBeenCalledWith({ path: '/schools/play', query: { class: 'd52efceb' } })
  })

  it('a class the DB has not minted a learner for yet still launches, with class_learner_id null', async () => {
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const maybeSingle = vi.fn().mockResolvedValue({ data: { class_learner_id: null }, error: null })
    const from = vi.fn().mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) })
    const { exposed } = mountWithRouter({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses: ref([{ course_code: 'cym_n_for_eng' }]),
      supabase: ref({ from }),
    })
    const ok = await exposed.launchClassSession({ id: 'c9', class_name: 'New', course_code: 'cym_n_for_eng', class_learner_id: null })
    expect(ok).toBe(true)
    expect(JSON.parse(localStorage.getItem('ssi-active-class')!).class_learner_id).toBeNull()
  })
})

describe('usePlayAsClass — unresolvable course refusal', () => {
  beforeEach(() => {
    localStorage.clear()
    setRole('teacher')
  })

  it('refuses to launch when the class course_code matches no catalogue course (phantom code)', async () => {
    // Two live classes carried 'cym_for_eng_north' — a code with no courses
    // row (the real course is cym_n_for_eng). Launching anyway put the player
    // on a half-formed course and crashed the render (2026-07-16).
    const push = vi.fn().mockResolvedValue(undefined)
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const supabase = ref({
      from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle })),
    })
    const exposed = mountHarness({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses: ref([]),
      supabase,
      [routerKey as symbol]: { push },
    })
    const ok = await exposed.launchClassSession({ id: 'c1', class_name: 'Y7 Welsh', course_code: 'cym_for_eng_north', class_learner_id: null })
    expect(ok).toBe(false)
    expect(handleCourseSelect).not.toHaveBeenCalled()
    expect(localStorage.getItem('ssi-active-class')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })
})

describe('usePlayAsClass — launch refreshes the entitlement snapshot (job #734)', () => {
  // Tom, staging 2026-09-14: teacher signs in (snapshot fetched), creates the
  // Y7 Welsh class, presses Play as class, and the end of Yellow raises the
  // paywall on a school with a live trial — the in-memory snapshot predated
  // the class and nothing had asked again. Launch must ask again, BEFORE the
  // navigation that mounts the player.
  beforeEach(() => {
    localStorage.clear()
    refreshEntitlements.mockClear()
    setRole('teacher')
  })

  it('a ready class: refresh() runs once, before router.push', async () => {
    const order: string[] = []
    refreshEntitlements.mockImplementation(async () => { order.push('refresh') })
    const push = vi.fn().mockImplementation(async () => { order.push('push') })
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const exposed = mountHarness({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses: ref([{ course_code: 'cym_n_for_eng', display_name: 'Welsh (North)' }]),
      supabase: ref(null),
      [routerKey as symbol]: { push },
    })
    const ok = await exposed.launchClassSession({ id: 'd52efceb', class_name: 'Y7 Welsh', course_code: 'cym_n_for_eng', class_learner_id: null })
    expect(ok).toBe(true)
    expect(refreshEntitlements).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['refresh', 'push'])
  })

  it('a refused launch never asks — nothing is mounting', async () => {
    const push = vi.fn().mockResolvedValue(undefined)
    const exposed = mountHarness({ isAdminView: false, [routerKey as symbol]: { push } })
    const ok = await exposed.launchClassSession({ id: '', class_name: '', course_code: '', class_learner_id: null })
    expect(ok).toBe(false)
    expect(refreshEntitlements).not.toHaveBeenCalled()
  })

  it('a failed refresh does not stop the launch', async () => {
    refreshEntitlements.mockRejectedValueOnce(new Error('offline'))
    const push = vi.fn().mockResolvedValue(undefined)
    const handleCourseSelect = vi.fn().mockResolvedValue(undefined)
    const exposed = mountHarness({
      isAdminView: false,
      handleCourseSelect,
      enrolledCourses: ref([{ course_code: 'cym_n_for_eng', display_name: 'Welsh (North)' }]),
      supabase: ref(null),
      [routerKey as symbol]: { push },
    })
    const ok = await exposed.launchClassSession({ id: 'd52efceb', class_name: 'Y7 Welsh', course_code: 'cym_n_for_eng', class_learner_id: null })
    expect(ok).toBe(true)
    expect(push).toHaveBeenCalledTimes(1)
  })
})
