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
import { applyCors } from '../_utils/cors'
import { resolveEffectiveSubscription } from '../_utils/familyAccess'
import { familyCoverEndsAt } from '../_utils/familyGrace'
import { resolveOrgFreeAccess } from '../_utils/orgFreeAccess'

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
  scheduled_plan_name?: string | null
  scheduled_plan_at?: string | null
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`. This
  // route is authenticated (verifyAuthToken, below), so it gets the closed
  // allowlist rather than a wildcard.
  if (applyCors(req, res, { methods: 'GET' })) return


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
        freeAccess: null,
      })
      return
    }

    // FREE THROUGH A FUNDED ORG ENROLMENT. Reported alongside the subscription
    // because every upgrade prompt in the app already asks this endpoint "is
    // this person a payer?" — and a Canolfan learner whose year is funded must
    // answer that question the same way a payer does, from the grant rather
    // than from a payment (api/_utils/orgFreeAccess.ts).
    const freeAccess = await resolveOrgFreeAccess(supabase, learner.id)

    // A CHILD ACCOUNT IS NEVER OFFERED A CHECKOUT (job #376·F, D7). A child
    // signs in on a synthetic address a parent never sees; binding a Paddle
    // customer to that address is a trap. The client uses this to say "ask
    // your grown-up about the family plan" instead of opening a price.
    const { data: childRow } = await supabase
      .from('family_members')
      .select('id')
      .eq('member_learner_id', learner.id)
      .eq('is_child_account', true)
      .limit(1)
      .maybeSingle()
    const isChildAccount = !!childRow

    // Get subscription — own row, or (member of an active family) the owner's.
    const { sub: subscription, viaFamily, coverEndsAt } = await resolveEffectiveSubscription(supabase, learner.id)

    if (!subscription) {
      res.status(200).json({
        subscription: null,
        isSubscribed: false,
        isChildAccount,
        freeAccess,
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
        // A change the owner has scheduled for the end of the paid period
        // (job #376·F, D2): what the plan becomes, and when. Null = none.
        scheduledPlanName: sub.scheduled_plan_name ?? null,
        scheduledPlanAt: sub.scheduled_plan_at ?? null,
        // FOR A MEMBER (D6): when their family cover actually ends — the paid
        // period PLUS the 30-day grace when the owner has changed to Premium,
        // or the paid period itself when the owner has cancelled outright.
        // Computed by the resolver, from familyGrace.ts, so this date and the
        // date the resolver grants access to are the same date and cannot
        // drift. The banner reads "Your family Premium ends 6 November. Keep
        // going for £15 a month". Null while nothing ends.
        familyEndsAt: viaFamily ? coverEndsAt : null,
        // FOR THE OWNER: when the people on their plan would stop being
        // covered — the same 30-day arithmetic, shown before they confirm as
        // well as after, so the dialog never has to do its own. Null unless
        // they hold the Family plan themselves.
        familyCoverEndsAt:
          !viaFamily && sub.plan_name === 'SSi Family'
            ? familyCoverEndsAt(sub.scheduled_plan_at ?? sub.current_period_end)
            : null,
      },
      isSubscribed,
      isChildAccount,
      freeAccess,
    })
  } catch (err) {
    console.error('[subscription] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
