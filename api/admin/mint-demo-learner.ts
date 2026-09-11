/**
 * Mint something that is NOT a person — POST /api/admin/mint-demo-learner
 *
 * The other door. This is the ONLY mint that sets an analytics exclusion flag,
 * and it exists as its own endpoint because Tom's ruling of 2026-09-10 turns on
 * the distinction it enforces: excluding a real person because they did not pay
 * makes the numbers less accurate, and the only thing that should ever be
 * excluded is a thing that is not a person.
 *
 *   kind: 'demo' — a fixture for a sales demo. `is_demo = true`.
 *   kind: 'test' — a test or staff account. `is_internal = true`, which is the
 *                  flag test_learner_ids() already reads.
 *
 * `kind` is required and has no default: choosing which sort of not-a-person
 * this is must be an act, not an omission.
 *
 * A demo learner takes no gift. Access for a demo comes from the demo org's own
 * machinery (api/admin/demo-schools.ts, api/groups/[id]/demo-mint.ts); an
 * entitlement row here would put a fixture in the gifted cohort, which is a
 * cohort of real people.
 *
 * ssi_admin only, via verifyAdmin().
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { mintNotAPerson } from '../_utils/mintLearner'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const body = (req.body || {}) as { kind?: string; display_name?: string; email?: string }

  if (body.kind !== 'demo' && body.kind !== 'test') {
    res.status(400).json({ error: "kind must be 'demo' or 'test'" })
    return
  }
  if (!(body.display_name || '').trim()) {
    res.status(400).json({ error: 'display_name is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const outcome = await mintNotAPerson(supabase, body.kind, {
    displayName: body.display_name as string,
    email: body.email ?? null,
    actorUserId: admin.userId,
  })

  if ('error' in outcome) {
    res.status(500).json({ error: outcome.error, detail: outcome.detail })
    return
  }

  console.log('[MintDemoLearner] minted', body.kind, outcome.userId, 'by', admin.userId)
  res.status(200).json({
    learner_id: outcome.learnerId,
    user_id: outcome.userId,
    kind: body.kind,
    counts_in_analytics: false,
  })
}
