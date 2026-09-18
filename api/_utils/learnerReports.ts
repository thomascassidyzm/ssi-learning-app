/**
 * learnerReports — every in-app report a learner has sent us, and the reply
 * (job #28).
 *
 * Tom, 2026-09-16 22:49Z "send a reply in the app", and 22:50Z: Tom, Kai and
 * any ssi_admin must be able to SEE every in-app report and reply from there.
 *
 * TWO POSTBOXES, ONE INBOX. public.bug_reports is what the player's "Report a
 * bug" writes; public.tester_feedback is the older tester panel, still mounted
 * in App.vue and still written. Neither is going to be migrated into the other
 * for this: they are read into ONE normalised shape here, and a report is
 * addressed by source + id.
 *
 * THE REPLY IS AN INBOX MESSAGE, NOT A COLUMN. It goes out through
 * sendAdminMessage as an admin message to that one learner, so she meets it on
 * the Library notice card and in /me/inbox — reading code in production since
 * job #684. The report tables carry only the LINK: reply_message_id,
 * replied_at, replied_by. SEEN is the user_messages row's own read_at, which
 * is real: listing never stamps it, only her tap does.
 *
 * IDEMPOTENT. The broadcast id is derived from source + report id, so a retry
 * after a timeout re-sends nothing.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAdminMessage, dedupeKeyFor, BODY_MAX } from './adminMessages'
import { USER_MESSAGES_TABLE } from './userMessages'

export type ReportSource = 'bug_report' | 'tester_feedback'

export const REPORT_TABLES: Record<ReportSource, string> = {
  bug_report: 'bug_reports',
  tester_feedback: 'tester_feedback',
}

export function isReportSource(v: unknown): v is ReportSource {
  return v === 'bug_report' || v === 'tester_feedback'
}

/** Her words, in her language of the app, plain. No jargon, no ticket number. */
export const REPLY_TITLE = 'A reply to your report'

const BUG_COLUMNS =
  'id, auth_user_id, learner_id, body, created_at, course_code, position, device, app_version, app_shell, deployment_env, screenshot_url, reporter_email, account_code, reply_message_id, replied_at, replied_by'
const TESTER_COLUMNS =
  'id, user_id, display_name, feedback_type, title, description, route, device_info, build_version, screenshot_url, status, created_at, reply_message_id, replied_at, replied_by'

/** One report, whichever postbox it came from, in the shape the inbox renders. */
export interface LearnerReport {
  source: ReportSource
  id: string
  createdAt: string
  /** Auth uid of the reporter; null for a guest, and a guest cannot be replied to. */
  authUserId: string | null
  who: string
  courseCode: string | null
  /** Where she was: the last LEGO played, or the route the tester panel recorded. */
  position: string | null
  device: string | null
  appVersion: string | null
  deploymentEnv: string | null
  title: string | null
  body: string
  screenshotUrl: string | null
  status: string | null
  repliedAt: string | null
  repliedBy: string | null
  replyMessageId: string | null
  /** The reply as sent, read back off the inbox row. */
  replyText: string | null
  /** When she opened it. Null means sent and not yet seen. */
  replySeenAt: string | null
}

interface MessageRow {
  id: string
  body: string
  read_at: string | null
}

function text(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}

/** The last LEGO played, said the way Tom says it: the lego's own words, never a seed number. */
function positionWords(position: unknown): string | null {
  const p = (position && typeof position === 'object' ? position : null) as Record<string, unknown> | null
  if (!p) return null
  const known = text(p.known_text)
  const target = text(p.target_text)
  const lego = text(p.lego_id)
  const belt = text(p.belt)
  const words = known && target ? `${known} — ${target}` : known || target || lego
  if (!words) return null
  return belt ? `${words}, ${belt} belt` : words
}

function deviceWords(device: unknown): string | null {
  const d = (device && typeof device === 'object' ? device : null) as Record<string, unknown> | null
  if (!d) return null
  const bits = [text(d.platform), text(d.viewport), d.standalone === true ? 'installed' : null, text(d.user_agent)]
  return bits.filter(Boolean).join(' · ') || null
}

function fromBugReport(r: Record<string, any>, msg: MessageRow | null): LearnerReport {
  return {
    source: 'bug_report',
    id: String(r.id),
    createdAt: String(r.created_at),
    authUserId: text(r.auth_user_id),
    who: text(r.reporter_email) || text(r.account_code) || text(r.auth_user_id) || 'a guest',
    courseCode: text(r.course_code),
    position: positionWords(r.position),
    device: deviceWords(r.device),
    appVersion: text(r.app_version),
    deploymentEnv: text(r.deployment_env),
    title: null,
    body: String(r.body ?? ''),
    screenshotUrl: text(r.screenshot_url),
    status: null,
    repliedAt: text(r.replied_at),
    repliedBy: text(r.replied_by),
    replyMessageId: text(r.reply_message_id),
    replyText: msg?.body ?? null,
    replySeenAt: msg?.read_at ?? null,
  }
}

function fromTesterFeedback(r: Record<string, any>, msg: MessageRow | null): LearnerReport {
  return {
    source: 'tester_feedback',
    id: String(r.id),
    createdAt: String(r.created_at),
    authUserId: text(r.user_id),
    who: text(r.display_name) || text(r.user_id) || 'a tester',
    courseCode: null,
    position: text(r.route),
    device: deviceWords(r.device_info),
    appVersion: text(r.build_version),
    deploymentEnv: null,
    title: text(r.title),
    body: String(r.description ?? ''),
    screenshotUrl: text(r.screenshot_url),
    status: text(r.status),
    repliedAt: text(r.replied_at),
    repliedBy: text(r.replied_by),
    replyMessageId: text(r.reply_message_id),
    replyText: msg?.body ?? null,
    replySeenAt: msg?.read_at ?? null,
  }
}

/** Unanswered first, then newest first. The order Tom reads them in. */
export function sortForInbox(rows: LearnerReport[]): LearnerReport[] {
  return [...rows].sort((a, b) => {
    const unanswered = Number(Boolean(a.repliedAt)) - Number(Boolean(b.repliedAt))
    if (unanswered !== 0) return unanswered
    return b.createdAt.localeCompare(a.createdAt)
  })
}

/** Every report from both postboxes, with its reply and whether she has opened it. */
export async function listLearnerReports(svc: SupabaseClient, limit = 200): Promise<LearnerReport[]> {
  const [bugs, testers] = await Promise.all([
    svc.from(REPORT_TABLES.bug_report).select(BUG_COLUMNS).order('created_at', { ascending: false }).limit(limit),
    svc.from(REPORT_TABLES.tester_feedback).select(TESTER_COLUMNS).order('created_at', { ascending: false }).limit(limit),
  ])
  if (bugs.error) throw new Error(`${REPORT_TABLES.bug_report} read failed: ${bugs.error.message}`)
  if (testers.error) throw new Error(`${REPORT_TABLES.tester_feedback} read failed: ${testers.error.message}`)

  const bugRows = (bugs.data ?? []) as Array<Record<string, any>>
  const testerRows = (testers.data ?? []) as Array<Record<string, any>>
  const messageIds = [...bugRows, ...testerRows].map((r) => r.reply_message_id).filter(Boolean) as string[]
  const messages = await loadReplyMessages(svc, messageIds)

  return sortForInbox([
    ...bugRows.map((r) => fromBugReport(r, messages.get(r.reply_message_id) ?? null)),
    ...testerRows.map((r) => fromTesterFeedback(r, messages.get(r.reply_message_id) ?? null)),
  ])
}

/** PostgREST refuses a very long .in() list, so this chunks well under the url limit. */
const IN_CHUNK = 150

async function loadReplyMessages(svc: SupabaseClient, ids: string[]): Promise<Map<string, MessageRow>> {
  const out = new Map<string, MessageRow>()
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK)
    if (!chunk.length) continue
    const { data, error } = await svc.from(USER_MESSAGES_TABLE).select('id, body, read_at').in('id', chunk)
    if (error) throw new Error(`${USER_MESSAGES_TABLE} read failed: ${error.message}`)
    for (const m of (data ?? []) as MessageRow[]) out.set(m.id, m)
  }
  return out
}

export async function loadLearnerReport(svc: SupabaseClient, source: ReportSource, id: string): Promise<LearnerReport | null> {
  // `as string`: a union of two column literals sends PostgREST's generic
  // select() inference past its own limit (TS2590), red on dev since job #28.
  const columns: string = source === 'bug_report' ? BUG_COLUMNS : TESTER_COLUMNS
  const { data, error } = await svc.from(REPORT_TABLES[source]).select(columns).eq('id', id).maybeSingle()
  if (error) throw new LearnerReportError(error.message)
  if (!data) return null
  const row = data as Record<string, any>
  const messages = await loadReplyMessages(svc, row.reply_message_id ? [row.reply_message_id] : [])
  const msg = row.reply_message_id ? messages.get(row.reply_message_id) ?? null : null
  return source === 'bug_report' ? fromBugReport(row, msg) : fromTesterFeedback(row, msg)
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

/** "16 September" — the day she wrote, so the quote below is anchored in time. */
export function reportDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dayMonth.format(d)
}

/**
 * The reply, then her own report under it. Pre-wrap in the inbox renders the
 * blank lines, so this reads as two blocks rather than one wall.
 */
export function composeReplyBody(replyText: string, report: Pick<LearnerReport, 'body' | 'createdAt' | 'title'>): string {
  const when = reportDate(report.createdAt)
  const heading = when ? `What you sent us on ${when}` : 'What you sent us'
  const hers = [report.title, report.body.trim()].filter(Boolean).join('\n\n')
  return `${replyText.trim()}\n\n———\n\n${heading}\n\n${hers}`
}

/**
 * A uuid derived from the report, so the same report always sends under the
 * same broadcast. Deterministic, not random: that is the whole idempotency.
 */
export function replyBroadcastId(source: ReportSource, reportId: string): string {
  const seed = source === 'bug_report' ? `bug_report_reply:${reportId}` : `${source}_reply:${reportId}`
  const h = createHash('sha1').update(seed).digest('hex')
  // Shape the digest as a v5-looking uuid: version nibble 5, variant nibble 8.
  return [h.slice(0, 8), h.slice(8, 12), `5${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join('-')
}

export interface ReplyInput {
  source: ReportSource
  reportId: string
  /** The words to send, as written. Never edited here. */
  replyText: string
  /** Auth uid of whoever is replying; goes on the broadcast as the sender. */
  senderUserId: string
  /** Answer a report that already carries replied_at. Re-sends nothing. */
  resend?: boolean
}

export interface ReplyResult {
  source: ReportSource
  reportId: string
  broadcastId: string
  recipientUserId: string
  messageId: string | null
  /** True when a NEW inbox row landed. False on a retry, and that is correct. */
  sent: boolean
}

export class LearnerReportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LearnerReportError'
  }
}

/** Send one reply and link it back to the report. Service-role client only. */
export async function replyToLearnerReport(svc: SupabaseClient, input: ReplyInput): Promise<ReplyResult> {
  const reply = input.replyText.trim()
  if (!reply) throw new LearnerReportError('reply text is required')

  const report = await loadLearnerReport(svc, input.source, input.reportId)
  if (!report) throw new LearnerReportError(`no ${input.source} ${input.reportId}`)
  if (!report.authUserId) throw new LearnerReportError('this report was sent by a guest, so there is no inbox to reply to')
  if (report.repliedAt && !input.resend) {
    throw new LearnerReportError(`already replied at ${report.repliedAt}; pass resend to stamp it again`)
  }

  const body = composeReplyBody(reply, report)
  if (body.length > BODY_MAX) throw new LearnerReportError(`reply plus quoted report is ${body.length} characters, over the ${BODY_MAX} limit`)

  const broadcastId = replyBroadcastId(report.source, report.id)
  const recipientUserId = report.authUserId
  const outcome = await sendAdminMessage(svc, {
    id: broadcastId,
    senderUserId: input.senderUserId,
    spec: { kind: 'one', userId: recipientUserId },
    title: REPLY_TITLE,
    body,
  })

  const messageId = await findReplyMessageId(svc, broadcastId, recipientUserId)
  const { error } = await svc
    .from(REPORT_TABLES[report.source])
    .update({ reply_message_id: messageId, replied_at: new Date().toISOString(), replied_by: input.senderUserId })
    .eq('id', report.id)
  if (error) throw new LearnerReportError(`reply sent but the report could not be stamped: ${error.message}`)

  return { source: report.source, reportId: report.id, broadcastId, recipientUserId, messageId, sent: outcome.sent > 0 }
}

/** The inbox row this broadcast landed as, found by the key it was written with. */
export async function findReplyMessageId(svc: SupabaseClient, broadcastId: string, recipientUserId: string): Promise<string | null> {
  const { data, error } = await svc
    .from(USER_MESSAGES_TABLE)
    .select('id')
    .eq('dedupe_key', dedupeKeyFor(broadcastId, recipientUserId))
    .maybeSingle()
  if (error) throw new LearnerReportError(error.message)
  return (data as { id?: string } | null)?.id ?? null
}
