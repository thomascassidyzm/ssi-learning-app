/**
 * GET /api/messages/thread?id=<message id> — the conversation under one of the
 * caller's admin messages: their replies and ours, oldest first. Opening it
 * marks the thread read (last_read_at). Own row only; a message that is not
 * an admin message has no thread and answers an empty list.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { resolveInboxCaller } from './_shared'
import { ownUserMessage } from '../_utils/userMessages'
import { findLearnerThread, listTurns } from '../_utils/learnerThread'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  const caller = await resolveInboxCaller(req, res, { method: 'GET' })
  if (!caller) return
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : ''
  if (!id) { res.status(400).json({ error: 'id is required' }); return }
  try {
    const row = await ownUserMessage(caller.svc, caller.userId, id)
    if (!row) { res.status(404).json({ error: 'No such message' }); return }
    const thread = row.source === 'admin_message' ? await findLearnerThread(caller.svc, caller.userId, row.id) : null
    if (!thread) { res.status(200).json({ turns: [] }); return }
    const turns = await listTurns(caller.svc, thread.id)
    await caller.svc.from('support_threads').update({ last_read_at: new Date().toISOString() }).eq('id', thread.id)
    res.status(200).json({ turns })
  } catch (err) {
    console.error('[messages/thread]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
