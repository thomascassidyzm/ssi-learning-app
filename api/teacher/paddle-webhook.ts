/**
 * Paddle Webhook Handler - POST /api/teacher/paddle-webhook
 *
 * Public (no auth — verified by signature). Handles:
 *
 *   subscription.* with customData.kind in {'learner_premium', 'premium', 'teacher_plan'}
 *     → upsert subscriptions row. If customData.teacher_id is present,
 *       also link teachers.own_subscription_id. ('teacher_plan' is the
 *       legacy kind for subs created before the premium/teach split;
 *       handled identically.)
 *
 *   subscription.* with customData.kind = 'student_via_teacher'
 *     → upsert subscriptions row, upsert teacher_referrals (class-scoped),
 *       insert user_tags row linking student to class
 *
 *   subscription.* with customData.kind = 'school_platform'  (lever-3)
 *     → SET schools.platform_status/expires_at/teacher_seats (=item quantity)
 *       + provider ids, from the Paddle payload (absolute, idempotent).
 *
 *   subscription.* with customData.kind = 'tutor_platform'   (lever-3)
 *     → SET teachers.platform_status/expires_at from the Paddle payload.
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

// ── SERVER-SIDE PRICE SOURCE OF TRUTH ────────────────────────────────────────
// priceId → (kind it belongs to, server tier, expected per-period pence). The
// webhook NEVER trusts client customData for money: this map lets us (a) sanity
// check that the price the customer was actually billed on belongs to the tier
// we derived server-side, and (b) recognise legit prices. The pri_ values are the
// LIVE Paddle prices already shipped in player-vue (lib/paddle.ts + WithTeacher.vue);
// do NOT change them here. Amounts are GBP reference pence — Paddle country pricing
// can legitimately bill a different amount/currency on the SAME price id, so amount
// is validated leniently (we trust the price id's TIER, not the raw pence).
type PriceTier = 'premium' | 'student_tutor' | 'student_school'
interface PriceMeta {
  tier: PriceTier
  gbpPence: number
  period: 'monthly' | 'annual'
}
const PRICE_CATALOG: Record<string, PriceMeta> = {
  // £15/mo + £150/yr SSi Premium — used for learner_premium, tutor_platform AND
  // the per-seat school_platform price (a school is quantity>1 of the same unit).
  pri_01kqq85gvncyasfmfvvpcv1xfg: { tier: 'premium', gbpPence: 1500, period: 'monthly' },
  pri_01kqq86ymc3yhm8be3w7f7kgr1: { tier: 'premium', gbpPence: 15000, period: 'annual' },
  // Student-via-TUTOR (ACT) — £10/mo, £100/yr. Commission-bearing.
  pri_01kqq89qwnsd3qwxvyybsc6ey1: { tier: 'student_tutor', gbpPence: 1000, period: 'monthly' },
  pri_01kvaj1ben739erky6zjdjsq22: { tier: 'student_tutor', gbpPence: 10000, period: 'annual' },
  // Student-via-SCHOOL — £5/mo, £50/yr. No commission.
  pri_01kv5wrc5cz17pwgeva4zk8s0r: { tier: 'student_school', gbpPence: 500, period: 'monthly' },
  pri_01kvaj05x1y16trwvm8pdm2wcb: { tier: 'student_school', gbpPence: 5000, period: 'annual' },
}

function planIdOf(data: any): string | null {
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  return firstItem?.price?.id || null
}

// Real collected amount (minor units / pence) from a transaction payload. Paddle
// puts the charged total on details.totals.grandTotal (string). Returns null when
// it can't be read so callers can decide a safe default.
function collectedPenceOf(txn: any): number | null {
  const raw = txn?.details?.totals?.grandTotal ?? txn?.details?.totals?.total
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// Refunded amount (minor units / pence) on an adjustment payload.
function adjustmentPenceOf(adj: any): number | null {
  const raw = adj?.totals?.total ?? adj?.payoutTotals?.total
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

// True only when a refund covers the FULL original transaction total. Fails SAFE for
// the payer: if the amount can't be determined it returns false (treated as partial →
// access left intact) so a goodwill/partial refund never cuts off a live payer.
async function isFullRefund(adj: any): Promise<boolean> {
  try {
    const refunded = adjustmentPenceOf(adj)
    const txnId = adj?.transactionId
    if (refunded == null || !txnId) return false
    const txn = await paddle.transactions.get(txnId)
    const collected = collectedPenceOf(txn)
    if (collected == null || collected <= 0) return false
    return refunded >= collected
  } catch (e: any) {
    console.warn('[paddle-webhook] refund-amount check failed, treating as partial:', e?.message)
    return false
  }
}

// Best-effort: confirm the Paddle customer's email matches an email we hold for
// the resolved learner. NEVER throws and NEVER blocks (a parent/guardian may
// legitimately pay for a learner) — it only logs mismatches for audit so fraud /
// mis-wired customData surfaces in the logs. Fails open on any error.
async function logEmailMismatch(
  supabase: any,
  customerId: string | undefined,
  learnerId: string | null,
  context: string
): Promise<void> {
  if (!customerId || !learnerId) return
  try {
    const customer = await paddle.customers.get(customerId)
    const payerEmail = (customer?.email || '').trim().toLowerCase()
    if (!payerEmail) return
    const { data: emails } = await supabase
      .from('learner_emails')
      .select('email')
      .eq('learner_id', learnerId)
    const known = (emails || []).map((e: any) => (e.email || '').trim().toLowerCase())
    if (known.length > 0 && !known.includes(payerEmail)) {
      console.warn(
        `[paddle-webhook] EMAIL MISMATCH (${context}): payer ${payerEmail} not among learner ${learnerId} emails [${known.join(', ')}] — proceeding (third-party payment allowed), flagged for audit`
      )
    }
  } catch (e: any) {
    console.warn('[paddle-webhook] email validation skipped:', e?.message)
  }
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

  // Idempotency: record the event id before any side effect. A 23505 means we've
  // already processed this delivery → ack and skip (prevents double-accrual on
  // Paddle retries / at-least-once redelivery). Fails OPEN if the ledger table is
  // absent (pre-migration), preserving today's behaviour.
  if (event.eventId) {
    try {
      const { error: dedupErr } = await supabase
        .from('processed_webhook_events')
        .insert({ provider: 'paddle', event_id: event.eventId, event_type: event.eventType })
      if (dedupErr) {
        if (dedupErr.code === '23505') {
          res.status(200).json({ received: true, deduped: true })
          return
        }
        console.warn('[paddle-webhook] Event dedup unavailable (proceeding):', dedupErr.code, dedupErr.message)
      }
    } catch (e: any) {
      console.warn('[paddle-webhook] Event dedup threw (proceeding):', e?.message)
    }
  }

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

      case EventName.AdjustmentCreated:
        // Refund / chargeback — reverse a still-held commission accrual and the
        // student's entitlement. (Paddle surfaces refunds + chargebacks as
        // adjustments; transaction.refunded is not a distinct event in this SDK.)
        await handleAdjustmentEvent(supabase, event.data as any)
        break

      default:
        console.log('[paddle-webhook] Unhandled event:', event.eventType)
    }

    res.status(200).json({ received: true })
  } catch (err: any) {
    console.error('[paddle-webhook] Handler error:', err)
    // A genuine processing failure must NOT leave the dedup row behind, or the
    // provider's retry would be deduped and the side effect lost forever. Remove
    // it so the retry reprocesses. (Legitimate no-ops returned 200 above and keep
    // their row.) Best-effort: a failed cleanup just costs one retry of a 500.
    if (event.eventId) {
      try {
        await supabase
          .from('processed_webhook_events')
          .delete()
          .eq('provider', 'paddle')
          .eq('event_id', event.eventId)
      } catch (cleanupErr: any) {
        console.warn('[paddle-webhook] dedup cleanup failed:', cleanupErr?.message)
      }
    }
    res.status(500).json({ error: err?.message || 'Internal error' })
  }
}

// ============================================
// SUBSCRIPTION EVENTS
// ============================================

async function handleSubscriptionEvent(supabase: any, data: any): Promise<void> {
  const customData = (data.customData || {}) as Record<string, unknown>
  const kind = customData.kind as string | undefined

  if (kind === 'premium' || kind === 'teacher_plan' || kind === 'learner_premium') {
    await handlePremiumSubscription(supabase, data, customData)
  } else if (kind === 'student_via_teacher') {
    await handleStudentSubscription(supabase, data, customData)
  } else if (kind === 'school_platform') {
    await handleSchoolPlatformSubscription(supabase, data, customData)
  } else if (kind === 'tutor_platform') {
    await handleTutorPlatformSubscription(supabase, data, customData)
  } else {
    console.log('[paddle-webhook] Skipping subscription event for kind:', kind)
  }
}

// ============================================
// PLATFORM SUBSCRIPTION — schools (£15/teacher/mo) + tutors (£15/mo)
// ============================================
//
// Lever-3: the school/tutor pays for the DASHBOARD (not student play). On a
// paid subscription event we SET the platform columns absolutely from Paddle's
// own period end (idempotent on retries / out-of-order deliveries) and the
// teacher_seats from the per-seat price QUANTITY. Money values come from the
// webhook payload, never the client. The dashboard gate (SchoolsContainer /
// TeachContainer / api/school/subscription) reads these.

// Paddle subscription status → our platform_status enum (schools/teachers).
const PLATFORM_STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'active', // a Paddle-managed trial still entitles the dashboard
  past_due: 'past_due',
  paused: 'cancelled',
  canceled: 'cancelled',
}

async function handleSchoolPlatformSubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  const schoolId = customData.school_id as string | undefined
  if (!schoolId) {
    console.error('[paddle-webhook] school_platform subscription missing school_id in customData')
    return
  }

  const status = PLATFORM_STATUS_MAP[data.status] || 'cancelled'
  // ABSOLUTE set from Paddle's billing period (idempotent on retry/out-of-order).
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  // Per-teacher pricing = Paddle quantity on the single per-seat price.
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  const seats =
    firstItem && Number.isFinite(Number(firstItem.quantity)) && Number(firstItem.quantity) > 0
      ? Number(firstItem.quantity)
      : 1

  const { error } = await supabase
    .from('schools')
    .update({
      platform_status: status,
      platform_expires_at: periodEnd,
      teacher_seats: seats,
      provider_subscription_id: data.id,
      provider_customer_id: data.customerId,
    })
    .eq('id', schoolId)

  if (error) {
    console.error('[paddle-webhook] Failed to update school platform subscription:', error)
    return
  }
  console.log(
    '[paddle-webhook] School platform subscription:',
    schoolId,
    'status:',
    status,
    'seats:',
    seats,
    'period_end:',
    periodEnd
  )
}

async function handleTutorPlatformSubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  // Resolve teacher: prefer customData.teacher_id, else fall back to the learner
  // behind supabase_user_id (fixes the "teacher_id:null recorded nowhere" bug —
  // no paying tutor should be locked out for a missing client field).
  let teacherId = customData.teacher_id as string | undefined
  const supabaseUserId = customData.supabase_user_id as string | undefined
  let learnerId: string | null = null

  if (teacherId) {
    const { data: teacher } = await supabase
      .from('teachers')
      .select('learner_id')
      .eq('id', teacherId)
      .maybeSingle()
    learnerId = teacher?.learner_id || null
  } else if (supabaseUserId) {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', supabaseUserId)
      .maybeSingle()
    learnerId = learner?.id || null
    if (learnerId) {
      const { data: teacher } = await supabase
        .from('teachers')
        .select('id')
        .eq('learner_id', learnerId)
        .maybeSingle()
      teacherId = teacher?.id || undefined
    }
  }

  if (!teacherId) {
    console.error(
      '[paddle-webhook] tutor_platform subscription could not resolve a teacher (teacher_id + supabase_user_id both unusable):',
      customData
    )
    return
  }

  const status = PLATFORM_STATUS_MAP[data.status] || 'cancelled'
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null

  const { error } = await supabase
    .from('teachers')
    .update({ platform_status: status, platform_expires_at: periodEnd })
    .eq('id', teacherId)

  if (error) {
    console.error('[paddle-webhook] Failed to update tutor platform subscription:', error)
    return
  }

  // Best-effort audit (never blocks): the £15 is paid by this tutor.
  await logEmailMismatch(supabase, data.customerId, learnerId, 'tutor_platform')

  // D2 BUNDLE (Tom's decision): the tutor's £15 dashboard subscription ALSO grants
  // them learner-side premium. Grant it by upserting the same premium subscription
  // row a learner_premium checkout would create. Kept best-effort + separate from
  // the platform update so a learner-resolution miss can't undo the dashboard grant.
  if (learnerId) {
    await grantLearnerPremium(supabase, data, learnerId, 'SSi Premium (tutor bundle)')
  } else {
    console.warn('[paddle-webhook] tutor_platform: no learner resolved — platform set, learner premium NOT granted:', teacherId)
  }

  console.log(
    '[paddle-webhook] Tutor platform subscription:',
    teacherId,
    'status:',
    status,
    'period_end:',
    periodEnd,
    'learner_premium:',
    !!learnerId
  )
}

// Upsert the premium subscription entitlement for a learner (the SAME entitlement
// path as a learner_premium checkout: unlocks all premium courses past Yellow).
// Idempotent on learner_id. Returns the subscription row id (or null on failure).
async function grantLearnerPremium(
  supabase: any,
  data: any,
  learnerId: string,
  planName: string
): Promise<string | null> {
  const status = SUB_STATUS_MAP[data.status] || 'none'
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  const planId = planIdOf(data)

  const { data: subRow, error } = await supabase
    .from('subscriptions')
    .upsert(
      {
        learner_id: learnerId,
        status,
        plan_id: planId,
        plan_name: planName,
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

  if (error || !subRow) {
    console.error('[paddle-webhook] Failed to grant learner premium:', error)
    return null
  }
  return subRow.id
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

  const signupCourse = (customData.course as string | undefined)?.trim() || null

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

  // Best-effort marketing attribution: record the conversion course the first
  // time we see it. Kept SEPARATE from the upsert above so a missing column
  // (migration not yet applied) can never break the payment write. The
  // `is null` guard preserves the original conversion course across renewals.
  if (signupCourse) {
    const { error: attrErr } = await supabase
      .from('subscriptions')
      .update({ signup_course_code: signupCourse })
      .eq('id', subRow.id)
      .is('signup_course_code', null)
    if (attrErr) {
      console.warn('[paddle-webhook] signup_course_code not stored (migration pending?):', attrErr.message)
    }
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

  // Legacy 'premium'/'teacher_plan' checkouts (and any tutor checkout that lands
  // here instead of kind:'tutor_platform') ALSO stamp the dashboard platform
  // status when a teacher resolves — so no paying tutor is locked out of the
  // dashboard just because the client sent the older kind. The £15 bundles both.
  const platformStatus = PLATFORM_STATUS_MAP[data.status] || 'cancelled'
  const platformPeriodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null

  const { error: linkErr } = await supabase
    .from('teachers')
    .update({
      own_subscription_id: subRow.id,
      referral_active: referralActive,
      platform_status: platformStatus,
      platform_expires_at: platformPeriodEnd,
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

  if (!supabaseUserId || !classId) {
    console.error(
      '[paddle-webhook] Missing required customData for student_via_teacher:',
      customData
    )
    return
  }

  // Price is decided SERVER-SIDE by the class type, never trusted from the client.
  // school_id NULL = tutor/ACT class → £10 (1000); set = school class → £5 (500).
  // Frozen into teacher_referrals.locked_price_pence below; commission gates on it.
  const { data: priceCls } = await supabase
    .from('classes')
    .select('school_id, course_code')
    .eq('id', classId)
    .maybeSingle()
  if (!priceCls) {
    // Money-safe default under uncertainty: unknown class → school tier (no commission).
    console.error('[paddle-webhook] Class not found deriving price; defaulting to school/no-commission:', classId)
  }
  const isTutorClass = !!priceCls && priceCls.school_id === null
  const lockedPricePence = isTutorClass ? 1000 : 500

  // PRICE-TIER GUARD: confirm the price the customer was actually billed on belongs
  // to the tier we derived from the class. A tutor class billed on a known school
  // price (or vice versa) means the client sent the wrong price → log loudly. We do
  // NOT block entitlement (the student paid something), but commission gates on the
  // SERVER-derived locked_price_pence below, so a spoofed price can't earn £5.
  const billedPlanId = planIdOf(data)
  const priceMeta = billedPlanId ? PRICE_CATALOG[billedPlanId] : undefined
  const derivedTier: PriceTier = isTutorClass ? 'student_tutor' : 'student_school'
  if (priceMeta && priceMeta.tier !== derivedTier) {
    console.warn(
      `[paddle-webhook] PRICE TIER MISMATCH (student_via_teacher): billed price ${billedPlanId} is '${priceMeta.tier}' but class ${classId} derives '${derivedTier}' — honouring server tier (locked ${lockedPricePence}p), flagged for audit`
    )
  } else if (billedPlanId && !priceMeta) {
    console.warn('[paddle-webhook] student_via_teacher billed on unrecognised price id:', billedPlanId)
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
        locked_price_pence: lockedPricePence,
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

  // Enrol the student in the class's course so the paid entitlement lands them on
  // the right course. Idempotent on (learner_id, course_id); best-effort so a
  // missing course_code can never undo the subscription/referral writes above.
  const courseCode = (priceCls?.course_code as string | undefined)?.trim() || null
  if (courseCode) {
    const { error: enrollErr } = await supabase
      .from('course_enrollments')
      .upsert(
        { learner_id: learner.id, course_id: courseCode },
        { onConflict: 'learner_id,course_id', ignoreDuplicates: true }
      )
    if (enrollErr) {
      console.error('[paddle-webhook] Failed to upsert course_enrollments:', enrollErr)
    }
  } else {
    console.warn('[paddle-webhook] student_via_teacher: no course_code on class, enrolment skipped:', classId)
  }

  // Best-effort payer-email audit (never blocks).
  await logEmailMismatch(supabase, data.customerId, learner.id, 'student_via_teacher')

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
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('id, learner_id, plan_name')
    .eq('provider_subscription_id', subscriptionId)
    .maybeSingle()

  // Throw on a GENUINE query error (vs a legitimate not-found) so the handler
  // returns 500, the dedup row is cleared, and Paddle's retry reprocesses —
  // rather than silently dropping the £5 accrual.
  if (subErr) throw new Error(`subscription lookup failed: ${subErr.message}`)
  if (!sub) {
    console.log('[paddle-webhook] transaction.paid for unknown subscription:', subscriptionId)
    return
  }

  // Look up the teacher_referral (only student-via-teacher subs have referrals)
  const { data: referral, error: referralErr } = await supabase
    .from('teacher_referrals')
    .select('class_id, locked_price_pence')
    .eq('subscription_id', sub.id)
    .maybeSingle()

  if (referralErr) throw new Error(`referral lookup failed: ${referralErr.message}`)
  if (!referral) {
    // Teacher's own subscription, or unattributed — nothing to accrue
    return
  }

  // Commission gates on the FROZEN price captured at signup (locked_price_pence),
  // never a live re-read of classes.school_id (which could diverge over the sub's
  // lifetime). 1000 = tutor/ACT student → accrue £5; 500 = school student → none.
  if (referral.locked_price_pence !== 1000) {
    console.log(
      '[paddle-webhook] Non-tutor referral (locked',
      referral.locked_price_pence,
      ') — no commission:',
      referral.class_id
    )
    return
  }

  // AMOUNT RECONCILIATION: read what Paddle actually COLLECTED. A £0 transaction
  // (100% discount / credit / trial conversion that took no money) must NOT accrue
  // a £5 commission. null = couldn't read the figure → proceed (a transaction.paid
  // implies money moved); 0 = explicitly nothing collected → skip.
  const collected = collectedPenceOf(data)
  if (collected === 0) {
    console.log('[paddle-webhook] transaction.paid collected £0 — no commission accrued:', data.id)
    return
  }

  // Resolve teacher via class.teacher_user_id → learners.user_id → teachers.id
  const { data: cls, error: clsErr } = await supabase
    .from('classes')
    .select('teacher_user_id')
    .eq('id', referral.class_id)
    .maybeSingle()

  if (clsErr) throw new Error(`class lookup failed: ${clsErr.message}`)
  if (!cls) {
    console.error('[paddle-webhook] Class not found for referral:', referral.class_id)
    return
  }

  const { data: teacherLearner, error: teacherLearnerErr } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', cls.teacher_user_id)
    .maybeSingle()

  if (teacherLearnerErr) throw new Error(`teacher learner lookup failed: ${teacherLearnerErr.message}`)
  if (!teacherLearner) {
    console.error('[paddle-webhook] Teacher learner not found:', cls.teacher_user_id)
    return
  }

  const { data: teacher, error: teacherErr } = await supabase
    .from('teachers')
    .select('id')
    .eq('learner_id', teacherLearner.id)
    .maybeSingle()

  if (teacherErr) throw new Error(`teacher lookup failed: ${teacherErr.message}`)
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

  // HELD until the 30-day refund window closes (Tom's decision: never pay out
  // immediately). hold_until = this transaction's paid_at + 30 days. The payout
  // cron must only release accruals whose hold_until has passed.
  const paidAt = data.billedAt ? new Date(data.billedAt) : now
  const holdUntil = new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

  // Atomic HELD accrual via RPC (INSERT … ON CONFLICT (teacher_id, period_start) DO
  // UPDATE accrued_pence += , status→held, hold_until advanced). Combined with the
  // event-id dedup above this makes accrual idempotent + race-free. Falls back to a
  // read-then-write when the 5-arg RPC is missing (pre-migration), so it's safe to
  // deploy before the migration is applied.
  const { error: rpcErr } = await supabase.rpc('accrue_teacher_commission_held', {
    p_teacher_id: teacher.id,
    p_period_start: periodStartIso,
    p_period_end: periodEndIso,
    p_pence: teacherTakePence,
    p_hold_until: holdUntil,
  })

  if (rpcErr) {
    const missing =
      rpcErr.code === 'PGRST202' ||
      rpcErr.code === '42883' ||
      /could not find the function|schema cache/i.test(rpcErr.message || '')
    if (!missing) {
      // Genuine accrual failure: throw so the handler 500s, the dedup row is
      // cleared, and Paddle retries (rather than silently dropping the accrual).
      throw new Error(`accrue_teacher_commission_held RPC failed: ${rpcErr.message}`)
    }
    // Pre-migration fallback: read-then-write (race-accepting). Tolerates the
    // hold_until / 'held' status columns being absent too — retries without them.
    console.warn('[paddle-webhook] held-accrue RPC missing — falling back to read-then-write')
    const { data: existing } = await supabase
      .from('teacher_commissions')
      .select('id, accrued_pence')
      .eq('teacher_id', teacher.id)
      .eq('period_start', periodStartIso)
      .maybeSingle()

    if (existing) {
      let { error: updErr } = await supabase
        .from('teacher_commissions')
        .update({
          accrued_pence: existing.accrued_pence + teacherTakePence,
          status: 'held',
          hold_until: holdUntil,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
      if (updErr && isUnknownColumn(updErr)) {
        ;({ error: updErr } = await supabase
          .from('teacher_commissions')
          .update({
            accrued_pence: existing.accrued_pence + teacherTakePence,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id))
      }
      if (updErr) {
        console.error('[paddle-webhook] Failed to update teacher_commissions:', updErr)
        return
      }
    } else {
      let { error: insErr } = await supabase.from('teacher_commissions').insert({
        teacher_id: teacher.id,
        period_start: periodStartIso,
        period_end: periodEndIso,
        accrued_pence: teacherTakePence,
        status: 'held',
        hold_until: holdUntil,
      })
      if (insErr && isUnknownColumn(insErr)) {
        ;({ error: insErr } = await supabase.from('teacher_commissions').insert({
          teacher_id: teacher.id,
          period_start: periodStartIso,
          period_end: periodEndIso,
          accrued_pence: teacherTakePence,
          status: 'accruing',
        }))
      }
      if (insErr) {
        console.error('[paddle-webhook] Failed to insert teacher_commissions:', insErr)
        return
      }
    }
  }

  console.log(
    '[paddle-webhook] Accrued HELD commission:',
    'teacher:',
    teacher.id,
    'period:',
    periodStartIso,
    '+',
    teacherTakePence,
    'pence (£5/attributed student); hold_until:',
    holdUntil
  )
}

// True when a Supabase/Postgres error indicates a column the migration adds is not
// yet present (so the caller can retry without it — fail safe pre-migration).
function isUnknownColumn(err: any): boolean {
  return (
    err?.code === '42703' ||
    err?.code === 'PGRST204' ||
    /column .* does not exist|could not find the .* column|schema cache/i.test(err?.message || '')
  )
}

// ============================================
// ADJUSTMENT EVENTS — refund / chargeback reversal
// ============================================

async function handleAdjustmentEvent(supabase: any, data: any): Promise<void> {
  const action = (data.action || '').toLowerCase()

  // chargeback_warning is ONLY an early alert that a chargeback MAY occur (and can
  // itself be undone via chargeback_warning_reverse) — it takes no money. Cutting a
  // still-paying student off on a warning is wrong, so we log it and do nothing.
  if (action === 'chargeback_warning') {
    console.log('[paddle-webhook] chargeback_warning (alert only, no revocation):', data.id)
    return
  }

  // *_reverse actions UNDO a prior dispute → re-grant the entitlement (+ re-accrue).
  const isReverse = action === 'chargeback_reverse' || action === 'chargeback_warning_reverse'
  if (action !== 'refund' && action !== 'chargeback' && !isReverse) {
    console.log('[paddle-webhook] adjustment (no reversal needed):', data.id, 'action:', action)
    return
  }

  const subscriptionId = data.subscriptionId
  if (!subscriptionId) {
    console.log('[paddle-webhook] adjustment without subscription — skip:', data.id)
    return
  }

  // Resolve our subscription → referral → teacher (same chain as accrual).
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('id, learner_id')
    .eq('provider_subscription_id', subscriptionId)
    .maybeSingle()
  if (subErr) throw new Error(`adjustment subscription lookup failed: ${subErr.message}`)
  if (!sub) {
    console.log('[paddle-webhook] adjustment for unknown subscription:', subscriptionId)
    return
  }

  const { data: referral, error: refErr } = await supabase
    .from('teacher_referrals')
    .select('class_id, locked_price_pence')
    .eq('subscription_id', sub.id)
    .maybeSingle()
  if (refErr) throw new Error(`adjustment referral lookup failed: ${refErr.message}`)

  // Decide what happens to the paid entitlement:
  //  - reverse action → re-grant (a prior dispute was undone)
  //  - chargeback     → revoke (the whole charge is disputed)
  //  - refund         → revoke ONLY if it's a FULL refund. A partial/goodwill refund
  //    leaves the Paddle subscription active, so over-revoking would cut off a live
  //    payer until the next subscription.updated self-heals. Leave access intact.
  let entitlementChange: 'revoke' | 'regrant' | 'none' = 'none'
  if (isReverse) {
    entitlementChange = 'regrant'
  } else if (action === 'chargeback') {
    entitlementChange = 'revoke'
  } else {
    entitlementChange = (await isFullRefund(data)) ? 'revoke' : 'none'
  }

  if (entitlementChange === 'none') {
    console.log('[paddle-webhook] adjustment: partial refund, entitlement left intact:', data.id)
    return
  }

  if (entitlementChange === 'revoke') {
    const { error: subUpdErr } = await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
    if (subUpdErr) console.error('[paddle-webhook] adjustment: failed to revoke entitlement:', subUpdErr)
    if (referral) {
      await supabase
        .from('teacher_referrals')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('subscription_id', sub.id)
    }
  } else {
    // regrant: re-activate; a following subscription.updated will reconcile exact dates.
    const { error: subUpdErr } = await supabase
      .from('subscriptions')
      .update({ status: 'active', cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
    if (subUpdErr) console.error('[paddle-webhook] adjustment: failed to re-grant entitlement:', subUpdErr)
    if (referral) {
      await supabase
        .from('teacher_referrals')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('subscription_id', sub.id)
    }
  }

  // COMMISSION: only tutor referrals ever accrued (locked 1000).
  if (!referral || referral.locked_price_pence !== 1000) {
    console.log('[paddle-webhook] adjustment: entitlement', entitlementChange + 'ed,', 'no commission to adjust:', data.id)
    return
  }

  // Resolve teacher via class.teacher_user_id → learners.user_id → teachers.id.
  const { data: cls } = await supabase
    .from('classes')
    .select('teacher_user_id')
    .eq('id', referral.class_id)
    .maybeSingle()
  if (!cls) {
    console.error('[paddle-webhook] adjustment: class not found:', referral.class_id)
    return
  }
  const { data: teacherLearner } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', cls.teacher_user_id)
    .maybeSingle()
  if (!teacherLearner) return
  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('learner_id', teacherLearner.id)
    .maybeSingle()
  if (!teacher) return

  const reversePence = 500

  // Reverse against the month the ORIGINAL payment landed in, derived from the
  // adjustment's createdAt (best available signal). If the row is still held we
  // subtract; if already paid out the RPC records a clawback (carry a negative).
  const when = data.createdAt ? new Date(data.createdAt) : new Date()
  const periodStart = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1))
  const periodStartIso = periodStart.toISOString().slice(0, 10)

  // A reverse action re-accrues the £5 (held again); a refund/chargeback claws it back.
  if (entitlementChange === 'regrant') {
    const periodEndIso = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10)
    const holdUntil = new Date(when.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { error: reAccErr } = await supabase.rpc('accrue_teacher_commission_held', {
      p_teacher_id: teacher.id,
      p_period_start: periodStartIso,
      p_period_end: periodEndIso,
      p_pence: reversePence,
      p_hold_until: holdUntil,
    })
    if (reAccErr) {
      const missing =
        reAccErr.code === 'PGRST202' ||
        reAccErr.code === '42883' ||
        /could not find the function|schema cache/i.test(reAccErr.message || '')
      if (!missing) throw new Error(`re-accrue (reverse) RPC failed: ${reAccErr.message}`)
      console.warn('[paddle-webhook] re-accrue RPC missing — commission not restored (pre-migration):', teacher.id, periodStartIso)
    }
    console.log('[paddle-webhook] Re-accrued commission for reversed dispute:', 'teacher:', teacher.id, 'period:', periodStartIso, '+', reversePence, 'pence; action:', action)
    return
  }

  const { error: rpcErr } = await supabase.rpc('reverse_teacher_commission', {
    p_teacher_id: teacher.id,
    p_period_start: periodStartIso,
    p_pence: reversePence,
  })

  if (rpcErr) {
    const missing =
      rpcErr.code === 'PGRST202' ||
      rpcErr.code === '42883' ||
      /could not find the function|schema cache/i.test(rpcErr.message || '')
    if (!missing) throw new Error(`reverse_teacher_commission RPC failed: ${rpcErr.message}`)
    // Pre-migration fallback: subtract from a still-recoverable row (floored at 0).
    console.warn('[paddle-webhook] reverse RPC missing — falling back to read-then-write')
    const { data: existing } = await supabase
      .from('teacher_commissions')
      .select('id, accrued_pence, status')
      .eq('teacher_id', teacher.id)
      .eq('period_start', periodStartIso)
      .maybeSingle()
    if (existing && (existing.status === 'held' || existing.status === 'accruing')) {
      const next = Math.max(existing.accrued_pence - reversePence, 0)
      await supabase
        .from('teacher_commissions')
        .update({ accrued_pence: next, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      console.warn('[paddle-webhook] adjustment: commission already paid/absent, clawback not recorded (pre-migration):', teacher.id, periodStartIso)
    }
  }

  console.log(
    '[paddle-webhook] Reversed commission for refund/chargeback:',
    'teacher:',
    teacher.id,
    'period:',
    periodStartIso,
    '-',
    reversePence,
    'pence; action:',
    action
  )
}
