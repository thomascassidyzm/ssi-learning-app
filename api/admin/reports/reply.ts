/**
 * POST /api/admin/reports/reply — answer one report, in the app (job #28).
 *
 * The reply goes out as an admin message to that one learner, so she meets it
 * on the Library notice card and in /me/inbox. Idempotent on a broadcast id
 * derived from the report, so a double tap sends nothing twice. ssi_admin only.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { resolveAdminCaller } from '../messages/_shared'
import { replyToLearnerReport, loadLearnerReport, isReportSource, LearnerReportError } from '../../_utils/learnerReports'
import { BODY_MAX } from '../../_utils/adminMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Named here too: the preflight-coverage scanner reads the handler file for the cors import.
  if (applyCors(req, res, { methods: 'POST' })) return
  const caller = await resolveAdminCaller(req, res, { method: 'POST' })
  if (!caller) return

  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const source = b.source
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  const text = typeof b.text === 'string' ? b.text.trim() : ''
  if (!isReportSource(source)) { res.status(400).json({ error: 'source must be bug_report or tester_feedback' }); return }
  if (!id) { res.status(400).json({ error: 'id is required' }); return }
  if (!text) { res.status(400).json({ error: 'a reply needs words' }); return }
  if (text.length > BODY_MAX) { res.status(400).json({ error: `reply too long, max ${BODY_MAX} characters` }); return }

  try {
    const outcome = await replyToLearnerReport(caller.svc, {
      source,
      reportId: id,
      replyText: text,
      senderUserId: caller.userId,
      resend: b.resend === true,
    })
    const report = await loadLearnerReport(caller.svc, source, id)
    res.status(200).json({ ...outcome, report })
  } catch (err) {
    if (err instanceof LearnerReportError) { res.status(400).json({ error: err.message }); return }
    console.error('[admin/reports/reply]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
