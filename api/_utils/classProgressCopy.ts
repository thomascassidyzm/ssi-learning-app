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
 * ONE AT A TIME. An apply claims its audit row before it reads anything; a
 * partial unique index lets one running claim exist per source+course, so a
 * concurrent second apply is refused by the database (409), never doubled.
 * See ClaimRecord below (job #811).
 *
 * COPY, NOT MOVE. The teacher's rows stay where they are. A second run is
 * idempotent: every apply writes one class_progress_copy_audit row listing
 * the source ids it copied, and the next run skips every source id any prior
 * record already names. Natural-key tables (one row per learner+course+key)
 * are insert-if-absent on the class side, so they cannot duplicate either.
 *
 * ONE CLASS. A teacher's own-account play is credited to ONE class, the one a
 * leader copies it onto. The prior-record scan is by SOURCE learner and
 * course, across every target: a source row any class account already holds
 * is never offered to, or copied onto, a second class. This used to be keyed
 * per (source, target) pair, and a teacher tagged on two classes for the
 * same course was offered on both rows of the sweep with identical figures —
 * Chepstow, 2026-09-15 06:54Z: two teachers' play, 51 practice items, went
 * onto their own classes AND onto a colleague's 7E, which had never played
 * it, and 7E's figure led that school's dashboard for the morning (job #792).
 * Play copied elsewhere carries no cursor either: when nothing new is left
 * to copy, the class keeps its own position and gains no minutes.
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
import { copyDidSomething, sendClassPlayCopiedNotice } from './copyPlayNotice'

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

/**
 * The second audit row an undo appends (same table, append-only): which run it
 * reversed, exactly what it deleted per table, and the cursor it restored.
 */
export interface UndoRecord {
  /** Set only when the undo COMPLETED: every deletion done and the cursor restored. */
  undo_of?: string
  /**
   * Set instead of undo_of when the undo failed part-way (job #689). The row
   * keeps the trail honest — what was deleted before the failure — but it is
   * NOT an undo: the already-undone check and the prior-copy scan both ignore
   * it, so the copy stays in force and the undo can be retried. Deletions are
   * idempotent (rows already gone are fine), so the retry finishes the job.
   */
  undo_failed_of?: string
  deleted: Record<string, string[]>
  cursorRestored: CursorSnapshot | null
  skipped: Array<{ table: string; reason: string }>
  error?: string
}

export const isUndoRow = (r: CopyRecord | UndoRecord | ClaimRecord | null | undefined): boolean =>
  Boolean((r as UndoRecord)?.undo_of || (r as UndoRecord)?.undo_failed_of)

/**
 * The CLAIM a copy writes before it reads anything (job #811). Two concurrent
 * applies for the same teacher and course used to both pass the prior-copy
 * scan, both insert, and both write an audit row: that is how 7E got 22 + 29
 * duplicated items. Now the apply inserts its audit row FIRST, as a claim
 * carrying `state: 'running'`, and a partial unique index on
 * (source_learner_id, course_code) WHERE state = 'running' lets exactly one
 * claim exist per source+course at a time. The second request's claim insert
 * is refused by the database and it answers 409; only the holder plans and
 * inserts. The claim is finalised in place into the full CopyRecord when the
 * run ends, so the audit row that names the copied ids is the row that held
 * the claim. A claim older than CLAIM_STALE_MS whose holder died is marked
 * `abandoned` by the next apply and then never blocks anything.
 *
 * The claim also carries what the run has LANDED (job #841). PostgREST gives
 * no transaction across insert + finalise, so before every chunk insert the
 * claim is checkpointed with `copied` (every id landed so far) and `pending`
 * (the source ids of the chunk about to go in); the checkpoint failing stops
 * the run before that chunk, so nothing lands unrecorded. If the finalising
 * write then fails after the rows are in, the claim still names them, and
 * priorCopied treats a claim's copied AND pending ids as done. The one
 * remaining failure mode is under-copy: a pending chunk whose insert failed
 * and whose clearing write also failed stays skipped. Never a duplicate.
 */
export interface ClaimRecord {
  state: 'running' | 'abandoned'
  started_at: string
  error?: string
  copied?: CopiedIds
  pending?: Record<string, string[]>
}
const claimIds = (r: ClaimRecord): Record<string, string[]> => {
  const out: Record<string, string[]> = {}
  for (const [t, m] of Object.entries(r.copied ?? {})) out[t] = [...(out[t] ?? []), ...Object.keys(m)]
  for (const [t, ids] of Object.entries(r.pending ?? {})) out[t] = [...(out[t] ?? []), ...ids]
  return out
}
export const isClaimRow = (r: CopyRecord | UndoRecord | ClaimRecord | null | undefined): boolean =>
  (r as ClaimRecord)?.state === 'running' || (r as ClaimRecord)?.state === 'abandoned'
export const CLAIM_STALE_MS = 15 * 60 * 1000
/** Postgres unique_violation, as PostgREST surfaces it. */
const UNIQUE_VIOLATION = '23505'

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
  /**
   * The ONE CLASS rule (file header): other classes already holding rows from
   * this teacher's own play on this course, and how many rows. Those rows are
   * counted in alreadyPresent and are never copied here.
   */
  copiedElsewhere: { classIds: string[]; rows: number }
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

/**
 * Union of source ids every earlier record for this SOURCE and course already
 * copied — onto this class or any other (the ONE CLASS rule, file header).
 * `runs` counts the runs onto THIS target; `elsewhere` names the other classes
 * that hold rows from this source, and how many.
 */
async function priorCopied(
  svc: SupabaseClient,
  sourceLearnerId: string,
  targetLearnerId: string,
  courseCode: string,
): Promise<{ runs: number; ids: Record<string, Set<string>>; elsewhere: { classIds: string[]; rows: number } }> {
  const { data, error } = await svc
    .from(AUDIT_TABLE)
    .select('id, class_id, target_learner_id, record')
    .eq('source_learner_id', sourceLearnerId)
    .eq('course_code', courseCode)
  if (error) throw new Error(`${AUDIT_TABLE} read failed: ${error.message}`)
  const ids: Record<string, Set<string>> = {}
  const all = (data ?? []) as Array<{ id: string; class_id: string | null; target_learner_id: string; record: CopyRecord | UndoRecord | ClaimRecord }>
  // An undone run no longer holds its rows on the class side, so its ids must
  // not be skipped by the next copy — otherwise undo would make re-copy
  // impossible. The undo record names the run it reversed. A claim row (the
  // run in progress, or one abandoned) is a run only if it checkpointed ids
  // (job #841): those rows ARE on the class side, so they count as done, and
  // the run's minutes were added, so it counts towards `runs`.
  const undone = new Set(all.map((r) => (r.record as UndoRecord)?.undo_of).filter(Boolean) as string[])
  const rows = all.filter((r) => !isUndoRow(r.record) && !undone.has(String(r.id)))
  let runs = 0
  const elsewhereClasses = new Set<string>()
  let elsewhereRows = 0
  for (const r of rows) {
    const onThisTarget = r.target_learner_id === targetLearnerId
    const landed: Record<string, string[]> = isClaimRow(r.record)
      ? claimIds(r.record as ClaimRecord)
      : Object.fromEntries(Object.entries((r.record as CopyRecord)?.copied ?? {}).map(([t, m]) => [t, Object.keys(m)]))
    const landedAny = Object.values(landed).some((l) => l.length > 0)
    if (isClaimRow(r.record) && !landedAny) continue
    if (onThisTarget) runs++
    let copiedHere = 0
    for (const [table, list] of Object.entries(landed)) {
      ids[table] ??= new Set()
      for (const src of list) { ids[table].add(src); copiedHere++ }
    }
    if (!onThisTarget && copiedHere > 0) {
      elsewhereRows += copiedHere
      if (r.class_id) elsewhereClasses.add(String(r.class_id))
    }
  }
  return { runs, ids, elsewhere: { classIds: [...elsewhereClasses], rows: elsewhereRows } }
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
  // The cursor follows the PLAY. Once another class holds this teacher's
  // play, this class's position moves only if new sessions or diary rows are
  // going onto it now; otherwise it keeps its own cursor (ONE CLASS).
  const newPlayHere = (toCopy['sessions'] ?? 0) + (toCopy['player_events'] ?? 0) > 0
  const creditedElsewhere = prior.elsewhere.rows > 0 && !newPlayHere
  const takenFromSource = !creditedElsewhere && compareLego(sPos, tPos) > 0
  const resulting = takenFromSource ? { ...sPos, takenFromSource } : { ...tPos, takenFromSource }

  const diaryTs = (rows['player_events'] ?? [])
    .map((r) => Date.parse(String(r['occurred_at'])))
    .filter((t) => Number.isFinite(t))
  const inAppSecondsToCopy = sessioniseSeconds(diaryTs)
  // Practice minutes on the enrollment are added ONCE: the first run for a
  // pair, and never when another class already holds this teacher's play.
  const minutesToAdd = prior.runs === 0 && prior.elsewhere.rows === 0 && sourceCursor ? Number(sourceCursor.total_practice_minutes || 0) : 0

  return {
    courseCode, sourceLearnerId, targetLearnerId,
    toCopy, alreadyPresent, skipped: SKIPPED_TABLES,
    cursor: { source: sourceCursor, target: targetCursor },
    resulting, inAppSecondsToCopy, minutesToAdd, priorRuns: prior.runs,
    copiedElsewhere: prior.elsewhere, rows,
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
export type ApplyOutcome =
  | { conflict: false; plan: CopyPlan; record: CopyRecord; auditId: string | null; error: string | null }
  /** Another apply for this teacher and course holds the claim right now. Nothing was written. */
  | { conflict: true }

/**
 * Take the claim: mark any stale running claim abandoned, then insert ours.
 * Returns null when the database refused the insert because a live claim
 * already exists (the partial unique index), which is the concurrent case.
 */
async function takeClaim(
  svc: SupabaseClient,
  params: { sourceLearnerId: string; targetLearnerId: string; courseCode: string },
  ctx: { actorUserId: string; classId: string },
): Promise<string | null> {
  const { sourceLearnerId, targetLearnerId, courseCode } = params
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString()
  const { data: stale, error: staleErr } = await svc
    .from(AUDIT_TABLE)
    .select('id, record')
    .eq('source_learner_id', sourceLearnerId)
    .eq('course_code', courseCode)
    .eq('record->>state', 'running')
    .lt('created_at', staleBefore)
  if (staleErr) throw new Error(`${AUDIT_TABLE} read failed: ${staleErr.message}`)
  for (const row of (stale ?? []) as Array<{ id: string; record: ClaimRecord }>) {
    const abandoned: ClaimRecord = { ...row.record, state: 'abandoned', error: `claim abandoned: holder did not finish within ${CLAIM_STALE_MS / 60000} minutes` }
    const { error } = await svc.from(AUDIT_TABLE).update({ record: abandoned }).eq('id', row.id).eq('record->>state', 'running')
    if (error) throw new Error(`${AUDIT_TABLE} stale-claim update failed: ${error.message}`)
    console.warn('[classProgressCopy] abandoned a stale running claim', row.id)
  }
  const claim: ClaimRecord = { state: 'running', started_at: new Date().toISOString() }
  const { data, error } = await svc
    .from(AUDIT_TABLE)
    .insert({
      actor_user_id: ctx.actorUserId,
      class_id: ctx.classId,
      course_code: courseCode,
      source_learner_id: sourceLearnerId,
      target_learner_id: targetLearnerId,
      record: claim,
    })
    .select('id')
    .single()
  if (error) {
    const dup = error.code === UNIQUE_VIOLATION || /duplicate key|unique/i.test(error.message ?? '')
    if (dup) return null
    throw new Error(`${AUDIT_TABLE} claim insert failed: ${error.message}`)
  }
  return String((data as { id: string }).id)
}

export async function applyCopy(
  svc: SupabaseClient,
  params: { sourceLearnerId: string; targetLearnerId: string; courseCode: string },
  ctx: { actorUserId: string; classId: string },
): Promise<ApplyOutcome> {
  const auditId = await takeClaim(svc, params, ctx)
  if (auditId === null) return { conflict: true }
  // Plan INSIDE the claim: a plan read before the claim could predate a run
  // that finished a moment ago, and would double it.
  let plan: CopyPlan
  try {
    plan = await planCopy(svc, params)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await releaseClaimOnError(svc, auditId, `plan: ${message}`)
    throw err
  }
  const { targetLearnerId, courseCode } = plan
  const copied: CopiedIds = {}
  const sessionMap = new Map<string, string>()
  let failure: string | null = null
  const startedAt = new Date().toISOString()
  // Checkpoint the claim (see ClaimRecord): what has landed, what is about to.
  const checkpoint = async (pending: Record<string, string[]>): Promise<string | null> => {
    const claim: ClaimRecord = { state: 'running', started_at: startedAt, copied, pending }
    const { error } = await svc.from(AUDIT_TABLE).update({ record: claim }).eq('id', auditId)
    return error ? `${AUDIT_TABLE} checkpoint: ${error.message}` : null
  }

  for (const spec of COPY_TABLES) {
    const pending = plan.rows[spec.table] ?? []
    copied[spec.table] = {}
    if (pending.length === 0) continue
    for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
      const slice = pending.slice(i, i + INSERT_CHUNK)
      const payload = slice.map((r) => rekey(r, spec, targetLearnerId, sessionMap))
      const returning = spec.key.kind === 'generated' ? spec.key.idColumn : spec.key.keyColumns.join(',')
      // Record the chunk BEFORE it goes in; a checkpoint that fails stops the
      // run while nothing is landed unrecorded.
      failure = await checkpoint({ [spec.table]: slice.map((r) => sourceIdOf(r, spec)) })
      if (failure) break
      const { data, error } = await svc.from(spec.table).insert(payload).select(returning)
      if (error) {
        failure = `${spec.table}: ${error.message}`
        // Nothing of this chunk landed: clear its pending ids so they are not
        // treated as done. If this write fails too, the chunk is skipped by
        // later runs (under-copy), never duplicated.
        const cleared = await checkpoint({})
        if (cleared) console.error('[classProgressCopy] could not clear pending ids after a failed insert', auditId, cleared)
        break
      }
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
  // Finalise the claim row into the record: the same row now names every
  // copied id, and no longer carries state 'running', so the index slot is
  // free for the next run.
  const { error: auditErr } = await svc.from(AUDIT_TABLE).update({ record }).eq('id', auditId)
  if (auditErr) {
    // The rows are in. The last checkpoint already names every id that
    // landed (copied + pending), so the next run cannot double them; try to
    // release the claim carrying those ids, and if that fails too the stale
    // path abandons it with them intact.
    console.error('[classProgressCopy] audit write failed:', auditErr.message, JSON.stringify(record.copied).slice(0, 4000))
    failure = failure ?? `audit: ${auditErr.message}`
    const abandoned: ClaimRecord = { state: 'abandoned', started_at: startedAt, copied, error: failure }
    const { error: relErr } = await svc.from(AUDIT_TABLE).update({ record: abandoned }).eq('id', auditId)
    if (relErr) console.error('[classProgressCopy] could not release claim after audit failure', auditId, relErr.message)
  }
  // The notice to the teacher whose play moved (job #684), with one-tap undo.
  // Sent from HERE, not from the route, so the sweep and the card cannot
  // differ; idempotent by audit id, so the backfill cannot double it. A failed
  // send never fails the copy — the backfill picks the row up later.
  if (auditId && !failure && copyDidSomething(record)) {
    try {
      const sent = await sendClassPlayCopiedNotice(svc, auditId)
      if (sent.error) console.error('[classProgressCopy] copy notice not sent:', sent.error)
    } catch (err) {
      console.error('[classProgressCopy] copy notice threw:', err instanceof Error ? err.message : err)
    }
  }
  return { conflict: false, plan, record, auditId, error: failure }
}

/** A run that failed before writing anything must not hold the claim. */
async function releaseClaimOnError(svc: SupabaseClient, auditId: string, error: string): Promise<void> {
  const abandoned: ClaimRecord = { state: 'abandoned', started_at: new Date().toISOString(), error }
  const { error: err } = await svc.from(AUDIT_TABLE).update({ record: abandoned }).eq('id', auditId)
  if (err) console.error('[classProgressCopy] could not release claim', auditId, err.message)
}


// ── Undo ─────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string
  created_at: string
  actor_user_id: string
  class_id: string
  course_code: string
  source_learner_id: string
  target_learner_id: string
  record: CopyRecord | UndoRecord | ClaimRecord
}

export async function readAudit(svc: SupabaseClient, auditId: string): Promise<AuditRow | null> {
  const { data, error } = await svc.from(AUDIT_TABLE).select('*').eq('id', auditId).maybeSingle()
  if (error) throw new Error(`${AUDIT_TABLE} read failed: ${error.message}`)
  return (data as AuditRow | null) ?? null
}

export type UndoOutcome =
  | { ok: true; undoAuditId: string | null; deleted: Record<string, number>; cursorRestored: boolean }
  | { ok: false; reason: 'not_found' | 'not_a_copy' | 'already_undone' | 'played_since' | 'error'; detail?: string }

const DELETE_CHUNK = 200

/**
 * The class account has PLAYED since the copy when it holds a session or a
 * diary row newer than the copy that the copy did not put there. Then the undo
 * is not clean — deleting the copied rows would leave a cursor and a history
 * that no longer agree — and it is refused; the message says so and offers
 * nothing (the brief's rule, 2026-09-14).
 */
export async function playedSinceCopy(svc: SupabaseClient, audit: AuditRow): Promise<boolean> {
  const record = audit.record as CopyRecord
  const copiedSessionIds = new Set(Object.values(record.copied?.sessions ?? {}))
  const copiedEventIds = new Set(Object.values(record.copied?.player_events ?? {}).map(String))
  const { data: sess, error: sErr } = await svc
    .from('sessions')
    .select('id')
    .eq('learner_id', audit.target_learner_id)
    .eq('course_id', audit.course_code)
    .gt('started_at', audit.created_at)
    .limit(500)
  if (sErr) throw new Error(`sessions read failed: ${sErr.message}`)
  if (((sess ?? []) as Array<{ id: string }>).some((r) => !copiedSessionIds.has(String(r.id)))) return true
  const { data: ev, error: eErr } = await svc
    .from('player_events')
    .select('id')
    .eq('learner_id', audit.target_learner_id)
    .eq('course_code', audit.course_code)
    .gt('occurred_at', audit.created_at)
    .limit(500)
  if (eErr) throw new Error(`player_events read failed: ${eErr.message}`)
  return ((ev ?? []) as Array<{ id: string | number }>).some((r) => !copiedEventIds.has(String(r.id)))
}

/**
 * Reverse one copy: delete exactly the rows the audit record says the copy
 * inserted on the class learner (the newId side of record.copied, per table,
 * children before sessions), restore the class cursor to cursorBefore.target,
 * and append a second audit row naming what was deleted, so the trail stays
 * append-only. Rows the class learner held BEFORE the copy are never touched:
 * they are not in the record. Refused when the class account has played since.
 *
 * RETRYABLE. Every deletion is idempotent — a row the record names that is
 * already gone counts as done — so an undo that failed part-way is simply run
 * again. The failed attempt is on the trail as undo_failed_of, which nothing
 * treats as an undo (job #689).
 */
export async function undoCopy(
  svc: SupabaseClient,
  auditId: string,
  ctx: { actorUserId: string },
): Promise<UndoOutcome> {
  const audit = await readAudit(svc, auditId)
  if (!audit) return { ok: false, reason: 'not_found' }
  if (isUndoRow(audit.record) || isClaimRow(audit.record)) return { ok: false, reason: 'not_a_copy' }
  const record = audit.record as CopyRecord

  const prior = await svc
    .from(AUDIT_TABLE)
    .select('id, record')
    .eq('source_learner_id', audit.source_learner_id)
    .eq('target_learner_id', audit.target_learner_id)
    .eq('course_code', audit.course_code)
  if (prior.error) throw new Error(`${AUDIT_TABLE} read failed: ${prior.error.message}`)
  const undoneAlready = ((prior.data ?? []) as Array<{ record: UndoRecord }>).some((r) => r.record?.undo_of === auditId)
  if (undoneAlready) return { ok: false, reason: 'already_undone' }

  if (await playedSinceCopy(svc, audit)) return { ok: false, reason: 'played_since' }

  const deleted: Record<string, string[]> = {}
  let failure: string | null = null

  // Children first: sessions last, so nothing referencing a session outlives it.
  for (const spec of [...COPY_TABLES].reverse()) {
    const map = record.copied?.[spec.table] ?? {}
    const newIds = Object.values(map).map(String)
    deleted[spec.table] = []
    if (newIds.length === 0) continue
    if (spec.key.kind === 'generated') {
      const idColumn = spec.key.idColumn
      for (let i = 0; i < newIds.length; i += DELETE_CHUNK) {
        const slice = newIds.slice(i, i + DELETE_CHUNK)
        const { error } = await svc
          .from(spec.table)
          .delete()
          .eq('learner_id', audit.target_learner_id)
          .in(idColumn, slice)
        if (error) { failure = `${spec.table}: ${error.message}`; break }
        deleted[spec.table].push(...slice)
      }
    } else {
      // Natural keys: the record holds the concatenated key, not the columns.
      // Read the class learner's rows for this course and delete the ones
      // whose natural key the copy inserted.
      const keyColumns = spec.key.keyColumns
      const orderBy = keyColumns[0]
      const rows = await readAll(svc, spec.table, { learner_id: audit.target_learner_id, [spec.courseColumn]: audit.course_code }, orderBy)
      const wanted = new Set(newIds)
      for (const row of rows) {
        const key = naturalKey(row, keyColumns)
        if (!wanted.has(key)) continue
        let q = svc.from(spec.table).delete().eq('learner_id', audit.target_learner_id).eq(spec.courseColumn, audit.course_code)
        for (const c of keyColumns) q = q.eq(c, row[c] as never)
        const { error } = await q
        if (error) { failure = `${spec.table}: ${error.message}`; break }
        deleted[spec.table].push(key)
      }
    }
    if (failure) break
  }

  let cursorRestored: CursorSnapshot | null = null
  if (!failure) {
    const before = record.cursorBefore?.target ?? null
    if (before) {
      const patch: Record<string, unknown> = {
        last_completed_lego_id: before.last_completed_lego_id,
        last_completed_round_index: before.last_completed_round_index,
        highest_completed_lego_id: before.highest_completed_lego_id,
        highest_completed_round_index: before.highest_completed_round_index,
        current_cycle_index: before.current_cycle_index,
        current_mode: before.current_mode,
        helix_state: before.helix_state,
        total_practice_minutes: before.total_practice_minutes,
        last_practiced_at: before.last_practiced_at,
        completed_pod_rounds: before.completed_pod_rounds,
        rounds_since_pod: before.rounds_since_pod,
        pod_activation_round: before.pod_activation_round,
        infplay_round_index: before.infplay_round_index,
      }
      const { error } = await svc
        .from('course_enrollments')
        .update(patch)
        .eq('learner_id', audit.target_learner_id)
        .eq('course_id', audit.course_code)
      if (error) failure = `course_enrollments: ${error.message}`
      else cursorRestored = before
    }
  }

  // A failed undo is written as undo_failed_of, never undo_of: the copy stays
  // in force and the next attempt runs the deletions again (job #689).
  const undoRecord: UndoRecord = failure
    ? { undo_failed_of: auditId, deleted, cursorRestored, skipped: SKIPPED_TABLES, error: failure }
    : { undo_of: auditId, deleted, cursorRestored, skipped: SKIPPED_TABLES }
  const { data: undoAudit, error: auditErr } = await svc
    .from(AUDIT_TABLE)
    .insert({
      actor_user_id: ctx.actorUserId,
      class_id: audit.class_id,
      course_code: audit.course_code,
      source_learner_id: audit.source_learner_id,
      target_learner_id: audit.target_learner_id,
      record: undoRecord,
    })
    .select('id')
    .single()
  if (auditErr) {
    console.error('[classProgressCopy] undo audit write failed:', auditErr.message, JSON.stringify(deleted).slice(0, 4000))
    failure = failure ?? `audit: ${auditErr.message}`
  }
  if (failure) return { ok: false, reason: 'error', detail: failure }
  return {
    ok: true,
    undoAuditId: undoAudit ? String((undoAudit as { id: string }).id) : null,
    deleted: Object.fromEntries(Object.entries(deleted).map(([t, ids]) => [t, ids.length])),
    cursorRestored: cursorRestored !== null,
  }
}
