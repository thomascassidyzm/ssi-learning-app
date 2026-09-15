/**
 * GET /api/messages — the caller's own inbox, newest first, with the unread
 * count. NEVER marks anything read: "delivered is not seen" (job #684). The
 * schools avatar menu's badge and the learner Library card both read this.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { resolveInboxCaller } from './_shared'
import { listUserMessages, toView, unreadCount } from '../_utils/userMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Named here, not only inside resolveInboxCaller: the preflight-coverage scanner
  // (src/platform/scanClientApiCalls.ts) reads the handler file for the cors import.
  if (applyCors(req, res, { methods: 'GET' })) return
  const caller = await resolveInboxCaller(req, res, { method: 'GET' })
  if (!caller) return
  try {
    const rows = await listUserMessages(caller.svc, caller.userId)
    res.status(200).json({ messages: rows.map(toView), unread: unreadCount(rows) })
  } catch (err) {
    console.error('[messages]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
