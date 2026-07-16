/**
 * demoSchoolGen — provisioning engine behind /admin/demo-schools
 * (api/admin/demo-schools.ts). Generalises scripts/demo-data/generate-ime-demo.cjs
 * (the founder's ruling: "creating an actual account for them is much better
 * than a demo") into a parameterised, HTTP-callable module: real Supabase auth
 * accounts for staff, real schools/groups/classes rows (is_demo + is_test —
 * excluded from every board/admin aggregate by test_learner_ids()), and
 * realistic seeded learner activity so every dashboard tab looks alive.
 *
 * Reuses the SAME primitives as the real onboarding paths rather than
 * reinventing them: ensureClassLearnerEntity (owner ruling 2026-07-16, every
 * class-creation path must call it), ensureJoinCodesRegistered
 * (api/_utils/schoolJoinCodes.ts — the same helper api/onboarding/provision.ts
 * and api/admin/create-school.ts use). teacher_join_code / admin_join_code /
 * student_join_code are DB-trigger-generated (set_school_join_code /
 * set_class_join_code) — never hand-rolled here.
 *
 * Bulk inserts (seed_progress/lego_progress/sessions) are accumulated at the
 * ORG level and flushed in large chunks, not per-student — keeps the request
 * count (and wall-clock, this runs in one Vercel function call) low even at
 * the biggest org shape.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { ensureClassLearnerEntity } from './classLearnerEntity'
import { ensureJoinCodesRegistered } from './schoolJoinCodes'

export type OrgShape = 'single_school' | 'group' | 'government_region'

export interface DemoOrgSpec {
  prospectName: string
  orgShape: OrgShape
  courseCode: string
  numSchools?: number
  teachersPerSchool?: number
  classesPerSchool?: number
  learnersPerSchool?: number
  createdBy: string
}

export interface StaffCredential {
  role: 'govt_admin' | 'school_admin' | 'teacher'
  name: string
  email: string
  learnerId: string
  password: string
  schoolName?: string
}

export interface DemoOrgResult {
  demoOrgId: string
  orgName: string
  orgShape: OrgShape
  courseCode: string
  groupId: string | null
  schoolIds: string[]
  staff: StaffCredential[]
  counts: { schools: number; teachers: number; classes: number; learners: number }
  expiresAt: string
}

// ---------- seeded-ish PRNG (Math.random is fine here — this is sales
// showcase data, not test fixtures that need reproducibility) ----------
const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const between = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))
const DAY = 86400000

// Weekday-clustered timestamp (~85% land Mon-Fri) — real classroom/practice
// activity isn't uniform across the week; a demo that IS uniform reads as
// synthetic at a glance.
function weekdayTimestamp(startMs: number, endMs: number): Date {
  for (let attempt = 0; attempt < 8; attempt++) {
    const t = startMs + Math.random() * (endMs - startMs)
    const day = new Date(t).getDay() // 0=Sun..6=Sat
    if (day !== 0 && day !== 6) return new Date(t)
    if (Math.random() < 0.15) return new Date(t) // let a minority land on weekends anyway
  }
  return new Date(startMs + Math.random() * (endMs - startMs))
}

function generatePassword(): string {
  // 12 url-safe chars — shown once in the create response, never persisted.
  return randomBytes(9).toString('base64').replace(/\+/g, 'A').replace(/\//g, 'b').replace(/=+$/, '')
}

const STAFF_FIRST = ['Emma', 'Oliver', 'Sophie', 'Jack', 'Amelia', 'Harry', 'Isla', 'George', 'Freya', 'Charlie',
  'Grace', 'Thomas', 'Ruby', 'James', 'Chloe', 'William', 'Lily', 'Daniel', 'Ella', 'Joshua',
  'Priya', 'Mohammed', 'Aisha', 'Liam', 'Fatima', 'Ryan', 'Zara', 'Connor', 'Nadia', 'Sean']
const STAFF_LAST = ['Taylor', 'Clarke', 'Robinson', 'Walsh', 'Murphy', 'Bennett', 'Cole', 'Hughes', 'Reid', 'Marsh',
  'Osei', 'Patel', 'Khan', 'Novak', 'Byrne', 'Fitzgerald', 'Whitfield', 'Doyle', 'Adeyemi', 'Larsen']
const STUDENT_FIRST = ['Ava', 'Noah', 'Mia', 'Leo', 'Poppy', 'Freddie', 'Evie', 'Alfie', 'Ivy', 'Arthur',
  'Rosie', 'Oscar', 'Willow', 'Theo', 'Daisy', 'Archie', 'Phoebe', 'Finn', 'Nora', 'Max',
  'Aaliyah', 'Zayn', 'Layla', 'Ibrahim', 'Amara', 'Kai', 'Sana', 'Reuben', 'Yasmin', 'Elijah',
  'Millie', 'Jaxon', 'Esme', 'Toby', 'Maya', 'Louis', 'Sienna', 'Felix', 'Anya', 'Hugo']
const STUDENT_LAST = ['Brown', 'Wilson', 'Evans', 'Turner', 'Parker', 'Collins', 'Stewart', 'Morgan', 'Bell', 'Fraser',
  'Ahmed', 'Hussain', 'Chan', 'Wong', 'Singh', 'O’Brien', 'Kelly', 'Barnes', 'Pearce', 'Dixon']
const SCHOOL_PREFIX = ['Riverside', 'Kingsley', 'Elmwood', 'Oakfield', 'Meadowbrook', 'Silverdale', 'Brookfield',
  'Ashcombe', 'Fairview', 'Hillcrest', 'Greenwood', 'Sherbourne', 'Ledbury', 'Northgate', 'Priorswood']
const SCHOOL_SUFFIX = ['Academy', 'Primary School', 'High School', 'College', 'Community School']

function randomSchoolName(): string {
  return `${pick(SCHOOL_PREFIX)} ${pick(SCHOOL_SUFFIX)}`
}

function randomClassName(): string {
  const year = between(3, 11)
  if (year <= 6) return `Year ${year}`
  return `${year}${pick(['A', 'B', 'C'])}`
}

// ~20% high engagement / 50% mid / 30% low — same shape as the IME script,
// kept because it reads as human: some keen learners, some laggards.
function studentStage(classSeed: number) {
  const r = Math.random()
  if (r < 0.20) return { seeds: between(Math.max(classSeed, 6), classSeed + 12), sessions: between(10, 20), recencyDays: between(0, 3) }
  if (r < 0.70) return { seeds: between(Math.max(3, classSeed - 5), classSeed + 2), sessions: between(4, 10), recencyDays: between(2, 10) }
  return { seeds: between(1, Math.max(2, Math.floor(classSeed / 2))), sessions: between(1, 4), recencyDays: between(10, 25) }
}

async function ensureAuthUser(supabase: SupabaseClient, email: string, password: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true })
  if (data?.user?.id) return data.user.id
  // Extremely unlikely (fresh plus-addressed email per run) but fail loud rather
  // than silently reusing a stale account from a previous failed attempt.
  throw new Error(`Failed to create auth user ${email}: ${error?.message}`)
}

async function insertChunked(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) throw new Error(`${table} bulk insert failed: ${error.message}`)
  }
}

export async function provisionDemoOrg(
  supabase: SupabaseClient,
  spec: DemoOrgSpec,
): Promise<DemoOrgResult> {
  const { prospectName, orgShape, courseCode, createdBy } = spec

  // Phantom-course guard — server-side, not just the client dropdown. Only a
  // LIVE course may back a showcase; a beta/draft/retired code would leave
  // the class dashboards looking broken, the exact failure this tool exists
  // to prevent.
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('course_code, new_app_status')
    .eq('course_code', courseCode)
    .maybeSingle()
  if (courseErr || !course || course.new_app_status !== 'live') {
    throw new Error(`course_code "${courseCode}" is not a live course`)
  }

  const { count: seedCount } = await supabase
    .from('course_seeds')
    .select('seed_number', { count: 'exact', head: true })
    .eq('course_code', courseCode)
  const maxSeed = Math.max(20, Math.min(45, (seedCount ?? 45) - 5))

  const numSchools = orgShape === 'single_school' ? 1 : (spec.numSchools ?? 2)
  const teachersPerSchool = spec.teachersPerSchool ?? 2
  const classesPerSchool = spec.classesPerSchool ?? 3
  const learnersPerSchool = spec.learnersPerSchool ?? between(20, 60)

  const emailSlug = prospectName.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'demo'
  const runTag = randomBytes(3).toString('hex')
  const emailFor = (slug: string) => `thomas.cassidy+demo.${emailSlug}.${runTag}.${slug}@gmail.com`

  const staff: StaffCredential[] = []
  let groupId: string | null = null
  const schoolIds: string[] = []
  const now = Date.now()
  const termStart = now - 28 * DAY

  // ---- group / government-region leader ----
  if (orgShape !== 'single_school') {
    const { data: group, error: groupErr } = await supabase
      .from('groups')
      .insert({
        name: prospectName,
        type: orgShape === 'government_region' ? 'region' : 'group',
        is_demo: true,
        is_test: true,
      })
      .select('id')
      .single()
    if (groupErr || !group) throw new Error(`groups insert failed: ${groupErr?.message}`)
    groupId = group.id as string

    const leaderName = `${pick(STAFF_FIRST)} ${pick(STAFF_LAST)}`
    const leaderEmail = emailFor('leader')
    const leaderPassword = generatePassword()
    const leaderUid = await ensureAuthUser(supabase, leaderEmail, leaderPassword)
    await supabase.from('learners').update({
      display_name: leaderName,
      educational_role: 'govt_admin',
      is_demo: true,
    }).eq('user_id', leaderUid)
    const { data: leaderLearner } = await supabase.from('learners').select('id').eq('user_id', leaderUid).single()
    await supabase.from('govt_admins').insert({
      user_id: leaderUid,
      group_id: groupId,
      organization_name: prospectName,
      created_by: createdBy,
    })
    staff.push({
      role: 'govt_admin', name: leaderName, email: leaderEmail,
      learnerId: leaderLearner!.id as string, password: leaderPassword,
    })
  }

  // ---- accumulators for bulk inserts, flushed once at the end ----
  const seedRows: Record<string, unknown>[] = []
  const legoRows: Record<string, unknown>[] = []
  const sessionRows: Record<string, unknown>[] = []
  const classSessionRows: Record<string, unknown>[] = []
  const userTagRows: Record<string, unknown>[] = []
  const studentSpecs: { suid: string; name: string; classId: string; stage: ReturnType<typeof studentStage>; lastPracticed: Date }[] = []
  let totalTeachers = 0
  let totalClasses = 0
  let totalLearners = 0

  for (let si = 0; si < numSchools; si++) {
    const schoolName = orgShape === 'single_school' ? prospectName : randomSchoolName()

    const adminName = `${pick(STAFF_FIRST)} ${pick(STAFF_LAST)}`
    const adminEmail = emailFor(`s${si}.admin`)
    const adminPassword = generatePassword()
    const adminUid = await ensureAuthUser(supabase, adminEmail, adminPassword)
    const { data: adminLearner } = await supabase.from('learners').update({
      display_name: adminName, educational_role: 'school_admin', is_demo: true,
    }).eq('user_id', adminUid).select('id').single()

    const teacherUids: string[] = []
    for (let ti = 0; ti < teachersPerSchool; ti++) {
      const teacherName = `${pick(STAFF_FIRST)} ${pick(STAFF_LAST)}`
      const teacherEmail = emailFor(`s${si}.t${ti}`)
      const teacherPassword = generatePassword()
      const teacherUid = await ensureAuthUser(supabase, teacherEmail, teacherPassword)
      const { data: teacherLearner } = await supabase.from('learners').update({
        display_name: teacherName, educational_role: 'teacher', is_demo: true,
      }).eq('user_id', teacherUid).select('id').single()
      teacherUids.push(teacherUid)
      staff.push({
        role: 'teacher', name: teacherName, email: teacherEmail,
        learnerId: teacherLearner!.id as string, password: teacherPassword, schoolName,
      })
      totalTeachers++
    }

    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .insert({
        school_name: schoolName,
        admin_user_id: adminUid,
        group_id: groupId,
        is_demo: true,
        is_test: true,
        platform_status: 'trial',
        trial_kind: 'free_1yr',
        trial_course_code: courseCode,
        platform_expires_at: new Date(now + 365 * DAY).toISOString(),
      })
      .select('id')
      .single()
    if (schoolErr || !school) throw new Error(`schools insert failed: ${schoolErr?.message}`)
    const schoolId = school.id as string
    schoolIds.push(schoolId)
    await ensureJoinCodesRegistered(supabase, schoolId, createdBy)

    staff.push({
      role: 'school_admin', name: adminName, email: adminEmail,
      learnerId: adminLearner!.id as string, password: adminPassword, schoolName,
    })

    userTagRows.push({ user_id: adminUid, tag_type: 'school', tag_value: `SCHOOL:${schoolId}`, role_in_context: 'admin', added_by: 'demo-schools-tool' })
    for (const t of teacherUids) {
      userTagRows.push({ user_id: t, tag_type: 'school', tag_value: `SCHOOL:${schoolId}`, role_in_context: 'teacher', added_by: 'demo-schools-tool' })
    }

    // Split this school's total learners across its classes with some
    // variance rather than an exact even split — real rosters aren't uniform.
    const classLearnerCounts: number[] = []
    let remaining = learnersPerSchool
    for (let ci = 0; ci < classesPerSchool; ci++) {
      const isLast = ci === classesPerSchool - 1
      const share = isLast ? remaining : Math.max(1, Math.round(remaining / (classesPerSchool - ci) * between(80, 120) / 100))
      classLearnerCounts.push(Math.min(share, remaining))
      remaining -= classLearnerCounts[ci]
    }

    for (let ci = 0; ci < classesPerSchool; ci++) {
      const className = randomClassName()
      const teacherUid = teacherUids[ci % teacherUids.length]
      const classSeed = between(Math.max(10, maxSeed - 20), maxSeed)
      const classLego = `S${String(classSeed).padStart(4, '0')}L0${between(1, 3)}`

      const { data: cls, error: clsErr } = await supabase
        .from('classes')
        .insert({
          school_id: schoolId,
          teacher_user_id: teacherUid,
          class_name: className,
          course_code: courseCode,
          current_seed: classSeed,
          last_lego_id: classLego,
          is_active: true,
        })
        .select('id')
        .single()
      if (clsErr || !cls) throw new Error(`classes insert failed: ${clsErr?.message}`)
      const classId = cls.id as string
      totalClasses++

      const entityResult = await ensureClassLearnerEntity(supabase, classId)
      if ('error' in entityResult) {
        console.warn('[demoSchoolGen] ensureClassLearnerEntity failed (non-fatal):', entityResult.error)
      }

      const nClassSessions = between(6, 12)
      for (let k = 0; k < nClassSessions; k++) {
        const st = weekdayTimestamp(now - 26 * DAY, now)
        const dur = between(900, 2100)
        classSessionRows.push({
          class_id: classId,
          teacher_user_id: teacherUid,
          start_lego_id: `S${String(Math.max(1, classSeed - 2)).padStart(4, '0')}L01`,
          end_lego_id: classLego,
          started_at: st.toISOString(),
          ended_at: new Date(st.getTime() + dur * 1000).toISOString(),
          cycles_completed: Math.floor(dur / 11),
          duration_seconds: dur,
        })
      }

      const nStudents = classLearnerCounts[ci]
      for (let s2 = 0; s2 < nStudents; s2++) {
        const name = `${pick(STUDENT_FIRST)} ${pick(STUDENT_LAST)}`
        const stage = studentStage(classSeed)
        const lastPracticed = weekdayTimestamp(now - stage.recencyDays * DAY - between(0, 8) * 3600000, now - stage.recencyDays * DAY)
        const suid = randomBytes(16).toString('hex')

        studentSpecs.push({ suid, name, classId, stage, lastPracticed })
        totalLearners++
      }
    }
  }

  // ---- flush all student learner rows in one bulk insert, keyed by the
  // user_id we already generated — avoids one DB round trip per student
  // (which at default counts would risk the function's time budget). ----
  const learnerIdBySuid = new Map<string, string>()
  if (studentSpecs.length) {
    const learnerInsertRows = studentSpecs.map(s => ({
      user_id: s.suid,
      display_name: s.name,
      educational_role: 'student',
      is_demo: true,
      created_at: new Date(termStart).toISOString(),
    }))
    for (let i = 0; i < learnerInsertRows.length; i += 500) {
      const chunk = learnerInsertRows.slice(i, i + 500)
      const { data: inserted, error } = await supabase.from('learners').insert(chunk).select('id, user_id')
      if (error || !inserted) throw new Error(`learners bulk insert failed: ${error?.message}`)
      for (const row of inserted) learnerIdBySuid.set(row.user_id as string, row.id as string)
    }
  }

  const enrollmentRows: Record<string, unknown>[] = []
  for (const spec of studentSpecs) {
    const lid = learnerIdBySuid.get(spec.suid)
    if (!lid) throw new Error(`learner row missing for generated user_id ${spec.suid}`)

    userTagRows.push({ user_id: spec.suid, tag_type: 'class', tag_value: `CLASS:${spec.classId}`, role_in_context: 'student', added_by: 'demo-schools-tool' })

    const seeds = spec.stage.seeds
    const lastLego = `S${String(seeds).padStart(4, '0')}L0${between(1, 4)}`
    const minutes = Math.round(seeds * between(9, 15))

    enrollmentRows.push({
      learner_id: lid,
      course_id: courseCode,
      enrolled_at: new Date(termStart + between(0, 3) * DAY).toISOString(),
      last_practiced_at: spec.lastPracticed.toISOString(),
      total_practice_minutes: minutes,
      last_completed_lego_id: lastLego,
      highest_completed_lego_id: lastLego,
      highest_completed_seed: seeds,
      last_completed_round_index: seeds * 3,
      highest_completed_round_index: seeds * 3,
      current_cycle_index: 0,
      welcome_played: true,
    })

    for (let s = 1; s <= seeds; s++) {
      const sid = `S${String(s).padStart(4, '0')}`
      const introducedAt = new Date(termStart + (spec.lastPracticed.getTime() - termStart) * (s / seeds)).toISOString()
      seedRows.push({ learner_id: lid, seed_id: sid, course_id: courseCode, thread_id: (s % 3) + 1, is_introduced: true, introduced_at: introducedAt })
      const nLegos = between(3, 4)
      for (let g = 1; g <= nLegos; g++) {
        legoRows.push({
          learner_id: lid, lego_id: `${sid}L${String(g).padStart(2, '0')}`, course_id: courseCode,
          thread_id: (s % 3) + 1, fibonacci_position: between(2, 8), skip_number: between(1, 13),
          reps_completed: between(2, 12), is_retired: s < seeds - 4, last_practiced_at: introducedAt,
        })
      }
    }

    const span = Math.max(1, spec.lastPracticed.getTime() - termStart)
    for (let k = 0; k < spec.stage.sessions; k++) {
      const st = weekdayTimestamp(termStart, termStart + span)
      const dur = between(480, 1500)
      const items = Math.floor((dur / 60) * between(4, 6))
      sessionRows.push({
        learner_id: lid, course_id: courseCode, started_at: st.toISOString(),
        ended_at: new Date(st.getTime() + dur * 1000).toISOString(), duration_seconds: dur,
        items_practiced: items, points_earned: items,
      })
    }
  }

  await insertChunked(supabase, 'course_enrollments', enrollmentRows)
  await insertChunked(supabase, 'user_tags', userTagRows)
  await insertChunked(supabase, 'seed_progress', seedRows)
  await insertChunked(supabase, 'lego_progress', legoRows)
  await insertChunked(supabase, 'sessions', sessionRows)
  await insertChunked(supabase, 'class_sessions', classSessionRows)

  const expiresAt = new Date(now + 30 * DAY).toISOString()
  const counts = { schools: numSchools, teachers: totalTeachers, classes: totalClasses, learners: totalLearners }

  const { data: demoOrg, error: demoOrgErr } = await supabase
    .from('demo_orgs')
    .insert({
      created_by: createdBy,
      prospect_name: prospectName,
      org_shape: orgShape,
      course_code: courseCode,
      group_id: groupId,
      school_id: orgShape === 'single_school' ? schoolIds[0] : null,
      expires_at: expiresAt,
      status: 'active',
      metadata: {
        orgName: prospectName,
        staff: staff.map(({ password: _password, ...rest }) => rest),
        counts,
      },
    })
    .select('id')
    .single()
  if (demoOrgErr || !demoOrg) throw new Error(`demo_orgs insert failed: ${demoOrgErr?.message}`)

  return {
    demoOrgId: demoOrg.id as string,
    orgName: prospectName,
    orgShape,
    courseCode,
    groupId,
    schoolIds,
    staff,
    counts,
    expiresAt,
  }
}
