/**
 * User Entitlements API - GET /api/entitlement/user
 *
 * Requires auth. Returns the current user's active (non-expired) entitlements.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveActiveEntitlements } from '../_utils/resolveEntitlements'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Cross-origin (native shell) policy + preflight. No-op same-origin.
  if (applyCors(req, res, { methods: 'GET' })) return

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Get learner_id
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (!learner) {
      res.status(200).json({ entitlements: [] })
      return
    }

    // Every layer — stored rows, cascade, class coverage, org coverage — is
    // resolved by api/_utils/resolveEntitlements.ts, the same function the
    // admin effective-access view calls, so the two can never disagree about
    // one account again (founder report 2026-09-09).
    const active = await resolveActiveEntitlements(supabase, userId, learner.id)

    res.status(200).json({ entitlements: active })
  } catch (error) {
    console.error('[EntitlementUser] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
