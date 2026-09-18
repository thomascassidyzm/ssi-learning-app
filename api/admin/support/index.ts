/**
 * GET /api/admin/support — every school's and every org's support thread, in
 * the platform inbox (job #220). Unanswered first, newest first.
 *
 * Tom, 2026-09-18: platform admins should be able to see in-app support
 * messages somewhere in the app. ssi_admin only, through the same
 * resolveAdminCaller gate the learner-report inbox beside it uses.
 *
 * ?id=<thread> answers ONE thread with every turn and the envelope behind her
 * latest question. Reading here never marks a thread read: last_read_at is the
 * SCHOOL's own reading of it, and the doorbell keys on it.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { resolveAdminCaller } from '../messages/_shared'
import { listPlatformThreads, loadPlatformThread } from '../../_utils/platformSupport'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Named here too: the preflight-coverage scanner reads the handler file for the cors import.
  if (applyCors(req, res, { methods: 'GET' })) return
  const caller = await resolveAdminCaller(req, res, { method: 'GET' })
  if (!caller) return
  try {
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : ''
    if (id) {
      const thread = await loadPlatformThread(caller.svc, id)
      if (!thread) {
        res.status(404).json({ error: 'No such school or organisation thread' })
        return
      }
      res.status(200).json({ thread })
      return
    }
    const threads = await listPlatformThreads(caller.svc)
    res.status(200).json({ threads, unanswered: threads.filter((t) => t.unanswered > 0).length })
  } catch (err) {
    console.error('[admin/support]', err)
    res.status(500).json({ error: 'Support threads could not be read' })
  }
}
