/**
 * useAdminUsers - Paginated user list with enrollments + emails.
 *
 * Pulls users (with email) from /api/admin/users (service-role on the server,
 * which is the only way to safely read auth.users.email). Enrollments are
 * still queried directly via the user's Supabase client.
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

const users = ref<AdminUser[]>([])
const enrollments = ref<Map<string, UserEnrollment[]>>(new Map())

const totalCount = ref(0)
const currentPage = ref(1)
const searchQuery = ref('')
const courseFilter = ref<string | null>(null)

const isLoading = ref(false)
const error = ref<string | null>(null)

// Hero stats
const totalUsers = ref(0)
const newThisWeek = ref(0)

export function useAdminUsers(client: SupabaseClient) {

  const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

  async function getToken(): Promise<string | null> {
    try {
      const { data } = await client.auth.getSession()
      return data?.session?.access_token ?? null
    } catch {
      return null
    }
  }

  async function fetchUsers(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      const token = await getToken()
      const params = new URLSearchParams({
        page: String(currentPage.value),
        limit: String(PAGE_SIZE),
      })
      if (searchQuery.value) params.set('search', searchQuery.value)

      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      const data = await res.json()

      users.value = data.users || []
      totalCount.value = data.totalCount || 0
      totalUsers.value = data.totalUsers || 0
      newThisWeek.value = data.newThisWeek || 0

      if (users.value.length === 0) {
        enrollments.value = new Map()
        return
      }

      const pageIds = users.value.map(u => u.id)

      // Batch fetch enrollments (still goes via the user's client — content table, permissive)
      const { data: enrollData, error: enrollErr } = await client
        .from('course_enrollments')
        .select('learner_id, course_id, last_practiced_at, total_practice_minutes')
        .in('learner_id', pageIds)

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

  async function fetchAll(): Promise<void> {
    await fetchUsers()
  }

  function setPage(page: number) {
    currentPage.value = page
    fetchUsers()
  }

  function setSearch(query: string) {
    searchQuery.value = query
    currentPage.value = 1
    fetchUsers()
  }

  function setCourseFilter(course: string | null) {
    courseFilter.value = course
    currentPage.value = 1
  }

  // Client-side filtering for course (applied to already-fetched page)
  const filteredUsers = computed(() => {
    let result = users.value

    if (courseFilter.value) {
      const courseId = courseFilter.value
      result = result.filter(u => {
        const userEnrollments = enrollments.value.get(u.id)
        return userEnrollments?.some(e => e.course_id === courseId)
      })
    }

    return result
  })

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
    users: filteredUsers,
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
    fetchUsers,
    setPage,
    setSearch,
    setCourseFilter,

    // Helpers
    getUserEnrollments,
    getLastActive,
    getTotalPracticeMinutes,
  }
}
