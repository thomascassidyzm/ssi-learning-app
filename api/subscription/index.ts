/**
 * Subscription Status API - Get current user's subscription
 *
 * GET /api/subscription
 *
 * Returns the user's current subscription status.
 * Requires Clerk authentication.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getAuthUserId } from '../_utils/auth'

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

    // Get learner ID for this Clerk user
    const { data: learner, error: learnerError } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (learnerError || !learner) {
      // User exists in Clerk but not yet in our database
      res.status(200).json({
        subscription: null,
        isSubscribed: false,
      })
      return
    }

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('learner_id', learner.id)
      .single()

    if (subError && subError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is fine
      console.error('[subscription] Query error:', subError)
      res.status(500).json({ error: 'Failed to fetch subscription' })
      return
    }

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
        planName: sub.plan_name,
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
