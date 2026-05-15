/**
 * useAdminUserDetail - Full profile, enrollments, sessions, entitlements, progress for one user
 */

import { ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface UserProfile {
  id: string
  user_id: string
  display_name: string
  primary_email: string | null
  emails: string[]
  created_at: string
  educational_role: string | null
  platform_role: string | null
}

export interface DetailEnrollment {
  course_id: string
  last_practiced_at: string | null
  total_practice_minutes: number
  highest_completed_seed: number | null
}

/**
 * One row per (learner, course, day) from learner_speaking_opportunities —
 * the canonical telemetry table written by `bump_speaking_opportunities`
 * on every cycle. The legacy `sessions` table is stale (the SessionStore
 * injection chain that wrote to it is chronically unreliable) so we read
 * this instead.
 */
export interface DetailSession {
  id: string                       // synthesised from (course_code, day)
  course_id: string                // course_code
  started_at: string               // day boundary (midnight UTC)
  ended_at: string | null          // null — per-day rollup, no end
  duration_seconds: number | null  // play_seconds
  items_practiced: number | null   // opportunities
}

export interface UserEntitlement {
  id: string
  access_type: string
  granted_courses: string[] | null
  expires_at: string | null
  redeemed_at: string
  label: string | null
}

export interface CourseProgress {
  course_id: string
  seeds_introduced: number
  legos_seen: number
  legos_retired: number
}

export interface PlayerEvent {
  id: number
  occurred_at: string
  course_code: string | null
  session_id: string | null
  event_type: string
  payload: Record<string, unknown> | null
  device_type: string | null
}

/** One row from learner_l1_state — per-seed L1 fire counter. */
export interface L1StateRow {
  course_code: string
  lego_id: string        // seed's completing LEGO
  fire_count: number
  last_fired_at: string | null
}

/** One row from learner_lego_metrics — per-LEGO adaptive pause mastery state. */
export interface LegoMetricsRow {
  course_code: string
  lego_id: string
  mastery_state: 'acquisition' | 'consolidating' | 'confident' | 'mastered'
  consecutive_smooth: number
  consecutive_fast: number
  n_samples: number
  last_seen_at: string
}

const profile = ref<UserProfile | null>(null)
const enrollments = ref<DetailEnrollment[]>([])
const sessions = ref<DetailSession[]>([])
const userEntitlements = ref<UserEntitlement[]>([])
const courseProgress = ref<Map<string, CourseProgress>>(new Map())
const playerEvents = ref<PlayerEvent[]>([])
const l1State = ref<L1StateRow[]>([])
const legoMetrics = ref<LegoMetricsRow[]>([])

const isLoading = ref(false)
const error = ref<string | null>(null)
const roleUpdateStatus = ref<string | null>(null)

export function useAdminUserDetail(client: SupabaseClient) {

  async function fetchUserDetail(learnerId: string): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      // Fetch all data in parallel
      const [profileResult, enrollResult, sessResult, entitlementResult] = await Promise.all([
        client
          .from('learners')
          .select('id, user_id, display_name, created_at, educational_role, platform_role')
          .eq('id', learnerId)
          .single(),
        client
          .from('course_enrollments')
          .select('course_id, last_practiced_at, total_practice_minutes, highest_completed_seed')
          .eq('learner_id', learnerId),
        client
          .from('learner_speaking_opportunities')
          .select('course_code, day, opportunities, play_seconds, updated_at')
          .eq('learner_id', learnerId)
          .order('day', { ascending: false })
          .limit(50),
        client
          .from('user_entitlements')
          .select('id, access_type, granted_courses, expires_at, redeemed_at, entitlement_code_id')
          .eq('learner_id', learnerId),
      ])

      if (profileResult.error) throw profileResult.error
      if (enrollResult.error) throw enrollResult.error
      if (sessResult.error) throw sessResult.error
      // Entitlement fetch is non-critical
      if (entitlementResult.error) {
        console.warn('[AdminUserDetail] entitlement fetch error:', entitlementResult.error)
      }

      profile.value = { ...profileResult.data, primary_email: null, emails: [] }
      enrollments.value = enrollResult.data || []
      // Shape learner_speaking_opportunities rows to the DetailSession contract
      // the view already renders. id is synthesised; started_at is the day
      // boundary; ended_at stays null (per-day rollup, not a closed session).
      sessions.value = (sessResult.data || []).map((row: any) => ({
        id: `${row.course_code}:${row.day}`,
        course_id: row.course_code,
        started_at: `${row.day}T00:00:00Z`,
        ended_at: null,
        duration_seconds: row.play_seconds,
        items_practiced: row.opportunities,
      }))

      // Recent player_events for this user — used to diagnose taps and
      // listening/commentary lifecycle when a user reports an issue
      // they can't quite describe. Filter by user_id (auth uid), which
      // we have from the profile we just loaded.
      if (profile.value?.user_id) {
        const { data: eventRows, error: eventError } = await client
          .from('player_events')
          .select('id, occurred_at, course_code, session_id, event_type, payload, device_type')
          .eq('user_id', profile.value.user_id)
          .order('occurred_at', { ascending: false })
          .limit(100)
        if (eventError) {
          console.warn('[AdminUserDetail] player_events fetch error:', eventError.message)
          playerEvents.value = []
        } else {
          playerEvents.value = eventRows || []
        }
      } else {
        playerEvents.value = []
      }

      // Fetch all emails via service-role endpoint (learner_emails is service-only).
      if (profile.value?.user_id) {
        try {
          const { data } = await client.auth.getSession()
          const token = data?.session?.access_token
          const headers = token ? { Authorization: `Bearer ${token}` } : {}
          const res = await fetch(`/api/admin/users?ids=${profile.value.user_id}`, { headers })
          if (res.ok) {
            const body = await res.json()
            const match = (body.users || [])[0]
            if (match && profile.value) {
              profile.value.primary_email = match.primary_email || null
              profile.value.emails = match.emails || []
            }
          }
        } catch (err) {
          console.warn('[AdminUserDetail] email fetch failed:', err)
        }
      }

      // Map entitlements — fetch code labels for code-based ones
      const rawEntitlements = entitlementResult.data || []
      const codeIds = rawEntitlements
        .map(e => e.entitlement_code_id)
        .filter(Boolean)

      let codeLabels = new Map<string, string>()
      if (codeIds.length > 0) {
        const { data: codes } = await client
          .from('entitlement_codes')
          .select('id, label')
          .in('id', codeIds)
        codes?.forEach(c => codeLabels.set(c.id, c.label))
      }

      userEntitlements.value = rawEntitlements.map(e => ({
        id: e.id,
        access_type: e.access_type,
        granted_courses: e.granted_courses,
        expires_at: e.expires_at,
        redeemed_at: e.redeemed_at,
        label: e.entitlement_code_id ? (codeLabels.get(e.entitlement_code_id) || 'Code') : 'Direct grant',
      }))

      // Fetch progress per course
      const courseIds = enrollments.value.map(e => e.course_id)
      if (courseIds.length > 0) {
        const progressMap = new Map<string, CourseProgress>()

        const [seedResult, legoResult] = await Promise.all([
          client
            .from('seed_progress')
            .select('course_id')
            .eq('learner_id', learnerId)
            .eq('is_introduced', true),
          client
            .from('lego_progress')
            .select('course_id, is_retired')
            .eq('learner_id', learnerId),
        ])

        // Count seeds introduced per course
        const seedCounts = new Map<string, number>()
        seedResult.data?.forEach(s => {
          seedCounts.set(s.course_id, (seedCounts.get(s.course_id) || 0) + 1)
        })

        // Count legos seen/retired per course
        const legoCounts = new Map<string, { seen: number; retired: number }>()
        legoResult.data?.forEach(l => {
          const entry = legoCounts.get(l.course_id) || { seen: 0, retired: 0 }
          entry.seen++
          if (l.is_retired) entry.retired++
          legoCounts.set(l.course_id, entry)
        })

        courseIds.forEach(courseId => {
          progressMap.set(courseId, {
            course_id: courseId,
            seeds_introduced: seedCounts.get(courseId) || 0,
            legos_seen: legoCounts.get(courseId)?.seen || 0,
            legos_retired: legoCounts.get(courseId)?.retired || 0,
          })
        })

        courseProgress.value = progressMap
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch user detail'
      console.error('[AdminUserDetail] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function updateUserRole(
    learnerId: string,
    field: 'platform_role' | 'educational_role',
    value: string | null
  ): Promise<boolean> {
    roleUpdateStatus.value = null
    try {
      const { error: updateError } = await client
        .from('learners')
        .update({ [field]: value })
        .eq('id', learnerId)

      if (updateError) throw updateError

      // Update local state
      if (profile.value) {
        profile.value = { ...profile.value, [field]: value }
      }
      roleUpdateStatus.value = 'saved'
      setTimeout(() => { roleUpdateStatus.value = null }, 2000)
      return true
    } catch (err) {
      console.error('[AdminUserDetail] role update error:', err)
      roleUpdateStatus.value = 'error'
      setTimeout(() => { roleUpdateStatus.value = null }, 3000)
      return false
    }
  }

  async function grantEntitlement(
    learnerId: string,
    payload: { access_type: string; granted_courses?: string[]; duration_type: string; duration_days?: number },
    getAuthToken: () => Promise<string | null>
  ): Promise<boolean> {
    const token = await getAuthToken()
    if (!token) return false

    try {
      const resp = await fetch('/api/admin/grant-entitlement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ learner_id: learnerId, ...payload }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        console.error('[AdminUserDetail] grant error:', data.error)
        return false
      }

      // Refresh entitlements
      await fetchUserDetail(learnerId)
      return true
    } catch (err) {
      console.error('[AdminUserDetail] grant error:', err)
      return false
    }
  }

  async function revokeEntitlement(
    learnerId: string,
    entitlementId: string,
    getAuthToken: () => Promise<string | null>
  ): Promise<boolean> {
    const token = await getAuthToken()
    if (!token) return false

    try {
      const resp = await fetch('/api/admin/revoke-entitlement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ entitlement_id: entitlementId }),
      })

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}))
        console.error('[AdminUserDetail] revoke error:', data.error)
        return false
      }

      // Refresh entitlements
      await fetchUserDetail(learnerId)
      return true
    } catch (err) {
      console.error('[AdminUserDetail] revoke error:', err)
      return false
    }
  }

  function getCourseProgress(courseId: string): CourseProgress {
    return courseProgress.value.get(courseId) || {
      course_id: courseId,
      seeds_introduced: 0,
      legos_seen: 0,
      legos_retired: 0,
    }
  }

  return {
    profile,
    enrollments,
    sessions,
    userEntitlements,
    courseProgress,
    playerEvents,
    l1State,
    legoMetrics,
    isLoading,
    error,
    roleUpdateStatus,
    fetchUserDetail,
    updateUserRole,
    grantEntitlement,
    revokeEntitlement,
    getCourseProgress,
  }
}
