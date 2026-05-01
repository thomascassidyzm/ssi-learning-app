/**
 * Paddle Webhook Handler - POST /api/teacher/paddle-webhook
 *
 * Public (no auth — verified by signature). Handles:
 *
 *   subscription.* with customData.kind in {'premium', 'teacher_plan'}
 *     → upsert subscriptions row. If customData.teacher_id is present,
 *       also link teachers.own_subscription_id. ('teacher_plan' is the
 *       legacy kind for subs created before the premium/teach split;
 *       handled identically.)
 *
 *   subscription.* with customData.kind = 'student_via_teacher'
 *     → upsert subscriptions row, upsert teacher_referrals (class-scoped),
 *       insert user_tags row linking student to class
 *
 *   transaction.paid (any subscription kind)
 *     → if associated subscription is student-via-teacher, accrue teacher
 *       commission (= flat £5 / 500 pence per transaction) to the current
 *       month's row in teacher_commissions
 *
 * Status mapping: Paddle's trialing/active/past_due/paused/canceled → our
 * subscriptions.status enum (active | past_due | cancelled | none).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { EventName } from '@paddle/paddle-node-sdk'
import { paddle, webhookSecret } from '../_utils/paddle'

// Paddle signature verification requires the raw, unmodified request body.
// Disable Vercel's default body parser on this endpoint.
export const config = {
  api: { bodyParser: false },
}

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// Paddle subscription status → our `subscriptions.status` enum
const SUB_STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  paused: 'cancelled',
  canceled: 'cancelled',
}

// Paddle subscription status → our `teacher_referrals.status` enum
const REFERRAL_STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'active',
  past_due: 'active', // still attributed during dunning
  paused: 'cancelled',
  canceled: 'cancelled',
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const signature = (req.headers['paddle-signature'] as string | undefined) || ''
  if (!signature) {
    res.status(400).json({ error: 'Missing Paddle-Signature header' })
    return
  }

  let rawBody: string
  try {
    rawBody = await readRawBody(req)
  } catch (err) {
    console.error('[paddle-webhook] Failed to read body:', err)
    res.status(400).json({ error: 'Failed to read body' })
    return
  }

  let event
  try {
    event = await paddle.webhooks.unmarshal(rawBody, webhookSecret, signature)
  } catch (err: any) {
    console.error('[paddle-webhook] Signature verification failed:', err?.message)
    res.status(401).json({ error: 'Invalid signature' })
    return
  }

  if (!event) {
    res.status(400).json({ error: 'Invalid event payload' })
    return
  }

  console.log('[paddle-webhook] Received:', event.eventType, 'id:', event.eventId)

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionTrialing:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionCanceled:
        await handleSubscriptionEvent(supabase, event.data as any)
        break

      case EventName.TransactionPaid:
        await handleTransactionPaidEvent(supabase, event.data as any)
        break

      case EventName.TransactionCompleted:
        // Logged for visibility; commission accrual happens on TransactionPaid.
        console.log('[paddle-webhook] transaction.completed (no-op):', (event.data as any).id)
        break

      default:
        console.log('[paddle-webhook] Unhandled event:', event.eventType)
    }

    res.status(200).json({ received: true })
  } catch (err: any) {
    console.error('[paddle-webhook] Handler error:', err)
    res.status(500).json({ error: err?.message || 'Internal error' })
  }
}

// ============================================
// SUBSCRIPTION EVENTS
// ============================================

async function handleSubscriptionEvent(supabase: any, data: any): Promise<void> {
  const customData = (data.customData || {}) as Record<string, unknown>
  const kind = customData.kind as string | undefined

  if (kind === 'premium' || kind === 'teacher_plan') {
    await handlePremiumSubscription(supabase, data, customData)
  } else if (kind === 'student_via_teacher') {
    await handleStudentSubscription(supabase, data, customData)
  } else {
    console.log('[paddle-webhook] Skipping subscription event for kind:', kind)
  }
}

async function handlePremiumSubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  const teacherId = customData.teacher_id as string | undefined
  const supabaseUserId = customData.supabase_user_id as string | undefined

  // Resolve learner_id: prefer teacher row, else fall back to learners.user_id
  let learnerId: string | null = null
  if (teacherId) {
    const { data: teacher, error: teacherErr } = await supabase
      .from('teachers')
      .select('learner_id')
      .eq('id', teacherId)
      .single()
    if (teacherErr || !teacher) {
      console.error('[paddle-webhook] Teacher not found:', teacherId, teacherErr)
      return
    }
    learnerId = teacher.learner_id
  } else if (supabaseUserId) {
    const { data: learner, error: learnerErr } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', supabaseUserId)
      .single()
    if (learnerErr || !learner) {
      console.error('[paddle-webhook] Learner not found for supabase_user_id:', supabaseUserId, learnerErr)
      return
    }
    learnerId = learner.id
  } else {
    console.error('[paddle-webhook] Premium subscription missing teacher_id and supabase_user_id in customData')
    return
  }

  const status = SUB_STATUS_MAP[data.status] || 'none'
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  const planId: string | null = firstItem?.price?.id || null

  const { data: subRow, error: upsertErr } = await supabase
    .from('subscriptions')
    .upsert(
      {
        learner_id: learnerId,
        status,
        plan_id: planId,
        plan_name: 'SSi Premium',
        current_period_end: periodEnd,
        cancel_at_period_end: !!data.scheduledChange,
        provider: 'paddle',
        provider_subscription_id: data.id,
        provider_customer_id: data.customerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'learner_id' }
    )
    .select('id')
    .single()

  if (upsertErr || !subRow) {
    console.error('[paddle-webhook] Failed to upsert premium subscription:', upsertErr)
    return
  }

  // Teacher-link mutation only runs when this checkout came via the teacher
  // signup flow (teacher_id in customData). Pure premium upgrades skip this.
  if (!teacherId) {
    console.log('[paddle-webhook] Premium subscription processed (no teacher link):', data.id, 'status:', status)
    return
  }

  // referral_active = false when the teacher cancels (no new sign-ups via
  // their class links). Existing student subs continue paying SSi independently
  // until their own cycle ends. Re-enabled on resume.
  const referralActive = status !== 'cancelled'

  const { error: linkErr } = await supabase
    .from('teachers')
    .update({
      own_subscription_id: subRow.id,
      referral_active: referralActive,
    })
    .eq('id', teacherId)

  if (linkErr) {
    console.error('[paddle-webhook] Failed to link teacher.own_subscription_id:', linkErr)
    return
  }

  console.log(
    '[paddle-webhook] Updated teacher subscription:',
    teacherId,
    'status:',
    status,
    'period_end:',
    periodEnd,
    'referral_active:',
    referralActive
  )
}

async function handleStudentSubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  const supabaseUserId = customData.supabase_user_id as string | undefined
  const classId = customData.class_id as string | undefined
  const tierPence = customData.tier_pence as number | undefined

  if (!supabaseUserId || !classId || !tierPence) {
    console.error(
      '[paddle-webhook] Missing required customData for student_via_teacher:',
      customData
    )
    return
  }

  // Get or create the learner for this Supabase user
  let { data: learner } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', supabaseUserId)
    .maybeSingle()

  if (!learner) {
    const { data: newLearner, error: createErr } = await supabase
      .from('learners')
      .insert({ user_id: supabaseUserId, display_name: '' })
      .select('id')
      .single()

    if (createErr || !newLearner) {
      console.error('[paddle-webhook] Failed to create learner:', createErr)
      return
    }
    learner = newLearner
  }

  const status = SUB_STATUS_MAP[data.status] || 'none'
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  const planId: string | null = firstItem?.price?.id || null

  // Upsert subscription row
  const { data: subRow, error: subErr } = await supabase
    .from('subscriptions')
    .upsert(
      {
        learner_id: learner.id,
        status,
        plan_id: planId,
        plan_name: 'SSi Student Access',
        current_period_end: periodEnd,
        cancel_at_period_end: !!data.scheduledChange,
        provider: 'paddle',
        provider_subscription_id: data.id,
        provider_customer_id: data.customerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'learner_id' }
    )
    .select('id')
    .single()

  if (subErr || !subRow) {
    console.error('[paddle-webhook] Failed to upsert student subscription:', subErr)
    return
  }

  // Upsert teacher_referrals (idempotent on subscription_id via partial unique index)
  const referralStatus = REFERRAL_STATUS_MAP[data.status] || 'lapsed'
  const { error: referralErr } = await supabase
    .from('teacher_referrals')
    .upsert(
      {
        class_id: classId,
        student_learner_id: learner.id,
        source: 'signup_link',
        locked_price_pence: tierPence,
        status: referralStatus,
        subscription_id: subRow.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'subscription_id' }
    )

  if (referralErr) {
    console.error('[paddle-webhook] Failed to upsert teacher_referrals:', referralErr)
  }

  // Insert user_tags row linking student to class (idempotent on the unique constraint)
  const { error: tagErr } = await supabase.from('user_tags').upsert(
    {
      user_id: supabaseUserId,
      tag_type: 'class',
      tag_value: `CLASS:${classId}`,
      role_in_context: 'student',
      added_by: supabaseUserId,
      added_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,tag_type,tag_value' }
  )

  if (tagErr) {
    console.error('[paddle-webhook] Failed to upsert user_tags:', tagErr)
  }

  console.log(
    '[paddle-webhook] Student subscription processed:',
    'learner:',
    learner.id,
    'class:',
    classId,
    'status:',
    status
  )
}

// ============================================
// TRANSACTION EVENTS — commission accrual
// ============================================

async function handleTransactionPaidEvent(supabase: any, data: any): Promise<void> {
  const subscriptionId = data.subscriptionId
  if (!subscriptionId) {
    // Not a subscription transaction (e.g. one-off charge) — nothing to accrue
    return
  }

  // Look up our local subscription
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, learner_id, plan_name')
    .eq('provider_subscription_id', subscriptionId)
    .maybeSingle()

  if (!sub) {
    console.log('[paddle-webhook] transaction.paid for unknown subscription:', subscriptionId)
    return
  }

  // Look up the teacher_referral (only student-via-teacher subs have referrals)
  const { data: referral } = await supabase
    .from('teacher_referrals')
    .select('class_id, locked_price_pence')
    .eq('subscription_id', sub.id)
    .maybeSingle()

  if (!referral) {
    // Teacher's own subscription, or unattributed — nothing to accrue
    return
  }

  // Resolve teacher via class.teacher_user_id → learners.user_id → teachers.id
  const { data: cls } = await supabase
    .from('classes')
    .select('teacher_user_id')
    .eq('id', referral.class_id)
    .maybeSingle()

  if (!cls) {
    console.error('[paddle-webhook] Class not found for referral:', referral.class_id)
    return
  }

  const { data: teacherLearner } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', cls.teacher_user_id)
    .maybeSingle()

  if (!teacherLearner) {
    console.error('[paddle-webhook] Teacher learner not found:', cls.teacher_user_id)
    return
  }

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('learner_id', teacherLearner.id)
    .maybeSingle()

  if (!teacher) {
    console.error('[paddle-webhook] Teacher row not found for learner:', teacherLearner.id)
    return
  }

  // Flat £5 / 500 pence per attributed paying student per paid transaction.
  // (locked_price_pence is retained on teacher_referrals for historical record
  // but no longer factors into the take calculation.)
  const teacherTakePence = 500

  // Calendar month for current period (UTC)
  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
  const periodStartIso = periodStart.toISOString().slice(0, 10)
  const periodEndIso = periodEnd.toISOString().slice(0, 10)

  // Upsert (read-then-write — accept rare race for v1; switch to RPC if needed)
  const { data: existing } = await supabase
    .from('teacher_commissions')
    .select('id, accrued_pence')
    .eq('teacher_id', teacher.id)
    .eq('period_start', periodStartIso)
    .maybeSingle()

  if (existing) {
    const { error: updErr } = await supabase
      .from('teacher_commissions')
      .update({
        accrued_pence: existing.accrued_pence + teacherTakePence,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (updErr) {
      console.error('[paddle-webhook] Failed to update teacher_commissions:', updErr)
      return
    }
  } else {
    const { error: insErr } = await supabase.from('teacher_commissions').insert({
      teacher_id: teacher.id,
      period_start: periodStartIso,
      period_end: periodEndIso,
      accrued_pence: teacherTakePence,
      status: 'accruing',
    })

    if (insErr) {
      console.error('[paddle-webhook] Failed to insert teacher_commissions:', insErr)
      return
    }
  }

  console.log(
    '[paddle-webhook] Accrued flat commission:',
    'teacher:',
    teacher.id,
    'period:',
    periodStartIso,
    '+',
    teacherTakePence,
    'pence (£5 per attributed student)'
  )
}
