/**
 * Current-user Subscription API - GET /api/me/subscription
 *
 * Auth required. Returns the authenticated learner's subscription row, or
 * { subscription: null } if they have none. Used by /premium and /teach/setup
 * to decide whether to open Paddle checkout.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(200).json({ subscription: null })
      return
    }

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('id, status, plan_id, plan_name, current_period_end, cancel_at_period_end, provider, provider_subscription_id')
      .eq('learner_id', learner.id)
      .maybeSingle()

    res.status(200).json({ subscription: subscription || null })
  } catch (error: any) {
    console.error('[me/subscription] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
