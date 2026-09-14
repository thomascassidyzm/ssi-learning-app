/**
 * POST /api/messages/dismiss {id} — the learner Library card's Dismiss only.
 * A dismissed message stays in the inbox and stays UNREAD until tapped; the
 * card simply never shows it again. Dismissing is not reading.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveInboxCaller, messageIdFromBody } from './_shared'
import { ownUserMessage, toView, USER_MESSAGES_TABLE } from '../_utils/userMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const caller = await resolveInboxCaller(req, res, { method: 'POST' })
  if (!caller) return
  const id = messageIdFromBody(req, res)
  if (!id) return
  try {
    const row = await ownUserMessage(caller.svc, caller.userId, id)
    if (!row) { res.status(404).json({ error: 'No such message' }); return }
    if (!row.dismissed_at) {
      const { error } = await caller.svc
        .from(USER_MESSAGES_TABLE)
        .update({ dismissed_at: new Date().toISOString() })
        .eq('id', id)
        .eq('recipient_user_id', caller.userId)
      if (error) throw new Error(error.message)
    }
    const after = await ownUserMessage(caller.svc, caller.userId, id)
    res.status(200).json({ message: toView(after ?? row) })
  } catch (err) {
    console.error('[messages/dismiss]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
