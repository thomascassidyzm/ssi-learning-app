/**
 * Grant Entitlement API - POST /api/admin/grant-entitlement
 *
 * Directly grants an entitlement to a user (without a code).
 * Requires auth. Only ssi_admin users can call this.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { grantGiftEntitlement, validateGift } from '../_utils/entitlementGrant'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // ADMIN-ENT-12 (fixed 2026-08-25): use the shared verifyAdmin() rather than a
  // hand-rolled platform_role check under the service-role key. One definition of
  // "admin" for the whole surface — it also honours educational_role 'god' and
  // reads the caller's row under the caller's own token, and it distinguishes a
  // transient failure (500) from genuinely-not-an-admin (403).
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { learner_id, access_type, granted_courses, duration_type, duration_days } = req.body || {}

  if (!learner_id) {
    res.status(400).json({ error: 'learner_id is required' })
    return
  }

  // A GIFT, not a status (Tom's ruling, 2026-09-10). Granting an entitlement by
  // hand is how a real person is told the payment side expects nothing from
  // them; it changes nothing about whether they count as a learner, and the
  // shared writer below is the same one api/_utils/mintLearner.ts uses so the
  // two doors cannot produce different rows.
  const gift = {
    access_type,
    granted_courses,
    duration_type,
    duration_days,
  }
  const bad = validateGift(gift as any)
  if (bad) {
    res.status(400).json({ error: bad })
    return
  }
  if (!duration_type || !['lifetime', 'time_limited'].includes(duration_type)) {
    res.status(400).json({ error: 'Invalid duration_type' })
    return
  }

  try {
    const outcome = await grantGiftEntitlement(supabase, learner_id, gift as any, {
      actorUserId: admin.userId,
      source: 'grant-entitlement',
    })

    if (!outcome.ok) {
      res.status(500).json({ error: 'Failed to grant entitlement' })
      return
    }

    console.log('[GrantEntitlement] Granted:', access_type, 'to learner:', learner_id, 'by:', admin.userId)
    res.status(201).json({ entitlement: outcome.entitlement })
  } catch (err) {
    console.error('[GrantEntitlement] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
