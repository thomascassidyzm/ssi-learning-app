/**
 * GET /api/admin/reports — the Support inbox (job #28). Every in-app report a
 * learner has sent us, from both postboxes, unanswered first, each with the
 * reply that went out and whether she has opened it. ssi_admin only.
 *
 * Tom, 2026-09-16 22:50Z: Tom, Kai and any ssi_admin must be able to see every
 * in-app report and reply from there, even though agents may handle most of them.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { resolveAdminCaller } from '../messages/_shared'
import { listLearnerReports } from '../../_utils/learnerReports'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Named here too: the preflight-coverage scanner reads the handler file for the cors import.
  if (applyCors(req, res, { methods: 'GET' })) return
  const caller = await resolveAdminCaller(req, res, { method: 'GET' })
  if (!caller) return
  try {
    const reports = await listLearnerReports(caller.svc)
    res.status(200).json({ reports, unanswered: reports.filter((r) => !r.repliedAt).length })
  } catch (err) {
    console.error('[admin/reports]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
