/**
 * GET /api/admin/messages/audience?kind=one|course|all[&course_code=][&user_id=]
 * The preview: how many inboxes a send would reach, and a few names so the
 * admin can see it is the right crowd. Reads nothing into anyone's inbox.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { resolveAdminCaller } from './_shared'
import { parseAudience, resolveAudience } from '../../_utils/adminMessages'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  const caller = await resolveAdminCaller(req, res, { method: 'GET' })
  if (!caller) return
  const parsed = parseAudience((req.query ?? {}) as Record<string, unknown>)
  if ('error' in parsed) { res.status(400).json({ error: parsed.error }); return }
  try {
    const audience = await resolveAudience(caller.svc, parsed.spec)
    res.status(200).json({
      kind: audience.kind,
      count: audience.members.length,
      sample: audience.members.slice(0, 5).map((m) => m.displayName || 'A learner with no name yet'),
    })
  } catch (err) {
    console.error('[admin/messages/audience]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
