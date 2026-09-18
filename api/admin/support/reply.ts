/**
 * POST /api/admin/support/reply — answer one school's thread as SSi (job #220).
 *
 * The row it writes is the ordinary 'out' row the watson-1 watcher writes, so
 * the inbox fan-out trigger, the school's unread dot and the email doorbell all
 * keep working without knowing this page exists.
 *
 * THE ONE GUARD (Tom, 2026-09-14): an ssi_admin touring under View As must
 * never create rows in the viewed person's name. Two things hold it here — the
 * author fields come from verifyAdmin's own verified uid and can be nobody
 * else's, and a write carrying the View-As header is refused outright.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { refuseViewAsWrite } from '../../_utils/actAsGuard'
import { resolveAdminCaller } from '../messages/_shared'
import { replyAsPlatform, loadPlatformThread, PlatformSupportError, PLATFORM_REPLY_MAX } from '../../_utils/platformSupport'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Named here too: the preflight-coverage scanner reads the handler file for the cors import.
  if (applyCors(req, res, { methods: 'POST' })) return
  if (refuseViewAsWrite(req, res)) return
  const caller = await resolveAdminCaller(req, res, { method: 'POST' })
  if (!caller) return

  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const threadId = typeof b.threadId === 'string' ? b.threadId.trim() : ''
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  if (!threadId) { res.status(400).json({ error: 'threadId is required' }); return }
  if (!text) { res.status(400).json({ error: 'a reply needs words' }); return }
  if (text.length > PLATFORM_REPLY_MAX) { res.status(400).json({ error: `reply too long, max ${PLATFORM_REPLY_MAX} characters` }); return }

  try {
    const message = await replyAsPlatform(caller.svc, { threadId, text, senderUserId: caller.userId })
    const thread = await loadPlatformThread(caller.svc, threadId)
    res.status(200).json({ message, thread })
  } catch (err) {
    if (err instanceof PlatformSupportError) { res.status(404).json({ error: err.message }); return }
    console.error('[admin/support/reply]', err)
    res.status(500).json({ error: 'Reply could not be sent' })
  }
}
