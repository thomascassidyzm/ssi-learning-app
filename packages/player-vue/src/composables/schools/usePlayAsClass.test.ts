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

  it('ssi_admin read-only god-view: excluded even for a teacher-shaped context', () => {
    setRole('teacher')
    const { canPlayAsClass } = mountHarness({ isAdminView: true })
    expect(canPlayAsClass.value).toBe(false)
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
    const ok = await exposed.launchClassSession({ id: '', class_name: '', course_code: '' })
    expect(ok).toBe(false)
    expect(localStorage.getItem('ssi-active-class')).toBeNull()
    expect(localStorage.getItem('ssi-last-course')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })

  it('refuses when not permitted (govt_admin), even for a fully-loaded class', async () => {
    setRole('govt_admin')
    const { exposed, push } = mountWithRouter({ isAdminView: false })
    const ok = await exposed.launchClassSession({ id: 'c1', class_name: 'Y7', course_code: 'cym_for_eng_north' })
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
    const ok = await exposed.launchClassSession({ id: 'c1', class_name: 'Y7 Welsh', course_code: 'cym_for_eng_north' })
    expect(ok).toBe(false)
    expect(handleCourseSelect).not.toHaveBeenCalled()
    expect(localStorage.getItem('ssi-active-class')).toBeNull()
    expect(push).not.toHaveBeenCalled()
  })
})
