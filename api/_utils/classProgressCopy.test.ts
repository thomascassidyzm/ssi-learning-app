/**
 * classProgressCopy — the copy engine behind
 * /api/school/copy-teacher-play/{preview,apply}.
 *
 * What these pin, against an in-memory table double that round-trips real
 * rows (a fake that only records calls would pass for the wrong reason):
 *   - the copy re-keys every planned row onto the class learner and leaves
 *     the teacher's rows in place (copy, not move);
 *   - a second run copies NOTHING — the audit record is the idempotency key
 *     for generated-id tables, presence on the class side for natural keys;
 *   - the cursor ends at the FURTHER position, by round then by lego id;
 *   - the audit record names every skipped table with a reason and every
 *     copied source id;
 *   - a table failing part-way is reported, never a false success, and what
 *     landed before it is still in the record.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  planCopy, applyCopy, compareLego, cursorPosition, COPY_TABLES, SKIPPED_TABLES, AUDIT_TABLE,
} from './classProgressCopy'

type Row = Record<string, any>
let DB: Record<string, Row[]>
let nextId = 1
let failOnInsert: string | null = null

function makeQuery(table: string) {
  const filters: Array<[string, any]> = []
  const q: any = {
    select() { return q },
    eq(col: string, val: any) { filters.push([col, val]); return q },
    is(col: string, val: any) { filters.push([col, val]); return q },
    order() { return q },
    range(from: number, to: number) {
      return Promise.resolve({ data: rows().slice(from, to + 1), error: null })
    },
    maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
    single() { const r = rows()[0]; return Promise.resolve({ data: r ?? null, error: r ? null : { message: 'none' } }) },
    then(res: any, rej: any) { return Promise.resolve({ data: rows(), error: null }).then(res, rej) },
    insert(payload: Row | Row[]) {
      const list = Array.isArray(payload) ? payload : [payload]
      if (failOnInsert === table) return { select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }
      const inserted = list.map((r) => {
        const row = { ...r }
        if (table === 'sessions' && !row.id) row.id = `s-new-${nextId++}`
        if (table === 'player_events' && !row.id) row.id = nextId++
        if ((table === 'response_metrics' || table === 'spike_events') && !row.db_id) row.db_id = `m-new-${nextId++}`
        if (table === AUDIT_TABLE) row.id = `audit-${nextId++}`
        if (!('id' in row)) row.id = `row-${nextId++}`
        DB[table].push(row)
        return row
      })
      return {
        select: () => ({
          single: () => Promise.resolve({ data: inserted[0], error: null }),
          then: (res: any, rej: any) => Promise.resolve({ data: inserted, error: null }).then(res, rej),
        }),
      }
    },
    update(patch: Row) {
      const upd: any = {
        eq(col: string, val: any) { filters.push([col, val]); return upd },
        then(res: any, rej: any) {
          for (const r of rows()) Object.assign(r, patch)
          return Promise.resolve({ data: null, error: null }).then(res, rej)
        },
      }
      return upd
    },
  }
  function rows(): Row[] {
    return (DB[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v))
  }
  return q
}
const svc: any = { from: (t: string) => makeQuery(t) }

const TEACHER = 'teacher-learner', CLASS = 'class-learner', COURSE = 'cym_s_for_eng'

beforeEach(() => {
  nextId = 1
  failOnInsert = null
  DB = Object.fromEntries([...COPY_TABLES.map((s) => s.table), 'course_enrollments', AUDIT_TABLE].map((t) => [t, []]))
  DB.sessions.push({ id: 's1', learner_id: TEACHER, course_id: COURSE, duration_seconds: 60 })
  DB.sessions.push({ id: 's2', learner_id: TEACHER, course_id: COURSE, duration_seconds: 30 })
  DB.sessions.push({ id: 's-other', learner_id: TEACHER, course_id: 'spa_for_eng', duration_seconds: 30 })
  DB.player_events.push({ id: 1, user_id: TEACHER, learner_id: TEACHER, course_code: COURSE, occurred_at: '2026-09-10T07:00:00Z', event_type: 'tap_play' })
  DB.player_events.push({ id: 2, user_id: TEACHER, learner_id: TEACHER, course_code: COURSE, occurred_at: '2026-09-10T07:02:00Z', event_type: 'audio_play' })
  DB.response_metrics.push({ db_id: 'rm1', learner_id: TEACHER, course_id: COURSE, session_id: 's1', response_latency_ms: 900 })
  DB.lego_progress.push({ id: 'lp1', learner_id: TEACHER, course_id: COURSE, lego_id: 'S0001L01', reps_completed: 3 })
  DB.learner_speaking_opportunities.push({ learner_id: TEACHER, course_code: COURSE, day: '2026-09-10', play_seconds: 83 })
  DB.learner_speaking_opportunities.push({ learner_id: CLASS, course_code: COURSE, day: '2026-09-10', play_seconds: 5 })
  DB.course_enrollments.push({ learner_id: TEACHER, course_id: COURSE, last_completed_lego_id: 'S0008L01', last_completed_round_index: 13, highest_completed_lego_id: null, highest_completed_round_index: null, current_cycle_index: 0, current_mode: 'main', helix_state: { t: 1 }, total_practice_minutes: 4, last_practiced_at: '2026-09-11T14:07:01Z', completed_pod_rounds: 0, rounds_since_pod: 0, pod_activation_round: null, infplay_round_index: 0 })
  DB.course_enrollments.push({ learner_id: CLASS, course_id: COURSE, last_completed_lego_id: 'S0002L01', last_completed_round_index: 2, highest_completed_lego_id: null, highest_completed_round_index: null, current_cycle_index: 0, current_mode: 'main', helix_state: { t: 0 }, total_practice_minutes: 1, last_practiced_at: '2026-09-01T00:00:00Z', completed_pod_rounds: 0, rounds_since_pod: 0, pod_activation_round: null, infplay_round_index: 0 })
})

const params = { sourceLearnerId: TEACHER, targetLearnerId: CLASS, courseCode: COURSE }

describe('planCopy (the preview)', () => {
  it('counts only the class course, skips natural keys the class already holds, and writes nothing', async () => {
    const before = JSON.stringify(DB)
    const plan = await planCopy(svc, params)
    expect(plan.toCopy.sessions).toBe(2)            // s-other is Spanish — not this class's course
    expect(plan.toCopy.player_events).toBe(2)
    expect(plan.toCopy.response_metrics).toBe(1)
    expect(plan.toCopy.lego_progress).toBe(1)
    expect(plan.toCopy.learner_speaking_opportunities).toBe(0)
    expect(plan.alreadyPresent.learner_speaking_opportunities).toBe(1)
    expect(plan.resulting).toEqual({ legoId: 'S0008L01', roundIndex: 13, takenFromSource: true })
    expect(plan.inAppSecondsToCopy).toBe(120)
    expect(plan.minutesToAdd).toBe(4)
    expect(plan.skipped).toBe(SKIPPED_TABLES)
    expect(JSON.stringify(DB)).toBe(before)
  })
})

describe('applyCopy', () => {
  it('copies re-keyed rows onto the class learner, keeps the teacher rows, remaps session ids, merges the cursor, writes one audit record', async () => {
    const plan = await planCopy(svc, params)
    const { record, auditId, error } = await applyCopy(svc, plan, { actorUserId: 'angharad', classId: 'class-1' })
    expect(error).toBeNull()
    expect(auditId).toBe(DB[AUDIT_TABLE][0].id)
    const classSessions = DB.sessions.filter((r) => r.learner_id === CLASS)
    expect(classSessions).toHaveLength(2)
    expect(DB.sessions.filter((r) => r.learner_id === TEACHER)).toHaveLength(3) // copy, not move
    const classEvents = DB.player_events.filter((r) => r.learner_id === CLASS)
    expect(classEvents).toHaveLength(2)
    expect(classEvents.every((r) => r.user_id === CLASS)).toBe(true) // player_events.user_id holds the learner PK
    const classMetric = DB.response_metrics.find((r) => r.learner_id === CLASS)
    expect(classMetric.session_id).toBe(record.copied.sessions['s1']) // remapped through the sessions map
    expect(classMetric.db_id).not.toBe('rm1')
    const classCursor = DB.course_enrollments.find((r) => r.learner_id === CLASS)
    expect(classCursor.last_completed_lego_id).toBe('S0008L01')
    expect(classCursor.last_completed_round_index).toBe(13)
    expect(classCursor.helix_state).toEqual({ t: 1 })
    expect(classCursor.total_practice_minutes).toBe(5)
    expect(classCursor.last_practiced_at).toBe('2026-09-11T14:07:01Z')
    expect(DB.course_enrollments).toHaveLength(2) // never a duplicate enrollment
    const audit = DB[AUDIT_TABLE][0]
    expect(audit.actor_user_id).toBe('angharad')
    expect(audit.source_learner_id).toBe(TEACHER)
    expect(audit.target_learner_id).toBe(CLASS)
    expect(Object.keys(audit.record.copied.sessions)).toEqual(['s1', 's2'])
    expect(audit.record.skipped.map((s: any) => s.table)).toContain('subscriptions')
    expect(audit.record.cursorTakenFromSource).toBe(true)
    expect(audit.record.minutesAdded).toBe(4)
  })

  it('a second run is a no-op: nothing copied again, minutes not re-added, cursor untouched', async () => {
    await applyCopy(svc, await planCopy(svc, params), { actorUserId: 'angharad', classId: 'class-1' })
    const snapshot = JSON.stringify({ ...DB, [AUDIT_TABLE]: undefined })
    const plan2 = await planCopy(svc, params)
    expect(Object.values(plan2.toCopy).every((n) => n === 0)).toBe(true)
    expect(plan2.alreadyPresent.sessions).toBe(2)
    expect(plan2.minutesToAdd).toBe(0)
    expect(plan2.resulting.takenFromSource).toBe(false)
    expect(plan2.priorRuns).toBe(1)
    const { error } = await applyCopy(svc, plan2, { actorUserId: 'angharad', classId: 'class-1' })
    expect(error).toBeNull()
    expect(JSON.stringify({ ...DB, [AUDIT_TABLE]: undefined })).toBe(snapshot)
    expect(DB[AUDIT_TABLE]).toHaveLength(2) // the no-op is still recorded
  })

  it('the class keeps its own cursor when it is already further than the teacher', async () => {
    const cls = DB.course_enrollments.find((r) => r.learner_id === CLASS)
    cls.last_completed_lego_id = 'S0020L02'; cls.last_completed_round_index = 40; cls.helix_state = { t: 0 }
    const plan = await planCopy(svc, params)
    expect(plan.resulting).toEqual({ legoId: 'S0020L02', roundIndex: 40, takenFromSource: false })
    await applyCopy(svc, plan, { actorUserId: 'angharad', classId: 'class-1' })
    expect(cls.last_completed_lego_id).toBe('S0020L02')
    expect(cls.helix_state).toEqual({ t: 0 })
  })

  it('a table failing part-way is reported as an error, and what landed is still in the record', async () => {
    failOnInsert = 'response_metrics'
    const plan = await planCopy(svc, params)
    const { record, error } = await applyCopy(svc, plan, { actorUserId: 'angharad', classId: 'class-1' })
    expect(error).toMatch(/^response_metrics: boom/)
    expect(Object.keys(record.copied.sessions)).toHaveLength(2)
    expect(record.copied.response_metrics).toEqual({})
    expect(record.cursorTakenFromSource).toBe(false)
    expect(DB.course_enrollments.find((r) => r.learner_id === CLASS).last_completed_lego_id).toBe('S0002L01')
    expect(DB[AUDIT_TABLE][0].record.error).toMatch(/response_metrics/)
    // and the next preview does not offer the landed sessions again
    failOnInsert = null
    const plan2 = await planCopy(svc, params)
    expect(plan2.toCopy.sessions).toBe(0)
    expect(plan2.toCopy.response_metrics).toBe(1)
  })
})

describe('position arithmetic', () => {
  it('compares by round index first, then by zero-padded lego id, and null is furthest behind', () => {
    expect(compareLego({ legoId: 'S0008L01', roundIndex: 13 }, { legoId: 'S0009L01', roundIndex: 12 })).toBe(1)
    expect(compareLego({ legoId: 'S0008L01', roundIndex: null }, { legoId: 'S0010L01', roundIndex: 3 })).toBe(-1)
    expect(compareLego({ legoId: null, roundIndex: null }, { legoId: 'S0001L01', roundIndex: 0 })).toBe(-1)
    expect(compareLego({ legoId: null, roundIndex: null }, { legoId: null, roundIndex: null })).toBe(0)
  })
  it('cursorPosition takes the further of highest_* and last_*', () => {
    expect(cursorPosition({ last_completed_lego_id: 'S0008L01', last_completed_round_index: 13, highest_completed_lego_id: 'S0005L01', highest_completed_round_index: 7 } as any))
      .toEqual({ legoId: 'S0008L01', roundIndex: 13 })
    expect(cursorPosition(null)).toEqual({ legoId: null, roundIndex: null })
  })
})
