/**
 * populateDemoData - Directly populate singleton refs with Welsh demo data.
 *
 * Called AFTER setSchoolsClient() has been invoked (DemoLauncher handles this).
 * No Supabase queries — pure data assignment into the module-level refs
 * returned by each composable.
 */

import { isDemoMode } from './demoMode'
import { useSchoolData } from '../schools/useSchoolData'
import { useClassesData } from '../schools/useClassesData'
import { useStudentsData } from '../schools/useStudentsData'
import { useTeachersData } from '../schools/useTeachersData'
import { useAnalyticsData } from '../schools/useAnalyticsData'
import type { School } from '../schools/useSchoolData'
import type { ClassInfo } from '../schools/useClassesData'
import type { Student } from '../schools/useStudentsData'
import type { Teacher } from '../schools/useTeachersData'
import type { DailyActivity, CourseStats, ClassRanking } from '../schools/useAnalyticsData'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-0000-0000-${String(n).padStart(12, '0')}`
}

/** ISO date string for N days ago, at a random hour */
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60))
  return d.toISOString()
}

function today(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Fixed IDs (matching migration pattern)
// ---------------------------------------------------------------------------

const SCHOOL_1_ID = 'e0000000-0000-0000-0000-000000000001'
const SCHOOL_2_ID = 'e0000000-0000-0000-0000-000000000002'
const SCHOOL_3_ID = 'e0000000-0000-0000-0000-000000000003'

const CLASS_IDS = [
  'e0300000-0000-0000-0000-000000000001',
  'e0300000-0000-0000-0000-000000000002',
  'e0300000-0000-0000-0000-000000000003',
  'e0300000-0000-0000-0000-000000000004',
  'e0300000-0000-0000-0000-000000000005',
  'e0300000-0000-0000-0000-000000000006',
]

const TEACHER_IDS = [
  uuid('e0200000', 1),
  uuid('e0200000', 2),
  uuid('e0200000', 3),
  uuid('e0200000', 4),
]

// ---------------------------------------------------------------------------
// School data
// ---------------------------------------------------------------------------

const school1: School = {
  id: SCHOOL_1_ID,
  school_name: 'Ysgol Gymraeg Aberystwyth',
  region_code: 'wales',
  admin_user_id: uuid('e0900000', 1),
  teacher_join_code: 'ABER-2026',
  teacher_count: 4,
  class_count: 6,
  student_count: 20,
  total_practice_hours: 63,
  created_at: '2025-09-01T08:00:00.000Z',
}

const school2: School = {
  id: SCHOOL_2_ID,
  school_name: 'Ysgol Gyfun Gymraeg Glantaf',
  region_code: 'wales',
  admin_user_id: uuid('e0900000', 2),
  teacher_join_code: 'GLNTF-2026',
  teacher_count: 5,
  class_count: 8,
  student_count: 24,
  total_practice_hours: 82,
  created_at: '2025-09-01T08:00:00.000Z',
}

const school3: School = {
  id: SCHOOL_3_ID,
  school_name: 'Ysgol Bro Morgannwg',
  region_code: 'wales',
  admin_user_id: uuid('e0900000', 3),
  teacher_join_code: 'BROMO-2026',
  teacher_count: 3,
  class_count: 5,
  student_count: 16,
  total_practice_hours: 63,
  created_at: '2025-09-02T08:00:00.000Z',
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

const demoClasses: ClassInfo[] = [
  {
    id: CLASS_IDS[0],
    class_name: 'Blwyddyn 5 - Cymraeg',
    course_code: 'cym_s_for_eng',
    school_id: SCHOOL_1_ID,
    teacher_user_id: TEACHER_IDS[0],
    student_join_code: 'BL5CYM',
    current_seed: 55,
    last_lego_id: null,
    is_active: true,
    student_count: 10,
    avg_seeds_completed: 48,
    avg_practice_minutes: 45,
    created_at: '2025-09-05T08:00:00.000Z',
  },
  {
    id: CLASS_IDS[1],
    class_name: 'Blwyddyn 5 - Ffrangeg',
    course_code: 'fra_for_eng',
    school_id: SCHOOL_1_ID,
    teacher_user_id: TEACHER_IDS[1],
    student_join_code: 'BL5FRA',
    current_seed: 30,
    last_lego_id: null,
    is_active: true,
    student_count: 10,
    avg_seeds_completed: 26,
    avg_practice_minutes: 32,
    created_at: '2025-09-05T08:00:00.000Z',
  },
  {
    id: CLASS_IDS[2],
    class_name: 'Blwyddyn 5 - Sbaeneg',
    course_code: 'spa_for_eng',
    school_id: SCHOOL_1_ID,
    teacher_user_id: TEACHER_IDS[0],
    student_join_code: 'BL5SPA',
    current_seed: 22,
    last_lego_id: null,
    is_active: true,
    student_count: 10,
    avg_seeds_completed: 19,
    avg_practice_minutes: 25,
    created_at: '2025-09-05T08:00:00.000Z',
  },
  {
    id: CLASS_IDS[3],
    class_name: 'Blwyddyn 6 - Cymraeg',
    course_code: 'cym_s_for_eng',
    school_id: SCHOOL_1_ID,
    teacher_user_id: TEACHER_IDS[2],
    student_join_code: 'BL6CYM',
    current_seed: 95,
    last_lego_id: null,
    is_active: true,
    student_count: 10,
    avg_seeds_completed: 88,
    avg_practice_minutes: 75,
    created_at: '2025-09-05T08:00:00.000Z',
  },
  {
    id: CLASS_IDS[4],
    class_name: 'Blwyddyn 6 - Ffrangeg',
    course_code: 'fra_for_eng',
    school_id: SCHOOL_1_ID,
    teacher_user_id: TEACHER_IDS[2],
    student_join_code: 'BL6FRA',
    current_seed: 58,
    last_lego_id: null,
    is_active: true,
    student_count: 10,
    avg_seeds_completed: 52,
    avg_practice_minutes: 50,
    created_at: '2025-09-05T08:00:00.000Z',
  },
  {
    id: CLASS_IDS[5],
    class_name: 'Blwyddyn 6 - Sbaeneg',
    course_code: 'spa_for_eng',
    school_id: SCHOOL_1_ID,
    teacher_user_id: TEACHER_IDS[3],
    student_join_code: 'BL6SPA',
    current_seed: 42,
    last_lego_id: null,
    is_active: true,
    student_count: 10,
    avg_seeds_completed: 37,
    avg_practice_minutes: 38,
    created_at: '2025-09-05T08:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

interface StudentSpec {
  name: string
  seeds: number
  mins: number
  daysAgoActive: number
}

const blwyddyn5Students: StudentSpec[] = [
  { name: 'Angharad Jones',     seeds: 62,  mins: 72,  daysAgoActive: 0 },
  { name: 'Gruffydd Evans',     seeds: 55,  mins: 58,  daysAgoActive: 1 },
  { name: 'Bethan Davies',      seeds: 48,  mins: 45,  daysAgoActive: 0 },
  { name: 'Iolo Thomas',        seeds: 70,  mins: 80,  daysAgoActive: 2 },
  { name: 'Efa Roberts',        seeds: 42,  mins: 38,  daysAgoActive: 0 },
  { name: 'Macsen Hughes',      seeds: 58,  mins: 65,  daysAgoActive: 3 },
  { name: 'Gwen Lewis',         seeds: 45,  mins: 42,  daysAgoActive: 1 },
  { name: 'Osian Morgan',       seeds: 40,  mins: 30,  daysAgoActive: 8 },
  { name: 'Heledd Griffiths',   seeds: 67,  mins: 74,  daysAgoActive: 0 },
  { name: 'Rhodri Williams',    seeds: 53,  mins: 50,  daysAgoActive: 2 },
]

const blwyddyn6Students: StudentSpec[] = [
  { name: 'Llio Price',         seeds: 105, mins: 115, daysAgoActive: 0 },
  { name: 'Tomos Rees',         seeds: 92,  mins: 98,  daysAgoActive: 1 },
  { name: 'Mali Jenkins',       seeds: 88,  mins: 85,  daysAgoActive: 0 },
  { name: 'Efan Owen',          seeds: 110, mins: 120, daysAgoActive: 0 },
  { name: 'Non Phillips',       seeds: 78,  mins: 68,  daysAgoActive: 3 },
  { name: 'Harri Griffiths',    seeds: 95,  mins: 102, daysAgoActive: 1 },
  { name: 'Seren Davies',       seeds: 82,  mins: 78,  daysAgoActive: 2 },
  { name: 'Steffan Morgan',     seeds: 75,  mins: 60,  daysAgoActive: 10 },
  { name: 'Tirion Jones',       seeds: 100, mins: 108, daysAgoActive: 0 },
  { name: 'Llŷr Evans',         seeds: 98,  mins: 95,  daysAgoActive: 1 },
]

// Blwyddyn 5 students are in classes 0,1,2 (Cymraeg, Ffrangeg, Sbaeneg)
// Blwyddyn 6 students are in classes 3,4,5
// Each student appears in one class per language — we assign to the primary
// (Cymraeg) class for simplicity, but give them the matching class name.
function buildStudents(): Student[] {
  const students: Student[] = []
  let idx = 1

  // Blwyddyn 5 — primary class is Cymraeg (index 0)
  for (const s of blwyddyn5Students) {
    students.push({
      user_id: uuid('e0400000', idx),
      learner_id: uuid('e0500000', idx),
      display_name: s.name,
      class_id: CLASS_IDS[0],
      class_name: 'Blwyddyn 5 - Cymraeg',
      course_code: 'cym_s_for_eng',
      seeds_completed: s.seeds,
      legos_mastered: Math.round(s.seeds * 2.3),
      total_practice_minutes: s.mins,
      last_active_at: s.daysAgoActive === 0 ? today() : daysAgo(s.daysAgoActive),
      joined_class_at: '2025-09-10T08:00:00.000Z',
    })
    idx++
  }

  // Blwyddyn 6 — primary class is Cymraeg (index 3)
  for (const s of blwyddyn6Students) {
    students.push({
      user_id: uuid('e0400000', idx),
      learner_id: uuid('e0500000', idx),
      display_name: s.name,
      class_id: CLASS_IDS[3],
      class_name: 'Blwyddyn 6 - Cymraeg',
      course_code: 'cym_s_for_eng',
      seeds_completed: s.seeds,
      legos_mastered: Math.round(s.seeds * 2.3),
      total_practice_minutes: s.mins,
      last_active_at: s.daysAgoActive === 0 ? today() : daysAgo(s.daysAgoActive),
      joined_class_at: '2025-09-10T08:00:00.000Z',
    })
    idx++
  }

  return students
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------

const demoTeachers: Teacher[] = [
  {
    user_id: TEACHER_IDS[0],
    learner_id: uuid('e0600000', 1),
    display_name: 'Rhian Puw',
    class_count: 2,
    student_count: 20,
    total_practice_hours: 18.5,
    joined_at: '2025-08-20T08:00:00.000Z',
  },
  {
    user_id: TEACHER_IDS[1],
    learner_id: uuid('e0600000', 2),
    display_name: 'Gethin Llŷr Evans',
    class_count: 1,
    student_count: 10,
    total_practice_hours: 8.2,
    joined_at: '2025-08-22T08:00:00.000Z',
  },
  {
    user_id: TEACHER_IDS[2],
    learner_id: uuid('e0600000', 3),
    display_name: 'Megan Haf Davies',
    class_count: 2,
    student_count: 20,
    total_practice_hours: 22.1,
    joined_at: '2025-08-20T08:00:00.000Z',
  },
  {
    user_id: TEACHER_IDS[3],
    learner_id: uuid('e0600000', 4),
    display_name: 'Hywel Gruffydd',
    class_count: 1,
    student_count: 10,
    total_practice_hours: 14.3,
    joined_at: '2025-08-25T08:00:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Analytics — daily activity (last 30 days)
// ---------------------------------------------------------------------------

function buildDailyActivity(): DailyActivity[] {
  const result: DailyActivity[] = []
  const now = new Date()

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const dayOfWeek = d.getDay() // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const dateStr = d.toISOString().split('T')[0]

    // Weekdays: higher activity; weekends: lower
    const baseSessions = isWeekend ? 4 : 12
    const sessionJitter = Math.floor(Math.random() * 7) - 2
    const sessions = Math.max(2, baseSessions + sessionJitter)

    const baseMinutes = isWeekend ? 30 : 100
    const minuteJitter = Math.floor(Math.random() * 80) - 30
    const practiceMinutes = Math.max(15, baseMinutes + minuteJitter)

    const baseStudents = isWeekend ? 4 : 14
    const studentJitter = Math.floor(Math.random() * 7) - 3
    const activeStudents = Math.max(2, Math.min(20, baseStudents + studentJitter))

    result.push({
      date: dateStr,
      sessions,
      practice_minutes: practiceMinutes,
      active_students: activeStudents,
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Analytics — course stats
// ---------------------------------------------------------------------------

const demoCourseStats: CourseStats[] = [
  {
    course_code: 'cym_s_for_eng',
    enrolled_count: 20,
    avg_practice_minutes: 62,
    avg_seeds_completed: 68,
  },
  {
    course_code: 'fra_for_eng',
    enrolled_count: 20,
    avg_practice_minutes: 41,
    avg_seeds_completed: 39,
  },
  {
    course_code: 'spa_for_eng',
    enrolled_count: 20,
    avg_practice_minutes: 32,
    avg_seeds_completed: 28,
  },
]

// ---------------------------------------------------------------------------
// Analytics — class rankings (by avg seeds)
// ---------------------------------------------------------------------------

function buildClassRankings(): ClassRanking[] {
  const ranked = [...demoClasses]
    .sort((a, b) => b.avg_seeds_completed - a.avg_seeds_completed)
    .map((c, i) => ({
      class_id: c.id,
      class_name: c.class_name,
      student_count: c.student_count,
      avg_seeds: c.avg_seeds_completed,
      avg_minutes: c.avg_practice_minutes,
      rank: i + 1,
    }))
  return ranked
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function populateDemoData(demoType: 'teacher' | 'govt_admin'): void {
  // Enable demo mode — suppresses Supabase queries in all schools composables
  isDemoMode.value = true

  // Get singleton refs from each composable.
  // setSchoolsClient() must have been called before this point.
  const schoolData = useSchoolData()
  const classesData = useClassesData()
  const studentsData = useStudentsData()
  const teachersData = useTeachersData()
  const analyticsData = useAnalyticsData()

  // -- School data --
  if (demoType === 'teacher') {
    schoolData.currentSchool.value = { ...school1 }
    schoolData.schools.value = [school1]
    schoolData.regionSummary.value = null
  } else {
    // govt_admin sees all schools + region summary
    schoolData.currentSchool.value = null
    schoolData.schools.value = [school1, school2, school3]
    schoolData.regionSummary.value = {
      region_code: 'wales',
      region_name: 'Wales',
      school_count: 3,
      teacher_count: 12,
      student_count: 60,
      total_practice_hours: 208,
    }
  }

  // -- Classes --
  classesData.classes.value = demoClasses

  // -- Students --
  studentsData.students.value = buildStudents()

  // -- Teachers --
  teachersData.teachers.value = demoTeachers

  // -- Analytics --
  analyticsData.dailyActivity.value = buildDailyActivity()
  analyticsData.courseStats.value = demoCourseStats
  analyticsData.classRankings.value = buildClassRankings()
}
