/**
 * useSchoolCourseCatalogue - the course list a school can create classes in.
 *
 * Sources the SAME model as TeacherDashboard/CreateClassModal (the current,
 * settled commercial model — docs/schools/group-commercial-model.md "Student
 * entitlement — FINAL model", 2026-07-15): schools don't hold per-course
 * `entitlement_grants` rows any more — a subscribed school gets the full live
 * catalogue, a trial school is locked to its one `schools.trial_course_code`.
 *
 * useCourseAccess()/entitlement_grants is the SUPERSEDED per-course-grant
 * model; it now legitimately returns zero rows for most real schools, which
 * is what left the setup wizard's course dropdown empty (2026-07-16).
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from './client'
import { isDemoMode } from '../demo/demoMode'

export interface CatalogueCourse {
  course_code: string
  display_name: string
}

// Matches CreateClassModal.vue's demo/offline fallback — kept in sync
// manually since both are small, static lists (see that file's comment on
// why cym_for_eng_north/south etc were removed 2026-07-16: those codes
// matched no `courses` row).
const DEMO_COURSES: CatalogueCourse[] = [
  { course_code: 'cym_n_for_eng', display_name: 'Welsh (Northern)' },
  { course_code: 'cym_s_for_eng', display_name: 'Welsh (Southern)' },
  { course_code: 'spa_for_eng', display_name: 'Spanish' },
  { course_code: 'nld_for_eng', display_name: 'Dutch' },
  { course_code: 'cor_for_eng', display_name: 'Cornish' },
]

export function useSchoolCourseCatalogue() {
  const client = getSchoolsClient()

  const catalogueCourses = ref<CatalogueCourse[]>([])
  const isLoadingCatalogue = ref(false)
  const catalogueError = ref<string | null>(null)

  const schoolPlatformStatus = ref<string | null>(null)
  const schoolTrialCourse = ref<string | null>(null)

  async function fetchCatalogue(): Promise<void> {
    if (isDemoMode.value) {
      catalogueCourses.value = DEMO_COURSES
      return
    }
    if (catalogueCourses.value.length || isLoadingCatalogue.value) return
    isLoadingCatalogue.value = true
    catalogueError.value = null
    try {
      const { data, error } = await client
        .from('courses')
        .select('course_code, display_name')
        .in('new_app_status', ['live', 'beta'])
        .order('display_name')
      if (error) throw error
      catalogueCourses.value = (data || []).map(c => ({
        course_code: c.course_code,
        display_name: c.display_name || c.course_code,
      }))
    } catch (err) {
      catalogueError.value = err instanceof Error ? err.message : 'Failed to load course catalogue'
      catalogueCourses.value = DEMO_COURSES
    } finally {
      isLoadingCatalogue.value = false
    }
  }

  // Fails open (never lock a school out of the wizard on a read error) —
  // mirrors TeacherDashboard's loadSchoolTrial().
  async function loadSchoolPlatformState(supabase: any): Promise<void> {
    if (isDemoMode.value || !supabase?.value) return
    try {
      const { data: { session } } = await supabase.value.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const res = await fetch('/api/school/subscription', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      schoolPlatformStatus.value = data?.school?.platform_status ?? null
      schoolTrialCourse.value = data?.school?.trial_course_code ?? null
    } catch {
      /* non-fatal — falls back to the full catalogue below */
    }
  }

  // Trial-locked to its one language only while genuinely mid-trial (not yet
  // subscribed); everyone else (subscribed, or unknown/fail-open) gets the
  // full catalogue — same precedence as TeacherDashboard's schoolAvailableCourses.
  const availableCourses = computed<CatalogueCourse[]>(() => {
    if (schoolPlatformStatus.value !== 'active' && schoolTrialCourse.value) {
      const trial = schoolTrialCourse.value
      const known = catalogueCourses.value.find(c => c.course_code === trial)
      return [known || { course_code: trial, display_name: trial.replace(/_/g, ' ') }]
    }
    return catalogueCourses.value
  })

  return {
    catalogueCourses,
    isLoadingCatalogue,
    catalogueError,
    schoolPlatformStatus,
    schoolTrialCourse,
    availableCourses,
    fetchCatalogue,
    loadSchoolPlatformState,
  }
}
