/**
 * Change teacher seats on the EXISTING school platform subscription —
 * POST /api/school/update-seats
 *
 * Seats are the `quantity` on the subscription's single per-seat item. The ONLY
 * correct way to change them is an in-place Paddle update (PATCH /subscriptions);
 * running a fresh Checkout instead makes Paddle auto-create a SECOND subscription
 * and DOUBLE-BILLS the school. (Confirmed against Paddle Billing docs; there is no
 * "create subscription" API and the customer portal cannot change quantity.)
 *
 * The school is derived from the SESSION (admin_user_id, else the school user_tag),
 * never from the request body — a body school_id would let any caller mutate
 * another school's billing.
 *
 * Proration (decided default): an INCREASE bills the prorated delta immediately
 * (prorated_immediately); a DECREASE defers to the next billing period
 * (prorated_next_billing_period) so a school never sees a confusing balance credit
 * it can't withdraw. A Paddle-managed trialing subscription uses do_not_bill.
 *
 * teacher_seats is written here from Paddle's AUTHORITATIVE update response (the
 * new item quantity), and the resulting subscription.updated webhook
 * (handleSchoolPlatformSubscription) re-applies the same absolute value — both
 * converge, so a missed/delayed webhook can't leave the count stale.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'
import { auditSchoolWriteRejection } from '../_utils/auditSchoolWriteRejection'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// Guard rail so a typo can't request an absurd quantity. The real ceiling is the
// Paddle price's quantity.maximum (default 100); above it Paddle 400s and we
// surface that. 1..1000 is a sane outer clamp before we even call Paddle.
const MAX_SEATS = 1000

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/update-seats] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const rawSeats = Number((req.body || {}).seats)
  if (!Number.isFinite(rawSeats)) {
    res.status(400).json({ error: 'seats must be a number' })
    return
  }
  const seats = Math.min(MAX_SEATS, Math.max(1, Math.floor(rawSeats)))

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // --- Resolve the caller's school from the session (never the body). ---
    // Admin-only: schools.admin_user_id, or a user_tags SCHOOL: tag whose
    // role_in_context is 'admin' — a bare tag match would also catch a
    // school's plain teachers and let them change paid seat counts (finding,
    // 2026-07-16 teacher-loop audit — same gap as update-profile.ts).
    let schoolId: string | null = null
    {
      const { data: ownSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      schoolId = ownSchool?.id ?? null
      if (!schoolId) {
        const { data: tag } = await supabase
          .from('user_tags')
          .select('tag_value')
          .eq('user_id', auth.userId)
          .eq('tag_type', 'school')
          .eq('role_in_context', 'admin')
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (tag?.tag_value) schoolId = String(tag.tag_value).replace('SCHOOL:', '')
      }
    }
    if (!schoolId) {
      const { data: nonAdminTag } = await supabase
        .from('user_tags')
        .select('tag_value, role_in_context')
        .eq('user_id', auth.userId)
        .eq('tag_type', 'school')
        .is('removed_at', null)
        .limit(1)
        .maybeSingle()
      if (nonAdminTag?.tag_value) {
        const rejectedSchoolId = String(nonAdminTag.tag_value).replace('SCHOOL:', '')
        await auditSchoolWriteRejection(supabase, {
          authUserId: auth.userId,
          schoolId: rejectedSchoolId,
          endpoint: 'school/update-seats',
          roleInContext: nonAdminTag.role_in_context ?? null,
        })
        res.status(403).json({ error: 'Only a school admin can change seats' })
        return
      }
      res.status(404).json({ error: 'No school for this account' })
      return
    }

    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .select('provider_subscription_id, platform_status, teacher_seats')
      .eq('id', schoolId)
      .maybeSingle()
    if (schoolErr || !school) {
      res.status(404).json({ error: 'School not found' })
      return
    }
    const subId = school.provider_subscription_id as string | null
    if (!subId) {
      // No live subscription yet → the caller wants the INITIAL checkout, not a
      // seat change. The client opens Paddle directly for this case.
      res.status(409).json({ error: 'No active subscription; start one first', requires_checkout: true })
      return
    }

    // --- Read the live subscription to get its per-seat price + current qty. ---
    const sub = await paddle.subscriptions.get(subId)
    const item = sub.items?.[0]
    const priceId = item?.price?.id
    if (!priceId) {
      console.error('[school/update-seats] Subscription has no price item:', subId)
      res.status(500).json({ error: 'Subscription is missing its seat price' })
      return
    }
    const currentQty = typeof item?.quantity === 'number' ? item.quantity : (school.teacher_seats as number) || 1
    if (seats === currentQty) {
      res.status(200).json({ seats, unchanged: true })
      return
    }

    // INCREASE → charge the delta now; DECREASE → apply at next renewal (no
    // un-withdrawable mid-cycle credit). A Paddle-managed trial can't be prorated.
    const prorationBillingMode =
      sub.status === 'trialing'
        ? 'do_not_bill'
        : seats > currentQty
          ? 'prorated_immediately'
          : 'prorated_next_billing_period'

    const updated = await paddle.subscriptions.update(subId, {
      items: [{ priceId, quantity: seats }],
      prorationBillingMode,
    })

    // Paddle's response is authoritative for the new quantity. Mirror it now so
    // the UI reflects the change immediately; the subscription.updated webhook
    // re-applies the same absolute value (idempotent convergence).
    const newQty = updated.items?.[0]?.quantity ?? seats
    await supabase.from('schools').update({ teacher_seats: newQty }).eq('id', schoolId)

    res.status(200).json({ seats: newQty, status: updated.status, prorationBillingMode })
  } catch (err: any) {
    // Surface the common Paddle states in language the admin can act on.
    const code = err?.code || err?.error?.code || ''
    const message: string = err?.message || err?.detail || 'Failed to update seats'
    if (/past_due/i.test(code) || /past_due/i.test(message)) {
      res.status(409).json({ error: 'Resolve the outstanding payment before changing seats' })
      return
    }
    if (/quantity_out_of_range/i.test(code) || /quantity/i.test(message)) {
      res.status(400).json({ error: 'That seat count is outside the allowed range for this plan' })
      return
    }
    console.error('[school/update-seats] Error:', err)
    res.status(500).json({ error: message })
  }
}
