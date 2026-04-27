/**
 * useAdminUsers - Loads ALL users once on mount, filters client-side.
 *
 * At ~1.3k users this is far snappier than round-tripping to the server
 * on every keystroke; total payload is ~300KB once. Switch back to
 * server-side search once user count crosses ~5k.
 *
 * Pulls users (with emails) from /api/admin/users (service-role on the
 * server, only safe way to read auth.users.email + learner_emails).
 * Enrollments are still queried directly via the user's Supabase client.
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AdminUser {
  id: string
  user_id: string
  display_name: string
  primary_email: string | null
  emails: string[]
  created_at: string
  educational_role: string | null
  platform_role: string | null
}

export interface UserEnrollment {
  learner_id: string
  course_id: string
  last_practiced_at: string | null
  total_practice_minutes: number
}

const PAGE_SIZE = 50
const FETCH_LIMIT = 10000 // grab everything in one shot

const allUsers = ref<AdminUser[]>([])
const enrollments = ref<Map<string, UserEnrollment[]>>(new Map())

const currentPage = ref(1)
const searchQuery = ref('')
const courseFilter = ref<string | null>(null)

const isLoading = ref(false)
const error = ref<string | null>(null)

export function useAdminUsers(client: SupabaseClient) {

  async function getToken(): Promise<string | null> {
    try {
      const { data } = await client.auth.getSession()
      return data?.session?.access_token ?? null
    } catch {
      return null
    }
  }

  async function fetchAll(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      const token = await getToken()
      const params = new URLSearchParams({
        page: '1',
        limit: String(FETCH_LIMIT),
      })

      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      const data = await res.json()

      allUsers.value = data.users || []

      if (allUsers.value.length === 0) {
        enrollments.value = new Map()
        return
      }

      // Batch fetch enrollments for all users
      const ids = allUsers.value.map(u => u.id)
      const { data: enrollData, error: enrollErr } = await client
        .from('course_enrollments')
        .select('learner_id, course_id, last_practiced_at, total_practice_minutes')
        .in('learner_id', ids)

      if (enrollErr) throw enrollErr

      const enrollMap = new Map<string, UserEnrollment[]>()
      enrollData?.forEach(e => {
        if (!enrollMap.has(e.learner_id)) {
          enrollMap.set(e.learner_id, [])
        }
        enrollMap.get(e.learner_id)!.push(e)
      })
      enrollments.value = enrollMap
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch users'
      console.error('[AdminUsers] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Apply search + course filter, then return the current page slice.
  const filteredUsers = computed(() => {
    let result = allUsers.value

    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      result = result.filter(u => {
        if (u.display_name?.toLowerCase().includes(q)) return true
        if (u.emails.some(e => e.toLowerCase().includes(q))) return true
        return false
      })
    }

    if (courseFilter.value) {
      const courseId = courseFilter.value
      result = result.filter(u => {
        const userEnrollments = enrollments.value.get(u.id)
        return userEnrollments?.some(e => e.course_id === courseId)
      })
    }

    return result
  })

  const totalCount = computed(() => filteredUsers.value.length)
  const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

  // Visible page slice
  const users = computed(() => {
    const offset = (currentPage.value - 1) * PAGE_SIZE
    return filteredUsers.value.slice(offset, offset + PAGE_SIZE)
  })

  // Hero stats — derived from full set, not the filtered/paged view
  const totalUsers = computed(() => allUsers.value.length)
  const newThisWeek = computed(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return allUsers.value.filter(u => new Date(u.created_at).getTime() >= weekAgo).length
  })

  function setPage(page: number) {
    currentPage.value = page
  }

  function setSearch(query: string) {
    searchQuery.value = query
    currentPage.value = 1
  }

  function setCourseFilter(course: string | null) {
    courseFilter.value = course
    currentPage.value = 1
  }

  function getUserEnrollments(learnerId: string): UserEnrollment[] {
    return enrollments.value.get(learnerId) || []
  }

  function getLastActive(learnerId: string): string | null {
    const userEnrollments = enrollments.value.get(learnerId)
    if (!userEnrollments || userEnrollments.length === 0) return null

    const dates = userEnrollments
      .map(e => e.last_practiced_at)
      .filter((d): d is string => d !== null)

    if (dates.length === 0) return null
    return dates.sort().reverse()[0]
  }

  function getTotalPracticeMinutes(learnerId: string): number {
    const userEnrollments = enrollments.value.get(learnerId)
    if (!userEnrollments) return 0
    return userEnrollments.reduce((sum, e) => sum + (e.total_practice_minutes || 0), 0)
  }

  return {
    // State
    users,
    totalCount,
    currentPage,
    totalPages,
    searchQuery,
    courseFilter,
    isLoading,
    error,

    // Hero stats
    totalUsers,
    newThisWeek,

    // Actions
    fetchAll,
    setPage,
    setSearch,
    setCourseFilter,

    // Helpers
    getUserEnrollments,
    getLastActive,
    getTotalPracticeMinutes,
  }
}
