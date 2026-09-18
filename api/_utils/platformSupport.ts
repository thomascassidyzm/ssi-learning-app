/**
 * platformSupport — every school's, every org's and every learner's support
 * thread, read and answered by an ssi_admin from one place (job #220, job
 * #221).
 *
 * Tom, 2026-09-18 14:16Z: platform admins should be able to see in-app support
 * messages somewhere in the app, even though agents will handle most of them.
 * Until now they could not: resolveSupportScope in api/support/_shared.ts
 * resolves a school_admin's own school or a govt_admin's own group and nothing
 * else, so an ssi_admin — who has neither — could open no school's thread at
 * all, not even under View As.
 *
 * READ SCOPE, NOT A NEW CHANNEL. The school's side of the channel is untouched:
 * a school still reads only its own thread, through its own scope, under the
 * same RLS. This is the admin passthrough — the same shape as
 * scopeForSchoolRead in schoolScope.ts, which the class-practice tiles use —
 * lifted to the support tables and reachable only behind verifyAdmin.
 *
 * THE THIRD OWNER, ONE LIST (job #221). support_threads carries a third owner
 * kind since job #821: learner_user_id + origin_message_id, opened when a
 * learner replies to an admin_message from /me/inbox. Tom wants ONE list of
 * everything waiting, so a learner thread is listed here exactly like a
 * school's or an org's — named by her display name or her support id, NEVER
 * her email — and answered the same way, through the same replyAsPlatform.
 *
 * DE-DUPED AGAINST HER OWN REPORT. A learner thread whose origin_message_id
 * is a bug_report's or tester_feedback's own reply_message_id (job #28) is
 * the SAME conversation the reports list already shows — she replied to our
 * reply to her bug report — so it is left out here rather than shown twice.
 * See repliedReportOriginIds.
 *
 * THE REPLY IS AN ORDINARY 'out' ROW. Nothing new is needed to deliver it: for
 * a school/org thread the user_messages_from_support_reply trigger fans an out
 * row into every admin's inbox, GET /api/support/thread marks those read when
 * she opens the thread, and api/cron/support-doorbell emails her if the reply
 * sits unopened (skipped for a learner thread — see support-doorbell.ts, the
 * copy there is written for a school and her own inbox already carries it).
 * For a learner thread the same trigger instead clears read_at on the origin
 * message, so her own inbox shows it unread again with the reply inside — the
 * same shape /api/messages/reply already writes her side with. So the
 * platform inbox writes the same row the watson-1 watcher writes, and the
 * doorbell and the read receipts keep working because they were never told
 * about us.
 *
 * AUTHORED AS THE SSI_ADMIN, NEVER AS THE SCHOOL (Tom, 2026-09-14: "viewing as
 * a school admin/teacher must never create rows in that person's name"). The
 * author fields come from verifyAdmin's own verified uid, and the route refuses
 * a write made while touring under View As.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { MESSAGE_VIEW_COLUMNS, type SupportMessageView } from '../support/_shared'
import { supportIdForLearnerId } from '../../packages/core/src/identity/supportId'

/** A body longer than this is not a support reply, it is a document. */
export const PLATFORM_REPLY_MAX = 4000

/** How many threads the inbox reads at once. Support volume is small; this is a guard, not a page. */
export const THREAD_LIMIT = 300

export interface PlatformThreadRow {
  id: string
  school_id: string | null
  group_id: string | null
  learner_user_id: string | null
  origin_message_id: string | null
  created_at: string
  last_message_at: string | null
  last_read_at: string | null
  language: string | null
}

const THREAD_COLUMNS = 'id, school_id, group_id, learner_user_id, origin_message_id, created_at, last_message_at, last_read_at, language'

/** One thread as the platform inbox lists it. */
export interface PlatformThreadSummary {
  id: string
  /** 'school', 'group' or 'learner' (job #221) — her own reply thread, named by her, never by email. */
  kind: 'school' | 'group' | 'learner'
  /** The school's or the org's name, as the admin would say it out loud; for a learner thread, her display name or support id. */
  who: string
  /** The person who wrote the most recent question, when we know their name. Null for a learner thread — 'who' already says it. */
  person: string | null
  language: string | null
  createdAt: string
  lastMessageAt: string | null
  /** The most recent turn, whichever side wrote it. */
  lastBody: string
  lastDirection: 'in' | 'out' | null
  /** Questions with no answer yet. Greater than zero = this row is waiting on us. */
  unanswered: number
  messageCount: number
  /** When the school last opened the thread; null means our last reply is unread. */
  lastReadAt: string | null
}

export interface ThreadContext {
  /** What her browser said: the route, the tile, the value it showed, the build, the device. */
  route: string | null
  anchor: string | null
  displayedLabel: string | null
  displayedValue: string | null
  build: string | null
  device: string | null
  /** What the server computed under that tile at the moment she pressed Send. */
  server: Record<string, unknown> | null
  signalKey: string | null
  computedAt: string | null
}

export interface PlatformThreadDetail extends PlatformThreadSummary {
  messages: SupportMessageView[]
  standingNotes: Record<string, unknown>
  /**
   * The envelope of her most recent question — the half of the channel the
   * school never sees and the answerer always needs. It is read here under the
   * service role for an ssi_admin only; the browser grant on support_messages
   * stays column-scoped to MESSAGE_VIEW_COLUMNS (SEC0912-B-01), untouched.
   */
  context: ThreadContext | null
  /** What she was replying to — the admin_message this learner thread answers. Null for a school/org thread. */
  originMessage: { title: string; body: string } | null
}

interface TurnRow {
  id: string
  thread_id: string
  body: string
  direction: 'in' | 'out'
  author_name: string | null
  answered_at: string | null
  created_at: string
  envelope?: Record<string, unknown> | null
  signal_key?: string | null
}

/** Unanswered first, then newest first — the order Tom asked for, and testable on its own. */
export function orderThreads<T extends { unanswered: number; lastMessageAt: string | null; createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if ((a.unanswered > 0) !== (b.unanswered > 0)) return a.unanswered > 0 ? -1 : 1
    const at = Date.parse(a.lastMessageAt ?? a.createdAt) || 0
    const bt = Date.parse(b.lastMessageAt ?? b.createdAt) || 0
    return bt - at
  })
}

/** Fold one thread's turns into the row the inbox shows. Pure, so the counting is testable. */
export function summariseTurns(turns: TurnRow[]): {
  unanswered: number
  messageCount: number
  lastBody: string
  lastDirection: 'in' | 'out' | null
  person: string | null
} {
  const ordered = [...turns].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  const last = ordered[ordered.length - 1] ?? null
  const lastIn = [...ordered].reverse().find((t) => t.direction === 'in') ?? null
  return {
    unanswered: ordered.filter((t) => t.direction === 'in' && !t.answered_at).length,
    messageCount: ordered.length,
    lastBody: last?.body ?? '',
    lastDirection: last ? last.direction : null,
    person: lastIn?.author_name ?? null,
  }
}

async function namesFor(svc: SupabaseClient, schoolIds: string[], groupIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  const [schools, groups] = await Promise.all([
    schoolIds.length ? svc.from('schools').select('id, school_name').in('id', schoolIds) : Promise.resolve({ data: [] }),
    groupIds.length ? svc.from('groups').select('id, name').in('id', groupIds) : Promise.resolve({ data: [] }),
  ])
  for (const s of (schools.data ?? []) as Array<{ id: string; school_name: string | null }>) {
    names.set(s.id, s.school_name || 'Unnamed school')
  }
  for (const g of (groups.data ?? []) as Array<{ id: string; name: string | null }>) {
    names.set(g.id, g.name || 'Unnamed organisation')
  }
  return names
}

/** Her display name, or failing that her support id (job #221) — never her email, keyed by auth uid. */
async function learnerNamesFor(svc: SupabaseClient, authUserIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (!authUserIds.length) return names
  const { data } = await svc.from('learners').select('id, user_id, display_name').in('user_id', authUserIds)
  for (const l of (data ?? []) as Array<{ id: string; user_id: string; display_name: string | null }>) {
    names.set(l.user_id, l.display_name || supportIdForLearnerId(l.id) || 'a learner')
  }
  return names
}

/**
 * Every bug_report / tester_feedback reply already in the reports list
 * (job #28) that a learner might have replied to, keyed by the admin_message
 * id it was sent as. A learner thread whose origin_message_id lands in this
 * set is the SAME conversation, so listPlatformThreads leaves it out rather
 * than showing it twice.
 */
async function repliedReportOriginIds(svc: SupabaseClient): Promise<Set<string>> {
  const [bugs, testers] = await Promise.all([
    svc.from('bug_reports').select('reply_message_id'),
    svc.from('tester_feedback').select('reply_message_id'),
  ])
  const ids = new Set<string>()
  for (const row of [...((bugs.data ?? []) as Array<{ reply_message_id: string | null }>), ...((testers.data ?? []) as Array<{ reply_message_id: string | null }>)]) {
    if (row.reply_message_id) ids.add(row.reply_message_id)
  }
  return ids
}

/** The admin_message a learner thread answers — for the "what she was replying to" line. */
async function loadOriginMessage(svc: SupabaseClient, id: string): Promise<{ title: string; body: string } | null> {
  const { data } = await svc.from('user_messages').select('title, body').eq('id', id).maybeSingle()
  const row = data as { title?: string; body?: string } | null
  return row ? { title: row.title ?? '', body: row.body ?? '' } : null
}

/**
 * Every school, org and learner thread, unanswered first, newest first.
 *
 * A learner thread (support_threads.learner_user_id, job #821) already shown
 * via her own bug_report/tester_feedback row (job #28) is left out — see
 * repliedReportOriginIds — so the same conversation never appears twice.
 */
export async function listPlatformThreads(svc: SupabaseClient): Promise<PlatformThreadSummary[]> {
  const { data, error } = await svc
    .from('support_threads')
    .select(THREAD_COLUMNS)
    .or('school_id.not.is.null,group_id.not.is.null,learner_user_id.not.is.null')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(THREAD_LIMIT)
  // Silent to loud (RLS doctrine rule 8): a refused read is a failure the
  // caller must see, never an empty inbox.
  if (error) throw new Error(`support threads read failed: ${error.message}`)
  const allThreads = (data ?? []) as PlatformThreadRow[]
  if (!allThreads.length) return []

  const excludedOriginIds = await repliedReportOriginIds(svc)
  const threads = allThreads.filter((t) => !(t.learner_user_id && t.origin_message_id && excludedOriginIds.has(t.origin_message_id)))
  if (!threads.length) return []

  const [{ data: turnRows, error: turnErr }, orgNames, learnerNames] = await Promise.all([
    svc
      .from('support_messages')
      .select('id, thread_id, body, direction, author_name, answered_at, created_at')
      .in('thread_id', threads.map((t) => t.id)),
    namesFor(
      svc,
      threads.map((t) => t.school_id).filter((x): x is string => !!x),
      threads.map((t) => t.group_id).filter((x): x is string => !!x),
    ),
    learnerNamesFor(svc, threads.map((t) => t.learner_user_id).filter((x): x is string => !!x)),
  ])
  if (turnErr) throw new Error(`support messages read failed: ${turnErr.message}`)

  const byThread = new Map<string, TurnRow[]>()
  for (const t of (turnRows ?? []) as TurnRow[]) {
    const list = byThread.get(t.thread_id) ?? []
    list.push(t)
    byThread.set(t.thread_id, list)
  }

  const rows = threads.map((t) => toSummary(t, byThread.get(t.id) ?? [], orgNames, learnerNames))
  return orderThreads(rows)
}

function toSummary(t: PlatformThreadRow, turns: TurnRow[], orgNames: Map<string, string>, learnerNames: Map<string, string>): PlatformThreadSummary {
  if (t.learner_user_id) {
    return {
      id: t.id,
      kind: 'learner',
      who: learnerNames.get(t.learner_user_id) ?? 'a learner',
      language: t.language,
      createdAt: t.created_at,
      lastMessageAt: t.last_message_at,
      lastReadAt: t.last_read_at,
      ...summariseTurns(turns),
      person: null,
    }
  }
  const kind: 'school' | 'group' = t.school_id ? 'school' : 'group'
  const key = (t.school_id ?? t.group_id) as string
  return {
    id: t.id,
    kind,
    who: orgNames.get(key) ?? (kind === 'school' ? 'Unknown school' : 'Unknown organisation'),
    language: t.language,
    createdAt: t.created_at,
    lastMessageAt: t.last_message_at,
    lastReadAt: t.last_read_at,
    ...summariseTurns(turns),
  }
}

/** The envelope of one inbound turn, flattened to the few facts worth reading. */
export function toContext(turn: TurnRow | null): ThreadContext | null {
  if (!turn || !turn.envelope) return null
  const env = turn.envelope as { client?: Record<string, unknown>; server?: Record<string, unknown> }
  const c = (env.client ?? {}) as Record<string, unknown>
  const d = (c.device_info ?? {}) as Record<string, unknown>
  const server = (env.server ?? null) as Record<string, unknown> | null
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
  return {
    route: str(c.route),
    anchor: str(c.anchor),
    displayedLabel: str(c.displayed_label),
    displayedValue: str(c.displayed_value),
    build: str(c.build_version),
    device: str(d.userAgent),
    server,
    signalKey: turn.signal_key ?? null,
    computedAt: server ? str(server.computed_at) : null,
  }
}

/** One thread with every turn, oldest first. Null when the id is not a school, org or learner thread. */
export async function loadPlatformThread(svc: SupabaseClient, threadId: string): Promise<PlatformThreadDetail | null> {
  const { data, error } = await svc
    .from('support_threads')
    .select(`${THREAD_COLUMNS}, standing_notes`)
    .eq('id', threadId)
    .maybeSingle()
  if (error) throw new Error(`support thread read failed: ${error.message}`)
  const thread = data as (PlatformThreadRow & { standing_notes: Record<string, unknown> }) | null
  if (!thread) return null
  if (!thread.school_id && !thread.group_id && !thread.learner_user_id) return null

  const [{ data: rows, error: rowErr }, orgNames, learnerNames, originMessage] = await Promise.all([
    svc
      .from('support_messages')
      .select(`${MESSAGE_VIEW_COLUMNS}, thread_id, envelope, signal_key`)
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
    namesFor(svc, thread.school_id ? [thread.school_id] : [], thread.group_id ? [thread.group_id] : []),
    learnerNamesFor(svc, thread.learner_user_id ? [thread.learner_user_id] : []),
    thread.origin_message_id ? loadOriginMessage(svc, thread.origin_message_id) : Promise.resolve(null),
  ])
  if (rowErr) throw new Error(`support messages read failed: ${rowErr.message}`)

  const all = (rows ?? []) as Array<TurnRow & SupportMessageView>
  const messages = all.map((r) => {
    const { thread_id: _t, envelope: _e, signal_key: _s, ...view } = r as unknown as Record<string, unknown>
    return view as unknown as SupportMessageView
  })
  const latestQuestion = [...all].reverse().find((r) => r.direction === 'in') ?? null

  return {
    ...toSummary(thread, all, orgNames, learnerNames),
    messages,
    standingNotes: thread.standing_notes ?? {},
    context: toContext(latestQuestion),
    originMessage,
  }
}

export interface PlatformReplyInput {
  threadId: string
  text: string
  /** The ssi_admin's OWN verified auth uid — never the school admin's. */
  senderUserId: string
}

export class PlatformSupportError extends Error {}

/**
 * Answer a school's, an org's or a learner's thread as SSi.
 *
 * Writes the same 'out' row the watcher writes — author_source 'human',
 * author_via 'jwt', author_user_id the admin's own — points it at the question
 * it answers, and stamps answered_at on every question still open in the
 * thread so the watcher does not answer them a second time.
 *
 * It deliberately does NOT touch last_read_at: for a school/org thread that is
 * HER reading of it, and the doorbell email rings precisely on "our reply is
 * newer than her last open". A learner thread has no such reading to disturb —
 * the fan-out trigger clears her origin message's read_at instead, exactly as
 * postLearnerReply's counterpart does on her own side.
 */
export async function replyAsPlatform(svc: SupabaseClient, input: PlatformReplyInput): Promise<SupportMessageView> {
  const thread = await loadPlatformThread(svc, input.threadId)
  if (!thread) throw new PlatformSupportError('no such school or organisation thread')

  const { data: openQuestions, error: qErr } = await svc
    .from('support_messages')
    .select('id, created_at')
    .eq('thread_id', input.threadId)
    .eq('direction', 'in')
    .is('answered_at', null)
    .order('created_at', { ascending: true })
  if (qErr) throw new Error(`support messages read failed: ${qErr.message}`)
  const open = (openQuestions ?? []) as Array<{ id: string; created_at: string }>

  const { data: sender } = await svc.from('learners').select('display_name').eq('user_id', input.senderUserId).maybeSingle()

  const { data: message, error } = await svc
    .from('support_messages')
    .insert({
      thread_id: input.threadId,
      body: input.text,
      direction: 'out',
      author_source: 'human',
      author_name: ((sender as { display_name?: string } | null)?.display_name ?? 'SSi'),
      author_via: 'jwt',
      author_user_id: input.senderUserId,
      in_reply_to: open.length ? open[open.length - 1].id : null,
    })
    .select(MESSAGE_VIEW_COLUMNS)
    .single()
  if (error || !message) throw new Error(error?.message || 'reply could not be saved')

  const now = new Date().toISOString()
  if (open.length) {
    await svc.from('support_messages').update({ answered_at: now }).in('id', open.map((q) => q.id))
  }
  await svc.from('support_threads').update({ last_message_at: now }).eq('id', input.threadId)

  return message as SupportMessageView
}
