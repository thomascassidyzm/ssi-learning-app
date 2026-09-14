import { computed, inject, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSchoolContext } from './useSchoolContext'
import { rememberCourse } from '../../platform/courseChoice'

/**
 * Shared "force the app onto this course right now" step for every Play-as-class
 * entry point (ClassDetail, DashboardView, TeacherDashboard, TeachDashboard).
 *
 * PlayerContainer's own onMounted class-context check (reading ssi-active-class
 * from localStorage) races App.vue's async course-catalogue fetch — a
 * localStorage-only write can silently lose to whatever course was already
 * active, landing the teacher/admin in the default course instead of the
 * class's. Same root cause + fix shape as RedeemCode's student class-landing
 * fix (2026-07-15): call App.vue's own handleCourseSelect directly, with a
 * Supabase fallback fetch when the catalogue hasn't loaded yet.
 *
 * Also carries the play-as-class PERMISSION check (owner ruling, 2026-07-16):
 * any school STAFF member (teacher or school_admin) may play any class in
 * their school, but group leaders (govt_admin) are excluded by default, and
 * the ssi_admin read-only god-view (isAdminView) never gets a live session.
 */
/** The class fields a play-as-class launch needs. Views pass their own class
 * shape; anything optional is defaulted so the stored payload is CONSISTENT
 * across every entry point (the player reads id / class_learner_id /
 * last_lego_id / name from it). */
export interface PlayableClass {
  id: string
  class_name: string
  course_code: string
  current_seed?: number | null
  last_lego_id?: string | null
  /**
   * REQUIRED, nullable — never optional. This is the identity every
   * player_events row of the session is attributed to: LearningPlayer's
   * learnerId is `classContext.class_learner_id || the STAFF member's own`, so
   * a launcher that simply forgets the key hands the whole class session's
   * telemetry to the teacher. The sessions row never suffers this (the
   * class-aware session store resolves the class learner server-side from the
   * class id), which is exactly how staging split on 2026-09-14 21:32Z:
   * sessions said class, player_events said teacher, for one and the same
   * play (job #733). A row shape without the key is now a type error, and
   * launchClassSession resolves a null from the classes row anyway.
   */
  class_learner_id: string | null
}

export function usePlayAsClass() {
  const handleCourseSelect = inject<((course: any) => Promise<void>) | null>('handleCourseSelect', null)
  const enrolledCourses = inject<{ value: any[] } | null>('enrolledCourses', null)
  const supabase = inject<any>('supabase', null)
  const isAdminView = inject<boolean>('isAdminView', false)
  const { isSchoolStaff, currentUser } = useSchoolContext()
  const router = useRouter()

  // Who SEES the button: any school staff member. Who may PRESS it: the same
  // people on a live account. Under View As the button is SHOWN DISABLED,
  // never hidden (Tom, 2026-09-14 16:17Z, job #683: "every single Play as
  // Class button has GONE!!!! That should be prominent next to the class, not
  // invisible") — a viewer sees the control a teacher has, and the launch
  // below still refuses, which is the honest rendering of the #681 write ban.
  // Before this, canPlayAsClass carried `&& !isAdminView` (2026-07-16,
  // 8ca0f01b2) and View As hid every button on every surface.
  const canPlayAsClass = computed(() => isSchoolStaff.value)
  const playAsClassReadOnly = computed(() => canPlayAsClass.value && isAdminView)
  // Was silent (console.warn/error only) — a teacher clicking Play on a
  // half-loaded or misconfigured class saw nothing happen at all (trinity
  // ledger LA #5). Callers render this next to the Play button.
  const playError = ref<string | null>(null)

  /** Returns true iff the course row was found and the switch ran. */
  async function switchActiveCourseTo(courseCode: string | null | undefined): Promise<boolean> {
    if (!handleCourseSelect || !courseCode) return false
    let courseRow = enrolledCourses?.value?.find((c: any) => c.course_code === courseCode) || null
    if (!courseRow && supabase?.value) {
      const { data } = await supabase.value
        .from('courses')
        .select('*')
        .eq('course_code', courseCode)
        .maybeSingle()
      courseRow = data || null
    }
    if (!courseRow) return false
    await handleCourseSelect(courseRow)
    return true
  }

  /**
   * The ONE launch path for every schools play-as-class button
   * (DashboardView, TeacherDashboard, ClassDetail). Refuses to launch a
   * half-loaded class: ClassDetail's Play was clickable while its data was
   * still fetching, which navigated to /schools/play?class= (empty id) and
   * left the player on whatever course was previously active — the
   * "blank/failed player load" report (2026-07-16). Returns false when it
   * refuses, so callers can keep the button disabled/inert instead.
   */
  async function launchClassSession(cls: PlayableClass | null | undefined): Promise<boolean> {
    playError.value = null
    if (!canPlayAsClass.value || isAdminView) return false
    if (!cls?.id || !cls?.course_code) {
      console.warn('[usePlayAsClass] class not ready (missing id or course_code) — not launching')
      playError.value = 'This class is still loading — try again in a moment.'
      return false
    }
    // Force the app onto the class's course FIRST — don't rely on
    // PlayerContainer's onMounted to win its race against App.vue's async
    // course-catalogue fetch. If the class's course_code doesn't resolve to a
    // real course (two live classes carried the phantom 'cym_for_eng_north',
    // 2026-07-16), navigating anyway lands the player on the wrong or a
    // half-formed course — refuse instead, loudly, with nothing written.
    const switched = await switchActiveCourseTo(cls.course_code)
    if (!switched) {
      console.error(
        `[usePlayAsClass] course "${cls.course_code}" for class "${cls.class_name}" not found in the catalogue — ` +
        'not launching. Fix the class\'s course assignment.',
      )
      playError.value = `Couldn't start this class — its course ("${cls.course_code}") isn't set up correctly. Contact support.`
      return false
    }
    rememberCourse(cls.course_code, 'chosen')
    // The class's own learner id, from the classes row when the caller has
    // none (a freshly created class, or a row shape that dropped the key —
    // see PlayableClass). Missing here means the teacher's own account owns
    // the session's telemetry, so it is worth one read. Still null after the
    // read = the DB has not minted the class learner yet, and the player's
    // existing fallback applies exactly as before.
    let classLearnerId: string | null = cls.class_learner_id ?? null
    if (!classLearnerId && supabase?.value) {
      try {
        const { data } = await supabase.value
          .from('classes')
          .select('class_learner_id')
          .eq('id', cls.id)
          .maybeSingle()
        classLearnerId = (data?.class_learner_id as string | null | undefined) ?? null
      } catch {
        classLearnerId = null
      }
    }
    localStorage.setItem('ssi-active-class', JSON.stringify({
      id: cls.id,
      name: cls.class_name,
      course_code: cls.course_code,
      current_seed: cls.current_seed ?? null,
      last_lego_id: cls.last_lego_id ?? null,
      class_learner_id: classLearnerId,
      teacherUserId: currentUser.value?.user_id ?? null,
      timestamp: new Date().toISOString(),
    }))
    // /schools/play renders PlayerContainer as a child of SchoolsContainer,
    // so the schools top bar stays above the player.
    await router.push({ path: '/schools/play', query: { class: cls.id } })
    return true
  }

  return { canPlayAsClass, playAsClassReadOnly, switchActiveCourseTo, launchClassSession, playError }
}
