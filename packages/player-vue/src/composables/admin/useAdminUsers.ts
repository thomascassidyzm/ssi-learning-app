/**
 * useAdminUsers - Paginated user list with enrollments and subscriptions
 */

import { ref, computed } from 'vue'
import { getSchoolsClient } from '@/composables/schools/client'

export interface AdminUser {
  id: string
  user_id: string
  display_name: string
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

export interface UserSubscription {
  learner_id: string
  status: string
  plan_name: string | null
}

const PAGE_SIZE = 50

const users = ref<AdminUser[]>([])
const enrollments = ref<Map<string, UserEnrollment[]>>(new Map())
const subscriptions = ref<Map<string, UserSubscription>>(new Map())

const totalCount = ref(0)
const currentPage = ref(1)
const searchQuery = ref('')
const courseFilter = ref<string | null>(null)
const subscriptionFilter = ref<string | null>(null)

const isLoading = ref(false)
const error = ref<string | null>(null)

// Hero stats
const totalUsers = ref(0)
const activeSubscribers = ref(0)
const newThisWeek = ref(0)

export function useAdminUsers() {
  const client = getSchoolsClient()

  const totalPages = computed(() => Math.max(1, Math.ceil(totalCount.value / PAGE_SIZE)))

  async function fetchUsers(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      const offset = (currentPage.value - 1) * PAGE_SIZE

      // Build learners query
      let query = client
        .from('learners')
        .select('id, user_id, display_name, created_at, educational_role, platform_role', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1)

      if (searchQuery.value) {
        query = query.ilike('display_name', `%${searchQuery.value}%`)
      }

      const { data: learnerData, count, error: learnersErr } = await query

      if (learnersErr) throw learnersErr

      users.value = learnerData || []
      totalCount.value = count || 0

      if (users.value.length === 0) {
        enrollments.value = new Map()
        subscriptions.value = new Map()
        return
      }

      const pageIds = users.value.map(u => u.id)

      // Batch fetch enrollments and subscriptions
      const [enrollResult, subResult] = await Promise.all([
        client
          .from('course_enrollments')
          .select('learner_id, course_id, last_practiced_at, total_practice_minutes')
          .in('learner_id', pageIds),
        client
          .from('subscriptions')
          .select('learner_id, status, plan_name')
          .in('learner_id', pageIds),
      ])

      if (enrollResult.error) throw enrollResult.error
      if (subResult.error) throw subResult.error

      // Group enrollments by learner_id
      const enrollMap = new Map<string, UserEnrollment[]>()
      enrollResult.data?.forEach(e => {
        if (!enrollMap.has(e.learner_id)) {
          enrollMap.set(e.learner_id, [])
        }
        enrollMap.get(e.learner_id)!.push(e)
      })
      enrollments.value = enrollMap

      // Map subscriptions by learner_id
      const subMap = new Map<string, UserSubscription>()
      subResult.data?.forEach(s => {
        subMap.set(s.learner_id, s)
      })
      subscriptions.value = subMap
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch users'
      console.error('[AdminUsers] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  async function fetchHeroStats(): Promise<void> {
    try {
      // Total users
      const { count } = await client
        .from('learners')
        .select('*', { count: 'exact', head: true })
      totalUsers.value = count || 0

      // Active subscribers
      const { count: subCount } = await client
        .from('subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
      activeSubscribers.value = subCount || 0

      // New this week
      const weekAgo = new Date()
      weekAgo.setDate(weekAgo.getDate() - 7)
      const { count: newCount } = await client
        .from('learners')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', weekAgo.toISOString())
      newThisWeek.value = newCount || 0
    } catch (err) {
      console.error('[AdminUsers] hero stats error:', err)
    }
  }

  async function fetchAll(): Promise<void> {
    await Promise.all([fetchUsers(), fetchHeroStats()])
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

  function setSubscriptionFilter(status: string | null) {
    subscriptionFilter.value = status
    currentPage.value = 1
  }

  // Client-side filtering for course/subscription (applied to already-fetched page)
  const filteredUsers = computed(() => {
    let result = users.value

    if (courseFilter.value) {
      const courseId = courseFilter.value
      result = result.filter(u => {
        const userEnrollments = enrollments.value.get(u.id)
        return userEnrollments?.some(e => e.course_id === courseId)
      })
    }

    if (subscriptionFilter.value) {
      const status = subscriptionFilter.value
      result = result.filter(u => {
        const sub = subscriptions.value.get(u.id)
        if (status === 'none') return !sub
        return sub?.status === status
      })
    }

    return result
  })

  function getUserEnrollments(learnerId: string): UserEnrollment[] {
    return enrollments.value.get(learnerId) || []
  }

  function getUserSubscription(learnerId: string): UserSubscription | undefined {
    return subscriptions.value.get(learnerId)
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
    subscriptionFilter,
    isLoading,
    error,

    // Hero stats
    totalUsers,
    activeSubscribers,
    newThisWeek,

    // Actions
    fetchAll,
    fetchUsers,
    setPage,
    setSearch,
    setCourseFilter,
    setSubscriptionFilter,

    // Helpers
    getUserEnrollments,
    getUserSubscription,
    getLastActive,
    getTotalPracticeMinutes,
  }
}
