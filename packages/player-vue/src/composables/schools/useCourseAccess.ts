/**
 * useCourseAccess - Fetch effective course entitlements for a school
 *
 * Queries entitlement_grants at school level and group level (with ancestry),
 * then resolves course display names from the courses table.
 * Read-only — school admins and teachers can view but not edit.
 */

import { ref } from 'vue'
import { getSchoolsClient } from './client'
import { isDemoMode } from '../demo/demoMode'

export interface CourseGrant {
  course_code: string
  display_name: string
  source: 'school' | 'group'
  source_name?: string // group name if inherited
}

const courseGrants = ref<CourseGrant[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useCourseAccess() {
  const client = getSchoolsClient()

  /**
   * Fetch all courses the school has access to via entitlement cascade.
   * Merges direct school grants + group grants (walking up ancestry).
   */
  async function fetchCourseAccess(schoolId: string): Promise<void> {
    if (isDemoMode.value) return
    if (!schoolId) return

    isLoading.value = true
    error.value = null
    courseGrants.value = []

    try {
      // Collect unique course codes with their source
      const courseMap = new Map<string, { source: 'school' | 'group'; source_name?: string }>()

      // 1. Direct school-level grants
      const { data: schoolGrants, error: schoolErr } = await client
        .from('entitlement_grants')
        .select('granted_courses')
        .eq('school_id', schoolId)
        .eq('is_active', true)

      if (schoolErr) throw schoolErr

      for (const grant of schoolGrants || []) {
        for (const code of grant.granted_courses || []) {
          courseMap.set(code, { source: 'school' })
        }
      }

      // 2. Get school's group_id
      const { data: schoolData, error: schoolDataErr } = await client
        .from('schools')
        .select('group_id')
        .eq('id', schoolId)
        .single()

      if (schoolDataErr) throw schoolDataErr

      // 3. Walk up group ancestry and collect grants
      if (schoolData?.group_id) {
        await collectGroupGrants(schoolData.group_id, courseMap)
      }

      // 4. Resolve display names from courses table
      const courseCodes = Array.from(courseMap.keys())
      let displayNames = new Map<string, string>()

      if (courseCodes.length > 0) {
        const { data: courses, error: coursesErr } = await client
          .from('courses')
          .select('course_code, display_name')
          .in('course_code', courseCodes)

        if (!coursesErr && courses) {
          displayNames = new Map(courses.map(c => [c.course_code, c.display_name]))
        }
      }

      // 5. Build final list
      courseGrants.value = courseCodes.map(code => ({
        course_code: code,
        display_name: displayNames.get(code) || formatCourseCode(code),
        source: courseMap.get(code)!.source,
        source_name: courseMap.get(code)!.source_name,
      })).sort((a, b) => a.display_name.localeCompare(b.display_name))

    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch course access'
      console.error('Course access fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Recursively walk up the group ancestry tree, collecting grants.
   */
  async function collectGroupGrants(
    groupId: string,
    courseMap: Map<string, { source: 'school' | 'group'; source_name?: string }>
  ): Promise<void> {
    // Fetch this group's info + grants in parallel
    const [groupResult, grantsResult] = await Promise.all([
      client.from('groups').select('id, name, parent_id').eq('id', groupId).single(),
      client
        .from('entitlement_grants')
        .select('granted_courses')
        .eq('group_id', groupId)
        .eq('is_active', true),
    ])

    if (grantsResult.error) throw grantsResult.error

    const groupName = groupResult.data?.name || 'Group'

    for (const grant of grantsResult.data || []) {
      for (const code of grant.granted_courses || []) {
        // Only set if not already claimed by a more specific level
        if (!courseMap.has(code)) {
          courseMap.set(code, { source: 'group', source_name: groupName })
        }
      }
    }

    // Walk up to parent
    if (groupResult.data?.parent_id) {
      await collectGroupGrants(groupResult.data.parent_id, courseMap)
    }
  }

  return {
    courseGrants,
    isLoading,
    error,
    fetchCourseAccess,
  }
}

/**
 * Fallback: format course_code into a readable name if courses table lookup fails.
 * e.g. "cym_for_eng" -> "cym for eng"
 */
function formatCourseCode(code: string): string {
  return code.replace(/_/g, ' ')
}
