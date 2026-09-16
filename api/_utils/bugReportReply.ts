/**
 * bugReportReply — answering a learner's bug report, in the app (job #28).
 *
 * Tom, 2026-09-16 22:49Z: "send a reply in the app".
 *
 * NOTHING NEW REACHES HER PHONE. A reply to a bug report IS an admin message to
 * one learner, so it is sent as one: an admin_messages broadcast of audience
 * 'one' fanned out to a user_messages row, which the Library notice card and
 * /me/inbox already render and already track read state for. That reading code
 * has been in production since job #684, so a reply lands without a release.
 *
 * SHE SEES WHAT SHE WROTE. The report she is being answered about is quoted
 * under the reply, in the body, rather than in a fold the player would have to
 * grow a new component for. Same reason: the words travel, the code does not.
 *
 * IDEMPOTENT. The broadcast id is derived from the report id, so re-running the
 * tool after a timeout re-sends nothing: the broadcast is frozen and every
 * inbox row is keyed on dedupe_key admin_message:<broadcast>:<recipient>. A
 * report that already carries replied_at is refused unless the caller asks for
 * a resend, which only ever re-stamps — it cannot put a second copy in an inbox.
 */
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAdminMessage, dedupeKeyFor, BODY_MAX } from './adminMessages'
import { USER_MESSAGES_TABLE } from './userMessages'

export const BUG_REPORTS_TABLE = 'bug_reports'

/** Her words, in her language of the app, plain. No jargon, no ticket number. */
export const REPLY_TITLE = 'A reply to your report'

export const REPORT_COLUMNS =
  'id, auth_user_id, body, created_at, course_code, reply_message_id, replied_at, replied_by'

export interface BugReportRow {
  id: string
  auth_user_id: string | null
  body: string
  created_at: string
  course_code: string | null
  reply_message_id: string | null
  replied_at: string | null
  replied_by: string | null
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
export function composeReplyBody(replyText: string, report: Pick<BugReportRow, 'body' | 'created_at'>): string {
  const reply = replyText.trim()
  const when = reportDate(report.created_at)
  const heading = when ? `What you sent us on ${when}` : 'What you sent us'
  return `${reply}\n\n———\n\n${heading}\n\n${report.body.trim()}`
}

/**
 * A uuid derived from the report id, so the same report always sends under the
 * same broadcast. Deterministic, not random: that is the whole idempotency.
 */
export function replyBroadcastId(reportId: string): string {
  const h = createHash('sha1').update(`bug_report_reply:${reportId}`).digest('hex')
  // Shape the digest as a v5-looking uuid: version nibble 5, variant nibble 8.
  return [h.slice(0, 8), h.slice(8, 12), `5${h.slice(13, 16)}`, `8${h.slice(17, 20)}`, h.slice(20, 32)].join('-')
}

export interface ReplyInput {
  reportId: string
  /** The words to send, as written. Never edited here. */
  replyText: string
  /** Auth uid of whoever is replying; goes on the broadcast as the sender. */
  senderUserId: string
  /** Answer a report that already carries replied_at. Re-sends nothing. */
  resend?: boolean
}

export interface ReplyResult {
  reportId: string
  broadcastId: string
  recipientUserId: string
  messageId: string | null
  /** True when a NEW inbox row landed. False on a retry, and that is correct. */
  sent: boolean
}

export class BugReportReplyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BugReportReplyError'
  }
}

export async function loadBugReport(svc: SupabaseClient, reportId: string): Promise<BugReportRow | null> {
  const { data, error } = await svc.from(BUG_REPORTS_TABLE).select(REPORT_COLUMNS).eq('id', reportId).maybeSingle()
  if (error) throw new BugReportReplyError(error.message)
  return (data as unknown as BugReportRow | null) ?? null
}

/** Send one reply and link it back to the report. Service-role client only. */
export async function replyToBugReport(svc: SupabaseClient, input: ReplyInput): Promise<ReplyResult> {
  const reply = input.replyText.trim()
  if (!reply) throw new BugReportReplyError('reply text is required')

  const report = await loadBugReport(svc, input.reportId)
  if (!report) throw new BugReportReplyError(`no bug report ${input.reportId}`)
  if (!report.auth_user_id) throw new BugReportReplyError('this report was sent by a guest, so there is no inbox to reply to')
  if (report.replied_at && !input.resend) {
    throw new BugReportReplyError(`already replied at ${report.replied_at}; pass resend to stamp it again`)
  }

  const body = composeReplyBody(reply, report)
  if (body.length > BODY_MAX) throw new BugReportReplyError(`reply plus quoted report is ${body.length} characters, over the ${BODY_MAX} limit`)

  const broadcastId = replyBroadcastId(report.id)
  const recipientUserId = report.auth_user_id
  const outcome = await sendAdminMessage(svc, {
    id: broadcastId,
    senderUserId: input.senderUserId,
    spec: { kind: 'one', userId: recipientUserId },
    title: REPLY_TITLE,
    body,
  })

  const messageId = await findReplyMessageId(svc, broadcastId, recipientUserId)
  const { error } = await svc
    .from(BUG_REPORTS_TABLE)
    .update({ reply_message_id: messageId, replied_at: new Date().toISOString(), replied_by: input.senderUserId })
    .eq('id', report.id)
  if (error) throw new BugReportReplyError(`reply sent but the report could not be stamped: ${error.message}`)

  return { reportId: report.id, broadcastId, recipientUserId, messageId, sent: outcome.sent > 0 }
}

/** The inbox row this broadcast landed as, found by the key it was written with. */
export async function findReplyMessageId(svc: SupabaseClient, broadcastId: string, recipientUserId: string): Promise<string | null> {
  const { data, error } = await svc
    .from(USER_MESSAGES_TABLE)
    .select('id')
    .eq('dedupe_key', dedupeKeyFor(broadcastId, recipientUserId))
    .maybeSingle()
  if (error) throw new BugReportReplyError(error.message)
  return (data as { id?: string } | null)?.id ?? null
}
