/**
 * Teacher Billing Portal - GET /api/teacher/portal
 *
 * Auth required. Creates a Paddle customer-portal session for the authenticated
 * teacher and returns the URL. Used by the dashboard "Manage subscription"
 * button for cancel / update payment method / view invoices.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'

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
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    const { data: teacher } = await supabase
      .from('teachers')
      .select('id, own_subscription_id')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!teacher || !teacher.own_subscription_id) {
      res.status(404).json({ error: 'No active subscription' })
      return
    }

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('provider_customer_id, provider_subscription_id')
      .eq('id', teacher.own_subscription_id)
      .maybeSingle()

    if (!sub?.provider_customer_id) {
      res.status(404).json({ error: 'Subscription not linked to a Paddle customer' })
      return
    }

    const subscriptionIds = sub.provider_subscription_id ? [sub.provider_subscription_id] : []

    const session = await paddle.customerPortalSessions.create(
      sub.provider_customer_id,
      subscriptionIds
    )

    const portalUrl = session.urls?.general?.overview

    if (!portalUrl) {
      console.error('[teacher/portal] No portal URL in response:', session)
      res.status(500).json({ error: 'Portal URL not returned by Paddle' })
      return
    }

    res.status(200).json({ portalUrl })
  } catch (err: any) {
    console.error('[teacher/portal] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
