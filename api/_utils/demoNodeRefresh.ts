/**
 * demoNodeRefresh — "Refresh demo activity" for a DEMO node in the Structure
 * tree (founder-ruled 2026-07-19).
 *
 * The problem: demo programmes/schools (IME Demo Programme, Gaelscoileanna…)
 * go stale fast — their seeded telemetry is anchored to generation day, so a
 * few weeks later every chart reads burst-then-dead (+6100% vs a flat line).
 * This verb REGENERATES the demo subtree's synthetic telemetry up to the
 * minute: practice sessions spread over the last ~8 weeks weighted toward
 * recent days and TODAY, varied per learner (fast/steady/idle personas so
 * needs-attention, belts, rates and cohort strips all look alive), coherent
 * with each learner's LEGO position.
 *
 * REPLACE, not top-up (this is what distinguishes it from the legacy
 * demoSchoolRefresh.ts, which continues a trajectory for pre-2026-07-17
 * demo_orgs): re-running deletes the subtree's synthetic student telemetry
 * and regenerates it, so refreshes never stack.
 *
 * HARD SAFETY — impossible to touch non-demo data, enforced server-side at
 * every layer, never trusted from the client:
 *   1. the target group row must carry is_demo=true, or refuse;
 *   2. every school in the subtree must carry is_demo=true, or refuse;
 *   3. only learners with is_demo=true are ever selected, and every
 *      delete/insert/update is keyed strictly by that learner-id set;
 *   4. only STUDENT learners (class-tag role student) are touched — demo
 *      staff accounts are real logins (Tom demos as them) and their own
 *      practice history is never rewritten.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { between, weekdayTimestamp, insertChunked, DAY } from './demoSchoolGen'
import { resolveGroupSubtreeIds } from './demoSchoolGraph'
import { ensureClassLearnerEntity } from './classLearnerEntity'

export interface NodeRefreshResult {
  groupId: string
  schools: number
  classes: number
  learnersTouched: number
  sessionsWritten: number
  classSessionsWritten: number
  seedRowsWritten: number
  legoRowsWritten: number
  activityThrough: string
  noop: boolean
}

const WINDOW_DAYS = 56 // ~8 weeks

// fast / steady / idle personas — the Russell-2024 engagement shape the demo
// generators already use (20/50/30), expressed as a total-window plan.
// Trimmed 2026-07-20 (play-as-class re-anchor, LANE B): the class practising
// together is now the PRIMARY signal — students are the bonus layer, so
// their session volume shrinks relative to the class arc below.
const PERSONAS = [
  { key: 'fast', weight: 0.2, sessions: [10, 18] as const, recencyDays: [0, 0] as const, seedGain: [8, 14] as const },
  { key: 'steady', weight: 0.5, sessions: [5, 10] as const, recencyDays: [0, 4] as const, seedGain: [2, 7] as const },
  { key: 'idle', weight: 0.3, sessions: [1, 4] as const, recencyDays: [10, 25] as const, seedGain: [0, 2] as const },
] as const
type Persona = (typeof PERSONAS)[number]

function drawPersona(): Persona {
  const r = Math.random()
  let acc = 0
  for (const p of PERSONAS) {
    acc += p.weight
    if (r < acc) return p
  }
  return PERSONAS[PERSONAS.length - 1]
}

/**
 * Day offset biased hard toward NOW (power law): most sessions land in the
 * last couple of weeks, a long thin tail reaches back ~8 weeks — the shape a
 * chart reads as "alive right now", not burst-then-dead.
 */
function recentWeightedDayOffset(maxDays: number): number {
  return Math.floor(maxDays * Math.pow(Math.random(), 2.4))
}

/** Course seed count caps how far any learner can plausibly be advanced. */
async function resolveSeedCeiling(supabase: SupabaseClient, courseCode: string): Promise<number> {
  const { count } = await supabase
    .from('course_seeds')
    .select('seed_number', { count: 'exact', head: true })
    .eq('course_code', courseCode)
  return Math.max(20, (count ?? 60) - 5)
}

export async function refreshDemoNodeActivity(
  supabase: SupabaseClient,
  groupId: string,
  actorId: string,
): Promise<NodeRefreshResult> {
  // ---- guard 1: the node itself must be a demo node ----
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .select('id, name, is_demo')
    .eq('id', groupId)
    .maybeSingle()
  if (groupErr) throw new Error(`groups read failed: ${groupErr.message}`)
  if (!group) throw new Error('Group not found')
  if (group.is_demo !== true) throw new Error('Refresh refused: this is not a demo node')

  // ---- scope: the subtree's schools and classes ----
  const subtreeGroupIds = await resolveGroupSubtreeIds(supabase, groupId)
  const { data: schools, error: schoolsErr } = await supabase
    .from('schools')
    .select('id, school_name, is_demo')
    .in('group_id', subtreeGroupIds)
  if (schoolsErr) throw new Error(`schools read failed: ${schoolsErr.message}`)

  // ---- guard 2: every school in the subtree must be a demo school ----
  const nonDemo = (schools || []).filter((s) => s.is_demo !== true)
  if (nonDemo.length) {
    throw new Error(`Refresh refused: subtree contains non-demo school(s): ${nonDemo.map((s) => s.school_name).join(', ')}`)
  }
  const schoolIds = (schools || []).map((s) => s.id as string)

  const now = Date.now()
  const activityThrough = new Date(now).toISOString()
  const emptyResult: NodeRefreshResult = {
    groupId, schools: schoolIds.length, classes: 0, learnersTouched: 0,
    sessionsWritten: 0, classSessionsWritten: 0, seedRowsWritten: 0, legoRowsWritten: 0,
    activityThrough, noop: true,
  }
  if (!schoolIds.length) return emptyResult

  const { data: classRows, error: classErr } = await supabase
    .from('classes')
    .select('id, course_code, teacher_user_id, current_seed')
    .in('school_id', schoolIds)
  if (classErr) throw new Error(`classes read failed: ${classErr.message}`)
  const classes = (classRows || []).map((c) => ({
    id: c.id as string,
    courseCode: c.course_code as string,
    teacherUserId: c.teacher_user_id as string | null,
    currentSeed: (c.current_seed as number) || 20,
    classLearnerId: null as string | null,
  }))
  if (!classes.length) return emptyResult

  // ---- teacher fallback: classes.teacher_user_id (the lead pointer) is
  // nullable — some demo classes carry their teachers only in class_teachers.
  // class_sessions.teacher_user_id is NOT NULL, so without this fallback the
  // arc insert dies AFTER the replace-delete has run and the whole demo tree
  // goes class-practice-dark (hit live on the IME tree, 2026-07-20).
  const teacherless = classes.filter((c) => !c.teacherUserId)
  if (teacherless.length) {
    const { data: ctRows } = await supabase
      .from('class_teachers')
      .select('class_id, teacher_user_id')
      .in('class_id', teacherless.map((c) => c.id))
    const ctByClass = new Map<string, string>()
    for (const r of ctRows || []) {
      if (!ctByClass.has(r.class_id as string)) ctByClass.set(r.class_id as string, r.teacher_user_id as string)
    }
    for (const c of teacherless) c.teacherUserId = ctByClass.get(c.id) || null
  }

  // ---- class learning identity (founder ruling 2026-07-19: play-as-class is
  // the PRIMARY school metric — every demo class is itself a learner). Ensure
  // + belt-and-braces demo-flag every class in the guarded subtree so board
  // metrics / test_learner_ids() never mistake class practice for real data.
  for (const cls of classes) {
    const ensured = await ensureClassLearnerEntity(supabase, cls.id)
    if ('error' in ensured) {
      console.warn('[demoNodeRefresh] ensureClassLearnerEntity failed for', cls.id, ensured.error)
      continue
    }
    cls.classLearnerId = ensured.learnerId
    const { error: demoFlagErr } = await supabase
      .from('learners')
      .update({ is_demo: true })
      .eq('id', ensured.learnerId)
    if (demoFlagErr) console.warn('[demoNodeRefresh] class learner is_demo flag failed for', cls.id, demoFlagErr.message)
  }
  const classLearnerIds = classes.map((c) => c.classLearnerId).filter((id): id is string => !!id)

  // ---- the students: class-tag role student, then guard 3 (is_demo only).
  // A learner can belong to MORE THAN ONE class (dual-course learners in the
  // international-school segment) — keep every (user, class) membership so
  // each course gets its own coherent telemetry, not just the last tag read.
  const { data: tagRows } = await supabase
    .from('user_tags')
    .select('user_id, tag_value')
    .in('tag_value', classes.map((c) => `CLASS:${c.id}`))
    .eq('role_in_context', 'student')
  const classesByUserId = new Map<string, (typeof classes)[number][]>()
  for (const r of tagRows || []) {
    const cls = classes.find((c) => `CLASS:${c.id}` === (r.tag_value as string))
    if (!cls) continue
    const uid = r.user_id as string
    const list = classesByUserId.get(uid) || []
    if (!list.some((c) => c.id === cls.id)) list.push(cls)
    classesByUserId.set(uid, list)
  }
  if (!classesByUserId.size) return emptyResult

  const { data: learnerRows } = await supabase
    .from('learners')
    .select('id, user_id, is_demo')
    .in('user_id', Array.from(classesByUserId.keys()))
    .eq('is_demo', true) // guard 3 — non-demo learners can never enter the write set
  // One work item per (learner, class) pair; personas draw per pair, so a
  // dual-course learner can honestly be fast in French and idle in Spanish.
  const learners = (learnerRows || [])
    .filter((l) => l.is_demo === true) // belt-and-braces re-check of the filter
    .flatMap((l) =>
      (classesByUserId.get(l.user_id as string) || []).map((cls) => ({ learnerId: l.id as string, cls })),
    )
  if (!learners.length) return emptyResult
  const learnerIds = Array.from(new Set(learners.map((l) => l.learnerId)))

  // ---- existing enrollments (anchor positions so refresh reads as the same
  // cohort continuing, not a different class teleported) ----
  const { data: enrollments } = await supabase
    .from('course_enrollments')
    .select('learner_id, course_id, enrolled_at, highest_completed_seed')
    .in('learner_id', learnerIds)
  // Keyed by (learner, course) — a dual-course learner has one anchor per course.
  const enrollmentByLearnerCourse = new Map<string, any>()
  for (const e of enrollments || []) enrollmentByLearnerCourse.set(`${e.learner_id}:${e.course_id}`, e)

  const seedCeilingByCourse = new Map<string, number>()
  for (const c of classes) {
    if (!seedCeilingByCourse.has(c.courseCode)) {
      seedCeilingByCourse.set(c.courseCode, await resolveSeedCeiling(supabase, c.courseCode))
    }
  }

  // ---- REPLACE step 1: delete the subtree's synthetic student telemetry.
  // Every delete keyed strictly by the is_demo learner-id set / demo class ids.
  // `sessions` also carries the class-identity rows (keyed by class learner
  // id) — cleared here too so a re-run never stacks the class's own arc.
  const sessionDeleteIds = [...learnerIds, ...classLearnerIds]
  for (const table of ['sessions', 'seed_progress', 'lego_progress'] as const) {
    const ids = table === 'sessions' ? sessionDeleteIds : learnerIds
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100)
      const { error } = await supabase.from(table).delete().in('learner_id', chunk)
      if (error) throw new Error(`${table} delete failed: ${error.message}`)
    }
  }
  {
    const { error } = await supabase.from('class_sessions').delete().in('class_id', classes.map((c) => c.id))
    if (error) throw new Error(`class_sessions delete failed: ${error.message}`)
  }

  // ---- REPLACE step 2: regenerate ----
  const windowStart = now - WINDOW_DAYS * DAY
  const sessionRowsAll: Record<string, unknown>[] = []
  const seedRowsAll: Record<string, unknown>[] = []
  const legoRowsAll: Record<string, unknown>[] = []
  const enrollmentPatches: { learner_id: string; course_id: string; patch: Record<string, unknown> }[] = []
  const classLastLegoPatches: { classId: string; lastLegoId: string }[] = []

  for (const { learnerId, cls } of learners) {
    const persona = drawPersona()
    const ceiling = seedCeilingByCourse.get(cls.courseCode) || 40
    const enrollment = enrollmentByLearnerCourse.get(`${learnerId}:${cls.courseCode}`)
    const prevSeed = (enrollment?.highest_completed_seed as number) || 0
    // Anchor to where this learner already was (or seed near the class if
    // fresh), then advance by a persona-sized gain — coherent belts/positions.
    const base = prevSeed > 0 ? prevSeed : Math.max(1, cls.currentSeed - between(8, 14))
    const seeds = Math.max(1, Math.min(ceiling, base + between(persona.seedGain[0], persona.seedGain[1])))

    const nSessions = between(persona.sessions[0], persona.sessions[1])
    const recency = between(persona.recencyDays[0], persona.recencyDays[1])
    // Latest session lands exactly `recency` days back — fast personas today,
    // idle personas stale enough to trip needs-attention honestly.
    let latestMs = 0
    const durations: number[] = []
    for (let k = 0; k < nSessions; k++) {
      const isLast = k === nSessions - 1
      const dayOff = isLast ? recency : Math.max(recency, recentWeightedDayOffset(WINDOW_DAYS))
      const dayStart = now - dayOff * DAY - 12 * 3600000
      const st = weekdayTimestamp(Math.max(windowStart, dayStart), Math.min(now, dayStart + 12 * 3600000))
      const dur = between(480, 1500)
      const items = Math.floor((dur / 60) * between(4, 6))
      sessionRowsAll.push({
        learner_id: learnerId, course_id: cls.courseCode, started_at: st.toISOString(),
        ended_at: new Date(st.getTime() + dur * 1000).toISOString(), duration_seconds: dur,
        items_practiced: items, points_earned: items,
      })
      durations.push(dur)
      latestMs = Math.max(latestMs, st.getTime())
    }

    const enrolledAtMs = enrollment?.enrolled_at
      ? new Date(enrollment.enrolled_at as string).getTime()
      : windowStart
    const arcStart = Math.min(enrolledAtMs, windowStart)
    const arcEnd = latestMs || now
    for (let s = 1; s <= seeds; s++) {
      const sid = `S${String(s).padStart(4, '0')}`
      const introducedAt = new Date(arcStart + (arcEnd - arcStart) * (s / seeds)).toISOString()
      seedRowsAll.push({
        learner_id: learnerId, seed_id: sid, course_id: cls.courseCode,
        thread_id: (s % 3) + 1, is_introduced: true, introduced_at: introducedAt,
      })
      const nLegos = between(3, 4)
      for (let g = 1; g <= nLegos; g++) {
        legoRowsAll.push({
          learner_id: learnerId, lego_id: `${sid}L${String(g).padStart(2, '0')}`, course_id: cls.courseCode,
          thread_id: (s % 3) + 1, fibonacci_position: between(2, 8), skip_number: between(1, 13),
          reps_completed: between(2, 12), is_retired: s < seeds - 4, last_practiced_at: introducedAt,
        })
      }
    }

    const lastLego = `S${String(seeds).padStart(4, '0')}L0${between(1, 4)}`
    const minutes = Math.round(durations.reduce((a, b) => a + b, 0) / 60) + seeds * between(8, 12)
    enrollmentPatches.push({
      learner_id: learnerId,
      course_id: cls.courseCode,
      patch: {
        last_practiced_at: new Date(latestMs || now).toISOString(),
        total_practice_minutes: minutes,
        last_completed_lego_id: lastLego,
        highest_completed_lego_id: lastLego,
        highest_completed_seed: seeds,
        last_completed_round_index: seeds * 3,
        highest_completed_round_index: seeds * 3,
      },
    })
  }

  // Teacher-led class sessions — the SOURCE of school/class rate-of-progress
  // (analytics_class_sessions_scoped reads start→end LEGO ordinals from
  // class_sessions) AND, as of the play-as-class re-anchor, the source of the
  // class's OWN learning identity: every class_sessions row also emits a
  // matching `sessions` row keyed to the class learner id (ONE arc, two
  // projections — never two independently-drawn timelines). The arc must
  // ADVANCE session by session and END at the class's current seed with the
  // latest session landing today — a fixed start/end range would roll the
  // weekly rate down to zero at "now" (the burst-then-dead shape this whole
  // verb exists to kill).
  const classSessionRows: Record<string, unknown>[] = []
  for (const cls of classes) {
    // No resolvable teacher even via class_teachers → no teacher-led arc for
    // this class (class_sessions.teacher_user_id is NOT NULL). Honest skip,
    // loudly — a demo class without a teacher is a tree-shape problem to fix
    // at mint time, not something to paper over with a fake teacher id.
    if (!cls.teacherUserId) {
      console.warn('[demoNodeRefresh] class has no teacher (lead or class_teachers) — skipping class-practice arc:', cls.id)
      continue
    }
    const nCs = between(12, 24)
    // Spread over the full ~8-week window, oldest → newest, latest today:
    // classroom cadence of 2-4 sessions/week (2-4 days apart with jitter), so
    // the rolling weekly rate stays alive across the whole demo window.
    const offsets: number[] = [0]
    let acc = 0
    for (let k = 1; k < nCs; k++) {
      acc += between(2, 4)
      offsets.push(Math.min(acc, WINDOW_DAYS - 2))
    }
    const arcSeeds = Math.min(cls.currentSeed - 1, between(6, 10)) // seeds covered across the arc
    const arcStartSeed = Math.max(1, cls.currentSeed - arcSeeds)
    let newestClassSession: { st: Date; dur: number; endLegoId: string } | null = null
    let classMinutes = 0
    for (let k = 0; k < nCs; k++) {
      const dayOff = offsets[k]
      const dayStart = now - dayOff * DAY - 10 * 3600000
      const st = weekdayTimestamp(Math.max(windowStart, dayStart), Math.min(now, dayStart + 9 * 3600000))
      const dur = between(900, 2100)
      // Session k (dayOff descending in recency as k grows) — map so the
      // OLDEST session starts the arc and the NEWEST ends at current_seed.
      const progress = (nCs - 1 - k) / Math.max(1, nCs - 1) // 0 = oldest, 1 = newest
      const endSeed = Math.round(arcStartSeed + arcSeeds * progress)
      const startSeed = Math.max(1, endSeed - 1)
      const endLegoId = `S${String(endSeed).padStart(4, '0')}L0${between(1, 3)}`
      const cyclesCompleted = Math.floor(dur / 11)
      classSessionRows.push({
        class_id: cls.id,
        teacher_user_id: cls.teacherUserId,
        start_lego_id: `S${String(startSeed).padStart(4, '0')}L01`,
        end_lego_id: endLegoId,
        started_at: st.toISOString(),
        ended_at: new Date(st.getTime() + dur * 1000).toISOString(),
        cycles_completed: cyclesCompleted,
        duration_seconds: dur,
      })
      classMinutes += dur / 60
      if (cls.classLearnerId) {
        // Same source arc — the class-identity practice-hours spine (sessions
        // keyed on class_learner_id) that THE LENS and dashboards read.
        sessionRowsAll.push({
          learner_id: cls.classLearnerId, course_id: cls.courseCode, started_at: st.toISOString(),
          ended_at: new Date(st.getTime() + dur * 1000).toISOString(), duration_seconds: dur,
          items_practiced: cyclesCompleted, points_earned: cyclesCompleted,
        })
      }
      // offsets[0] is always 0 (the arc's most recent session) — k===0 is
      // newest by construction, no need to compare after the fact.
      if (k === 0) newestClassSession = { st, dur, endLegoId }
    }

    if (cls.classLearnerId && newestClassSession) {
      const endSeedNum = parseInt(newestClassSession.endLegoId.slice(1, 5), 10)
      enrollmentPatches.push({
        learner_id: cls.classLearnerId,
        course_id: cls.courseCode,
        patch: {
          last_practiced_at: newestClassSession.st.toISOString(),
          total_practice_minutes: Math.round(classMinutes),
          last_completed_lego_id: newestClassSession.endLegoId,
          highest_completed_lego_id: newestClassSession.endLegoId,
          highest_completed_seed: endSeedNum,
          last_completed_round_index: endSeedNum * 3,
          highest_completed_round_index: endSeedNum * 3,
        },
      })
      classLastLegoPatches.push({ classId: cls.id, lastLegoId: newestClassSession.endLegoId })
    }
  }

  await insertChunked(supabase, 'sessions', sessionRowsAll)
  await insertChunked(supabase, 'seed_progress', seedRowsAll)
  await insertChunked(supabase, 'lego_progress', legoRowsAll, 300)
  await insertChunked(supabase, 'class_sessions', classSessionRows)
  for (const u of enrollmentPatches) {
    const { error } = await supabase
      .from('course_enrollments')
      .update(u.patch)
      .eq('learner_id', u.learner_id)
      .eq('course_id', u.course_id)
    if (error) console.warn('[demoNodeRefresh] course_enrollments update failed for', u.learner_id, error.message)
  }
  for (const p of classLastLegoPatches) {
    const { error } = await supabase.from('classes').update({ last_lego_id: p.lastLegoId }).eq('id', p.classId)
    if (error) console.warn('[demoNodeRefresh] classes.last_lego_id sync failed for', p.classId, error.message)
  }

  try {
    await supabase.from('player_events').insert({
      occurred_at: activityThrough,
      event_type: 'admin_demo_node_activity_refreshed',
      payload: {
        actor_user_id: actorId, group_id: groupId, group_name: group.name,
        learners_touched: learnerIds.length, sessions_written: sessionRowsAll.length,
        class_sessions_written: classSessionRows.length,
      },
    })
  } catch (auditErr) {
    console.warn('[demoNodeRefresh] audit insert threw:', auditErr)
  }

  return {
    groupId,
    schools: schoolIds.length,
    classes: classes.length,
    learnersTouched: learnerIds.length,
    sessionsWritten: sessionRowsAll.length,
    classSessionsWritten: classSessionRows.length,
    seedRowsWritten: seedRowsAll.length,
    legoRowsWritten: legoRowsAll.length,
    activityThrough,
    noop: false,
  }
}
