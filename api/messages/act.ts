/**
 * POST /api/messages/act {id} — run the message's one-tap action, ONCE.
 * Stamps action_taken_at on success and refuses a second run with 409. Own
 * row only. Under View As the preamble refuses before anything is read.
 *
 * Kinds:
 *   undo_class_play_copy {audit_id, class_id} — reverse a teacher-play copy
 *     (api/_utils/classProgressCopy.ts undoCopy). The recipient IS the teacher
 *     whose play was copied, by construction of the notice; a school admin of
 *     the class's school may also run it, which is the door a future admin
 *     surface will use. Refused when the class account has played since the
 *     copy: the undo would not be clean, and the answer says so.
 *   open_support — nothing to run server-side; the client navigates. Answered
 *     200 without stamping, so the message stays a plain pointer.
 *   acknowledge — "Understood", and nothing else. Stamps action_taken_at and
 *     answers 200. It exists because read_at only says the message was opened,
 *     and a note that asks a teacher to change how they start a lesson wants
 *     an answer rather than an impression. A second tap is the same 409 every
 *     other kind gets, which is right: the acknowledgement is given once.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveInboxCaller, messageIdFromBody } from './_shared'
import { ownUserMessage, toView, USER_MESSAGES_TABLE, type UserMessageRow } from '../_utils/userMessages'
import { readAudit, undoCopy } from '../_utils/classProgressCopy'
import { fetchClassAuthRow, isSchoolAdminOfClass } from '../_utils/classTeacherAuth'

/** The words the client shows when an undo is refused, keyed so the client can translate. */
export const UNDO_REFUSALS: Record<string, string> = {
  played_since: 'The class account has been played since the copy, so this cannot be undone cleanly.',
  already_undone: 'This copy has already been undone.',
  not_found: 'The copy this message refers to no longer exists.',
  not_a_copy: 'This message does not refer to a copy.',
}

async function mayUndo(svc: SupabaseClient, callerUserId: string, auditId: string): Promise<boolean> {
  const audit = await readAudit(svc, auditId)
  if (!audit) return true // let undoCopy answer not_found
  const { data: src } = await svc.from('learners').select('user_id').eq('id', audit.source_learner_id).maybeSingle()
  if ((src as { user_id?: string } | null)?.user_id === callerUserId) return true
  const classRow = await fetchClassAuthRow(svc, audit.class_id)
  return classRow ? isSchoolAdminOfClass(svc, callerUserId, classRow) : false
}

async function stampTaken(svc: SupabaseClient, row: UserMessageRow): Promise<void> {
  const { error } = await svc
    .from(USER_MESSAGES_TABLE)
    .update({ action_taken_at: new Date().toISOString(), read_at: row.read_at ?? new Date().toISOString() })
    .eq('id', row.id)
    .eq('recipient_user_id', row.recipient_user_id)
    .is('action_taken_at', null)
  if (error) throw new Error(error.message)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const caller = await resolveInboxCaller(req, res, { method: 'POST' })
  if (!caller) return
  const id = messageIdFromBody(req, res)
  if (!id) return
  try {
    const row = await ownUserMessage(caller.svc, caller.userId, id)
    if (!row) { res.status(404).json({ error: 'No such message' }); return }
    if (!row.action) { res.status(400).json({ error: 'This message has no action' }); return }
    if (row.action_taken_at) { res.status(409).json({ error: 'This action has already been taken', message: toView(row) }); return }

    if (row.action.kind === 'acknowledge') {
      await stampTaken(caller.svc, row)
      const after = await ownUserMessage(caller.svc, caller.userId, id)
      res.status(200).json({ message: toView(after ?? row), outcome: { kind: 'acknowledge' } })
      return
    }
    if (row.action.kind === 'open_support') {
      res.status(200).json({ message: toView(row), outcome: { kind: 'open_support' } })
      return
    }
    if (row.action.kind === 'undo_class_play_copy') {
      const auditId = String(row.action.payload?.audit_id ?? '')
      if (!auditId) { res.status(400).json({ error: 'This message names no copy to undo' }); return }
      if (!(await mayUndo(caller.svc, caller.userId, auditId))) {
        res.status(403).json({ error: 'Not authorised to undo this copy' })
        return
      }
      const outcome = await undoCopy(caller.svc, auditId, { actorUserId: caller.userId })
      if (!outcome.ok) {
        const status = outcome.reason === 'error' ? 500 : 409
        res.status(status).json({
          error: UNDO_REFUSALS[outcome.reason] ?? outcome.detail ?? 'Could not undo',
          reason: outcome.reason,
          message: toView(row),
        })
        return
      }
      await stampTaken(caller.svc, row)
      const after = await ownUserMessage(caller.svc, caller.userId, id)
      res.status(200).json({ message: toView(after ?? row), outcome: { kind: 'undo_class_play_copy', ...outcome } })
      return
    }
    res.status(400).json({ error: `Unknown action kind` })
  } catch (err) {
    console.error('[messages/act]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
