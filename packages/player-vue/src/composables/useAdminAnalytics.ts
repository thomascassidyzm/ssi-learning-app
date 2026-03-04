/**
 * useAdminAnalytics - Platform-wide analytics for ssi_admin
 *
 * Provides user acquisition, engagement, and retention metrics
 * by querying learners, course_enrollments, and sessions tables.
 */

import { ref } from 'vue'
import { getSchoolsClient } from './schools/client'

// --- Types ---

export interface WeeklyUsers {
  week: string // ISO date of week start (Monday)
  count: number
}

export interface MonthlyUsers {
  month: string // YYYY-MM
  count: number
}

export interface CourseEnrollment {
  course_id: string
  count: number
}

export interface CourseMau {
  course_id: string
  mau: number
}

export interface RetentionCohort {
  week: string // ISO date of cohort week start
  users: number
  w1: number // % retained at week 1
  w2: number
  w4: number
  w8: number
}

// --- State ---

const totalUsers = ref(0)
const newUsersPerWeek = ref<WeeklyUsers[]>([])
const newUsersPerMonth = ref<MonthlyUsers[]>([])
const usersPerCourse = ref<CourseEnrollment[]>([])

const totalMau = ref(0)
const mauPerCourse = ref<CourseMau[]>([])
const avgSessionsPerUserPerWeek = ref(0)
const avgSessionDurationMinutes = ref(0)
const sessionsPerWeek = ref<WeeklyUsers[]>([])

const retentionCohorts = ref<RetentionCohort[]>([])

const isLoading = ref(false)
const error = ref<string | null>(null)

// --- Helpers ---

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0]
}

export function useAdminAnalytics() {
  const client = getSchoolsClient()

  async function fetchAll(): Promise<void> {
    isLoading.value = true
    error.value = null

    try {
      await Promise.all([
        fetchUserAcquisition(),
        fetchEngagement(),
        fetchRetention(),
      ])
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch analytics'
      console.error('[AdminAnalytics] fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // --- User Acquisition ---

  async function fetchUserAcquisition(): Promise<void> {
    // Total users
    const { count, error: countErr } = await client
      .from('learners')
      .select('*', { count: 'exact', head: true })

    if (countErr) throw countErr
    totalUsers.value = count || 0

    // All learners with created_at for weekly/monthly grouping
    const { data: learners, error: learnersErr } = await client
      .from('learners')
      .select('created_at')
      .order('created_at')

    if (learnersErr) throw learnersErr

    // Group by week (last 12 weeks)
    const now = new Date()
    const twelveWeeksAgo = new Date(now)
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)
    const weekStart = getMonday(twelveWeeksAgo)

    const weekMap = new Map<string, number>()
    for (let i = 0; i < 12; i++) {
      const w = new Date(weekStart)
      w.setDate(w.getDate() + i * 7)
      weekMap.set(toDateStr(w), 0)
    }

    learners?.forEach(l => {
      const created = new Date(l.created_at)
      const monday = getMonday(created)
      const key = toDateStr(monday)
      if (weekMap.has(key)) {
        weekMap.set(key, (weekMap.get(key) || 0) + 1)
      }
    })

    newUsersPerWeek.value = Array.from(weekMap.entries())
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))

    // Group by month (last 6 months)
    const sixMonthsAgo = new Date(now)
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const monthMap = new Map<string, number>()
    for (let i = 0; i < 6; i++) {
      const m = new Date(now)
      m.setMonth(m.getMonth() - (5 - i))
      const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
      monthMap.set(key, 0)
    }

    learners?.forEach(l => {
      const created = new Date(l.created_at)
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
      if (monthMap.has(key)) {
        monthMap.set(key, (monthMap.get(key) || 0) + 1)
      }
    })

    newUsersPerMonth.value = Array.from(monthMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // Users per course
    const { data: enrollments, error: enrollErr } = await client
      .from('course_enrollments')
      .select('course_id')

    if (enrollErr) throw enrollErr

    const courseMap = new Map<string, number>()
    enrollments?.forEach(e => {
      courseMap.set(e.course_id, (courseMap.get(e.course_id) || 0) + 1)
    })

    usersPerCourse.value = Array.from(courseMap.entries())
      .map(([course_id, count]) => ({ course_id, count }))
      .sort((a, b) => b.count - a.count)
  }

  // --- Engagement ---

  async function fetchEngagement(): Promise<void> {
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Sessions in last 30 days
    const { data: sessions, error: sessErr } = await client
      .from('sessions')
      .select('learner_id, course_id, started_at, duration_seconds')
      .gte('started_at', thirtyDaysAgo.toISOString())

    if (sessErr) throw sessErr

    if (!sessions || sessions.length === 0) {
      totalMau.value = 0
      mauPerCourse.value = []
      avgSessionsPerUserPerWeek.value = 0
      avgSessionDurationMinutes.value = 0
      sessionsPerWeek.value = []
      return
    }

    // MAU total
    const uniqueLearners = new Set(sessions.map(s => s.learner_id))
    totalMau.value = uniqueLearners.size

    // MAU per course
    const courseLearnerMap = new Map<string, Set<string>>()
    sessions.forEach(s => {
      if (!courseLearnerMap.has(s.course_id)) {
        courseLearnerMap.set(s.course_id, new Set())
      }
      courseLearnerMap.get(s.course_id)!.add(s.learner_id)
    })

    mauPerCourse.value = Array.from(courseLearnerMap.entries())
      .map(([course_id, learners]) => ({ course_id, mau: learners.size }))
      .sort((a, b) => b.mau - a.mau)

    // Avg session duration
    const totalDuration = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0)
    avgSessionDurationMinutes.value = Math.round(totalDuration / sessions.length / 60)

    // Sessions per user per week (average over last 4 weeks)
    const fourWeeksAgo = new Date(now)
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28)
    const recentSessions = sessions.filter(s => new Date(s.started_at) >= fourWeeksAgo)
    const recentLearners = new Set(recentSessions.map(s => s.learner_id))
    avgSessionsPerUserPerWeek.value = recentLearners.size > 0
      ? Math.round((recentSessions.length / recentLearners.size / 4) * 10) / 10
      : 0

    // Sessions per week (last 12 weeks)
    const twelveWeeksAgo = new Date(now)
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)

    const { data: allRecentSessions, error: allSessErr } = await client
      .from('sessions')
      .select('started_at')
      .gte('started_at', twelveWeeksAgo.toISOString())

    if (allSessErr) throw allSessErr

    const weekSessionMap = new Map<string, number>()
    const weekStartDate = getMonday(twelveWeeksAgo)
    for (let i = 0; i < 12; i++) {
      const w = new Date(weekStartDate)
      w.setDate(w.getDate() + i * 7)
      weekSessionMap.set(toDateStr(w), 0)
    }

    allRecentSessions?.forEach(s => {
      const monday = getMonday(new Date(s.started_at))
      const key = toDateStr(monday)
      if (weekSessionMap.has(key)) {
        weekSessionMap.set(key, (weekSessionMap.get(key) || 0) + 1)
      }
    })

    sessionsPerWeek.value = Array.from(weekSessionMap.entries())
      .map(([week, count]) => ({ week, count }))
      .sort((a, b) => a.week.localeCompare(b.week))
  }

  // --- Retention ---

  async function fetchRetention(): Promise<void> {
    // Get all learners with created_at
    const { data: learners, error: learnersErr } = await client
      .from('learners')
      .select('id, created_at')

    if (learnersErr) throw learnersErr
    if (!learners || learners.length === 0) {
      retentionCohorts.value = []
      return
    }

    // Get all sessions (learner_id, started_at)
    const { data: sessions, error: sessErr } = await client
      .from('sessions')
      .select('learner_id, started_at')

    if (sessErr) throw sessErr

    // Build session lookup: learner_id -> Set of day offsets from signup
    const learnerSignup = new Map<string, Date>()
    learners.forEach(l => {
      learnerSignup.set(l.id, new Date(l.created_at))
    })

    const learnerSessionDays = new Map<string, Set<number>>()
    sessions?.forEach(s => {
      const signup = learnerSignup.get(s.learner_id)
      if (!signup) return
      const sessionDate = new Date(s.started_at)
      const dayOffset = Math.floor((sessionDate.getTime() - signup.getTime()) / (1000 * 60 * 60 * 24))
      if (dayOffset < 0) return
      if (!learnerSessionDays.has(s.learner_id)) {
        learnerSessionDays.set(s.learner_id, new Set())
      }
      learnerSessionDays.get(s.learner_id)!.add(dayOffset)
    })

    // Group learners into cohorts by signup week
    const cohortMap = new Map<string, string[]>() // weekStr -> learner_ids
    learners.forEach(l => {
      const monday = getMonday(new Date(l.created_at))
      const key = toDateStr(monday)
      if (!cohortMap.has(key)) {
        cohortMap.set(key, [])
      }
      cohortMap.get(key)!.push(l.id)
    })

    // Compute retention for each cohort
    const now = new Date()
    const retentionWindows = [
      { label: 'w1', startDay: 1, endDay: 7 },
      { label: 'w2', startDay: 8, endDay: 14 },
      { label: 'w4', startDay: 22, endDay: 28 },
      { label: 'w8', startDay: 50, endDay: 56 },
    ]

    const cohorts: RetentionCohort[] = []

    const sortedWeeks = Array.from(cohortMap.keys()).sort()
    // Only include cohorts at least 8 weeks old and last 12 cohorts
    const eightWeeksAgo = new Date(now)
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56)

    for (const week of sortedWeeks) {
      const weekDate = new Date(week)
      if (weekDate > eightWeeksAgo) continue // too recent for full retention data

      const learnerIds = cohortMap.get(week)!
      const total = learnerIds.length
      if (total === 0) continue

      const retention: Record<string, number> = {}
      for (const window of retentionWindows) {
        const retained = learnerIds.filter(id => {
          const days = learnerSessionDays.get(id)
          if (!days) return false
          for (let d = window.startDay; d <= window.endDay; d++) {
            if (days.has(d)) return true
          }
          return false
        }).length

        retention[window.label] = Math.round((retained / total) * 100)
      }

      cohorts.push({
        week,
        users: total,
        w1: retention.w1,
        w2: retention.w2,
        w4: retention.w4,
        w8: retention.w8,
      })
    }

    // Keep last 12 cohorts
    retentionCohorts.value = cohorts.slice(-12)
  }

  return {
    // State
    totalUsers,
    newUsersPerWeek,
    newUsersPerMonth,
    usersPerCourse,
    totalMau,
    mauPerCourse,
    avgSessionsPerUserPerWeek,
    avgSessionDurationMinutes,
    sessionsPerWeek,
    retentionCohorts,
    isLoading,
    error,

    // Actions
    fetchAll,
  }
}
