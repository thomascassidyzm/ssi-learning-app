/**
 * useSchoolContext — "Who is this dashboard FOR?" context.
 *
 * The schools composables and views read currentUser to scope queries
 * (school_id, group_id, educational_role, etc.). This ref is populated
 * from one of three sources:
 *
 *   - Self-view: real logged-in learner
 *     (loadFromAuth — called by SchoolsContainer)
 *   - Admin read-view: a schoolId / groupId / learnerId from route params
 *     (loadFromSchoolId / loadFromGroupId / loadFromLearnerId — called by
 *     AdminSchoolsContainer etc.). Queries still run as the real admin;
 *     the context just tells composables what scope to look at.
 *   - Demo: fake persona written directly by DemoLauncher
 *     (populateDemoData primes the data refs too).
 *
 * Queries NEVER impersonate anyone. When RLS is turned on, admin routes
 * rely on the real admin's JWT + admin-bypass policies, not on pretending
 * to be another user.
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSchoolsClient } from './client'

export type EducationalRole = 'god' | 'student' | 'teacher' | 'school_admin' | 'govt_admin'

export interface SchoolUser {
  user_id: string
  learner_id: string
  display_name: string
  educational_role: EducationalRole | null
  platform_role: 'ssi_admin' | null
  school_id?: string
  school_name?: string
  region_code?: string
  group_id?: string
  group_path?: string
  organization_name?: string
  class_ids?: string[]
}

// Module-level shared state so every caller sees the same context.
const currentUser = ref<SchoolUser | null>(null)

const currentRole = computed((): EducationalRole | null =>
  currentUser.value?.educational_role ?? null,
)
const isGovtAdmin = computed(() => currentRole.value === 'govt_admin')
const isSchoolAdmin = computed(() => currentRole.value === 'school_admin')
const isTeacher = computed(() => currentRole.value === 'teacher')
const isStudent = computed(() => currentRole.value === 'student')

export function useSchoolContext() {
  /**
   * Populate context from the real authenticated learner. Called by
   * SchoolsContainer on mount. Idempotent: no-op if currentUser is
   * already set (e.g. demo or admin-view already primed it).
   */
  async function loadFromAuth(authUserId: string, client?: SupabaseClient): Promise<void> {
    if (currentUser.value) return
    const c = client ?? getSchoolsClient()

    const { data: learner } = await c
      .from('learners')
      .select('id, user_id, display_name, educational_role, platform_role')
      .eq('user_id', authUserId)
      .single()
    if (!learner) return

    const user: SchoolUser = {
      user_id: learner.user_id,
      learner_id: learner.id,
      display_name: learner.display_name,
      educational_role: learner.educational_role,
      platform_role: learner.platform_role,
    }

    if (learner.educational_role === 'govt_admin') {
      const { data: govt } = await c
        .from('govt_admins')
        .select('region_code, organization_name')
        .eq('user_id', authUserId)
        .single()
      if (govt) {
        user.region_code = govt.region_code
        user.organization_name = govt.organization_name
      }
    } else if (['school_admin', 'teacher'].includes(learner.educational_role || '')) {
      const { data: tag } = await c
        .from('user_tags')
        .select('tag_value')
        .eq('user_id', authUserId)
        .eq('tag_type', 'school')
        .is('removed_at', null)
        .limit(1)
        .single()

      if (tag) {
        const schoolId = tag.tag_value.replace('SCHOOL:', '')
        user.school_id = schoolId
        const { data: school } = await c
          .from('schools')
          .select('school_name, region_code')
          .eq('id', schoolId)
          .single()
        if (school) {
          user.school_name = school.school_name
          user.region_code = school.region_code
        }
      } else {
        // Fallback: check if they're the admin_user_id on a school.
        const { data: school } = await c
          .from('schools')
          .select('id, school_name, region_code')
          .eq('admin_user_id', authUserId)
          .limit(1)
          .single()
        if (school) {
          user.school_id = school.id
          user.school_name = school.school_name
          user.region_code = school.region_code
        }
      }
    }

    currentUser.value = user
  }

  /**
   * Populate context for an admin viewing a specific school. Sets the
   * role to school_admin so the schools composables take the school-scope
   * query branch, with school_id/school_name/region_code from the DB.
   * Keeps the real admin's user_id/learner_id/platform_role so any action
   * that writes attribution lands on the admin, not a fictional user.
   */
  async function loadFromSchoolId(
    schoolId: string,
    realLearner: {
      user_id: string
      learner_id: string
      display_name: string
      platform_role: string | null
    },
    client?: SupabaseClient,
  ): Promise<void> {
    const c = client ?? getSchoolsClient()
    const { data: school } = await c
      .from('schools')
      .select('id, school_name, region_code, group_id')
      .eq('id', schoolId)
      .single()

    currentUser.value = {
      user_id: realLearner.user_id,
      learner_id: realLearner.learner_id,
      display_name: realLearner.display_name,
      educational_role: 'school_admin',
      platform_role: realLearner.platform_role as 'ssi_admin' | null,
      school_id: schoolId,
      school_name: school?.school_name,
      region_code: school?.region_code ?? undefined,
      group_id: school?.group_id ?? undefined,
    }
  }

  /**
   * Populate context for an admin viewing a specific group (cross-schools).
   * Sets the role to govt_admin so the schools composables take the
   * group-scope query branch.
   */
  async function loadFromGroupId(
    groupId: string,
    realLearner: {
      user_id: string
      learner_id: string
      display_name: string
      platform_role: string | null
    },
    client?: SupabaseClient,
  ): Promise<void> {
    const c = client ?? getSchoolsClient()
    const { data: group } = await c
      .from('groups')
      .select('id, path, name')
      .eq('id', groupId)
      .single()

    // `groups` has no region_code column — the schools composables fall
    // back to group_id/group_path when region_code is absent, which is
    // the right scope for cross-schools group views anyway.
    currentUser.value = {
      user_id: realLearner.user_id,
      learner_id: realLearner.learner_id,
      display_name: realLearner.display_name,
      educational_role: 'govt_admin',
      platform_role: realLearner.platform_role as 'ssi_admin' | null,
      group_id: groupId,
      group_path: group?.path ?? undefined,
      organization_name: group?.name ?? undefined,
    }
  }

  /**
   * Populate context for an admin viewing a specific learner's progress.
   * Sets the role to student; StudentProgressView reads learner_id to
   * query that user's course enrollments.
   */
  async function loadFromLearnerId(
    learnerId: string,
    realLearner: {
      user_id: string
      platform_role: string | null
    },
    client?: SupabaseClient,
  ): Promise<void> {
    const c = client ?? getSchoolsClient()
    const { data: learner } = await c
      .from('learners')
      .select('id, user_id, display_name, educational_role, platform_role')
      .eq('id', learnerId)
      .single()
    if (!learner) return

    currentUser.value = {
      // Keep the REAL admin's user_id on the context so any action writes
      // attribution to the admin, not to the learner being viewed.
      user_id: realLearner.user_id,
      learner_id: learner.id,
      display_name: learner.display_name,
      educational_role: learner.educational_role,
      platform_role: realLearner.platform_role as 'ssi_admin' | null,
    }
  }

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
    loadFromAuth,
    loadFromSchoolId,
    loadFromGroupId,
    loadFromLearnerId,
    clear,
  }
}
