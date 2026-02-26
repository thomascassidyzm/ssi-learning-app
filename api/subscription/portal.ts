/**
 * Subscription Portal API - Get customer portal URL
 *
 * GET /api/subscription/portal
 *
 * Returns URL for LemonSqueezy customer portal to manage subscription.
 * Requires Clerk authentication.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getAuthUserId } from '../_utils/auth'

// Environment variables
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const lemonSqueezyApiKey = (process.env.LEMONSQUEEZY_API_KEY || '').trim()

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
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // Check configuration
  if (!lemonSqueezyApiKey) {
    console.error('[portal] Missing LemonSqueezy configuration')
    res.status(500).json({ error: 'Payment system not configured' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[portal] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get learner
    const { data: learner, error: learnerError } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (learnerError || !learner) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Get subscription with customer ID
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('provider_customer_id, provider_subscription_id')
      .eq('learner_id', learner.id)
      .single()

    if (subError || !subscription) {
      res.status(404).json({ error: 'No subscription found' })
      return
    }

    const customerId = subscription.provider_customer_id
    if (!customerId) {
      res.status(404).json({ error: 'No customer ID found' })
      return
    }

    // Get customer portal URL from LemonSqueezy
    // LemonSqueezy customers have a portal URL in their record
    const customerResponse = await fetch(
      `https://api.lemonsqueezy.com/v1/customers/${customerId}`,
      {
        headers: {
          'Authorization': `Bearer ${lemonSqueezyApiKey}`,
          'Accept': 'application/vnd.api+json',
        },
      }
    )

    if (!customerResponse.ok) {
      const errorText = await customerResponse.text()
      console.error('[portal] LemonSqueezy error:', customerResponse.status, errorText)
      res.status(502).json({ error: 'Failed to fetch customer' })
      return
    }

    const customerData = await customerResponse.json()
    const portalUrl = customerData.data?.attributes?.urls?.customer_portal

    if (!portalUrl) {
      // Fallback: construct portal URL from subscription
      // LemonSqueezy subscription objects have their own manage URLs
      const subscriptionId = subscription.provider_subscription_id
      if (subscriptionId) {
        const subResponse = await fetch(
          `https://api.lemonsqueezy.com/v1/subscriptions/${subscriptionId}`,
          {
            headers: {
              'Authorization': `Bearer ${lemonSqueezyApiKey}`,
              'Accept': 'application/vnd.api+json',
            },
          }
        )

        if (subResponse.ok) {
          const subData = await subResponse.json()
          const manageUrl = subData.data?.attributes?.urls?.update_payment_method
            || subData.data?.attributes?.urls?.customer_portal

          if (manageUrl) {
            res.status(200).json({ portalUrl: manageUrl })
            return
          }
        }
      }

      console.error('[portal] No portal URL found in customer data:', customerData)
      res.status(404).json({ error: 'Portal URL not available' })
      return
    }

    res.status(200).json({ portalUrl })
  } catch (err) {
    console.error('[portal] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
