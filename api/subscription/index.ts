/**
 * Subscription Status API - Get current user's subscription
 *
 * GET /api/subscription
 *
 * Returns the user's current subscription status.
 * Requires Supabase Auth.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getAuthUserId } from '../_utils/auth'
import { resolveEffectiveSubscription } from '../_utils/familyAccess'

// Supabase client with service role (to bypass RLS for reading)
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface SubscriptionRow {
  id: string
  learner_id: string
  status: string
  plan_id: string | null
  plan_name: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  provider: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Verify authentication
  const userId = await getAuthUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', subscription: null, isSubscribed: false })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[subscription] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get learner ID for this Supabase Auth user
    const { data: learner, error: learnerError } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (learnerError || !learner) {
      // User exists in Supabase Auth but not yet in our database
      res.status(200).json({
        subscription: null,
        isSubscribed: false,
      })
      return
    }

    // Get subscription — own row, or (member of an active family) the owner's.
    const { sub: subscription, viaFamily } = await resolveEffectiveSubscription(supabase, learner.id)

    if (!subscription) {
      res.status(200).json({
        subscription: null,
        isSubscribed: false,
      })
      return
    }

    const sub = subscription as SubscriptionRow

    // Check if actively subscribed
    const isSubscribed = sub.status === 'active' &&
      (!sub.current_period_end || new Date(sub.current_period_end) > new Date())

    res.status(200).json({
      subscription: {
        id: sub.id,
        learnerId: sub.learner_id,
        status: sub.status,
        planId: sub.plan_id,
        // A member reads the owner's plan_name literally ('SSi Family') from
        // the row above — override to a distinct virtual name so the client
        // can render "covered by your family plan" rather than implying this
        // learner owns the Family subscription themselves (spec §3, §4.3).
        planName: viaFamily ? 'SSi Family (member)' : sub.plan_name,
        currentPeriodEnd: sub.current_period_end,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        provider: sub.provider,
      },
      isSubscribed,
    })
  } catch (err) {
    console.error('[subscription] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
