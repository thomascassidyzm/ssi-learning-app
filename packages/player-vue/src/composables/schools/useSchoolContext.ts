/**
 * useSchoolContext — "Who is this dashboard FOR?" context.
 *
 * Replaces useGodMode's selectedUser semantics with a name that reflects
 * what the state actually is: the user context the schools composables
 * use to scope their queries (school_id, group_id, role, etc.). Not
 * impersonation — context.
 *
 * Populated from one of three sources:
 *   - Self-view: the real logged-in learner (SchoolsContainer.loadFromAuth)
 *   - Admin-view: a schoolId / groupId / learnerId from route params
 *     (AdminSchoolsContainer.loadFromSchoolId etc.) — queries still run as
 *     the real admin, the context just tells the composables what scope to
 *     look at.
 *   - Demo: a fake persona (populateDemoData).
 *
 * During the migration this file re-exports useGodMode's shared state so
 * both the old and new names resolve to the same ref. Once all consumers
 * are migrated, useGodMode goes away and this becomes the owner of the
 * state.
 */

import { computed } from 'vue'
import { useGodMode, type GodModeUser, type EducationalRole } from './useGodMode'

// Re-export the type under the new name, keeping the underlying shape.
export type SchoolUser = GodModeUser
export type { EducationalRole }

export function useSchoolContext() {
  const gm = useGodMode()

  // `currentUser` is the rename for `selectedUser`. Same reactive ref —
  // writes from either name propagate to the other during the migration.
  const currentUser = gm.selectedUser

  // Role booleans derived from currentUser. Same computed semantics as
  // useGodMode; exposed here so consumers have a single import point.
  const currentRole = computed((): EducationalRole | null =>
    currentUser.value?.educational_role ?? null,
  )
  const isGovtAdmin = computed(() => currentRole.value === 'govt_admin')
  const isSchoolAdmin = computed(() => currentRole.value === 'school_admin')
  const isTeacher = computed(() => currentRole.value === 'teacher')
  const isStudent = computed(() => currentRole.value === 'student')

  function clear() {
    currentUser.value = null
  }

  return {
    currentUser,
    currentRole,
    isGovtAdmin,
    isSchoolAdmin,
    isTeacher,
    isStudent,
    clear,
  }
}
