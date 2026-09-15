/**
 * POST /api/admin/messages/send {id, kind, course_code?, user_id?, title, body}
 * Writes one user_messages row per recipient, keyed on the broadcast id, so a
 * retry never double-sends. The answer says how many landed on this call.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { resolveAdminCaller } from './_shared'
import { parseSendBody, sendAdminMessage } from '../../_utils/adminMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  const caller = await resolveAdminCaller(req, res, { method: 'POST' })
  if (!caller) return
  const parsed = parseSendBody(req.body)
  if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return }
  try {
    const result = await sendAdminMessage(caller.svc, { ...parsed.input, senderUserId: caller.userId })
    res.status(200).json(result)
  } catch (err) {
    console.error('[admin/messages/send]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
