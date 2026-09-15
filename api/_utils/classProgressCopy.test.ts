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
  planCopy, applyCopy as applyCopyRaw, undoCopy, compareLego, cursorPosition, COPY_TABLES, SKIPPED_TABLES, AUDIT_TABLE,
} from './classProgressCopy'
import { backfillCopyNotices } from './copyPlayNotice'

type Row = Record<string, any>
let DB: Record<string, Row[]>
let nextId = 1
let failOnInsert: string | null = null
let failOnDelete: string | null = null
/** Fail an update when this returns true — set per test for the audit-finalisation path. */
let failOnUpdate: ((table: string, patch: Row) => boolean) | null = null

const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)))

function makeQuery(table: string) {
  const filters: Array<(r: Row) => boolean> = []
  const q: any = {
    select() { return q },
    eq(col: string, val: any) { filters.push((r) => cell(r, col) === val); return q },
    is(col: string, val: any) { filters.push((r) => r[col] == val); return q },
    gt(col: string, val: any) { filters.push((r) => r[col] != null && String(r[col]) > String(val)); return q },
    lt(col: string, val: any) { filters.push((r) => r[col] != null && String(r[col]) < String(val)); return q },
    in(col: string, vals: any[]) { const set = new Set(vals.map(String)); filters.push((r) => set.has(String(r[col]))); return q },
    limit() { return q },
    delete() {
      const del: any = {
        eq(col: string, val: any) { filters.push((r) => r[col] === val); return del },
        in(col: string, vals: any[]) { const set = new Set(vals.map(String)); filters.push((r) => set.has(String(r[col]))); return del },
        then(res: any, rej: any) {
          if (failOnDelete === table) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(res, rej)
          const gone = new Set(rows())
          DB[table] = (DB[table] ?? []).filter((r) => !gone.has(r))
          return Promise.resolve({ data: null, error: null }).then(res, rej)
        },
      }
      return del
    },
    upsert(payload: Row, opts: { onConflict: string }) {
      const dup = (DB[table] ?? []).some((r) => r[opts.onConflict] != null && r[opts.onConflict] === payload[opts.onConflict])
      if (dup) return { select: () => Promise.resolve({ data: [], error: null }) }
      return q.insert(payload)
    },
    order() { return q },
    // Reads hand back COPIES, as PostgREST does: a snapshot taken before an
    // update must not change under it.
    range(from: number, to: number) {
      return Promise.resolve({ data: clone(rows().slice(from, to + 1)), error: null })
    },
    maybeSingle() { return Promise.resolve({ data: clone(rows()[0] ?? null), error: null }) },
    single() { const r = rows()[0]; return Promise.resolve({ data: clone(r ?? null), error: r ? null : { message: 'none' } }) },
    then(res: any, rej: any) { return Promise.resolve({ data: clone(rows()), error: null }).then(res, rej) },
    insert(payload: Row | Row[]) {
      const list = Array.isArray(payload) ? payload : [payload]
      if (failOnInsert === table) return { select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }
      // The live partial unique index (20260915b): one {state: running}
      // audit row per source learner + course, enforced by the DATABASE.
      if (table === AUDIT_TABLE) {
        for (const r of list) {
          const clash = r.record?.state === 'running' && (DB[table] ?? []).some((x) =>
            x.record?.state === 'running' && x.source_learner_id === r.source_learner_id && x.course_code === r.course_code)
          if (clash) {
            const error = { code: '23505', message: 'duplicate key value violates unique constraint "uq_class_progress_copy_audit_running_claim"' }
            return { select: () => ({ single: () => Promise.resolve({ data: null, error }), then: (res: any, rej: any) => Promise.resolve({ data: null, error }).then(res, rej) }) }
          }
        }
      }
      const inserted = list.map((r) => {
        const row = { ...r }
        if (table === 'sessions' && !row.id) row.id = `s-new-${nextId++}`
        if (table === 'player_events' && !row.id) row.id = nextId++
        if ((table === 'response_metrics' || table === 'spike_events') && !row.db_id) row.db_id = `m-new-${nextId++}`
        if (table === AUDIT_TABLE) { row.id = `audit-${nextId++}`; row.created_at ??= new Date().toISOString() }
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
        eq(col: string, val: any) { filters.push((r) => cell(r, col) === val); return upd },
        is(col: string, val: any) { filters.push((r) => r[col] == val); return upd },
        then(res: any, rej: any) {
          if (failOnUpdate?.(table, patch)) return Promise.resolve({ data: null, error: { message: 'audit boom' } }).then(res, rej)
          for (const r of rows()) Object.assign(r, patch)
          return Promise.resolve({ data: null, error: null }).then(res, rej)
        },
      }
      return upd
    },
  }
  function rows(): Row[] {
    return (DB[table] ?? []).filter((r) => filters.every((f) => f(r)))
  }
  // `record->>state` reads into the JSON column, as PostgREST does.
  function cell(r: Row, col: string): any {
    const m = col.match(/^(\w+)->>(\w+)$/)
    return m ? r[m[1]]?.[m[2]] : r[col]
  }
  return q
}
const svc: any = { from: (t: string) => makeQuery(t) }

const TEACHER = 'teacher-learner', CLASS = 'class-learner', COURSE = 'cym_s_for_eng'

beforeEach(() => {
  nextId = 1
  failOnInsert = null
  failOnDelete = null
  failOnUpdate = null
  DB = Object.fromEntries([...COPY_TABLES.map((s) => s.table), 'course_enrollments', AUDIT_TABLE, 'learners', 'classes', 'courses', 'user_messages'].map((t) => [t, []]))
  DB.learners.push({ id: TEACHER, user_id: 'teacher-uid' })
  DB.classes.push({ id: 'class-1', class_name: 'Year 7 Spanish' })
  DB.courses.push({ course_code: COURSE, display_name: 'Welsh (South)', learner_display_name: 'Welsh' })
  DB.sessions.push({ id: 's1', learner_id: TEACHER, course_id: COURSE, duration_seconds: 60, started_at: '2026-09-10T07:00:00Z' })
  DB.sessions.push({ id: 's2', learner_id: TEACHER, course_id: COURSE, duration_seconds: 30, started_at: '2026-09-10T08:00:00Z' })
  // What the class account held BEFORE any copy: must survive an undo untouched.
  DB.sessions.push({ id: 's-class-old', learner_id: CLASS, course_id: COURSE, duration_seconds: 20, started_at: '2026-09-01T09:00:00Z' })
  DB.lego_progress.push({ id: 'lp-class-old', learner_id: CLASS, course_id: COURSE, lego_id: 'S0002L01', reps_completed: 1 })
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
/** The apply, asserting the claim was taken (every non-concurrent test). */
async function applyCopy(svc: any, p: typeof params, ctx: { actorUserId: string; classId: string }) {
  const out = await applyCopyRaw(svc, p, ctx)
  if (out.conflict) throw new Error('unexpected claim conflict')
  return out
}

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
  it.each(['overlapping', 'serial control'] as const)(
    'ONE CLASS: %s requests copy each source session onto at most one class (verify #808)',
    async (schedule) => {
      const CLASS2 = 'class2-learner'
      DB.classes.push({ id: 'class-2', class_name: 'Year 8 Welsh' })
      DB.course_enrollments.push({
        ...clone(DB.course_enrollments.find((r) => r.learner_id === CLASS)),
        learner_id: CLASS2,
      })
      const sourceSessions = clone(DB.sessions.filter((r) => r.learner_id === TEACHER && r.course_id === COURSE))
      const existingClassSessions = clone(DB.sessions.filter((r) => r.learner_id === CLASS))
      const requests = [
        { targetLearnerId: CLASS, classId: 'class-1' },
        { targetLearnerId: CLASS2, classId: 'class-2' },
      ]
      // Since #811 the apply takes the claim BEFORE it plans, so a plan can no
      // longer be held across another request's insert: the race is two
      // applies in flight at once, and the claim index (one running claim per
      // source learner + course) lets exactly one of them through.
      const apply = (targetLearnerId: string, classId: string) =>
        applyCopyRaw(svc, { ...params, targetLearnerId }, { actorUserId: 'angharad', classId })

      if (schedule === 'overlapping') {
        expect(DB[AUDIT_TABLE]).toHaveLength(0)
        const outcomes = await Promise.all(requests.map(({ targetLearnerId, classId }) => apply(targetLearnerId, classId)))
        expect(outcomes.filter((o) => o.conflict)).toHaveLength(1)
        const winner = outcomes.find((o) => !o.conflict)!
        if (!winner.conflict) expect(winner.error).toBeNull()
      } else {
        // Positive control: the same invariant holds when the second plan
        // sees the first audit. This is not evidence of an atomic fix.
        for (const { targetLearnerId, classId } of requests) {
          const result = await apply(targetLearnerId, classId)
          expect(result.conflict).toBe(false)
          if (!result.conflict) expect(result.error).toBeNull()
        }
      }

      // Inspect actual landed rows: unique generated IDs or audit counts alone
      // would miss the same source play being credited to two classes.
      const landed = DB.sessions.filter((r) =>
        [CLASS, CLASS2].includes(r.learner_id) && r.course_id === COURSE &&
        !existingClassSessions.some((old) => old.id === r.id))
      for (const source of sourceSessions) {
        expect(landed.filter((r) => r.started_at === source.started_at &&
          r.duration_seconds === source.duration_seconds),
        `source session ${source.id} must land exactly once across both classes`).toHaveLength(1)
      }
      expect(landed).toHaveLength(sourceSessions.length)
      expect(DB.sessions.filter((r) => r.learner_id === TEACHER && r.course_id === COURSE)).toEqual(sourceSessions)
      expect(DB.sessions.filter((r) => existingClassSessions.some((old) => old.id === r.id))).toEqual(existingClassSessions)
    },
  )

  it('copies re-keyed rows onto the class learner, keeps the teacher rows, remaps session ids, merges the cursor, writes one audit record', async () => {
    const plan = await planCopy(svc, params)
    const { record, auditId, error } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect(error).toBeNull()
    expect(auditId).toBe(DB[AUDIT_TABLE][0].id)
    const classSessions = DB.sessions.filter((r) => r.learner_id === CLASS)
    expect(classSessions).toHaveLength(3) // two copied, plus the one the class already had
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
    await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    const snapshot = JSON.stringify({ ...DB, [AUDIT_TABLE]: undefined })
    const plan2 = await planCopy(svc, params)
    expect(Object.values(plan2.toCopy).every((n) => n === 0)).toBe(true)
    expect(plan2.alreadyPresent.sessions).toBe(2)
    expect(plan2.minutesToAdd).toBe(0)
    expect(plan2.resulting.takenFromSource).toBe(false)
    expect(plan2.priorRuns).toBe(1)
    const { error } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect(error).toBeNull()
    expect(JSON.stringify({ ...DB, [AUDIT_TABLE]: undefined })).toBe(snapshot)
    expect(DB[AUDIT_TABLE]).toHaveLength(2) // the no-op is still recorded
  })

  it('ONE CLASS: play copied onto one class is not offered to, or copied onto, a second class (job #792)', async () => {
    // A teacher tagged on two classes for the same course — Chepstow 2026-09-15:
    // roseribbeck's own play went onto her 11S AND a colleague's 7E.
    const CLASS2 = 'class2-learner'
    DB.course_enrollments.push({ learner_id: CLASS2, course_id: COURSE, last_completed_lego_id: 'S0001L01', last_completed_round_index: 0, highest_completed_lego_id: null, highest_completed_round_index: null, current_cycle_index: 0, current_mode: 'main', helix_state: { t: 0 }, total_practice_minutes: 0, last_practiced_at: null, completed_pod_rounds: 0, rounds_since_pod: 0, pod_activation_round: null, infplay_round_index: 0 })
    await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })

    const plan2 = await planCopy(svc, { ...params, targetLearnerId: CLASS2 })
    // Every row the first copy inserted is off the table for the second class.
    // (The fixture's speaking-opportunities day row was never copied — the
    // first class already held that day — so the audit does not name it and
    // it is the one natural-key row still on offer; the ledger and the diary,
    // which carry the practice figures, are what the rule protects.)
    expect(plan2.toCopy.sessions).toBe(0)
    expect(plan2.toCopy.player_events).toBe(0)
    expect(plan2.toCopy.response_metrics).toBe(0)
    expect(plan2.toCopy.lego_progress).toBe(0)
    expect(plan2.alreadyPresent.sessions).toBe(2)
    expect(plan2.copiedElsewhere).toEqual({ classIds: ['class-1'], rows: 6 }) // 2 sessions + 2 diary + 1 metric + 1 lego
    expect(plan2.resulting.takenFromSource).toBe(false) // the second class keeps its own position
    expect(plan2.minutesToAdd).toBe(0)
    expect(plan2.priorRuns).toBe(0)

    const { error } = await applyCopy(svc, { ...params, targetLearnerId: CLASS2 }, { actorUserId: 'angharad', classId: 'class-2' })
    expect(error).toBeNull()
    expect(DB.sessions.filter((r) => r.learner_id === CLASS2)).toHaveLength(0)
    expect(DB.player_events.filter((r) => r.learner_id === CLASS2)).toHaveLength(0)
    const cursor2 = DB.course_enrollments.find((r) => r.learner_id === CLASS2)
    expect(cursor2.last_completed_lego_id).toBe('S0001L01')
    expect(cursor2.total_practice_minutes).toBe(0)
  })

  it('ONE CLASS: after an undo the play can go onto the other class', async () => {
    const CLASS2 = 'class2-learner'
    DB.course_enrollments.push({ learner_id: CLASS2, course_id: COURSE, last_completed_lego_id: null, last_completed_round_index: null, highest_completed_lego_id: null, highest_completed_round_index: null, current_cycle_index: 0, current_mode: 'main', helix_state: null, total_practice_minutes: 0, last_practiced_at: null, completed_pod_rounds: 0, rounds_since_pod: 0, pod_activation_round: null, infplay_round_index: 0 })
    const { auditId } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    const undo = await undoCopy(svc, String(auditId), { actorUserId: 'angharad' })
    expect(undo.ok).toBe(true)
    const plan2 = await planCopy(svc, { ...params, targetLearnerId: CLASS2 })
    expect(plan2.toCopy.sessions).toBe(2)
    expect(plan2.copiedElsewhere).toEqual({ classIds: [], rows: 0 })
    expect(plan2.resulting.takenFromSource).toBe(true)
  })

  it('the class keeps its own cursor when it is already further than the teacher', async () => {
    const cls = DB.course_enrollments.find((r) => r.learner_id === CLASS)
    cls.last_completed_lego_id = 'S0020L02'; cls.last_completed_round_index = 40; cls.helix_state = { t: 0 }
    const plan = await planCopy(svc, params)
    expect(plan.resulting).toEqual({ legoId: 'S0020L02', roundIndex: 40, takenFromSource: false })
    await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect(cls.last_completed_lego_id).toBe('S0020L02')
    expect(cls.helix_state).toEqual({ t: 0 })
  })

  it('a table failing part-way is reported as an error, and what landed is still in the record', async () => {
    failOnInsert = 'response_metrics'
    const plan = await planCopy(svc, params)
    const { record, error } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
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


describe('the copy notice (job #684)', () => {
  it('lands once in the teacher\'s inbox with the undo action, and the backfill does not double it', async () => {
    await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect(DB.user_messages).toHaveLength(1)
    const m = DB.user_messages[0]
    expect(m.recipient_user_id).toBe('teacher-uid')
    expect(m.source).toBe('class_play_copied')
    expect(m.title).toBe("Your own practice on Welsh is now on Year 7 Spanish's account")
    expect(m.action.kind).toBe('undo_class_play_copy')
    expect(m.action.payload.audit_id).toBe(DB[AUDIT_TABLE][0].id)
    expect(m.dedupe_key).toBe(`class_play_copied:${DB[AUDIT_TABLE][0].id}`)
    expect(m.read_at).toBeUndefined() // delivered is not seen
    const outcome = await backfillCopyNotices(svc)
    expect(outcome).toMatchObject({ considered: 1, sent: 0, already: 1 })
    expect(DB.user_messages).toHaveLength(1)
  })

  it('a no-op second run sends nothing', async () => {
    await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect(DB[AUDIT_TABLE]).toHaveLength(2)
    expect(DB.user_messages).toHaveLength(1)
  })
})

describe('applyCopy — two concurrent requests (job #811: 7E was credited 22 + 29 duplicated items)', () => {
  it('exactly one copies; the other is refused by the claim index and writes nothing', async () => {
    const ctx = { actorUserId: 'angharad', classId: 'class-1' }
    const [a, b] = await Promise.all([applyCopyRaw(svc, params, ctx), applyCopyRaw(svc, params, ctx)])
    const outcomes = [a, b]
    expect(outcomes.filter((o) => o.conflict)).toHaveLength(1)
    const winner = outcomes.find((o) => !o.conflict)!
    expect(winner.conflict).toBe(false)
    if (winner.conflict) return
    expect(winner.error).toBeNull()
    // The class holds the teacher's two sessions ONCE, plus its own old one.
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)
    expect(DB.player_events.filter((r) => r.learner_id === CLASS)).toHaveLength(2)
    expect(DB.response_metrics.filter((r) => r.learner_id === CLASS)).toHaveLength(1)
    // Minutes added once; one audit row, finalised (no running claim left).
    expect(DB.course_enrollments.find((r) => r.learner_id === CLASS).total_practice_minutes).toBe(5)
    expect(DB[AUDIT_TABLE]).toHaveLength(1)
    expect(DB[AUDIT_TABLE][0].record.state).toBeUndefined()
    expect(Object.keys(DB[AUDIT_TABLE][0].record.copied.sessions)).toEqual(['s1', 's2'])
  })

  it('after the winner finishes, the next apply takes the claim and is the usual no-op', async () => {
    const ctx = { actorUserId: 'angharad', classId: 'class-1' }
    await Promise.all([applyCopyRaw(svc, params, ctx), applyCopyRaw(svc, params, ctx)])
    const again = await applyCopyRaw(svc, params, ctx)
    expect(again.conflict).toBe(false)
    if (again.conflict) return
    expect(again.error).toBeNull()
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)
    expect(DB[AUDIT_TABLE]).toHaveLength(2)
  })

  it('a stale running claim (its holder died) is abandoned and no longer blocks; a fresh one does', async () => {
    const ctx = { actorUserId: 'angharad', classId: 'class-1' }
    DB[AUDIT_TABLE].push({ id: 'dead-claim', created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), actor_user_id: 'x', class_id: 'class-1', course_code: COURSE, source_learner_id: TEACHER, target_learner_id: CLASS, record: { state: 'running', started_at: 'x' } })
    const out = await applyCopyRaw(svc, params, ctx)
    expect(out.conflict).toBe(false)
    expect(DB[AUDIT_TABLE].find((r) => r.id === 'dead-claim').record.state).toBe('abandoned')
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)

    DB[AUDIT_TABLE].push({ id: 'live-claim', created_at: new Date().toISOString(), actor_user_id: 'x', class_id: 'class-1', course_code: COURSE, source_learner_id: TEACHER, target_learner_id: CLASS, record: { state: 'running', started_at: 'x' } })
    const blocked = await applyCopyRaw(svc, params, ctx)
    expect(blocked.conflict).toBe(true)
    // An abandoned or running claim is never a copy: not undoable, not a prior run.
    expect((await undoCopy(svc, 'dead-claim', { actorUserId: 'angharad' })).ok).toBe(false)
  })

  it('a planning failure releases the claim so the next apply can run', async () => {
    const ctx = { actorUserId: 'angharad', classId: 'class-1' }
    await expect(applyCopyRaw(svc, { ...params, targetLearnerId: TEACHER }, ctx)).rejects.toThrow(/same learner/)
    expect(DB[AUDIT_TABLE][0].record.state).toBe('abandoned')
    const out = await applyCopyRaw(svc, params, ctx)
    expect(out.conflict).toBe(false)
  })

  it('audit finalisation failing AFTER the rows landed: the retry copies nothing again (job #841)', async () => {
    const ctx = { actorUserId: 'angharad', classId: 'class-1' }
    // The finalising write is the one that turns the claim into the full
    // record, i.e. the patch whose record carries no `state`. Checkpoints
    // and the release still go through.
    failOnUpdate = (table, patch) => table === AUDIT_TABLE && patch.record && patch.record.state === undefined
    const first = await applyCopyRaw(svc, params, ctx)
    expect(first.conflict).toBe(false)
    if (first.conflict) return
    expect(first.error).toMatch(/^audit: audit boom/)
    // Rows landed and minutes were added before the finalisation failed.
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)
    expect(DB.course_enrollments.find((r) => r.learner_id === CLASS).total_practice_minutes).toBe(5)
    const claim = DB[AUDIT_TABLE][0]
    failOnUpdate = null
    // Whether the claim was released or has gone stale, the next apply must
    // find the landed ids and copy NOTHING twice.
    claim.created_at = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const plan = await planCopy(svc, params)
    expect(plan.toCopy.sessions).toBe(0)
    expect(plan.toCopy.player_events).toBe(0)
    expect(plan.toCopy.response_metrics).toBe(0)
    expect(plan.minutesToAdd).toBe(0)
    const retry = await applyCopyRaw(svc, params, ctx)
    expect(retry.conflict).toBe(false)
    if (retry.conflict) return
    expect(retry.error).toBeNull()
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)
    expect(DB.player_events.filter((r) => r.learner_id === CLASS)).toHaveLength(2)
    expect(DB.response_metrics.filter((r) => r.learner_id === CLASS)).toHaveLength(1)
    expect(DB.course_enrollments.find((r) => r.learner_id === CLASS).total_practice_minutes).toBe(5)
    // The failed run's claim is not a finished record and was released, not
    // left running; the retry's own row is the finished record.
    expect(claim.record.state).toBe('abandoned')
    expect(Object.keys(claim.record.copied.sessions)).toEqual(['s1', 's2'])
    expect(DB[AUDIT_TABLE]).toHaveLength(2)
  })
})

describe('undoCopy (job #684)', () => {
  it('removes exactly the copied ids, leaves the rows the class held before untouched, restores the cursor, and lets the copy run again', async () => {
    const { auditId } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)
    expect(DB.lego_progress.filter((r) => r.learner_id === CLASS)).toHaveLength(2)

    const outcome = await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.deleted).toMatchObject({ sessions: 2, player_events: 2, response_metrics: 1, lego_progress: 1 })

    // Exactly the copied rows are gone; the class's own rows survive.
    expect(DB.sessions.filter((r) => r.learner_id === CLASS).map((r) => r.id)).toEqual(['s-class-old'])
    expect(DB.player_events.filter((r) => r.learner_id === CLASS)).toHaveLength(0)
    expect(DB.response_metrics.filter((r) => r.learner_id === CLASS)).toHaveLength(0)
    expect(DB.lego_progress.filter((r) => r.learner_id === CLASS).map((r) => r.id)).toEqual(['lp-class-old'])
    // The teacher's rows were never touched.
    expect(DB.sessions.filter((r) => r.learner_id === TEACHER)).toHaveLength(3)
    expect(DB.lego_progress.filter((r) => r.learner_id === TEACHER)).toHaveLength(1)
    // Cursor and minutes back to before.
    const cls = DB.course_enrollments.find((r) => r.learner_id === CLASS)
    expect(cls.last_completed_lego_id).toBe('S0002L01')
    expect(cls.last_completed_round_index).toBe(2)
    expect(cls.helix_state).toEqual({ t: 0 })
    expect(cls.total_practice_minutes).toBe(1)
    expect(cls.last_practiced_at).toBe('2026-09-01T00:00:00Z')
    // Append-only trail: the undo is a second row naming the first.
    expect(DB[AUDIT_TABLE]).toHaveLength(2)
    expect(DB[AUDIT_TABLE][1].record.undo_of).toBe(auditId)
    expect(DB[AUDIT_TABLE][1].record.deleted.sessions).toHaveLength(2)
    expect(DB[AUDIT_TABLE][1].actor_user_id).toBe('teacher-uid')
    // And the next preview offers the rows again: undo made re-copy possible.
    const plan = await planCopy(svc, params)
    expect(plan.toCopy.sessions).toBe(2)
    expect(plan.priorRuns).toBe(0)
  })

  it('refuses when the class account has played since the copy, and deletes nothing', async () => {
    const { auditId } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    DB.sessions.push({ id: 's-class-new', learner_id: CLASS, course_id: COURSE, duration_seconds: 9, started_at: '2999-01-01T00:00:00Z' })
    const before = JSON.stringify(DB)
    const outcome = await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })
    expect(outcome).toEqual({ ok: false, reason: 'played_since' })
    expect(JSON.stringify(DB)).toBe(before)
  })

  it('refuses a second undo of the same copy', async () => {
    const { auditId } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    expect((await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })).ok).toBe(true)
    expect(await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })).toEqual({ ok: false, reason: 'already_undone' })
    expect(DB[AUDIT_TABLE]).toHaveLength(2)
  })

  it('a failed undo is not recorded as an undo: the retry completes the deletion and only then is the copy marked undone (job #689)', async () => {
    const { auditId } = await applyCopy(svc, params, { actorUserId: 'angharad', classId: 'class-1' })
    // Deletion runs children-first (COPY_TABLES reversed), so by the time
    // player_events fails, response_metrics and lego_progress are already
    // gone and the copy is half-deleted.
    failOnDelete = 'player_events'
    const first = await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })
    expect(first).toMatchObject({ ok: false, reason: 'error', detail: expect.stringMatching(/^player_events: boom/) })
    expect(DB.response_metrics.filter((r) => r.learner_id === CLASS)).toHaveLength(0)
    expect(DB.lego_progress.filter((r) => r.learner_id === CLASS)).toHaveLength(1)
    expect(DB.player_events.filter((r) => r.learner_id === CLASS)).toHaveLength(2)
    expect(DB.sessions.filter((r) => r.learner_id === CLASS)).toHaveLength(3)
    // Cursor untouched: the copy is still in force.
    expect(DB.course_enrollments.find((r) => r.learner_id === CLASS).last_completed_lego_id).toBe('S0008L01')
    // The failure is on the trail, but NOT as an undo of the copy.
    expect(DB[AUDIT_TABLE].some((r) => r.record.undo_of === auditId)).toBe(false)
    expect(DB[AUDIT_TABLE].some((r) => r.record.undo_failed_of === auditId)).toBe(true)
    // The copy is still counted as in force by the next preview.
    expect((await planCopy(svc, params)).priorRuns).toBe(1)

    // Retry with the table healthy: already-missing children are fine, the
    // rest goes, the cursor is restored, and NOW the copy is marked undone.
    failOnDelete = null
    const second = await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    // Generated-key tables record the ids the delete covered (idempotent: a
    // row already gone is fine); natural-key tables record what they found.
    expect(second.deleted).toMatchObject({ sessions: 2, player_events: 2, response_metrics: 1, lego_progress: 0 })
    expect(DB.player_events.filter((r) => r.learner_id === CLASS)).toHaveLength(0)
    expect(DB.sessions.filter((r) => r.learner_id === CLASS).map((r) => r.id)).toEqual(['s-class-old'])
    expect(DB.course_enrollments.find((r) => r.learner_id === CLASS).last_completed_lego_id).toBe('S0002L01')
    expect(DB[AUDIT_TABLE].filter((r) => r.record.undo_of === auditId)).toHaveLength(1)
    expect(await undoCopy(svc, auditId!, { actorUserId: 'teacher-uid' })).toEqual({ ok: false, reason: 'already_undone' })
    expect((await planCopy(svc, params)).priorRuns).toBe(0)
  })

  it('an unknown audit id is not_found', async () => {
    expect(await undoCopy(svc, 'nope', { actorUserId: 'x' })).toEqual({ ok: false, reason: 'not_found' })
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
