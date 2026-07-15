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

// 'tutor' = the freelance (no-school) teacher role provision.ts writes —
// deliberately distinct from the school 'teacher' so /schools guards can
// bounce tutors to their own dashboard instead of the member wall.
export type EducationalRole = 'student' | 'teacher' | 'tutor' | 'school_admin' | 'govt_admin'

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
  // Platform-subscription gate (lever-3). Populated for school_admin / teacher.
  // Absent/undefined (legacy row or pre-migration DB) ⇒ treated as ACTIVE.
  platform_status?: string | null
  platform_expires_at?: string | null
  // Internal — which loader populated this context. loadFromAuth uses this
  // (not mere presence) to decide whether it's safe to no-op: a stale
  // admin-view/persona scope must never be mistaken for "self already
  // loaded". See loadFromAuth.
  _scopeSource?: 'self' | 'admin-view' | 'demo'
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

/**
 * The platform-subscription gate (lever-3). FAIL-OPEN by design:
 *   active = status === 'active'
 *         || status === 'past_due'                 (dunning grace — see below)
 *         || status == null                       (legacy / pre-migration)
 *         || (status === 'trial' && (expires_at == null || expires_at > now))
 * A NULL/absent status (legacy school, pre-migration DB, govt/admin context, or
 * a demo persona) resolves to ACTIVE, AND a 'trial' with no expiry resolves to
 * ACTIVE (the bare DEFAULT 'trial' the migration writes before provision.ts
 * stamps a real window — see below). A 'past_due' school ALSO resolves to
 * ACTIVE, mirroring the tutor lane's teacher_paid grace: Paddle is still
 * billing and retrying the card, so instant lockout would strand a school
 * mid-dunning over a declined card. Use `platformPastDue` to show the
 * payment-problem banner. Only an explicit expired/cancelled or an ELAPSED
 * trial (non-null expiry in the past) returns false.
 */
const platformActive = computed((): boolean => {
  const u = currentUser.value
  if (!u) return true
  // govt admins / cross-school views aren't gated by a single school's billing.
  if (u.educational_role === 'govt_admin') return true
  const status = u.platform_status
  if (status == null) return true // legacy / pre-migration / unloaded → fail open
  if (status === 'active') return true
  if (status === 'past_due') return true // dunning grace — still a live, billed subscription
  if (status === 'trial') {
    // A 'trial' with NO expiry = grandfathered / not-yet-stamped: the bare
    // schools.platform_status DEFAULT 'trial' (migration 20260616) before
    // provision.ts stamps an expiry, a pre-lever-3 school, or an orphaned row
    // left by an email-burn 409. Treat as active — only an ELAPSED trial (a
    // real, non-null expiry in the past) locks the dashboard.
    if (!u.platform_expires_at) return true
    return new Date(u.platform_expires_at).getTime() > Date.now()
  }
  return false // expired | cancelled
})

/** True while a payment-problem banner should show (dunning in progress). */
const platformPastDue = computed((): boolean => currentUser.value?.platform_status === 'past_due')

export function useSchoolContext() {
  /**
   * Populate context from the real authenticated learner. Called by
   * SchoolsContainer on mount. Idempotent ONLY against a matching self
   * load or demo data — an admin-view/persona scope left over from a
   * read-only detour (AdminSchoolsContainer/AdminGroupContainer/
   * AdminUserProgress/AdminClassDetail all clear on unmount, but this is
   * the defense-in-depth backstop: presence alone is never enough,
   * because "the admin's own user_id" is also what admin-view scopes
   * carry — see loadFromSchoolId's docstring) — see finding #1a,
   * 2026-07-13 audit.
   */
  async function loadFromAuth(authUserId: string, client?: SupabaseClient): Promise<void> {
    const existing = currentUser.value
    if (existing?._scopeSource === 'demo') return
    if (existing && existing._scopeSource !== 'admin-view' && existing.user_id === authUserId) return
    const user = await resolveUser(authUserId, client ?? getSchoolsClient())
    if (user) currentUser.value = { ...user, _scopeSource: 'self' }
  }

  /**
   * Build the full SchoolUser for a given learner user_id — their role plus
   * the scope (school / region / group) they'd see when logged in themselves.
   * Shared by loadFromAuth (self) and loadAsPersona (admin act-as).
   */
  async function resolveUser(userId: string, c: SupabaseClient): Promise<SchoolUser | null> {
    const { data: learner, error } = await c
      .from('learners')
      .select('id, user_id, display_name, educational_role, platform_role')
      .eq('user_id', userId)
      .single()
    // PGRST116 = no row (legitimately resolves to null). Surface anything else
    // (RLS/network) so a regression here — which would silently empty the
    // schools context / act-as view — is diagnosable instead of invisible.
    if (error && error.code !== 'PGRST116') {
      console.warn('[useSchoolContext] resolveUser query failed:', error.message)
    }
    if (!learner) return null

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
        .select('region_code, organization_name, group_id')
        .eq('user_id', userId)
        .single()
      if (govt) {
        user.region_code = govt.region_code
        user.organization_name = govt.organization_name
        // Group is the canonical scope (a govt admin governs a group subtree,
        // e.g. the Wales group). region_code is a legacy fallback for admins
        // created before the group tree existed. The schools composables
        // prefer group_path when present.
        if (govt.group_id) {
          user.group_id = govt.group_id
          const { data: group } = await c
            .from('groups')
            .select('path')
            .eq('id', govt.group_id)
            .single()
          if (group) user.group_path = group.path
        }
      }
    } else if (['school_admin', 'teacher'].includes(learner.educational_role || '')) {
      // Deterministic when a user belongs to 2+ schools: without an ORDER BY
      // the picked school could flip between sessions (limit(1) on an
      // unordered read). First-joined wins, stably.
      const { data: tag } = await c
        .from('user_tags')
        .select('tag_value')
        .eq('user_id', userId)
        .eq('tag_type', 'school')
        .is('removed_at', null)
        .order('added_at', { ascending: true })
        .limit(1)
        .single()

      if (tag) {
        const schoolId = tag.tag_value.replace('SCHOOL:', '')
        user.school_id = schoolId
        const school = await loadSchoolRow(c, 'id', schoolId)
        if (school) {
          user.school_name = school.school_name
          user.region_code = school.region_code
          user.platform_status = school.platform_status
          user.platform_expires_at = school.platform_expires_at
        }
      } else {
        // Fallback: check if they're the admin_user_id on a school.
        const school = await loadSchoolRow(c, 'admin_user_id', userId)
        if (school) {
          user.school_id = school.id
          user.school_name = school.school_name
          user.region_code = school.region_code
          user.platform_status = school.platform_status
          user.platform_expires_at = school.platform_expires_at
        }
      }

      // Tutors (no school) carry the gate on their teacher row. When a teacher
      // row exists, its platform columns take precedence for the tutor gate.
      const teacher = await loadTeacherRow(c, learner.id)
      if (teacher && !user.school_id) {
        user.platform_status = teacher.platform_status
        user.platform_expires_at = teacher.platform_expires_at
      }
    }

    return user
  }

  /**
   * Read a school row + its platform columns, FAILING OPEN if the platform
   * columns don't exist yet (pre-migration). A missing-column error retries
   * with just the legacy columns so the dashboard still renders; the platform
   * fields come back undefined ⇒ the gate treats the account as active.
   */
  async function loadSchoolRow(
    c: SupabaseClient,
    keyCol: 'id' | 'admin_user_id',
    keyVal: string,
  ): Promise<{
    id: string
    school_name: string
    region_code: string | null
    platform_status: string | null
    platform_expires_at: string | null
  } | null> {
    const { data, error } = await c
      .from('schools')
      .select('id, school_name, region_code, platform_status, platform_expires_at')
      .eq(keyCol, keyVal)
      .limit(1)
      .maybeSingle()
    if (!error) return (data as any) ?? null
    if (isMissingColumn(error)) {
      const { data: legacy } = await c
        .from('schools')
        .select('id, school_name, region_code')
        .eq(keyCol, keyVal)
        .limit(1)
        .maybeSingle()
      if (!legacy) return null
      return { ...(legacy as any), platform_status: null, platform_expires_at: null }
    }
    return null
  }

  /** Read a teacher row's platform columns (fail-open on missing column). */
  async function loadTeacherRow(
    c: SupabaseClient,
    learnerId: string,
  ): Promise<{ platform_status: string | null; platform_expires_at: string | null } | null> {
    const { data, error } = await c
      .from('teachers')
      .select('platform_status, platform_expires_at')
      .eq('learner_id', learnerId)
      .limit(1)
      .maybeSingle()
    if (!error) return (data as any) ?? null
    // Missing column (pre-migration) or no teacher row → no gate data (active).
    return null
  }

  /** PostgREST/Postgres "column does not exist" detection (pre-migration). */
  function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
    if (!err) return false
    if (['PGRST204', '42703'].includes(err.code || '')) return true
    return /column .* does not exist|could not find the .* column|schema cache/i.test(err.message || '')
  }

  /**
   * Act-as: prime the context as a real persona (teacher / school_admin /
   * govt_admin) so the live /schools experience renders exactly as that
   * person would see it. Only ssi_admins reach this (gated at the call site).
   *
   * Unlike loadFromSchoolId/GroupId (which keep the admin's user_id and a
   * fixed role for read-only scope), this sets the persona's OWN user_id —
   * a teacher's classes are scoped by their class membership (the
   * class_teachers relationship), so seeing their real roster requires being
   * them. This is ephemeral client state: the admin's
   * learner row and auth session are untouched, so no admin↔persona link is
   * ever stored. Exiting just clears the context.
   */
  async function loadAsPersona(personaUserId: string, client?: SupabaseClient): Promise<void> {
    const user = await resolveUser(personaUserId, client ?? getSchoolsClient())
    if (user) currentUser.value = { ...user, _scopeSource: 'admin-view' }
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
      _scopeSource: 'admin-view',
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
      _scopeSource: 'admin-view',
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
      _scopeSource: 'admin-view',
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
    platformActive,
    platformPastDue,
    loadFromAuth,
    loadAsPersona,
    loadFromSchoolId,
    loadFromGroupId,
    loadFromLearnerId,
    clear,
  }
}
