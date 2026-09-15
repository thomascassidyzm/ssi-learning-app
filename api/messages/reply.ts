/**
 * POST /api/messages/reply {id, text} — the learner answers an admin message.
 * This is what makes the channel live (Tom, 2026-09-15): the reply opens the
 * learner's own support thread (one per learner-message pair) and lands as an
 * 'in' turn the watson-1 watcher cards to Tom. Own row, admin messages only,
 * refused under View As by the preamble.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { resolveInboxCaller, messageIdFromBody } from './_shared'
import { ownUserMessage, markUserMessageRead } from '../_utils/userMessages'
import { postLearnerReply, REPLY_MAX, type ReplyClientEnvelope } from '../_utils/learnerThread'

function pickClient(body: Record<string, unknown>): ReplyClientEnvelope {
  const out: ReplyClientEnvelope = {}
  if (typeof body.route === 'string') out.route = body.route.slice(0, 300)
  if (typeof body.build_version === 'string') out.build_version = body.build_version.slice(0, 80)
  const d = body.device_info
  if (d && typeof d === 'object') {
    const di = d as Record<string, unknown>
    out.device_info = {
      userAgent: typeof di.userAgent === 'string' ? di.userAgent.slice(0, 400) : undefined,
      screen: typeof di.screen === 'string' ? di.screen.slice(0, 40) : undefined,
      language: typeof di.language === 'string' ? di.language.slice(0, 16) : undefined,
    }
  }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  const caller = await resolveInboxCaller(req, res, { method: 'POST' })
  if (!caller) return
  const id = messageIdFromBody(req, res)
  if (!id) return
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) { res.status(400).json({ error: 'text is required' }); return }
  if (text.length > REPLY_MAX) { res.status(400).json({ error: `text too long (max ${REPLY_MAX} characters)` }); return }
  try {
    const row = await ownUserMessage(caller.svc, caller.userId, id)
    if (!row) { res.status(404).json({ error: 'No such message' }); return }
    if (row.source !== 'admin_message') { res.status(400).json({ error: 'Only messages from SSi can be replied to' }); return }
    const { thread, turn } = await postLearnerReply(caller.svc, row, text, pickClient(body))
    if (!row.read_at) await markUserMessageRead(caller.svc, caller.userId, id)
    res.status(200).json({ thread_id: thread.id, turn })
  } catch (err) {
    console.error('[messages/reply]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
