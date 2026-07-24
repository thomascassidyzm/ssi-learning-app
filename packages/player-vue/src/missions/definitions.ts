/**
 * Mission registry — one well-crafted mission for now.
 *
 * "One of your students is quietly struggling. Find them."
 * Demo world: a teacher at Harbour View Primary with two classes. The Year 6
 * Spanish roster is arranged so exactly ONE student (Seren Williams) is
 * clearly drifting — seeds far below the class average while still quietly
 * turning up — which StudentsView's own deriveHealth renders as the single
 * "needs attention" dot. Completion = opening HER progress view (the
 * Students-tab "View →" deep link into /schools/analytics?scope=learner).
 */

import { isDemoMode } from '@/composables/demo/demoMode'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useStudentsData } from '@/composables/schools/useStudentsData'
import type { MissionDefinition } from './types'

const SCHOOL_ID = 'demo-mission-school'
const TEACHER_USER_ID = 'demo-mission-teacher'
const CLASS_Y6 = 'demo-mission-class-y6'
const CLASS_Y5 = 'demo-mission-class-y5'
export const MISSION_TARGET_LEARNER_ID = 'demo-mission-seren'

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
}

// Year 6 Spanish avg ≈ 21.7 seeds → needs-attention fires below ~10.9.
// Seren sits at 6, last active 3 days ago: still turning up, quietly adrift.
// Everyone else is ≥21 and recent, so she is the ONLY amber dot.
const DEMO_STUDENTS: DemoStudentSeed[] = [
  { learner_id: 'demo-mission-osian', name: 'Osian Hughes', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 24, minutes: 340, lastActiveDaysAgo: 1 },
  { learner_id: 'demo-mission-mali', name: 'Mali Roberts', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 22, minutes: 305, lastActiveDaysAgo: 2 },
  { learner_id: 'demo-mission-tomos', name: 'Tomos Evans', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 26, minutes: 380, lastActiveDaysAgo: 1 },
  { learner_id: 'demo-mission-ffion', name: 'Ffion Davies', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 28, minutes: 420, lastActiveDaysAgo: 1 },
  { learner_id: 'demo-mission-gwen', name: 'Gwen Lewis', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 21, minutes: 290, lastActiveDaysAgo: 2 },
  { learner_id: 'demo-mission-cai', name: 'Cai Morgan', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 25, minutes: 350, lastActiveDaysAgo: 1 },
  { learner_id: MISSION_TARGET_LEARNER_ID, name: 'Seren Williams', class_id: CLASS_Y6, class_name: 'Year 6 Spanish', course_code: 'spa_for_eng', seeds: 6, minutes: 45, lastActiveDaysAgo: 3 },
  { learner_id: 'demo-mission-elin', name: 'Elin Thomas', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 20, minutes: 260, lastActiveDaysAgo: 1 },
  { learner_id: 'demo-mission-rhys', name: 'Rhys Jenkins', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 19, minutes: 245, lastActiveDaysAgo: 2 },
  { learner_id: 'demo-mission-nia', name: 'Nia Price', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 17, minutes: 220, lastActiveDaysAgo: 1 },
  { learner_id: 'demo-mission-dylan', name: 'Dylan Owen', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 18, minutes: 230, lastActiveDaysAgo: 3 },
  { learner_id: 'demo-mission-cerys', name: 'Cerys Griffiths', class_id: CLASS_Y5, class_name: 'Year 5 French', course_code: 'fra_for_eng', seeds: 16, minutes: 200, lastActiveDaysAgo: 2 },
]

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

  const { students } = useStudentsData()
  students.value = DEMO_STUDENTS.map(s => ({
    user_id: `${s.learner_id}-user`,
    learner_id: s.learner_id,
    display_name: s.name,
    class_id: s.class_id,
    class_name: s.class_name,
    course_code: s.course_code,
    seeds_completed: s.seeds,
    // StudentsView's journey bar renders against a fixed 60-LEGO span —
    // seeds*2 keeps every demo student inside it.
    legos_mastered: s.seeds * 2,
    total_practice_minutes: s.minutes,
    last_active_at: daysAgo(s.lastActiveDaysAgo),
    joined_class_at: daysAgo(80),
  }))

  const y6 = DEMO_STUDENTS.filter(s => s.class_id === CLASS_Y6)
  const y5 = DEMO_STUDENTS.filter(s => s.class_id === CLASS_Y5)
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
    startRoute: '/schools',
    completion: {
      path: '/schools/analytics',
      query: { scope: 'learner', learner: MISSION_TARGET_LEARNER_ID },
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
