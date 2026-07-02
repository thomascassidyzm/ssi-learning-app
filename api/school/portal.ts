/**
 * School Billing Portal - GET /api/school/portal
 *
 * Auth required (the school's admin). Creates a Paddle customer-portal
 * session for the school's platform subscription and returns the URL —
 * invoices, card updates and cancellation all happen in Paddle's portal,
 * so no local cancel endpoint is needed. Mirrors api/teacher/portal.ts.
 *
 * The school_platform webhook writes schools.provider_customer_id /
 * provider_subscription_id (api/teacher/paddle-webhook.ts,
 * handleSchoolPlatformSubscription) — a school that has never subscribed
 * has neither and 404s.
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
    // Billing is admin-only: resolve the school OWNED by this user, not one
    // they merely teach in.
    const { data: school } = await supabase
      .from('schools')
      .select('id, provider_customer_id, provider_subscription_id')
      .eq('admin_user_id', authResult.userId)
      .maybeSingle()

    if (!school) {
      res.status(404).json({ error: 'No school for this account' })
      return
    }
    if (!school.provider_customer_id) {
      res.status(404).json({ error: 'No subscription yet — subscribe first' })
      return
    }

    const subscriptionIds = school.provider_subscription_id
      ? [school.provider_subscription_id]
      : []

    const session = await paddle.customerPortalSessions.create(
      school.provider_customer_id,
      subscriptionIds
    )

    const portalUrl = session.urls?.general?.overview
    if (!portalUrl) {
      console.error('[school/portal] No portal URL in response:', session)
      res.status(500).json({ error: 'Portal URL not returned by Paddle' })
      return
    }

    res.status(200).json({ portalUrl })
  } catch (err: any) {
    console.error('[school/portal] Error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
}
