/**
 * Subscription Checkout API - Create checkout URL
 *
 * POST /api/subscription/checkout
 * Body: { planId: 'monthly' | 'annual' }
 *
 * Creates a LemonSqueezy checkout session and returns the URL.
 * Requires Clerk authentication.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { getAuthUserId } from '../_utils/auth'

// Environment variables
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const lemonSqueezyApiKey = (process.env.LEMONSQUEEZY_API_KEY || '').trim()
const lemonSqueezyStoreId = (process.env.LEMONSQUEEZY_STORE_ID || '').trim()

// Plan variant IDs (from LemonSqueezy)
const PLAN_VARIANTS: Record<string, string> = {
  monthly: (process.env.LEMONSQUEEZY_MONTHLY_VARIANT_ID || '').trim(),
  annual: (process.env.LEMONSQUEEZY_ANNUAL_VARIANT_ID || '').trim(),
}

interface CheckoutRequestBody {
  planId: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  // Verify authentication
  const userId = await getAuthUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // Parse request body
  const body = req.body as CheckoutRequestBody
  if (!body?.planId) {
    res.status(400).json({ error: 'Missing planId' })
    return
  }

  const variantId = PLAN_VARIANTS[body.planId]
  if (!variantId) {
    res.status(400).json({ error: 'Invalid planId' })
    return
  }

  // Check configuration
  if (!lemonSqueezyApiKey || !lemonSqueezyStoreId) {
    console.error('[checkout] Missing LemonSqueezy configuration')
    res.status(500).json({ error: 'Payment system not configured' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[checkout] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get or create learner
    let { data: learner, error: learnerError } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (learnerError && learnerError.code === 'PGRST116') {
      // Create learner if doesn't exist
      const { data: newLearner, error: createError } = await supabase
        .from('learners')
        .insert({ user_id: userId, display_name: '' })
        .select('id')
        .single()

      if (createError) {
        console.error('[checkout] Failed to create learner:', createError)
        res.status(500).json({ error: 'Failed to create user record' })
        return
      }
      learner = newLearner
    } else if (learnerError) {
      console.error('[checkout] Failed to fetch learner:', learnerError)
      res.status(500).json({ error: 'Failed to fetch user' })
      return
    }

    // Build success/cancel URLs
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://app.saysomethingin.com'
    const successUrl = `${baseUrl}?subscription=success`
    const cancelUrl = `${baseUrl}?subscription=cancelled`

    // Create LemonSqueezy checkout
    const checkoutResponse = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lemonSqueezyApiKey}`,
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              custom: {
                learner_id: learner!.id,
                user_id: userId,
              },
            },
            product_options: {
              redirect_url: successUrl,
            },
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: lemonSqueezyStoreId,
              },
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId,
              },
            },
          },
        },
      }),
    })

    if (!checkoutResponse.ok) {
      const errorText = await checkoutResponse.text()
      console.error('[checkout] LemonSqueezy error:', checkoutResponse.status, errorText)
      res.status(502).json({ error: 'Failed to create checkout' })
      return
    }

    const checkoutData = await checkoutResponse.json()
    const checkoutUrl = checkoutData.data?.attributes?.url

    if (!checkoutUrl) {
      console.error('[checkout] No checkout URL in response:', checkoutData)
      res.status(502).json({ error: 'Invalid checkout response' })
      return
    }

    res.status(200).json({ checkoutUrl })
  } catch (err) {
    console.error('[checkout] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
