/**
 * useAdminUsers - Loads ALL users once on mount, filters/sorts client-side.
 *
 * The /api/admin/users endpoint now returns each user fully enriched
 * (emails + access tier + activity rollup) in ONE request, so there is no
 * second per-learner enrollment round-trip — the list renders as soon as
 * that single fetch returns. Client-side filter/sort is instant at this
 * scale; switch to the endpoint's server-side search once users cross ~5k.
 *
 * This page is for FINDING users fast and CHECKING PERMISSIONS, so the
 * default surfaces who's actually using the app (most-recently-active) and
 * exposes tier (premium/free/admin/school) for filtering.
 */

import { ref, computed } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export type Tier = 'admin' | 'school' | 'premium' | 'free'
export type SortKey = 'active' | 'practice' | 'joined' | 'name'

interface AdminUser {
  id: string
  user_id: string
  display_name: string
  primary_email: string | null
  emails: string[]
  created_at: string
  educational_role: string | null
  platform_role: string | null
  needs_email_verification: boolean
  // Enriched server-side:
  tier: Tier
  last_active: string | null
  practice_minutes: number
  course_ids: string[]
}

const PAGE_SIZE = 50
const FETCH_LIMIT = 10000 // grab everything in one shot

const allUsers = ref<AdminUser[]>([])

const currentPage = ref(1)
const searchQuery = ref('')
const courseFilter = ref<string | null>(null)
const tierFilter = ref<Tier | null>(null)
const sortKey = ref<SortKey>('active')

const isLoading = ref(false)
const error = ref<string | null>(null)

// Epoch ms for a timestamp; never-active sorts last.
function ts(d: string | null): number {
  return d ? new Date(d).getTime() : -Infinity
}

// Search relevance: exact (3) > starts-with (2) > contains (1) > no match (-1),
// matched against display name OR any email.
function matchScore(u: AdminUser, q: string): number {
  const name = (u.display_name || '').toLowerCase()
  const emails = u.emails.map(e => e.toLowerCase())
  if (name === q || emails.includes(q)) return 3
  if (name.startsWith(q) || emails.some(e => e.startsWith(q))) return 2
  if (name.includes(q) || emails.some(e => e.includes(q))) return 1
  return -1
}

function compareBy(key: SortKey) {
  return (a: AdminUser, b: AdminUser): number => {
    switch (key) {
      case 'active':
        return ts(b.last_active) - ts(a.last_active) ||
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'practice':
        return (b.practice_minutes - a.practice_minutes) ||
          ts(b.last_active) - ts(a.last_active)
      case 'joined':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      case 'name':
        return (a.display_name || '￿').toLowerCase()
          .localeCompare((b.display_name || '￿').toLowerCase())
    }
  }
}

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
      const params = new URLSearchParams({ page: '1', limit: String(FETCH_LIMIT) })

      const res = await fetch(`/api/admin/users?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Request failed: ${res.status}`)
      }
      const data = await res.json()
      allUsers.value = data.users || []
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch users'
      console.error('[AdminUsers] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Apply tier + course filters and search, then order. When searching, results
  // are relevance-ranked (then by recency); otherwise by the active sort chip.
  const filteredUsers = computed(() => {
    let result = allUsers.value

    if (tierFilter.value) {
      const t = tierFilter.value
      result = result.filter(u => u.tier === t)
    }

    if (courseFilter.value) {
      const courseId = courseFilter.value
      result = result.filter(u => u.course_ids.includes(courseId))
    }

    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      return result
        .map(u => ({ u, s: matchScore(u, q) }))
        .filter(x => x.s >= 0)
        .sort((a, b) => b.s - a.s || compareBy('active')(a.u, b.u))
        .map(x => x.u)
    }

    return result.slice().sort(compareBy(sortKey.value))
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

  // Counts per tier across the FULL set — drives the filter chip badges, so an
  // admin can see "how many premium" at a glance (checking permissions).
  const tierCounts = computed<Record<Tier, number>>(() => {
    const c: Record<Tier, number> = { admin: 0, school: 0, premium: 0, free: 0 }
    for (const u of allUsers.value) c[u.tier]++
    return c
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

  function setTierFilter(tier: Tier | null) {
    tierFilter.value = tier
    currentPage.value = 1
  }

  function setSort(key: SortKey) {
    sortKey.value = key
    currentPage.value = 1
  }

  // Distinct course IDs across all users — the course filter dropdown needs
  // every course any user is enrolled in, not just the current page slice.
  const allEnrolledCourseIds = computed(() => {
    const set = new Set<string>()
    for (const u of allUsers.value) for (const c of u.course_ids) set.add(c)
    return Array.from(set)
  })

  return {
    // State
    users,
    totalCount,
    currentPage,
    totalPages,
    searchQuery,
    courseFilter,
    tierFilter,
    sortKey,
    isLoading,
    error,

    // Hero stats
    totalUsers,
    newThisWeek,
    tierCounts,

    // Aggregates across the full dataset (not just the visible page)
    allEnrolledCourseIds,

    // Actions
    fetchAll,
    setPage,
    setSearch,
    setCourseFilter,
    setTierFilter,
    setSort,
  }
}
