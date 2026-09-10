/**
 * Mint a learner — POST /api/admin/mint-learner
 *
 * Verb 1 of the intelligence surface's verbs half. Mints a REAL PERSON, who is
 * included in every number from the moment they exist.
 *
 * Tom's ruling, 2026-09-10, reversing this design's first draft:
 *
 *   > "why cant they be included? if theyre in the data as proper learners,
 *   > they can just be minted as GIFTED, so the payment side of things doesnt
 *   > expect them."
 *
 * So there is no exclusion anywhere on this path and no way to ask for one. A
 * gift is offered instead: `gift` writes a `user_entitlements` row through the
 * ordinary grant machinery, which is what stops billing expecting money. The
 * learner is real either way.
 *
 * Minting something that is NOT a person is a different endpoint —
 * api/admin/mint-demo-learner.ts. Deliberately a different door rather than a
 * checkbox here: "is this a real person?" must be answered by choosing an
 * action, never by whatever the last person left ticked.
 *
 * ssi_admin only, via verifyAdmin(), as every verb on the surface is.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { mintPerson } from '../_utils/mintLearner'
import { validateGift, type GiftSpec } from '../_utils/entitlementGrant'

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

  const body = (req.body || {}) as {
    display_name?: string
    email?: string
    gift?: GiftSpec | null
    is_demo?: unknown
    is_internal?: unknown
  }

  // The exclusion flags are not arguments here. Refusing them loudly, rather
  // than ignoring them, is what stops a caller believing it minted a fixture.
  if (body.is_demo !== undefined || body.is_internal !== undefined) {
    res.status(400).json({
      error: 'This endpoint mints real people and never sets exclusion flags. Use /api/admin/mint-demo-learner for a demo or test account.',
    })
    return
  }

  if (!(body.display_name || '').trim()) {
    res.status(400).json({ error: 'display_name is required' })
    return
  }

  if (body.gift) {
    const bad = validateGift(body.gift)
    if (bad) {
      res.status(400).json({ error: bad })
      return
    }
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const outcome = await mintPerson(supabase, {
    displayName: body.display_name as string,
    email: body.email ?? null,
    gift: body.gift ?? null,
    actorUserId: admin.userId,
  })

  if ('error' in outcome) {
    res.status(500).json({ error: outcome.error, detail: outcome.detail })
    return
  }

  console.log('[MintLearner] minted real learner', outcome.userId, 'gifted:', outcome.gifted, 'by', admin.userId)
  res.status(200).json({
    learner_id: outcome.learnerId,
    user_id: outcome.userId,
    gifted: outcome.gifted,
    counts_in_analytics: true,
  })
}
