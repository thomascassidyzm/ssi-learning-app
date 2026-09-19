/**
 * adminMessages — admin-to-learner messaging, server side (job #821).
 *
 * Tom, 2026-09-15: "reaching out to learners with the ability to let them
 * know about new features, other things that have gone live, new PODS and so
 * on… by course… once they message support then the channel becomes live".
 *
 * THREE AUDIENCES. One learner (by auth uid, chosen through the existing
 * People search); one COURSE — every learner who has actually made progress on
 * it; or ALL learners. Demo, internal and class-entity accounts are never in a
 * course or all audience: a class account has no one reading its inbox, and a
 * demo one is a stage prop. A single named learner is taken as named, so Tom
 * can send himself or a tester a message to see it land.
 *
 * "PROGRESS ON THAT COURSE" is a course_enrollments row that has been played:
 * a last_practiced_at, a highest completed LEGO, or practice minutes. An
 * enrolment that was only ever opened is not an audience.
 *
 * IDEMPOTENT. The composer mints the broadcast id before the preview. The first
 * send freezes the audience (recipient_user_ids) and the words on the
 * admin_messages row; every inbox row carries dedupe_key
 * admin_message:<id>:<recipient>, so a retried send, a double tap or a
 * timed-out request that actually landed never puts a second copy in anyone's
 * inbox, never sweeps in a learner who qualified only after the first send,
 * and is refused if it carries different words or a different audience (job
 * #847). The count reported is the rows that landed THIS call.
 *
 * NO PUSH, NO EMAIL, NO NAG. This writes inbox rows and nothing else. The
 * learner meets the message when they next open the app (Tom's standing rule:
 * dog energy, never dentist energy).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { USER_MESSAGES_TABLE } from './userMessages'

export const ADMIN_MESSAGES_TABLE = 'admin_messages'
export const ADMIN_MESSAGE_SOURCE = 'admin_message'

export const TITLE_MAX = 120
export const BODY_MAX = 2000

/** PostgREST caps a page at 1000 rows server-side; every read here pages. */
const PAGE = 1000
const WRITE_CHUNK = 500

export type AudienceSpec =
  | { kind: 'one'; userId: string }
  | { kind: 'course'; courseCode: string }
  | { kind: 'all' }

export interface AudienceMember {
  /** auth uid — what user_messages.recipient_user_id holds. */
  userId: string
  learnerId: string
  displayName: string
}

export interface Audience {
  kind: AudienceSpec['kind']
  members: AudienceMember[]
}

interface LearnerRow {
  id: string
  user_id: string
  display_name: string | null
  is_demo: boolean | null
  is_internal: boolean | null
  is_class_entity: boolean | null
}

const LEARNER_COLUMNS = 'id, user_id, display_name, is_demo, is_internal, is_class_entity'

/** The audience filter, in one place: demo, internal and class-entity accounts are never sent to. */
export function isSendable(l: Pick<LearnerRow, 'is_demo' | 'is_internal' | 'is_class_entity' | 'user_id'>): boolean {
  if (!l.user_id) return false
  return !l.is_demo && !l.is_internal && !l.is_class_entity
}

function toMember(l: LearnerRow): AudienceMember {
  return { userId: l.user_id, learnerId: l.id, displayName: (l.display_name ?? '').trim() }
}

/** Read every row of a query, a page at a time, in a stable order. */
async function readAll<T>(make: () => any, orderCol = 'id'): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await make().order(orderCol, { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

interface EnrolmentRow {
  learner_id: string
  course_id: string
  last_practiced_at: string | null
  highest_completed_lego_id: string | null
  total_practice_minutes: number | null
}

/** An enrolment that has actually been played. */
export function hasProgress(e: Pick<EnrolmentRow, 'last_practiced_at' | 'highest_completed_lego_id' | 'total_practice_minutes'>): boolean {
  return Boolean(e.last_practiced_at) || Boolean(e.highest_completed_lego_id) || (e.total_practice_minutes ?? 0) > 0
}

async function sendableLearners(svc: SupabaseClient): Promise<Map<string, LearnerRow>> {
  const rows = await readAll<LearnerRow>(() => svc.from('learners').select(LEARNER_COLUMNS))
  const out = new Map<string, LearnerRow>()
  for (const l of rows) if (isSendable(l)) out.set(l.id, l)
  return out
}

/** Who the message goes to. Distinct by auth uid; a learner with two enrolment rows is one recipient. */
export async function resolveAudience(svc: SupabaseClient, spec: AudienceSpec): Promise<Audience> {
  if (spec.kind === 'one') {
    const { data, error } = await svc.from('learners').select(LEARNER_COLUMNS).eq('user_id', spec.userId).limit(1)
    if (error) throw new Error(error.message)
    const l = ((data ?? []) as LearnerRow[])[0]
    return { kind: 'one', members: l ? [toMember(l)] : [] }
  }
  const learners = await sendableLearners(svc)
  if (spec.kind === 'all') {
    return { kind: 'all', members: dedupe([...learners.values()].map(toMember)) }
  }
  const enrolments = await readAll<EnrolmentRow>(() =>
    svc.from('course_enrollments').select('learner_id, course_id, last_practiced_at, highest_completed_lego_id, total_practice_minutes').eq('course_id', spec.courseCode),
  'learner_id')
  const members: AudienceMember[] = []
  for (const e of enrolments) {
    if (!hasProgress(e)) continue
    const l = learners.get(e.learner_id)
    if (l) members.push(toMember(l))
  }
  return { kind: 'course', members: dedupe(members) }
}

function dedupe(members: AudienceMember[]): AudienceMember[] {
  const seen = new Set<string>()
  const out: AudienceMember[] = []
  for (const m of members) {
    if (seen.has(m.userId)) continue
    seen.add(m.userId)
    out.push(m)
  }
  return out
}

export interface CourseAudienceSummary {
  courseCode: string
  displayName: string
  learners: number
}

/** Every course somebody sendable has made progress on, with its audience size. The composer's course picker. */
export async function courseAudiences(svc: SupabaseClient): Promise<CourseAudienceSummary[]> {
  const [learners, enrolments, { data: courses, error }] = await Promise.all([
    sendableLearners(svc),
    readAll<EnrolmentRow>(() => svc.from('course_enrollments').select('learner_id, course_id, last_practiced_at, highest_completed_lego_id, total_practice_minutes'), 'learner_id'),
    svc.from('courses').select('course_code, display_name'),
  ])
  if (error) throw new Error(error.message)
  const names = new Map<string, string>()
  for (const c of (courses ?? []) as Array<{ course_code: string; display_name: string | null }>) names.set(c.course_code, c.display_name ?? c.course_code)
  const perCourse = new Map<string, Set<string>>()
  for (const e of enrolments) {
    if (!hasProgress(e)) continue
    const l = learners.get(e.learner_id)
    if (!l) continue
    let set = perCourse.get(e.course_id)
    if (!set) { set = new Set(); perCourse.set(e.course_id, set) }
    set.add(l.user_id)
  }
  return [...perCourse.entries()]
    .map(([courseCode, set]) => ({ courseCode, displayName: names.get(courseCode) ?? courseCode, learners: set.size }))
    .sort((a, b) => b.learners - a.learners || a.courseCode.localeCompare(b.courseCode))
}

export interface SendInput {
  /** The broadcast id, minted by the composer before preview. */
  id: string
  senderUserId: string
  spec: AudienceSpec
  title: string
  body: string
  /**
   * A one-tap action for every recipient's inbox row, e.g. { kind: 'acknowledge', label: 'Understood', payload: {} }.
   * Not reachable from the HTTP composer (parseSendBody never sets it) — script-only, for a send that
   * genuinely wants a stamped answer rather than just a body. Defaults to null, as it always has.
   */
  action?: { kind: string; label: string; payload: Record<string, unknown> } | null
}

export interface SendResult {
  id: string
  audience: number
  /** Inbox rows that landed on THIS call; a retry reports 0 and that is correct. */
  sent: number
}

export function dedupeKeyFor(broadcastId: string, recipientUserId: string): string {
  return `${ADMIN_MESSAGE_SOURCE}:${broadcastId}:${recipientUserId}`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The composer's fields, validated: a uuid id, a bounded title and body, a well-formed audience. */
export function parseSendBody(body: unknown): { input: Omit<SendInput, 'senderUserId'> } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id.trim().toLowerCase() : ''
  if (!UUID_RE.test(id)) return { error: 'id must be a uuid minted by the composer' }
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  const text = typeof b.body === 'string' ? b.body.trim() : ''
  if (!title) return { error: 'title is required' }
  if (title.length > TITLE_MAX) return { error: `title too long (max ${TITLE_MAX} characters)` }
  if (!text) return { error: 'body is required' }
  if (text.length > BODY_MAX) return { error: `body too long (max ${BODY_MAX} characters)` }
  const spec = parseAudience(b)
  if ('error' in spec) return spec
  return { input: { id, spec: spec.spec, title, body: text } }
}

export function parseAudience(q: Record<string, unknown>): { spec: AudienceSpec } | { error: string } {
  const kind = typeof q.kind === 'string' ? q.kind : ''
  if (kind === 'all') return { spec: { kind: 'all' } }
  if (kind === 'course') {
    const courseCode = typeof q.course_code === 'string' ? q.course_code.trim() : ''
    if (!/^[a-z0-9_]{3,40}$/i.test(courseCode)) return { error: 'course_code is required' }
    return { spec: { kind: 'course', courseCode } }
  }
  if (kind === 'one') {
    const userId = typeof q.user_id === 'string' ? q.user_id.trim() : ''
    if (!userId || userId.length > 80) return { error: 'user_id is required' }
    return { spec: { kind: 'one', userId } }
  }
  return { error: 'kind must be one, course or all' }
}

/** A retry under a broadcast id whose title, body or audience differ from the frozen row. */
export class BroadcastMismatchError extends Error {
  readonly status = 409
  constructor(field: string) {
    super(`broadcast ${field} differs from the one already sent under this id; mint a new id to send a different message`)
    this.name = 'BroadcastMismatchError'
  }
}

interface FrozenBroadcast {
  audience_kind: string
  course_code: string | null
  target_user_id: string | null
  title: string
  body: string
  recipient_user_ids: string[] | null
}

/**
 * Send to the resolved audience. Safe to call twice with the same id: the
 * FIRST send freezes the audience and the words on the broadcast row; a retry
 * reuses the frozen recipient list (never re-resolving it, so nobody who
 * qualified only later is swept in) and every inbox row is keyed, so a retry
 * adds nothing and reports sent: 0. A retry whose title, body or audience
 * differ from the frozen row is refused with BroadcastMismatchError.
 */
export async function sendAdminMessage(svc: SupabaseClient, input: SendInput): Promise<SendResult> {
  const { data: existing, error: readErr } = await svc
    .from(ADMIN_MESSAGES_TABLE)
    .select('audience_kind, course_code, target_user_id, title, body, recipient_user_ids')
    .eq('id', input.id)
    .maybeSingle()
  if (readErr) throw new Error(readErr.message)
  const frozen = (existing ?? null) as FrozenBroadcast | null

  let recipientIds: string[]
  if (frozen) {
    if (frozen.audience_kind !== input.spec.kind) throw new BroadcastMismatchError('audience')
    if ((frozen.course_code ?? null) !== (input.spec.kind === 'course' ? input.spec.courseCode : null)) throw new BroadcastMismatchError('audience')
    if ((frozen.target_user_id ?? null) !== (input.spec.kind === 'one' ? input.spec.userId : null)) throw new BroadcastMismatchError('audience')
    if (frozen.title !== input.title) throw new BroadcastMismatchError('title')
    if (frozen.body !== input.body) throw new BroadcastMismatchError('body')
    // Broadcasts from before the column existed carry null: resolve once more, as they always did.
    recipientIds = frozen.recipient_user_ids ?? (await resolveAudience(svc, input.spec)).members.map((m) => m.userId)
  } else {
    recipientIds = (await resolveAudience(svc, input.spec)).members.map((m) => m.userId)
    const { error: headErr } = await svc.from(ADMIN_MESSAGES_TABLE).upsert(
      {
        id: input.id,
        sender_user_id: input.senderUserId,
        audience_kind: input.spec.kind,
        course_code: input.spec.kind === 'course' ? input.spec.courseCode : null,
        target_user_id: input.spec.kind === 'one' ? input.spec.userId : null,
        title: input.title,
        body: input.body,
        recipient_count: recipientIds.length,
        recipient_user_ids: recipientIds,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (headErr) throw new Error(headErr.message)
  }

  let sent = 0
  for (let i = 0; i < recipientIds.length; i += WRITE_CHUNK) {
    const rows = recipientIds.slice(i, i + WRITE_CHUNK).map((userId) => ({
      recipient_user_id: userId,
      source: ADMIN_MESSAGE_SOURCE,
      title: input.title,
      body: input.body,
      action: input.action ?? null,
      dedupe_key: dedupeKeyFor(input.id, userId),
    }))
    const { data, error } = await svc
      .from(USER_MESSAGES_TABLE)
      .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(error.message)
    sent += ((data ?? []) as unknown[]).length
  }
  const { error: stampErr } = await svc.from(ADMIN_MESSAGES_TABLE).update({ sent_at: new Date().toISOString() }).eq('id', input.id).is('sent_at', null)
  if (stampErr) throw new Error(stampErr.message)
  return { id: input.id, audience: recipientIds.length, sent }
}

export interface SentSummary {
  id: string
  audience_kind: string
  course_code: string | null
  target_user_id: string | null
  title: string
  body: string
  recipient_count: number
  created_at: string
  sent_at: string | null
}

/**
 * One SEND, as the Sent list shows it. `parts` is how many admin_messages rows
 * folded into it — 1 for an ordinary broadcast.
 */
export interface SentGroup extends SentSummary {
  parts: number
}

/** How many raw rows are read to fill `limit` grouped ones. A 123-recipient loop is one group. */
const SENT_SCAN = 400

/** The send minute — the grouping grain. Two rows a second apart are one send; a repeat next week is not. */
function sendMinute(iso: string): string {
  return iso.slice(0, 16)
}

/**
 * Fold a per-recipient send into one row (Tom, 2026-09-19: "we don't want to
 * see tons of copies of a message sent to all learners").
 *
 * The 18 Sep schools release note landed as 123 separate audience_kind 'one'
 * broadcasts — one per recipient, minted in a loop by the script that sent it —
 * so the Sent list read as 123 identical rows. Rows with the same TITLE, BODY
 * and SEND MINUTE are that one send and become one row carrying the summed
 * recipient_count. A genuinely separate second send of the same words on
 * another day is a different minute, so it stays its own row, which is the
 * point: nothing is hidden, only gathered.
 *
 * A group of one keeps its target_user_id, so "who did that one-learner message
 * go to" survives. A group of many drops it — it names one of 123 people and
 * would be a lie.
 *
 * Pure, and exported, so the folding is testable without a database.
 */
export function groupSentRows(rows: SentSummary[]): SentGroup[] {
  const groups: SentGroup[] = []
  const byKey = new Map<string, SentGroup>()
  for (const r of rows) {
    const key = `${sendMinute(r.created_at)}\u0000${r.title}\u0000${r.body}`
    const hit = byKey.get(key)
    if (!hit) {
      const group: SentGroup = { ...r, parts: 1 }
      byKey.set(key, group)
      groups.push(group)
      continue
    }
    hit.parts += 1
    hit.recipient_count += r.recipient_count
    hit.target_user_id = null
    if (!hit.sent_at && r.sent_at) hit.sent_at = r.sent_at
  }
  return groups
}

/**
 * The last few SENDS, newest first — what the composer shows under the form.
 *
 * It reads a wider window of rows than it returns and folds them (see
 * groupSentRows), because one send can be many rows.
 */
export async function recentAdminMessages(svc: SupabaseClient, limit = 30): Promise<SentGroup[]> {
  const { data, error } = await svc
    .from(ADMIN_MESSAGES_TABLE)
    .select('id, audience_kind, course_code, target_user_id, title, body, recipient_count, created_at, sent_at')
    .order('created_at', { ascending: false })
    .limit(SENT_SCAN)
  if (error) throw new Error(error.message)
  return groupSentRows((data ?? []) as SentSummary[]).slice(0, limit)
}
