import { computed, inject } from 'vue'
import { useSchoolContext } from './useSchoolContext'

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
export function usePlayAsClass() {
  const handleCourseSelect = inject<((course: any) => Promise<void>) | null>('handleCourseSelect', null)
  const enrolledCourses = inject<{ value: any[] } | null>('enrolledCourses', null)
  const supabase = inject<any>('supabase', null)
  const isAdminView = inject<boolean>('isAdminView', false)
  const { isSchoolStaff } = useSchoolContext()

  const canPlayAsClass = computed(() => isSchoolStaff.value && !isAdminView)

  async function switchActiveCourseTo(courseCode: string | null | undefined): Promise<void> {
    if (!handleCourseSelect || !courseCode) return
    let courseRow = enrolledCourses?.value?.find((c: any) => c.course_code === courseCode) || null
    if (!courseRow && supabase?.value) {
      const { data } = await supabase.value
        .from('courses')
        .select('*')
        .eq('course_code', courseCode)
        .maybeSingle()
      courseRow = data || null
    }
    if (courseRow) await handleCourseSelect(courseRow)
  }

  return { canPlayAsClass, switchActiveCourseTo }
}
