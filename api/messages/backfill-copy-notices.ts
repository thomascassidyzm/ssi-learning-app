/**
 * POST /api/messages/backfill-copy-notices — send the class_play_copied notice
 * for every class_progress_copy_audit row that has none yet (job #684).
 * Idempotent; ssi_admin only. This is the seam the teacher-play sweep relies
 * on without knowing it: its audit rows get their notice whether it ran before
 * or after the inbox shipped.
 *
 *   curl -X POST https://staging.saysomethingin.app/api/messages/backfill-copy-notices \
 *        -H 'Authorization: Bearer <ssi_admin token>'
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { applyCors } from '../_utils/cors'
import { backfillCopyNotices } from '../_utils/copyPlayNotice'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const viewAs = rejectIfViewAs(req)
  if (viewAs) { res.status(viewAs.status).json({ error: viewAs.error }); return }
  const admin = await verifyAdmin(req)
  if ('error' in admin) { res.status(admin.status).json({ error: admin.error }); return }
  if (!supabaseUrl || !supabaseServiceKey) { res.status(500).json({ error: 'Server configuration error' }); return }
  try {
    const outcome = await backfillCopyNotices(createClient(supabaseUrl, supabaseServiceKey))
    res.status(200).json(outcome)
  } catch (err) {
    console.error('[messages/backfill-copy-notices]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
