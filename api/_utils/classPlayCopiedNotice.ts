/**
 * classPlayCopiedNotice — the message a teacher gets when the one-off sweep
 * copies her own-account play onto her class's Play as class account.
 *
 * WHY A MESSAGE AT ALL. Tom, 2026-09-14: "we DO want to be able to send them
 * in-app messages about stuff like this", and the reasoning he accepted in the
 * RBF room was that the copy is reversible and detectable by the teacher
 * herself — so ship it and let her edit in place. The bar for sending anyone
 * anything is whether it changes what they would do, and this one does: her
 * class account is at a different position than when she last looked, and one
 * tap puts it back.
 *
 * WHAT THIS FILE OWNS, AND WHAT IT DOES NOT. It owns the WORDS and the one-tap
 * action, nothing else. Delivery belongs to the in-app message inbox primitive
 * (job #684, landing alongside this). Exactly one place here knows how to hand
 * a message to that primitive — INBOX — so when the primitive lands, the whole
 * wiring is that one constant. There is deliberately NO second inbox, no
 * teacher_notices table, and no fallback delivery: a message that cannot be
 * delivered is REPORTED as undelivered, never invented somewhere else.
 *
 * HONEST WHEN IT CANNOT SEND. If the primitive's table is not there yet, the
 * send returns { sent: false, reason } and the sweep logs it per pair. A run
 * that copied rows and could not tell the teacher says exactly that.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The inbox primitive's contract, in one place. Job #684 builds one message
 * per user with a source, a read state and an optional one-tap action. These
 * names are the shape declared in its brief; when its migration lands, check
 * them against it and change them HERE and nowhere else.
 */
export const INBOX = {
  table: 'user_messages',
  columns: {
    userId: 'user_id',
    source: 'source',
    title: 'title',
    body: 'body',
    /** JSON: { label, endpoint, payload } — the one tap. */
    action: 'action',
  },
  /** This message's source key, so every copy notice is findable as one set. */
  source: 'class_play_copied',
} as const

export interface ClassPlayCopiedMessage {
  title: string
  body: string
  action: { label: string; endpoint: string; payload: Record<string, unknown> }
}

/**
 * The words. British English, no jargon, no parentheses; it names what changed,
 * why the teacher is seeing it, and the one thing she can do about it.
 */
export function classPlayCopiedMessage(params: {
  className: string
  courseName: string
  auditId: string
}): ClassPlayCopiedMessage {
  const { className, courseName, auditId } = params
  return {
    title: 'Your practice is now on your class account',
    body:
      `Your practice on ${courseName} has been copied onto ${className}'s Play as class account, ` +
      `so the class now starts where you got to. ` +
      `If you would rather it started from the beginning, tap Undo.`,
    action: {
      label: 'Undo',
      endpoint: '/api/school/copy-teacher-play/undo',
      payload: { audit_id: auditId },
    },
  }
}

/** A course's own display name, so the message never shows a course code. */
export async function courseDisplayName(svc: SupabaseClient, courseCode: string): Promise<string> {
  const { data } = await svc
    .from('courses')
    .select('learner_display_name, display_name')
    .eq('course_code', courseCode)
    .maybeSingle()
  const row = data as { learner_display_name?: string | null; display_name?: string | null } | null
  return String(row?.learner_display_name || row?.display_name || courseCode)
}

export interface NoticeResult {
  sent: boolean
  reason?: string
  message?: ClassPlayCopiedMessage
  messageId?: string
}

/**
 * Hands one notice to the inbox primitive. Returns { sent: false, reason }
 * rather than throwing: a copy that landed must never be reported as failed
 * because the message could not be delivered, and must never be reported as
 * clean when the teacher was not told.
 */
export async function sendClassPlayCopiedNotice(
  svc: SupabaseClient,
  params: {
    teacherUserId: string
    classId: string
    className: string
    courseCode: string
    auditId: string | null
  },
): Promise<NoticeResult> {
  if (!params.auditId) return { sent: false, reason: 'no audit id, so Undo would have nothing to undo' }
  const courseName = await courseDisplayName(svc, params.courseCode)
  const message = classPlayCopiedMessage({
    className: params.className,
    courseName,
    auditId: params.auditId,
  })
  const row: Record<string, unknown> = {
    [INBOX.columns.userId]: params.teacherUserId,
    [INBOX.columns.source]: INBOX.source,
    [INBOX.columns.title]: message.title,
    [INBOX.columns.body]: message.body,
    [INBOX.columns.action]: message.action,
  }
  const { data, error } = await svc.from(INBOX.table).insert(row).select('id').maybeSingle()
  if (error) return { sent: false, reason: `${INBOX.table}: ${error.message}`, message }
  return { sent: true, message, messageId: data ? String((data as { id: string }).id) : undefined }
}
