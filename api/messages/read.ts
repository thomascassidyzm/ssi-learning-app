/**
 * POST /api/messages/read {id} — the person TAPPED the message. This, and
 * only this (plus opening the Support thread a support reply points at), is
 * what marks a message read. Own-row: a foreign id is 404, not 403.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveInboxCaller, messageIdFromBody } from './_shared'
import { ownUserMessage, markUserMessageRead, toView } from '../_utils/userMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const caller = await resolveInboxCaller(req, res, { method: 'POST' })
  if (!caller) return
  const id = messageIdFromBody(req, res)
  if (!id) return
  try {
    const row = await ownUserMessage(caller.svc, caller.userId, id)
    if (!row) { res.status(404).json({ error: 'No such message' }); return }
    if (!row.read_at) await markUserMessageRead(caller.svc, caller.userId, id)
    const after = await ownUserMessage(caller.svc, caller.userId, id)
    res.status(200).json({ message: toView(after ?? row) })
  } catch (err) {
    console.error('[messages/read]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
