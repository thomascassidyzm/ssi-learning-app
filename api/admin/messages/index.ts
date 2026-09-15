/**
 * GET /api/admin/messages — what the composer needs to open: every course
 * with a sendable audience and its size, and the last broadcasts. ssi_admin only.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { resolveAdminCaller } from './_shared'
import { courseAudiences, recentAdminMessages, resolveAudience } from '../../_utils/adminMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Named here too: the preflight-coverage scanner reads the handler file for the cors import.
  if (applyCors(req, res, { methods: 'GET' })) return
  const caller = await resolveAdminCaller(req, res, { method: 'GET' })
  if (!caller) return
  try {
    const [courses, sent, all] = await Promise.all([
      courseAudiences(caller.svc),
      recentAdminMessages(caller.svc),
      resolveAudience(caller.svc, { kind: 'all' }),
    ])
    res.status(200).json({ courses, sent, all: all.members.length })
  } catch (err) {
    console.error('[admin/messages]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
