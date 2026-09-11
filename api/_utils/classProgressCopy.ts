/**
 * classProgressCopy — copy a teacher's own-account play onto the class's
 * play-as-class learner (Tom, 2026-09-11: "IF the teachers have by mistake
 * played as themselves, Angharad needs to be able to copy all progress data
 * and telemetry and everything to the play as class account").
 *
 * WHAT MOVES. Every learner-keyed row the teacher's own learner holds for the
 * CLASS'S course — sessions, the diary (player_events), lego/seed progress,
 * response metrics, spikes, points, milestones, lego metrics, pairings, L1
 * state, pod state, the speaking ledger — is re-keyed onto the class learner
 * and inserted there. The course scope is deliberate: a teacher who learns
 * Welsh for themselves must not have that moved onto a Spanish class.
 *
 * COPY, NOT MOVE. The teacher's rows stay where they are. A second run is
 * idempotent: every apply writes one class_progress_copy_audit row listing
 * the source ids it copied, and the next run skips every source id any prior
 * record already names. Natural-key tables (one row per learner+course+key)
 * are insert-if-absent on the class side, so they cannot duplicate either.
 *
 * CURSOR. The class learner's course_enrollments row is never duplicated; it
 * ends at the FURTHER of the two positions. Position is the last LEGO
 * actually played (last_completed_lego_id — the column the live cursor path
 * api/school/class-progress.ts writes), never a seed number.
 *
 * SKIPPED, NAMED. Tables that hold identity, billing, roles, leases or
 * audit rather than play are never copied and are listed in every record
 * with the reason, so a copy is never silently partial.
 *
 * The table inventory was read LIVE (information_schema, 2026-09-11): every
 * public column named learner_id plus player_events.user_id, which holds the
 * learner PK, not the auth uid.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { sessioniseSeconds } from './inAppTime'

export const AUDIT_TABLE = 'class_progress_copy_audit'

/** PostgREST caps one response at 1000 rows. */
const PAGE = 1000
const MAX_PAGES = 200
const INSERT_CHUNK = 500

type KeyKind =
  /** Row id is generated on insert; source id recorded → new id. */
  | { kind: 'generated'; idColumn: string }
  /** Composite natural key; insert only if the class side lacks the key. */
  | { kind: 'natural'; keyColumns: string[] }

export interface CopyTableSpec {
  table: string
  /** Column that names the course on this table. */
  courseColumn: string
  key: KeyKind
  /** Columns dropped before insert (surrogate ids the DB regenerates). */
  drop?: string[]
  /** Also re-key this column to the target learner (player_events.user_id). */
  extraLearnerColumns?: string[]
  /** Re-map this column through the sessions id map. */
  sessionColumn?: string
}

/** Copy order matters: sessions first so session ids can be re-mapped. */
export const COPY_TABLES: CopyTableSpec[] = [
  { table: 'sessions', courseColumn: 'course_id', key: { kind: 'generated', idColumn: 'id' } },
  { table: 'player_events', courseColumn: 'course_code', key: { kind: 'generated', idColumn: 'id' }, extraLearnerColumns: ['user_id'] },
  { table: 'lego_progress', courseColumn: 'course_id', key: { kind: 'natural', keyColumns: ['lego_id', 'course_id'] }, drop: ['id'] },
  { table: 'seed_progress', courseColumn: 'course_id', key: { kind: 'natural', keyColumns: ['seed_id', 'course_id'] }, drop: ['id'] },
  { table: 'response_metrics', courseColumn: 'course_id', key: { kind: 'generated', idColumn: 'db_id' }, sessionColumn: 'session_id' },
  { table: 'spike_events', courseColumn: 'course_id', key: { kind: 'generated', idColumn: 'db_id' }, sessionColumn: 'session_id' },
  { table: 'learner_points', courseColumn: 'course_id', key: { kind: 'natural', keyColumns: ['course_id'] }, drop: ['id'] },
  { table: 'learner_milestones', courseColumn: 'course_id', key: { kind: 'natural', keyColumns: ['course_id', 'milestone_type'] }, drop: ['id'] },
  { table: 'learner_lego_metrics', courseColumn: 'course_code', key: { kind: 'natural', keyColumns: ['lego_id'] } },
  { table: 'learner_lego_pairings', courseColumn: 'course_code', key: { kind: 'natural', keyColumns: ['course_code', 'lego_a', 'lego_b'] } },
  { table: 'learner_l1_state', courseColumn: 'course_code', key: { kind: 'natural', keyColumns: ['course_code', 'lego_id'] } },
  { table: 'learner_pod_state', courseColumn: 'course_code', key: { kind: 'natural', keyColumns: ['course_code', 'sentence_id'] } },
  { table: 'learner_speaking_opportunities', courseColumn: 'course_code', key: { kind: 'natural', keyColumns: ['course_code', 'day'] } },
]

/** Named, with reasons — the record carries these so a copy is never silently partial. */
export const SKIPPED_TABLES: Array<{ table: string; reason: string }> = [
  { table: 'learners', reason: 'identity: the teacher keeps their own account' },
  { table: 'learner_emails', reason: 'identity: email addresses belong to the person' },
  { table: 'learner_roles', reason: 'roles belong to the person, not the class' },
  { table: 'learner_meta_commentary_state', reason: 'not course-scoped; instruction state belongs to the person' },
  { table: 'offline_leases', reason: 'device lease belongs to the person' },
  { table: 'org_enrolments', reason: 'organisation membership, not play' },
  { table: 'subscriptions', reason: 'billing' },
  { table: 'user_entitlements', reason: 'entitlements' },
  { table: 'teachers', reason: 'tutor profile' },
  { table: 'tutor_rebate_ledger', reason: 'money ledger' },
  { table: 'pod_ratchet_reset_audit', reason: 'audit history stays with the account it happened on' },
  { table: 'learner_practice_history', reason: 'not course-scoped, and its session ids never match sessions rows, so no row can be attributed to this course' },
  { table: 'class_sessions', reason: 'keyed by class already, not by learner' },
]

export interface CursorSnapshot {
  last_completed_lego_id: string | null
  last_completed_round_index: number | null
  highest_completed_lego_id: string | null
  highest_completed_round_index: number | null
  current_cycle_index: number | null
  current_mode: string | null
  helix_state: unknown
  total_practice_minutes: number
  last_practiced_at: string | null
  completed_pod_rounds: number | null
  rounds_since_pod: number | null
  pod_activation_round: number | null
  infplay_round_index: number | null
}

export interface Position { legoId: string | null; roundIndex: number | null }

/** The furthest LEGO a cursor names, and the round it was played in. */
export function cursorPosition(c: CursorSnapshot | null): Position {
  if (!c) return { legoId: null, roundIndex: null }
  const candidates: Position[] = [
    { legoId: c.highest_completed_lego_id, roundIndex: c.highest_completed_round_index },
    { legoId: c.last_completed_lego_id, roundIndex: c.last_completed_round_index },
  ]
  let best: Position = { legoId: null, roundIndex: null }
  for (const cand of candidates) {
    if (!cand.legoId) continue
    if (!best.legoId || compareLego(cand, best) > 0) best = cand
  }
  return best
}

/**
 * Which position is further. Round index when both sides carry one, else the
 * lego id itself: ids are zero-padded (S0042L03) so their text order is their
 * course order.
 */
export function compareLego(a: Position, b: Position): number {
  if (!a.legoId && !b.legoId) return 0
  if (!a.legoId) return -1
  if (!b.legoId) return 1
  if (a.roundIndex != null && b.roundIndex != null && a.roundIndex !== b.roundIndex) {
    return a.roundIndex > b.roundIndex ? 1 : -1
  }
  return a.legoId < b.legoId ? -1 : a.legoId > b.legoId ? 1 : 0
}

export interface CopiedIds {
  /** table → { sourceId: newId } (natural-key tables map key → key). */
  [table: string]: Record<string, string>
}

export interface CopyRecord {
  copied: CopiedIds
  /** Per table: source rows that already existed on the class side or were copied by an earlier run. */
  alreadyPresent: Record<string, number>
  skipped: Array<{ table: string; reason: string }>
  cursorBefore: { source: CursorSnapshot | null; target: CursorSnapshot | null }
  cursorAfter: { target: CursorSnapshot | null }
  cursorTakenFromSource: boolean
  minutesAdded: number
  inAppSecondsCopied: number
  error?: string
}

export interface CopyPlan {
  courseCode: string
  sourceLearnerId: string
  targetLearnerId: string
  /** Per table: rows that WILL be copied on apply. */
  toCopy: Record<string, number>
  alreadyPresent: Record<string, number>
  skipped: Array<{ table: string; reason: string }>
  cursor: { source: CursorSnapshot | null; target: CursorSnapshot | null }
  /** Position the class learner will be at after apply. */
  resulting: Position & { takenFromSource: boolean }
  /** Sessionised in-app seconds carried by the diary rows to be copied. */
  inAppSecondsToCopy: number
  minutesToAdd: number
  priorRuns: number
  /** Everything the apply needs, so it never re-derives the plan. */
  rows: Record<string, Record<string, unknown>[]>
}

async function readAll(
  svc: SupabaseClient,
  table: string,
  filters: Record<string, unknown>,
  orderBy: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = svc.from(table).select('*')
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never)
    const { data, error } = await q.order(orderBy, { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(`${table} read failed: ${error.message}`)
    const rows = (data ?? []) as Record<string, unknown>[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

function naturalKey(row: Record<string, unknown>, cols: string[]): string {
  return cols.map((c) => String(row[c] ?? '')).join('')
}

function sourceIdOf(row: Record<string, unknown>, spec: CopyTableSpec): string {
  return spec.key.kind === 'generated' ? String(row[spec.key.idColumn]) : naturalKey(row, spec.key.keyColumns)
}

const CURSOR_COLUMNS =
  'last_completed_lego_id,last_completed_round_index,highest_completed_lego_id,highest_completed_round_index,current_cycle_index,current_mode,helix_state,total_practice_minutes,last_practiced_at,completed_pod_rounds,rounds_since_pod,pod_activation_round,infplay_round_index'

async function readCursor(svc: SupabaseClient, learnerId: string, courseCode: string): Promise<CursorSnapshot | null> {
  const { data, error } = await svc
    .from('course_enrollments')
    .select(CURSOR_COLUMNS)
    .eq('learner_id', learnerId)
    .eq('course_id', courseCode)
    .maybeSingle()
  if (error) throw new Error(`course_enrollments read failed: ${error.message}`)
  return (data as unknown as CursorSnapshot) ?? null
}

/** Union of source ids every earlier record for this pair already copied. */
async function priorCopied(
  svc: SupabaseClient,
  sourceLearnerId: string,
  targetLearnerId: string,
  courseCode: string,
): Promise<{ runs: number; ids: Record<string, Set<string>> }> {
  const { data, error } = await svc
    .from(AUDIT_TABLE)
    .select('record')
    .eq('source_learner_id', sourceLearnerId)
    .eq('target_learner_id', targetLearnerId)
    .eq('course_code', courseCode)
  if (error) throw new Error(`${AUDIT_TABLE} read failed: ${error.message}`)
  const ids: Record<string, Set<string>> = {}
  const rows = (data ?? []) as Array<{ record: CopyRecord }>
  for (const r of rows) {
    for (const [table, map] of Object.entries(r.record?.copied ?? {})) {
      ids[table] ??= new Set()
      for (const src of Object.keys(map)) ids[table].add(src)
    }
  }
  return { runs: rows.length, ids }
}

/**
 * The dry run. Reads everything, writes nothing, and returns the exact row set
 * the apply would insert.
 */
export async function planCopy(
  svc: SupabaseClient,
  params: { sourceLearnerId: string; targetLearnerId: string; courseCode: string },
): Promise<CopyPlan> {
  const { sourceLearnerId, targetLearnerId, courseCode } = params
  if (sourceLearnerId === targetLearnerId) throw new Error('source and target are the same learner')

  const prior = await priorCopied(svc, sourceLearnerId, targetLearnerId, courseCode)
  const toCopy: Record<string, number> = {}
  const alreadyPresent: Record<string, number> = {}
  const rows: Record<string, Record<string, unknown>[]> = {}

  for (const spec of COPY_TABLES) {
    const orderBy = spec.key.kind === 'generated' ? spec.key.idColumn : spec.key.keyColumns[0]
    const source = await readAll(svc, spec.table, { learner_id: sourceLearnerId, [spec.courseColumn]: courseCode }, orderBy)
    const done = prior.ids[spec.table] ?? new Set<string>()
    let present = new Set<string>()
    if (spec.key.kind === 'natural') {
      const keyColumns = spec.key.keyColumns
      const target = await readAll(svc, spec.table, { learner_id: targetLearnerId, [spec.courseColumn]: courseCode }, orderBy)
      present = new Set(target.map((r) => naturalKey(r, keyColumns)))
    }
    const pending: Record<string, unknown>[] = []
    let skippedHere = 0
    for (const r of source) {
      const id = sourceIdOf(r, spec)
      if (done.has(id) || present.has(id)) { skippedHere++; continue }
      pending.push(r)
    }
    rows[spec.table] = pending
    toCopy[spec.table] = pending.length
    alreadyPresent[spec.table] = skippedHere
  }

  const [sourceCursor, targetCursor] = await Promise.all([
    readCursor(svc, sourceLearnerId, courseCode),
    readCursor(svc, targetLearnerId, courseCode),
  ])
  const sPos = cursorPosition(sourceCursor)
  const tPos = cursorPosition(targetCursor)
  const takenFromSource = compareLego(sPos, tPos) > 0
  const resulting = takenFromSource ? { ...sPos, takenFromSource } : { ...tPos, takenFromSource }

  const diaryTs = (rows['player_events'] ?? [])
    .map((r) => Date.parse(String(r['occurred_at'])))
    .filter((t) => Number.isFinite(t))
  const inAppSecondsToCopy = sessioniseSeconds(diaryTs)
  // Practice minutes on the enrollment are added ONCE: the first run for a pair.
  const minutesToAdd = prior.runs === 0 && sourceCursor ? Number(sourceCursor.total_practice_minutes || 0) : 0

  return {
    courseCode, sourceLearnerId, targetLearnerId,
    toCopy, alreadyPresent, skipped: SKIPPED_TABLES,
    cursor: { source: sourceCursor, target: targetCursor },
    resulting, inAppSecondsToCopy, minutesToAdd, priorRuns: prior.runs, rows,
  }
}

function rekey(row: Record<string, unknown>, spec: CopyTableSpec, targetLearnerId: string, sessionMap: Map<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row, learner_id: targetLearnerId }
  for (const c of spec.extraLearnerColumns ?? []) out[c] = targetLearnerId
  if (spec.key.kind === 'generated') delete out[spec.key.idColumn]
  for (const c of spec.drop ?? []) delete out[c]
  if (spec.sessionColumn && out[spec.sessionColumn] != null) {
    const mapped = sessionMap.get(String(out[spec.sessionColumn]))
    if (mapped) out[spec.sessionColumn] = mapped
  }
  return out
}

/**
 * The real thing. Inserts every planned row re-keyed onto the class learner,
 * merges the cursor, and writes one audit record. Any table that fails stops
 * the run and the error names the table; what had landed before it is still
 * recorded so the next preview sees it and never doubles it.
 */
export async function applyCopy(
  svc: SupabaseClient,
  plan: CopyPlan,
  ctx: { actorUserId: string; classId: string },
): Promise<{ record: CopyRecord; auditId: string | null; error: string | null }> {
  const { sourceLearnerId, targetLearnerId, courseCode } = plan
  const copied: CopiedIds = {}
  const sessionMap = new Map<string, string>()
  let failure: string | null = null

  for (const spec of COPY_TABLES) {
    const pending = plan.rows[spec.table] ?? []
    copied[spec.table] = {}
    if (pending.length === 0) continue
    for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
      const slice = pending.slice(i, i + INSERT_CHUNK)
      const payload = slice.map((r) => rekey(r, spec, targetLearnerId, sessionMap))
      const returning = spec.key.kind === 'generated' ? spec.key.idColumn : spec.key.keyColumns.join(',')
      const { data, error } = await svc.from(spec.table).insert(payload).select(returning)
      if (error) { failure = `${spec.table}: ${error.message}`; break }
      const inserted = (data ?? []) as unknown as Record<string, unknown>[]
      if (inserted.length !== slice.length) { failure = `${spec.table}: inserted ${inserted.length} of ${slice.length}`; break }
      slice.forEach((src, idx) => {
        const srcId = sourceIdOf(src, spec)
        const newId = spec.key.kind === 'generated' ? String(inserted[idx][spec.key.idColumn]) : srcId
        copied[spec.table][srcId] = newId
        if (spec.table === 'sessions') sessionMap.set(srcId, newId)
      })
    }
    if (failure) break
  }

  // Cursor merge: only when every table landed.
  let cursorAfter: CursorSnapshot | null = plan.cursor.target
  let minutesAdded = 0
  if (!failure) {
    const s = plan.cursor.source
    const t = plan.cursor.target
    const patch: Record<string, unknown> = {}
    if (plan.resulting.takenFromSource && s) {
      Object.assign(patch, {
        last_completed_lego_id: s.last_completed_lego_id,
        last_completed_round_index: s.last_completed_round_index,
        highest_completed_lego_id: s.highest_completed_lego_id,
        highest_completed_round_index: s.highest_completed_round_index,
        current_cycle_index: s.current_cycle_index ?? 0,
        helix_state: s.helix_state,
        completed_pod_rounds: s.completed_pod_rounds,
        rounds_since_pod: s.rounds_since_pod,
        pod_activation_round: s.pod_activation_round,
        infplay_round_index: s.infplay_round_index,
      })
    }
    if (plan.minutesToAdd > 0) {
      minutesAdded = plan.minutesToAdd
      patch.total_practice_minutes = Number(t?.total_practice_minutes || 0) + minutesAdded
    }
    const sLast = s?.last_practiced_at ? Date.parse(s.last_practiced_at) : 0
    const tLast = t?.last_practiced_at ? Date.parse(t.last_practiced_at) : 0
    if (s && sLast > tLast) patch.last_practiced_at = s.last_practiced_at
    if (Object.keys(patch).length > 0) {
      const { error } = await svc.from('course_enrollments').update(patch).eq('learner_id', targetLearnerId).eq('course_id', courseCode)
      if (error) failure = `course_enrollments: ${error.message}`
      else cursorAfter = { ...(t ?? ({} as CursorSnapshot)), ...(patch as Partial<CursorSnapshot>) } as CursorSnapshot
    }
  }

  const record: CopyRecord = {
    copied,
    alreadyPresent: plan.alreadyPresent,
    skipped: plan.skipped,
    cursorBefore: plan.cursor,
    cursorAfter: { target: cursorAfter },
    cursorTakenFromSource: !failure && plan.resulting.takenFromSource,
    minutesAdded,
    inAppSecondsCopied: failure ? 0 : plan.inAppSecondsToCopy,
  }
  if (failure) record.error = failure
  const { data: audit, error: auditErr } = await svc
    .from(AUDIT_TABLE)
    .insert({
      actor_user_id: ctx.actorUserId,
      class_id: ctx.classId,
      course_code: courseCode,
      source_learner_id: sourceLearnerId,
      target_learner_id: targetLearnerId,
      record,
    })
    .select('id')
    .single()
  const auditId = audit ? String((audit as { id: string }).id) : null
  if (auditErr) {
    // The rows are in; losing the record would make the next run double them.
    console.error('[classProgressCopy] audit write failed:', auditErr.message, JSON.stringify(record.copied).slice(0, 4000))
    failure = failure ?? `audit: ${auditErr.message}`
  }
  return { record, auditId, error: failure }
}
