/**
 * Effective Access API - GET /api/admin/effective-access?learner_id=<uuid>
 *
 * What can this account ACTUALLY play — the player's own answer, for an admin
 * looking at somebody else's user page.
 *
 * Why it exists (founder report 2026-09-09, Chepstow): the admin user LIST
 * tagged a teacher "School" from her `educational_role`, while her DETAIL page
 * read the raw `user_entitlements` table from the browser and said DEFAULT,
 * "No active entitlements". Both were reporting something true and neither was
 * reporting her access, because three of its four layers are DERIVED — the
 * cascade RPC, class coverage, org coverage — and have no row to read. This
 * endpoint runs the SAME resolver the player runs (api/_utils/resolveEntitlements.ts)
 * so the screen and the ears cannot disagree.
 *
 * Requires auth. Only ssi_admin (or legacy god) users can call this.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveActiveEntitlements, isDerivedEntitlementId } from '../_utils/resolveEntitlements'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const learnerId = typeof req.query.learner_id === 'string' ? req.query.learner_id : ''
  if (!learnerId) {
    res.status(400).json({ error: 'learner_id is required' })
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // The resolver keys its derived layers on the AUTH uid and its stored rows
    // on the learner PK — the two identities this DB keeps distinct.
    const { data: learner, error: learnerError } = await supabase
      .from('learners')
      .select('id, user_id')
      .eq('id', learnerId)
      .maybeSingle()
    if (learnerError) {
      res.status(500).json({ error: 'Failed to read learner', detail: learnerError.message })
      return
    }
    if (!learner) {
      res.status(404).json({ error: 'No such learner' })
      return
    }

    const entitlements = await resolveActiveEntitlements(supabase, learner.user_id, learner.id)

    res.status(200).json({
      entitlements,
      // The derived ones carry no row, so the UI must not offer Revoke on them.
      derived: entitlements.filter((e) => isDerivedEntitlementId(e.id)).map((e) => e.id),
    })
  } catch (error: any) {
    console.error('[AdminEffectiveAccess] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
