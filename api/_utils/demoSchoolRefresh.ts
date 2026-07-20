/**
 * demoSchoolRefresh — "Refresh Activity" for /admin/demo-schools.
 *
 * The founder's ask verbatim: "can Nick just have that as a button before he
 * sends all the login details" — a demo org's seeded activity is anchored to
 * its creation date, so a prospect opening it weeks later sees a dashboard
 * that stopped moving. This tops the activity up from the org's last
 * activity through today, CONTINUING each learner's own trajectory rather
 * than a fresh random draw — reuses the exact engagement-mix primitives from
 * demoSchoolGen.ts (pick/between/weekdayTimestamp/insertChunked/resolveMaxSeed)
 * so the top-up reads as the same demo, not a different one bolted on.
 *
 * Continuation, not redraw: each learner's tier (keen/mid/lagging) is
 * inferred from their OWN session history (sessions/week since enrolment),
 * not re-rolled — a keen learner keeps being keen. A small slice (~6%) shift
 * tier by one notch, because real classes have a couple of learners whose
 * engagement changes over time and an unmoving cohort reads as synthetic.
 *
 * Guard: only ever touches orgs whose schools are ALL is_test=true — checked
 * server-side against the live schools rows, not trusted from the demo_orgs
 * row alone.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { between, weekdayTimestamp, insertChunked, resolveMaxSeed, DAY } from './demoSchoolGen'
import { resolveGroupSubtreeIds } from './demoSchoolGraph'

export interface RefreshResult {
  demoOrgId: string
  activityThrough: string
  learnersTouched: number
  newSessions: number
  tierShifts: number
  noop: boolean
}

interface OrgScope {
  schoolIds: string[]
  classes: { id: string; courseCode: string; teacherUserId: string | null }[]
}

async function resolveOrgScope(supabase: SupabaseClient, org: { group_id: string | null; school_id: string | null }): Promise<OrgScope> {
  const schoolIds: string[] = []
  if (org.school_id) schoolIds.push(org.school_id)
  if (org.group_id) {
    const groupIds = await resolveGroupSubtreeIds(supabase, org.group_id)
    const { data: groupSchools } = await supabase.from('schools').select('id').in('group_id', groupIds)
    for (const s of groupSchools || []) schoolIds.push(s.id as string)
  }
  if (!schoolIds.length) return { schoolIds, classes: [] }

  const { data: classRows } = await supabase
    .from('classes')
    .select('id, course_code, teacher_user_id')
    .in('school_id', schoolIds)
  const classes = (classRows || []).map(c => ({ id: c.id as string, courseCode: c.course_code as string, teacherUserId: c.teacher_user_id as string | null }))
  return { schoolIds, classes }
}

// keen/mid/lagging weekly-rate table — same three-way split as
// demoSchoolGen's studentStage(), expressed as a per-week continuation rate
// instead of a one-shot total, since we're topping up an existing arc.
const TIERS = ['keen', 'mid', 'lagging'] as const
type Tier = typeof TIERS[number]
const TIER_WEEKLY_SESSIONS: Record<Tier, [number, number]> = { keen: [3, 5], mid: [1, 3], lagging: [0, 1] }
const TIER_WEEKLY_SEEDS: Record<Tier, [number, number]> = { keen: [1, 3], mid: [0, 2], lagging: [0, 1] }

function classifyTier(sessionCount: number, weeksSinceEnrolled: number): Tier {
  const perWeek = sessionCount / Math.max(0.5, weeksSinceEnrolled)
  if (perWeek >= 2.2) return 'keen'
  if (perWeek >= 0.8) return 'mid'
  return 'lagging'
}

function shiftTier(tier: Tier): Tier {
  const idx = TIERS.indexOf(tier)
  const dir = Math.random() < 0.5 ? -1 : 1
  const next = Math.min(TIERS.length - 1, Math.max(0, idx + dir))
  return TIERS[next]
}

export async function refreshDemoOrgActivity(
  supabase: SupabaseClient,
  demoOrgId: string,
  actorId: string,
): Promise<RefreshResult> {
  const { data: org, error: orgErr } = await supabase
    .from('demo_orgs')
    .select('id, status, group_id, school_id, course_code, metadata')
    .eq('id', demoOrgId)
    .maybeSingle()
  if (orgErr) throw new Error(`demo_orgs read failed: ${orgErr.message}`)
  if (!org) throw new Error('Demo org not found')
  if (org.status !== 'active') throw new Error('Demo org is expired — extend it before refreshing activity')

  const scope = await resolveOrgScope(supabase, org)
  if (!scope.schoolIds.length) throw new Error('Demo org has no schools to refresh')

  // Hard server-side guard — never touch a school that isn't marked is_test,
  // regardless of what the demo_orgs row claims.
  const { data: schoolCheck, error: schoolCheckErr } = await supabase
    .from('schools')
    .select('id, is_test')
    .in('id', scope.schoolIds)
  if (schoolCheckErr) throw new Error(`schools read failed: ${schoolCheckErr.message}`)
  const nonTest = (schoolCheck || []).filter(s => !s.is_test)
  if (nonTest.length || (schoolCheck || []).length !== scope.schoolIds.length) {
    throw new Error('Refresh blocked: one or more schools in this org are not marked is_test')
  }

  const now = Date.now()
  const classIds = scope.classes.map(c => c.id)
  const studentUserIds: string[] = []
  const userIdToClass = new Map<string, { id: string; courseCode: string }>()
  if (classIds.length) {
    const { data: tagRows } = await supabase
      .from('user_tags')
      .select('user_id, tag_value')
      .in('tag_value', classIds.map(id => `CLASS:${id}`))
      .eq('role_in_context', 'student')
    for (const r of tagRows || []) {
      const uid = r.user_id as string
      const classId = (r.tag_value as string).replace('CLASS:', '')
      const cls = scope.classes.find(c => c.id === classId)
      if (!cls) continue
      studentUserIds.push(uid)
      userIdToClass.set(uid, { id: cls.id, courseCode: cls.courseCode })
    }
  }

  if (!studentUserIds.length) {
    return { demoOrgId, activityThrough: new Date(now).toISOString(), learnersTouched: 0, newSessions: 0, tierShifts: 0, noop: true }
  }

  const { data: learnerRows } = await supabase.from('learners').select('id, user_id').in('user_id', studentUserIds)
  const learnerIdByUserId = new Map<string, string>()
  for (const l of learnerRows || []) learnerIdByUserId.set(l.user_id as string, l.id as string)
  const learnerIds = Array.from(learnerIdByUserId.values())

  const { data: enrollments } = await supabase
    .from('course_enrollments')
    .select('learner_id, course_id, enrolled_at, last_practiced_at, total_practice_minutes, highest_completed_seed, highest_completed_round_index')
    .in('learner_id', learnerIds)
  const enrollmentByLearner = new Map<string, any>()
  for (const e of enrollments || []) enrollmentByLearner.set(e.learner_id as string, e)

  // Bulk history read (not per-learner) to infer each learner's existing
  // tier from their own session cadence.
  const { data: allSessions } = await supabase
    .from('sessions')
    .select('learner_id, started_at')
    .in('learner_id', learnerIds)
  const sessionsByLearner = new Map<string, string[]>()
  for (const s of allSessions || []) {
    const arr = sessionsByLearner.get(s.learner_id as string) || []
    arr.push(s.started_at as string)
    sessionsByLearner.set(s.learner_id as string, arr)
  }

  const maxSeedByCourse = new Map<string, number>()
  const resolveMaxSeedCached = async (courseCode: string) => {
    if (!maxSeedByCourse.has(courseCode)) maxSeedByCourse.set(courseCode, await resolveMaxSeed(supabase, courseCode))
    return maxSeedByCourse.get(courseCode)!
  }

  const enrollmentUpdates: { learner_id: string; patch: Record<string, unknown> }[] = []
  const sessionRows: Record<string, unknown>[] = []
  const seedRows: Record<string, unknown>[] = []
  const legoRows: Record<string, unknown>[] = []
  let learnersTouched = 0
  let tierShifts = 0

  for (const [userId, learnerId] of learnerIdByUserId) {
    const enrollment = enrollmentByLearner.get(learnerId)
    if (!enrollment) continue
    const cls = userIdToClass.get(userId)
    if (!cls) continue

    const lastPracticedMs = new Date(enrollment.last_practiced_at).getTime()
    const windowStart = Math.max(lastPracticedMs, now - 60 * DAY) // never reach back further than 60d even for a very stale org
    const elapsedDays = (now - windowStart) / DAY
    if (elapsedDays < 0.5) continue // already fresh — idempotent no-op for this learner

    const history = sessionsByLearner.get(learnerId) || []
    const weeksSinceEnrolled = Math.max(0.5, (now - new Date(enrollment.enrolled_at).getTime()) / (7 * DAY))
    let tier = classifyTier(history.length, weeksSinceEnrolled)
    if (Math.random() < 0.06) { tier = shiftTier(tier); tierShifts++ }

    const weeks = elapsedDays / 7
    const [sLo, sHi] = TIER_WEEKLY_SESSIONS[tier]
    const nNewSessions = Math.round(between(sLo * 10, sHi * 10) / 10 * weeks)
    if (nNewSessions <= 0) continue

    const [gLo, gHi] = TIER_WEEKLY_SEEDS[tier]
    const newSeeds = Math.round(between(gLo * 10, gHi * 10) / 10 * weeks)
    const maxSeed = await resolveMaxSeedCached(cls.courseCode)
    const prevSeed = enrollment.highest_completed_seed || 0
    const nextSeed = Math.min(maxSeed, prevSeed + newSeeds)

    let latestSessionMs = lastPracticedMs
    let minutesAdded = 0
    for (let k = 0; k < nNewSessions; k++) {
      // Reserve the last session in the batch for the tail of the window —
      // without this, tiers with few sessions (laggards) scatter randomly
      // across a wide window and last_practiced_at can stay stale, defeating
      // idempotency (a re-click would keep finding a big gap to fill).
      const isLast = k === nNewSessions - 1
      const st = isLast ? weekdayTimestamp(Math.max(windowStart, now - 2 * DAY), now) : weekdayTimestamp(windowStart, now)
      const dur = between(480, 1500)
      const items = Math.floor((dur / 60) * between(4, 6))
      sessionRows.push({
        learner_id: learnerId, course_id: cls.courseCode, started_at: st.toISOString(),
        ended_at: new Date(st.getTime() + dur * 1000).toISOString(), duration_seconds: dur,
        items_practiced: items, points_earned: items,
      })
      minutesAdded += Math.round(dur / 60)
      latestSessionMs = Math.max(latestSessionMs, st.getTime())
    }

    if (nextSeed > prevSeed) {
      for (let s = prevSeed + 1; s <= nextSeed; s++) {
        const sid = `S${String(s).padStart(4, '0')}`
        const introducedAt = new Date(windowStart + (latestSessionMs - windowStart) * ((s - prevSeed) / (nextSeed - prevSeed))).toISOString()
        seedRows.push({ learner_id: learnerId, seed_id: sid, course_id: cls.courseCode, thread_id: (s % 3) + 1, is_introduced: true, introduced_at: introducedAt })
        const nLegos = between(3, 4)
        for (let g = 1; g <= nLegos; g++) {
          legoRows.push({
            learner_id: learnerId, lego_id: `${sid}L${String(g).padStart(2, '0')}`, course_id: cls.courseCode,
            thread_id: (s % 3) + 1, fibonacci_position: between(2, 8), skip_number: between(1, 13),
            reps_completed: between(2, 12), is_retired: s < nextSeed - 4, last_practiced_at: introducedAt,
          })
        }
      }
    }

    const lastLego = `S${String(nextSeed).padStart(4, '0')}L0${between(1, 4)}`
    enrollmentUpdates.push({
      learner_id: learnerId,
      patch: {
        last_practiced_at: new Date(latestSessionMs).toISOString(),
        total_practice_minutes: (enrollment.total_practice_minutes || 0) + minutesAdded,
        last_completed_lego_id: nextSeed > prevSeed ? lastLego : enrollment.last_completed_lego_id,
        highest_completed_lego_id: nextSeed > prevSeed ? lastLego : enrollment.highest_completed_lego_id,
        highest_completed_seed: nextSeed,
        last_completed_round_index: nextSeed * 3,
        highest_completed_round_index: Math.max(enrollment.highest_completed_round_index || 0, nextSeed * 3),
      },
    })
    learnersTouched++
  }

  await insertChunked(supabase, 'sessions', sessionRows)
  await insertChunked(supabase, 'seed_progress', seedRows)
  await insertChunked(supabase, 'lego_progress', legoRows)
  for (const u of enrollmentUpdates) {
    const { error } = await supabase.from('course_enrollments').update(u.patch).eq('learner_id', u.learner_id)
    if (error) console.warn('[demoSchoolRefresh] course_enrollments update failed for', u.learner_id, error.message)
  }

  // Light top-up of teacher-led class_sessions so the class-level charts
  // move too, scaled to however stale the org was.
  const classSessionRows: Record<string, unknown>[] = []
  for (const cls of scope.classes) {
    const nNew = between(1, 3)
    for (let k = 0; k < nNew; k++) {
      const st = weekdayTimestamp(now - 7 * DAY, now)
      const dur = between(900, 2100)
      classSessionRows.push({
        class_id: cls.id,
        teacher_user_id: cls.teacherUserId,
        start_lego_id: 'S0001L01',
        end_lego_id: 'S0001L01',
        started_at: st.toISOString(),
        ended_at: new Date(st.getTime() + dur * 1000).toISOString(),
        cycles_completed: Math.floor(dur / 11),
        duration_seconds: dur,
      })
    }
  }
  await insertChunked(supabase, 'class_sessions', classSessionRows)

  const activityThrough = new Date(now).toISOString()
  const nextMetadata = { ...(org.metadata as Record<string, unknown> || {}), lastActivityThrough: activityThrough }
  const { error: updateErr } = await supabase.from('demo_orgs').update({ metadata: nextMetadata }).eq('id', demoOrgId)
  if (updateErr) throw new Error(`demo_orgs metadata update failed: ${updateErr.message}`)

  try {
    await supabase.from('player_events').insert({
      occurred_at: new Date().toISOString(),
      event_type: 'admin_demo_school_activity_refreshed',
      payload: { actor_user_id: actorId, demo_org_id: demoOrgId, learners_touched: learnersTouched, new_sessions: sessionRows.length, tier_shifts: tierShifts },
    })
  } catch (auditErr) {
    console.warn('[demoSchoolRefresh] audit insert threw:', auditErr)
  }

  return {
    demoOrgId,
    activityThrough,
    learnersTouched,
    newSessions: sessionRows.length,
    tierShifts,
    noop: learnersTouched === 0,
  }
}
