/**
 * useAnalyticsData - Aggregated metrics for analytics views
 *
 * Provides analytics data for school admin and govt admin views.
 */

import { ref, computed } from 'vue'
import { getClient } from './useSupabase'
import { useGodMode } from './useGodMode'

export interface DailyActivity {
  date: string
  sessions: number
  practice_minutes: number
  active_students: number
}

export interface CourseStats {
  course_code: string
  enrolled_count: number
  avg_practice_minutes: number
  avg_seeds_completed: number
}

export interface SchoolReport {
  classes: Array<{
    class_id: string
    class_name: string
    course_code: string
    total_cycles: number
    avg_cycles_per_session: number
    active_students: number
  }>
  schoolTotal: number
  schoolAvgPerClass: number
  regionAvg: { avg_total_cycles: number; avg_cycles_per_session: number; class_count: number } | null
}

export interface RegionReport {
  schools: Array<{
    school_id: string
    school_name: string
    total_cycles: number
    class_count: number
    active_students: number
  }>
  regionTotal: number
  allRegionsAvg: { avg_total_cycles: number; class_count: number } | null
}

export interface ClassRanking {
  class_id: string
  class_name: string
  student_count: number
  avg_seeds: number
  avg_minutes: number
  rank: number
}

const dailyActivity = ref<DailyActivity[]>([])
const courseStats = ref<CourseStats[]>([])
const classRankings = ref<ClassRanking[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)

export function useAnalyticsData() {
  const client = getClient()
  const { selectedUser, isSchoolAdmin, isGovtAdmin } = useGodMode()

  // Fetch daily activity for last 30 days
  async function fetchDailyActivity(): Promise<void> {
    if (!selectedUser.value) return

    isLoading.value = true
    error.value = null

    try {
      // Get class IDs for the scope (school or region)
      let classIds: string[] = []

      if (isSchoolAdmin.value && selectedUser.value.school_id) {
        const { data: classesData } = await client
          .from('classes')
          .select('id')
          .eq('school_id', selectedUser.value.school_id)
          .eq('is_active', true)

        classIds = (classesData || []).map(c => c.id)
      } else if (isGovtAdmin.value && selectedUser.value.region_code) {
        const { data: schoolsData } = await client
          .from('schools')
          .select('id')
          .eq('region_code', selectedUser.value.region_code)

        const schoolIds = (schoolsData || []).map(s => s.id)

        if (schoolIds.length > 0) {
          const { data: classesData } = await client
            .from('classes')
            .select('id')
            .in('school_id', schoolIds)
            .eq('is_active', true)

          classIds = (classesData || []).map(c => c.id)
        }
      }

      if (classIds.length === 0) {
        dailyActivity.value = []
        return
      }

      // Get learner IDs for these classes
      const { data: tagsData } = await client
        .from('user_tags')
        .select('user_id')
        .in('tag_value', classIds.map(id => `CLASS:${id}`))
        .eq('tag_type', 'class')
        .eq('role_in_context', 'student')
        .is('removed_at', null)

      const studentUserIds = [...new Set((tagsData || []).map(t => t.user_id))]

      if (studentUserIds.length === 0) {
        dailyActivity.value = []
        return
      }

      // Get learner IDs
      const { data: learnersData } = await client
        .from('learners')
        .select('id')
        .in('user_id', studentUserIds)

      const learnerIds = (learnersData || []).map(l => l.id)

      // Fetch sessions from last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: sessionsData, error: sessionsError } = await client
        .from('sessions')
        .select('learner_id, started_at, duration_seconds')
        .in('learner_id', learnerIds)
        .gte('started_at', thirtyDaysAgo.toISOString())
        .order('started_at')

      if (sessionsError) throw sessionsError

      // Aggregate by day
      const dayMap = new Map<string, { sessions: number; minutes: number; students: Set<string> }>()

      sessionsData?.forEach(s => {
        const date = s.started_at.split('T')[0]
        const existing = dayMap.get(date) || { sessions: 0, minutes: 0, students: new Set() }
        existing.sessions++
        existing.minutes += (s.duration_seconds || 0) / 60
        existing.students.add(s.learner_id)
        dayMap.set(date, existing)
      })

      // Convert to array, fill in missing days
      const result: DailyActivity[] = []
      const today = new Date()

      for (let i = 29; i >= 0; i--) {
        const date = new Date(today)
        date.setDate(date.getDate() - i)
        const dateStr = date.toISOString().split('T')[0]
        const stats = dayMap.get(dateStr)

        result.push({
          date: dateStr,
          sessions: stats?.sessions || 0,
          practice_minutes: Math.round(stats?.minutes || 0),
          active_students: stats?.students.size || 0,
        })
      }

      dailyActivity.value = result
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to fetch analytics'
      console.error('Analytics fetch error:', err)
    } finally {
      isLoading.value = false
    }
  }

  // Fetch course enrollment stats
  async function fetchCourseStats(): Promise<void> {
    if (!selectedUser.value) return

    try {
      // Get learner IDs in scope
      let learnerIds: string[] = []

      if (isSchoolAdmin.value && selectedUser.value.school_id) {
        const { data: classesData } = await client
          .from('classes')
          .select('id')
          .eq('school_id', selectedUser.value.school_id)
          .eq('is_active', true)

        const classIds = (classesData || []).map(c => c.id)

        const { data: tagsData } = await client
          .from('user_tags')
          .select('user_id')
          .in('tag_value', classIds.map(id => `CLASS:${id}`))
          .eq('tag_type', 'class')
          .eq('role_in_context', 'student')
          .is('removed_at', null)

        const userIds = [...new Set((tagsData || []).map(t => t.user_id))]

        const { data: learnersData } = await client
          .from('learners')
          .select('id')
          .in('user_id', userIds)

        learnerIds = (learnersData || []).map(l => l.id)
      }

      if (learnerIds.length === 0) {
        courseStats.value = []
        return
      }

      // Get course enrollments
      const { data: enrollmentsData, error: enrollError } = await client
        .from('course_enrollments')
        .select('course_id, total_practice_minutes, learner_id')
        .in('learner_id', learnerIds)

      if (enrollError) throw enrollError

      // Get seed counts per learner/course
      const { data: seedsData } = await client
        .from('seed_progress')
        .select('learner_id, course_id')
        .in('learner_id', learnerIds)
        .eq('is_introduced', true)

      // Aggregate by course
      const courseMap = new Map<string, { count: number; totalMinutes: number; totalSeeds: number }>()

      enrollmentsData?.forEach(e => {
        const existing = courseMap.get(e.course_id) || { count: 0, totalMinutes: 0, totalSeeds: 0 }
        existing.count++
        existing.totalMinutes += e.total_practice_minutes || 0
        courseMap.set(e.course_id, existing)
      })

      // Count seeds per course
      const seedCountMap = new Map<string, Map<string, number>>() // course -> learner -> count
      seedsData?.forEach(s => {
        const courseSeeds = seedCountMap.get(s.course_id) || new Map()
        const count = courseSeeds.get(s.learner_id) || 0
        courseSeeds.set(s.learner_id, count + 1)
        seedCountMap.set(s.course_id, courseSeeds)
      })

      courseStats.value = Array.from(courseMap.entries()).map(([course_code, stats]) => {
        const seedCounts = seedCountMap.get(course_code)
        const totalSeeds = seedCounts ? Array.from(seedCounts.values()).reduce((a, b) => a + b, 0) : 0

        return {
          course_code,
          enrolled_count: stats.count,
          avg_practice_minutes: stats.count > 0 ? Math.round(stats.totalMinutes / stats.count) : 0,
          avg_seeds_completed: stats.count > 0 ? Math.round(totalSeeds / stats.count) : 0,
        }
      }).sort((a, b) => b.enrolled_count - a.enrolled_count)
    } catch (err) {
      console.error('Course stats fetch error:', err)
    }
  }

  // Fetch class rankings
  async function fetchClassRankings(): Promise<void> {
    if (!selectedUser.value || !selectedUser.value.school_id) return

    try {
      const { data: progressData, error: progressError } = await client
        .from('class_student_progress')
        .select('class_id, class_name, seeds_completed, total_practice_seconds')
        .eq('school_id', selectedUser.value.school_id)

      if (progressError) throw progressError

      // Aggregate by class
      const classMap = new Map<string, { name: string; students: number; totalSeeds: number; totalMinutes: number }>()

      progressData?.forEach(p => {
        const existing = classMap.get(p.class_id) || { name: p.class_name, students: 0, totalSeeds: 0, totalMinutes: 0 }
        existing.students++
        existing.totalSeeds += p.seeds_completed
        existing.totalMinutes += (p.total_practice_seconds || 0) / 60
        classMap.set(p.class_id, existing)
      })

      const rankings = Array.from(classMap.entries())
        .map(([class_id, stats]) => ({
          class_id,
          class_name: stats.name,
          student_count: stats.students,
          avg_seeds: stats.students > 0 ? Math.round(stats.totalSeeds / stats.students) : 0,
          avg_minutes: stats.students > 0 ? Math.round(stats.totalMinutes / stats.students) : 0,
          rank: 0,
        }))
        .sort((a, b) => b.avg_seeds - a.avg_seeds)
        .map((item, index) => ({ ...item, rank: index + 1 }))

      classRankings.value = rankings
    } catch (err) {
      console.error('Class rankings fetch error:', err)
    }
  }

  // Computed totals
  const totalSessions = computed(() =>
    dailyActivity.value.reduce((sum, d) => sum + d.sessions, 0)
  )

  const totalPracticeMinutes = computed(() =>
    dailyActivity.value.reduce((sum, d) => sum + d.practice_minutes, 0)
  )

  const avgDailyActive = computed(() => {
    const activeDays = dailyActivity.value.filter(d => d.active_students > 0)
    if (activeDays.length === 0) return 0
    return Math.round(activeDays.reduce((sum, d) => sum + d.active_students, 0) / activeDays.length)
  })

  // Fetch school report: all classes + regional comparison
  async function getSchoolReport(schoolId: string): Promise<SchoolReport | null> {
    try {
      const { data: classesData, error: classesError } = await client
        .from('class_activity_stats')
        .select('class_id, class_name, course_code, total_cycles, avg_cycles_per_session, active_students, school_id, region_code')
        .eq('school_id', schoolId)

      if (classesError || !classesData) return null

      const schoolTotal = classesData.reduce((sum, c) => sum + (c.total_cycles || 0), 0)
      const schoolAvgPerClass = classesData.length > 0 ? Math.round(schoolTotal / classesData.length) : 0

      // Get regional average for comparison
      const regionCode = classesData[0]?.region_code
      let regionAvg = null
      if (regionCode) {
        const { data: demographics } = await client
          .from('demographic_cycle_averages')
          .select('*')
          .eq('level', 'region')
          .eq('group_id', regionCode)
          .single()

        if (demographics) {
          regionAvg = {
            avg_total_cycles: demographics.avg_total_cycles,
            avg_cycles_per_session: demographics.avg_cycles_per_session,
            class_count: demographics.class_count,
          }
        }
      }

      return {
        classes: classesData.map(c => ({
          class_id: c.class_id,
          class_name: c.class_name,
          course_code: c.course_code,
          total_cycles: c.total_cycles || 0,
          avg_cycles_per_session: c.avg_cycles_per_session || 0,
          active_students: c.active_students || 0,
        })),
        schoolTotal,
        schoolAvgPerClass,
        regionAvg,
      }
    } catch (err) {
      console.error('School report fetch error:', err)
      return null
    }
  }

  // Fetch region report: all schools aggregated
  async function getRegionReport(regionCode: string): Promise<RegionReport | null> {
    try {
      // Get all classes in the region, grouped by school
      const { data: classesData, error: classesError } = await client
        .from('class_activity_stats')
        .select('class_id, class_name, school_id, total_cycles, active_students')
        .eq('region_code', regionCode)

      if (classesError || !classesData) return null

      // Get school names
      const schoolIds = [...new Set(classesData.map(c => c.school_id))]
      const { data: schoolsData } = await client
        .from('schools')
        .select('id, school_name')
        .in('id', schoolIds)

      const schoolNameMap = new Map(schoolsData?.map(s => [s.id, s.school_name]) || [])

      // Aggregate by school
      const schoolMap = new Map<string, { total_cycles: number; class_count: number; active_students: number }>()
      classesData.forEach(c => {
        const existing = schoolMap.get(c.school_id) || { total_cycles: 0, class_count: 0, active_students: 0 }
        existing.total_cycles += c.total_cycles || 0
        existing.class_count++
        existing.active_students += c.active_students || 0
        schoolMap.set(c.school_id, existing)
      })

      const schools = Array.from(schoolMap.entries()).map(([school_id, stats]) => ({
        school_id,
        school_name: schoolNameMap.get(school_id) || 'Unknown',
        total_cycles: stats.total_cycles,
        class_count: stats.class_count,
        active_students: stats.active_students,
      }))

      const regionTotal = schools.reduce((sum, s) => sum + s.total_cycles, 0)

      // Get course-level average as "all regions" comparison
      const { data: courseAvg } = await client
        .from('demographic_cycle_averages')
        .select('*')
        .eq('level', 'course')
        .limit(1)
        .single()

      return {
        schools,
        regionTotal,
        allRegionsAvg: courseAvg ? { avg_total_cycles: courseAvg.avg_total_cycles, class_count: courseAvg.class_count } : null,
      }
    } catch (err) {
      console.error('Region report fetch error:', err)
      return null
    }
  }

  return {
    // State
    dailyActivity,
    courseStats,
    classRankings,
    isLoading,
    error,

    // Computed
    totalSessions,
    totalPracticeMinutes,
    avgDailyActive,

    // Actions
    fetchDailyActivity,
    fetchCourseStats,
    fetchClassRankings,
    getSchoolReport,
    getRegionReport,
  }
}
