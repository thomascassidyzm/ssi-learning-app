/**
 * Mission registry — one well-crafted mission for now.
 *
 * "One of your students is quietly struggling. Find them."
 * Demo world: a teacher at Harbour View Primary with two classes, rendered
 * entirely on THE VIEW's canon node surface (/org/:id — NodeHomeView,
 * map rail, class cards, flat student rows). The Year 6 Spanish roster is
 * arranged so exactly ONE student (Seren Williams) is clearly drifting —
 * LEGOs far below the class average while still quietly turning up — which
 * the node home's own health rule renders as the single "needs attention"
 * row (and the lone white belt in the distribution). Completion = opening
 * HER row (the student rows carry mission-supplied links; the engine watches
 * the route).
 *
 * The canon views are server-backed, so setup() installs a mission-scoped
 * fetch interceptor (demoOrgApi.ts) serving /api/groups/:id/home and
 * rate-compare in the server's exact shapes for the demo node ids.
 */

import { isDemoMode } from '@/composables/demo/demoMode'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useStudentsData } from '@/composables/schools/useStudentsData'
import { installMissionOrgApi } from './demoOrgApi'
import type { MissionDefinition } from './types'

const SCHOOL_ID = 'demo-mission-school'
const TEACHER_USER_ID = 'demo-mission-teacher'
const CLASS_Y6 = 'demo-mission-class-y6'
const CLASS_Y5 = 'demo-mission-class-y5'
export const MISSION_TARGET_LEARNER_ID = 'demo-mission-seren'
export const MISSION_CLASS_HOME = `/org/${CLASS_Y6}`

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

interface DemoStudentSeed {
  learner_id: string
  name: string
  class_id: string
  class_name: string
  course_code: string
  seeds: number
  minutes: number
  lastActiveDaysAgo: number
  /** Last-7-days practice minutes, oldest → newest (the row sparkline). */
  last7: number[]
}

// Year 6 Spanish avg ≈ 21.7 seeds → needs-attention fires below ~10.9.
// Seren sits at 6, last active 3 days ago: still turning up, quietly adrift.
// Everyone else is ≥21 and recent, so she is the ONLY amber row — and the
// lone white belt in the class's belt distribution.
const DEMO_STUDENTS: DemoStudentSeed[] = [
  { learner_id: 'demo-mission-osian', name: 'Osian Hughes', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 24, minutes: 340, lastActiveDaysAgo: 1, last7: [12, 18, 0, 25, 15, 20, 10] },
  { learner_id: 'demo-mission-mali', name: 'Mali Roberts', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 22, minutes: 305, lastActiveDaysAgo: 2, last7: [15, 0, 20, 10, 18, 12, 0] },
  { learner_id: 'demo-mission-tomos', name: 'Tomos Evans', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 26, minutes: 380, lastActiveDaysAgo: 1, last7: [20, 15, 18, 0, 22, 16, 14] },
  { learner_id: 'demo-mission-ffion', name: 'Ffion Davies', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 28, minutes: 420, lastActiveDaysAgo: 1, last7: [18, 22, 15, 20, 0, 25, 19] },
  { learner_id: 'demo-mission-gwen', name: 'Gwen Lewis', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 21, minutes: 290, lastActiveDaysAgo: 2, last7: [10, 14, 0, 16, 12, 15, 0] },
  { learner_id: 'demo-mission-cai', name: 'Cai Morgan', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 25, minutes: 350, lastActiveDaysAgo: 1, last7: [16, 20, 12, 18, 14, 0, 21] },
  { learner_id: MISSION_TARGET_LEARNER_ID, name: 'Seren Williams', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 6, minutes: 45, lastActiveDaysAgo: 3, last7: [0, 0, 4, 0, 3, 0, 2] },
  { learner_id: 'demo-mission-elin', name: 'Elin Thomas', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 20, minutes: 260, lastActiveDaysAgo: 1, last7: [14, 0, 18, 12, 15, 10, 16] },
  { learner_id: 'demo-mission-rhys', name: 'Rhys Jenkins', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 19, minutes: 245, lastActiveDaysAgo: 2, last7: [12, 15, 0, 14, 10, 16, 0] },
  { learner_id: 'demo-mission-nia', name: 'Nia Price', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 17, minutes: 220, lastActiveDaysAgo: 1, last7: [10, 12, 14, 0, 15, 11, 13] },
  { learner_id: 'demo-mission-dylan', name: 'Dylan Owen', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 18, minutes: 230, lastActiveDaysAgo: 3, last7: [15, 10, 12, 16, 0, 0, 11] },
  { learner_id: 'demo-mission-cerys', name: 'Cerys Griffiths', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 16, minutes: 200, lastActiveDaysAgo: 2, last7: [11, 13, 0, 12, 14, 10, 0] },
]

// ─── Canon node-surface payloads (/api/groups/:id/home shapes) ───

const SCHOOL_REF = { id: SCHOOL_ID, name: 'Harbour View Primary', label: null, is_demo: true, hasSchool: true }
const TEACHERS = [{ user_id: TEACHER_USER_ID, name: 'Eleri Vaughan', is_lead: true }]

/** The server's class-home student row (+ the mission's row link). */
function homeStudents(classId: string) {
  return DEMO_STUDENTS.filter((s) => s.class_id === classId)
    .map((s) => ({
      learner_id: s.learner_id,
      name: s.name,
      seeds_completed: s.seeds,
      // The journey bar runs in LEGOs against the class journey total below.
      legos_mastered: s.seeds * 2,
      practice_hours: Math.round((s.minutes / 60) * 10) / 10,
      last_active_at: daysAgo(s.lastActiveDaysAgo),
      joined_class_at: daysAgo(80),
      last7_minutes: s.last7,
      week_minutes: s.last7.reduce((a, b) => a + b, 0),
      // Mission-only: the row opens this student (NodeChildrenList honours a
      // row-supplied link; the real server never sends one). Completion
      // watches for the target's link arriving in the route.
      to: `/org/${classId}?student=${s.learner_id}`,
    }))
    .sort((a, b) => b.practice_hours - a.practice_hours)
}

function classHome(classId: string, name: string, courseCode: string, extras: {
  journey: Record<string, unknown>
  classPractice: Record<string, unknown>
  benchmark: Record<string, number>
  practiceHours: number
}) {
  const students = homeStudents(classId)
  return {
    kind: 'class',
    node: {
      id: classId,
      name,
      label: 'class',
      is_demo: true,
      course_code: courseCode,
      rollup: { childGroupCount: 0, teacherCount: 1, classCount: 1, learnerCount: students.length },
      commercial: null,
    },
    ancestors: [SCHOOL_REF],
    siblings: [],
    children: [],
    teachers: TEACHERS,
    students,
    journey: extras.journey,
    benchmark: extras.benchmark,
    classPractice: extras.classPractice,
    practiceHours: extras.practiceHours,
    schoolId: SCHOOL_ID,
    nodeId: SCHOOL_ID,
  }
}

function buildOrgWorld() {
  const classesLens = [
    {
      id: CLASS_Y6, name: 'Year 6 Spanish', home: 'Harbour View Primary', teachers: ['Eleri Vaughan'],
      studentCount: 7, practiceHours: 35.5, classPracticeHours: 8.5, lastClassSessionAt: daysAgo(1),
    },
    {
      id: CLASS_Y5, name: 'Year 5 French', home: 'Harbour View Primary', teachers: ['Eleri Vaughan'],
      studentCount: 5, practiceHours: 19.3, classPracticeHours: 5.2, lastClassSessionAt: daysAgo(2),
    },
  ]

  const homes: Record<string, Record<string, unknown>> = {
    [SCHOOL_ID]: {
      kind: 'node',
      node: {
        ...SCHOOL_REF,
        rollup: { childGroupCount: 0, teacherCount: 1, classCount: 2, learnerCount: 12 },
        commercial: null,
      },
      ancestors: [],
      siblings: [],
      children: [],
      practiceHours: 54.8,
      classPractice: { hours: 13.7, sessions7d: 5, activeClasses7d: 2, classCount: 2 },
      classes: classesLens,
      teachers: [{ user_id: TEACHER_USER_ID, name: 'Eleri Vaughan', classes: classesLens.map((c) => ({ id: c.id, name: c.name, home: c.home })) }],
      groups: [],
      schools: [],
    },
    [CLASS_Y6]: classHome(CLASS_Y6, 'Year 6 Spanish', 'spa_for_eng', {
      // The class has played together to seed 22 — orange belt, 18 to green.
      journey: { done: 44, total: 60, source: 'class-play', legoId: 'S0022L02', seedNumber: 22 },
      classPractice: { weekSessions: 3, sessions28d: 11, totalSessions: 34, lastSessionAt: daysAgo(1), hours: 8.5 },
      benchmark: { class: 38, school: 34, course: 31 },
      practiceHours: 35.5,
    }),
    [CLASS_Y5]: classHome(CLASS_Y5, 'Year 5 French', 'fra_for_eng', {
      journey: { done: 18, total: 60, source: 'estimate', legoId: null, seedNumber: null },
      classPractice: { weekSessions: 2, sessions28d: 8, totalSessions: 21, lastSessionAt: daysAgo(2), hours: 5.2 },
      benchmark: { class: 33, school: 34, course: 31 },
      practiceHours: 19.3,
    }),
  }

  // THE LENS ("See insights") stays honest: two classes is below the k-floor,
  // so rate-compare reports insufficient data — never a fabricated number.
  const rateCompare = (nodeId: string, name: string, kind: 'node' | 'class', courseCode: string) => ({
    node: { id: nodeId, name, label: kind === 'class' ? 'class' : 'school', kind },
    options: {
      courses: [{ code: courseCode, classCount: 1, hasData: true }],
      compares: [{ value: SCHOOL_ID, label: 'Harbour View Primary average', word: 'school' }],
      windows: [
        { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 days' },
        { value: '30d', label: 'Last 30 days' }, { value: 'all', label: 'All time' },
      ],
      measures: [
        { value: 'rate', label: 'Rate of progress', desc: 'How fast new LEGOs are being learned, per week.' },
        { value: 'minutes_per_class', label: 'Practice minutes per class', desc: 'How many minutes each class practises, per week on average.' },
        { value: 'hours_total', label: 'Practice hours', desc: 'Total hours of practice in the selected period.' },
      ],
    },
    applied: { course_code: courseCode, compare_to: SCHOOL_ID, days: 30, window: '30d', measure: 'rate' },
    windowLabel: 'Last 30 days',
    trendLabel: 'Daily · last 30 days',
    trendPeriodDays: 1,
    kFloor: 5,
    insufficientData: true,
    cohortSize: 2,
    reason: 'Only 2 classes at Harbour View Primary — not enough to compare fairly yet.',
  })

  return {
    homes,
    rateCompares: {
      [SCHOOL_ID]: rateCompare(SCHOOL_ID, 'Harbour View Primary', 'node', 'spa_for_eng'),
      [CLASS_Y6]: rateCompare(CLASS_Y6, 'Year 6 Spanish', 'class', 'spa_for_eng'),
      [CLASS_Y5]: rateCompare(CLASS_Y5, 'Year 5 French', 'class', 'fra_for_eng'),
    },
  }
}

function setupFindStrugglingStudent(): void {
  isDemoMode.value = true

  const ctx = useSchoolContext()
  ctx.currentUser.value = {
    user_id: TEACHER_USER_ID,
    learner_id: 'demo-mission-teacher-learner',
    display_name: 'Eleri Vaughan',
    educational_role: 'teacher',
    platform_role: null,
    school_id: SCHOOL_ID,
    school_name: 'Harbour View Primary',
    class_ids: [CLASS_Y6, CLASS_Y5],
    _scopeSource: 'demo',
  }

  // The canon node surface reads the org API — serve it in-memory.
  installMissionOrgApi(buildOrgWorld())

  // The legacy composables stay primed so the shell's other doors (Students,
  // Classes tabs) still show the same coherent world if the user wanders.
  const { students } = useStudentsData()
  students.value = DEMO_STUDENTS.map((s) => ({
    user_id: `${s.learner_id}-user`,
    learner_id: s.learner_id,
    display_name: s.name,
    class_id: s.class_id,
    class_name: s.class_name,
    course_code: s.course_code,
    seeds_completed: s.seeds,
    legos_mastered: s.seeds * 2,
    total_practice_minutes: s.minutes,
    last_active_at: daysAgo(s.lastActiveDaysAgo),
    joined_class_at: daysAgo(80),
  }))

  const y6 = DEMO_STUDENTS.filter((s) => s.class_id === CLASS_Y6)
  const y5 = DEMO_STUDENTS.filter((s) => s.class_id === CLASS_Y5)
  const avg = (rows: DemoStudentSeed[]) =>
    Math.round(rows.reduce((sum, s) => sum + s.seeds, 0) / Math.max(1, rows.length))

  const { classes } = useClassesData()
  classes.value = [
    {
      id: CLASS_Y6,
      class_name: 'Year 6 Spanish',
      course_code: 'spa_for_eng',
      school_id: SCHOOL_ID,
      teacher_user_id: TEACHER_USER_ID,
      student_join_code: 'DEMO-Y6',
      current_seed: avg(y6),
      last_lego_id: null,
      class_learner_id: null,
      is_active: true,
      student_count: y6.length,
      avg_seeds_completed: avg(y6),
      avg_practice_minutes: 45,
      created_at: daysAgo(90),
      activity_last_7: [3, 4, 2, 5, 3, 4, 2],
    },
    {
      id: CLASS_Y5,
      class_name: 'Year 5 French',
      course_code: 'fra_for_eng',
      school_id: SCHOOL_ID,
      teacher_user_id: TEACHER_USER_ID,
      student_join_code: 'DEMO-Y5',
      current_seed: avg(y5),
      last_lego_id: null,
      class_learner_id: null,
      is_active: true,
      student_count: y5.length,
      avg_seeds_completed: avg(y5),
      avg_practice_minutes: 40,
      created_at: daysAgo(90),
      activity_last_7: [2, 3, 3, 2, 4, 3, 3],
    },
  ]
}

export const MISSIONS: MissionDefinition[] = [
  {
    id: 'find-struggling-student',
    title: 'A teacher’s eye',
    brief: 'One of your students is quietly struggling — no red flags, no fuss. Have a look around; something in these classes needs a teacher’s eye.',
    // The canon school node home, classes lens up — THE VIEW, not the legacy
    // dashboard (owner styling ruling 2026-07-24).
    startRoute: `/org/${SCHOOL_ID}?lens=classes`,
    completion: {
      path: MISSION_CLASS_HOME,
      query: { student: MISSION_TARGET_LEARNER_ID },
    },
    nudge: {
      afterMs: 45000,
      text: 'Averages are good at hiding people. Somewhere there’s a view that shows every student, one line each.',
    },
    closing: {
      note: 'That’s the one. Nothing dramatic — a student slipping quietly while the class average looks fine. You noticed. That’s the whole skill.',
      link: { label: 'How we listen', href: '/methodology/how-we-listen.html' },
    },
    setup: setupFindStrugglingStudent,
  },
]

export function missionById(id: string): MissionDefinition | null {
  return MISSIONS.find(m => m.id === id) ?? null
}
