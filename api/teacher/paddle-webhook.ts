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
 *   subscription.* with customData.kind = 'org_platform'     (org billing,
 *   2026-08-01) → SET groups.platform_status/expires_at/seats (=item
 *       quantity) + provider ids, from the Paddle payload (absolute,
 *       idempotent). UPDATEs the existing trial org's `groups` row in place —
 *       upgrade never inserts a new node.
 *
 *   transaction.paid (any subscription kind)
 *     → if associated subscription is student-via-teacher, accrue teacher
 *       commission (= flat £5 / 500 pence per transaction) to the current
 *       month's row in teacher_commissions
 *
 * Status mapping: Paddle's trialing/active/past_due/paused/canceled → our
 * subscriptions.status enum (active | past_due | cancelled | none).
 *
 * TRUST BOUNDARY (security fix 2026-08-11, ADMIN-ENT-01 / TENANCY-03): for the
 * PLATFORM kinds ('school_platform', 'org_platform'), the tenant written to is
 * NEVER taken from customData — the browser composes customData, so trusting it
 * let anyone buy one seat, name a victim school, and clobber its seat count,
 * billing pointers and platform_status. The target is resolved server-side by
 * resolveSchoolTarget / resolveOrgTarget below; a payment that resolves to no
 * node is rejected and logged rather than written to a guessed row.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { EventName } from '@paddle/paddle-node-sdk'
import { paddle, webhookSecret } from '../_utils/paddle'
import { leaderGroupId } from '../_utils/orgPlatform'

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
type PriceTier = 'premium' | 'student_tutor' | 'student_school' | 'family'
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
  // SSi Family — £25/mo, £250/yr, up to 6 learners incl. the payer
  // (FAMILY-PLAN-SPEC.md §2.1). NO hardcoded fallback: unlike the tiers
  // above, this Paddle product does not exist yet — Tom creates it by hand
  // and pastes the two price ids into Vercel env (all environments):
  //   VITE_PADDLE_FAMILY_PRICE_MONTHLY, VITE_PADDLE_FAMILY_PRICE_ANNUAL
  // Until both are set, these entries are simply absent, so an incoming
  // kind:'family_plan' event fails the tier check below and is REJECTED —
  // tolerant of the product not existing yet, never a crash.
  ...(process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY?.trim()
    ? { [process.env.VITE_PADDLE_FAMILY_PRICE_MONTHLY.trim()]: { tier: 'family' as const, gbpPence: 2500, period: 'monthly' as const } }
    : {}),
  ...(process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL?.trim()
    ? { [process.env.VITE_PADDLE_FAMILY_PRICE_ANNUAL.trim()]: { tier: 'family' as const, gbpPence: 25000, period: 'annual' as const } }
    : {}),
}

function planIdOf(data: any): string | null {
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  return firstItem?.price?.id || null
}

// ── PLAN PRECEDENCE GUARD (worklist 07-02 decision C) ───────────────────────
// `subscriptions` is UNIQUE(learner_id) and all three purchase kinds upsert it,
// so a tutor who also buys a student sub would otherwise clobber their
// tutor-bundle row with a lower-value plan_name. Rank reflects what each plan
// GRANTS: the tutor bundle already includes learner premium (D2 bundle, see
// handleTutorPlatformSubscription), which in turn unlocks more than a
// class-scoped student subscription. An upsert may only raise or hold the
// rank, never lower it — a downgrade is skipped (logged), same-or-higher
// proceeds normally (renewals, upgrades, status changes on the SAME plan).
// 'SSi Family' ranks TOP (FAMILY-PLAN-SPEC.md §2.4): the owner's row carries
// five other people's access — nothing may clobber it. The tutor-bundle
// overlap is safe because the dashboard grant lives on teachers.platform_status
// (set unconditionally by handleTutorPlatformSubscription), not the
// subscriptions row — only the redundant row write is precedence-gated here.
export const PLAN_PRECEDENCE: Record<string, number> = {
  'SSi Family': 4,
  'SSi Premium (tutor bundle)': 3,
  'SSi Premium': 2,
  'SSi Student Access': 1,
}

// subscriptions.status values this webhook writes (SUB_STATUS_MAP above,
// plus the 'none' default fallback): active | past_due | cancelled | none.
// Only a NON-TERMINAL existing row can outrank an incoming plan — a
// cancelled/none row already grants nothing, so it must never block a new
// paid purchase from being entitled.
const NON_TERMINAL_SUB_STATUSES = new Set(['active', 'past_due'])

// Returns true if writing `incomingPlanName` for `learnerId` would DOWNGRADE
// an existing higher-ranked, still-active plan — in which case the caller
// must skip the upsert (leaving the higher-ranked row untouched) rather than
// clobber it.
export async function wouldDowngradePlan(
  supabase: any,
  learnerId: string,
  incomingPlanName: string
): Promise<boolean> {
  const { data: existing, error } = await supabase
    .from('subscriptions')
    .select('plan_name, status')
    .eq('learner_id', learnerId)
    .maybeSingle()
  if (error || !existing?.plan_name) return false // no existing row → nothing to downgrade
  if (!NON_TERMINAL_SUB_STATUSES.has(existing.status)) return false // terminal (cancelled/none) → grants nothing, never blocks

  const incomingRank = PLAN_PRECEDENCE[incomingPlanName] ?? 0
  const existingRank = PLAN_PRECEDENCE[existing.plan_name] ?? 0
  if (existingRank > incomingRank) {
    console.warn(
      `[paddle-webhook] plan precedence guard: skipping upsert for learner ${learnerId} — existing '${existing.plan_name}' (rank ${existingRank}) outranks incoming '${incomingPlanName}' (rank ${incomingRank})`
    )
    return true
  }
  return false
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

export async function handleSubscriptionEvent(supabase: any, data: any): Promise<void> {
  const customData = (data.customData || {}) as Record<string, unknown>
  const kind = customData.kind as string | undefined

  if (kind === 'premium' || kind === 'teacher_plan' || kind === 'learner_premium') {
    // 'learner_premium' is the CURRENT consumer premium flow. customData.kind is
    // CLIENT-supplied, so the entitlement it claims must be backed by a
    // premium-tier price ACTUALLY billed (the same protection the platform
    // branch below applies). Without this, a tampered checkout on the cheapest
    // live price (£5 student) + kind:'learner_premium' would upsert full
    // 'SSi Premium'. The billed price id is read from Paddle's payload and
    // can't be faked. Legacy 'premium'/'teacher_plan' predate PRICE_CATALOG and
    // may renew on an un-catalogued price, so they are left untouched here to
    // avoid breaking their renewals.
    if (kind === 'learner_premium') {
      const billedPriceId = planIdOf(data)
      const meta = billedPriceId ? PRICE_CATALOG[billedPriceId] : undefined
      if (meta?.tier !== 'premium') {
        console.error(
          '[paddle-webhook] REJECTED learner_premium subscription: billed price is not the premium tier:',
          { kind, billedPriceId, tier: meta?.tier ?? 'unknown', customData }
        )
        return
      }
    }
    await handlePremiumSubscription(supabase, data, customData)
  } else if (kind === 'family_plan') {
    // customData.kind is CLIENT-supplied — the entitlement it claims (Family,
    // which grants up to 6 learners) must be backed by the FAMILY price
    // actually billed, same protection as learner_premium/platform below.
    // Without this, a tampered checkout on the cheapest live price + kind:
    // 'family_plan' would upsert 'SSi Family' for a fraction of £25/mo.
    const billedPriceId = planIdOf(data)
    const meta = billedPriceId ? PRICE_CATALOG[billedPriceId] : undefined
    if (meta?.tier !== 'family') {
      console.error(
        '[paddle-webhook] REJECTED family_plan subscription: billed price is not the family tier (product may not be configured yet — see VITE_PADDLE_FAMILY_PRICE_MONTHLY/ANNUAL):',
        { kind, billedPriceId, tier: meta?.tier ?? 'unknown', customData }
      )
      return
    }
    await handleFamilySubscription(supabase, data, customData)
  } else if (kind === 'student_via_teacher') {
    await handleStudentSubscription(supabase, data, customData)
  } else if (kind === 'school_platform' || kind === 'tutor_platform' || kind === 'org_platform') {
    // customData.kind comes from CLIENT JS, but the entitlement it claims
    // (the paid dashboard) must be backed by the PLATFORM price actually
    // billed. Without this check, a tampered checkout on the cheapest live
    // price (£5 student) + kind:'school_platform' would set
    // platform_status='active' for a fraction of £15/seat. The billed price
    // id can't be faked — it's read from Paddle's own payload.
    const billedPriceId = planIdOf(data)
    const meta = billedPriceId ? PRICE_CATALOG[billedPriceId] : undefined
    if (meta?.tier !== 'premium') {
      console.error(
        '[paddle-webhook] REJECTED platform subscription: billed price does not match the platform tier:',
        { kind, billedPriceId, tier: meta?.tier ?? 'unknown', customData }
      )
      return
    }
    if (kind === 'school_platform') {
      await handleSchoolPlatformSubscription(supabase, data, customData)
    } else if (kind === 'org_platform') {
      await handleOrgPlatformSubscription(supabase, data, customData)
    } else {
      await handleTutorPlatformSubscription(supabase, data, customData)
    }
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

// ── SERVER-SIDE TENANT RESOLUTION (security fix 2026-08-11, ADMIN-ENT-01) ────
//
// customData is composed in the BROWSER. Trusting customData.school_id /
// group_id as the address of a privileged write meant anyone could buy one
// £15 seat, name a victim school, and clobber that school's seat count,
// platform_status and provider_* billing pointers — then cancel their own sub
// and take the victim's dashboard down with it.
//
// The target is now derived from things the payer cannot forge:
//   1. The EXISTING binding. If some row already carries this Paddle
//      subscription id, that row IS the target — this is every renewal,
//      seat change and cancellation, and it makes a live subscription
//      structurally unable to migrate onto a different tenant.
//   2. Otherwise (first bind) the PAYER's own node, resolved from the Paddle
//      customer's email — read from Paddle's API with our server key, never
//      from the request body — through learner_emails → learners.user_id, and
//      then the same ownership rule the authenticated endpoints use
//      (schools.admin_user_id / an admin school user_tag; govt_admins.group_id
//      for orgs).
// No resolution → REJECT and log loudly. A payment that can't be tied to a
// node is a manual-remediation case, never a write to a guessed row.

/**
 * The auth uid behind the Paddle customer who actually paid, or null.
 *
 * SEC15-04 (2026-08-16): an email is a WEAK identity claim on the money path,
 * so the two ways it used to be over-trusted are closed here.
 *
 *  - `learner_emails.verified = true` is required. An unverified row is an
 *    address somebody typed, not an address anybody proved they hold.
 *  - A multi-learner match is REFUSED rather than resolved arbitrarily.
 *    CLAUDE.md records that multiple accounts per person are INTENTIONAL
 *    (tester accounts — do not merge learners), so a multi-match is an
 *    expected state, and `.find(Boolean)` picked whichever row Postgres
 *    happened to return first. On the money path the right answer is to
 *    refuse and log for manual binding.
 *
 * Refusing here writes NOTHING — every caller turns a null into "reject and
 * log", never into a downgrade. That is deliberate: a resolution failure must
 * never be able to take a paying node's access away.
 */
async function resolvePayerAuthUid(
  supabase: any,
  customerId: string | undefined
): Promise<string | null> {
  if (!customerId) return null
  try {
    const customer = await paddle.customers.get(customerId)
    const payerEmail = (customer?.email || '').trim().toLowerCase()
    if (!payerEmail) return null

    const { data: emailRows, error: emailErr } = await supabase
      .from('learner_emails')
      .select('learner_id')
      .eq('email', payerEmail)
      .eq('verified', true)
    if (emailErr) {
      console.warn('[paddle-webhook] payer email lookup failed (resolving to nothing):', emailErr.message)
      return null
    }
    const learnerIds = [
      ...new Set((emailRows || []).map((r: any) => r.learner_id).filter(Boolean)),
    ]
    if (learnerIds.length === 0) return null
    if (learnerIds.length > 1) {
      console.error(
        `[paddle-webhook] REFUSING payer resolution: verified email ${payerEmail} maps to ${learnerIds.length} learners — multiple accounts per person are intentional, so "an arbitrary one of these" is not an answer on the money path. Needs manual binding.`,
        { customerId }
      )
      return null
    }

    const { data: learners } = await supabase
      .from('learners')
      .select('user_id')
      .in('id', learnerIds)
    const uids = [...new Set((learners || []).map((l: any) => l.user_id).filter(Boolean))]
    if (uids.length !== 1) {
      if (uids.length > 1) {
        console.error(
          '[paddle-webhook] REFUSING payer resolution: one learner id resolved to several auth uids. Needs manual binding.',
          { customerId }
        )
      }
      return null
    }
    return uids[0] as string
  } catch (e: any) {
    console.warn('[paddle-webhook] payer resolution failed:', e?.message)
    return null
  }
}

/** The school this subscription may write to — existing binding, else the payer's own. */
async function resolveSchoolTarget(supabase: any, data: any): Promise<string | null> {
  const { data: bound } = await supabase
    .from('schools')
    .select('id')
    .eq('provider_subscription_id', data.id)
    .maybeSingle()
  if (bound?.id) return bound.id as string

  const authUid = await resolvePayerAuthUid(supabase, data.customerId)
  if (!authUid) return null

  const { data: ownSchool } = await supabase
    .from('schools')
    .select('id')
    .eq('admin_user_id', authUid)
    .maybeSingle()
  if (ownSchool?.id) return ownSchool.id as string

  // Same admin-only tag rule as api/school/update-seats.ts — a plain teacher
  // tag must NOT be able to address the school's billing.
  const { data: tag } = await supabase
    .from('user_tags')
    .select('tag_value')
    .eq('user_id', authUid)
    .eq('tag_type', 'school')
    .eq('role_in_context', 'admin')
    .is('removed_at', null)
    .limit(1)
    .maybeSingle()
  if (tag?.tag_value) return String(tag.tag_value).replace('SCHOOL:', '')

  return null
}

/** The org this subscription may write to — existing binding, else the payer's own. */
async function resolveOrgTarget(supabase: any, data: any): Promise<string | null> {
  const { data: bound } = await supabase
    .from('groups')
    .select('id')
    .eq('provider_subscription_id', data.id)
    .maybeSingle()
  if (bound?.id) return bound.id as string

  const authUid = await resolvePayerAuthUid(supabase, data.customerId)
  if (!authUid) return null
  return await leaderGroupId(supabase, authUid)
}

/** Log when the browser named a different node than the server resolved. */
function logTargetMismatch(kind: string, claimed: unknown, resolved: string): void {
  if (claimed && claimed !== resolved) {
    console.warn(
      `[paddle-webhook] TENANT MISMATCH (${kind}): customData named ${String(claimed)} but the payer's own node is ${resolved} — writing to the server-resolved node`
    )
  }
}

async function handleSchoolPlatformSubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  const schoolId = await resolveSchoolTarget(supabase, data)
  if (!schoolId) {
    console.error(
      '[paddle-webhook] REJECTED school_platform subscription: could not resolve a school the payer administers (no existing binding for this subscription, and the Paddle customer maps to no school admin). Needs manual binding.',
      { subscriptionId: data.id, customerId: data.customerId, customData }
    )
    return
  }
  logTargetMismatch('school_platform', customData.school_id, schoolId)

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

// ============================================
// PLATFORM SUBSCRIPTION — orgs (£15/seat/mo, founder-specced 2026-08-01)
// ============================================
//
// Same shape as handleSchoolPlatformSubscription above, targeting `groups`
// instead of `schools` (the shared quintet: platform_status/expires_at/seats/
// provider_*). This UPDATEs the org's EXISTING groups row — it must never
// insert a new node — which is what makes upgrade convert the trial org IN
// PLACE, exactly as the founder ruling requires.

async function handleOrgPlatformSubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  const groupId = await resolveOrgTarget(supabase, data)
  if (!groupId) {
    console.error(
      '[paddle-webhook] REJECTED org_platform subscription: could not resolve an org the payer leads (no existing binding for this subscription, and the Paddle customer maps to no govt_admins row). Needs manual binding.',
      { subscriptionId: data.id, customerId: data.customerId, customData }
    )
    return
  }
  logTargetMismatch('org_platform', customData.group_id, groupId)

  const status = PLATFORM_STATUS_MAP[data.status] || 'cancelled'
  // ABSOLUTE set from Paddle's billing period (idempotent on retry/out-of-order).
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  // Per-seat pricing = Paddle quantity on the single per-seat price.
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  const seats =
    firstItem && Number.isFinite(Number(firstItem.quantity)) && Number(firstItem.quantity) > 0
      ? Number(firstItem.quantity)
      : 1

  const { error } = await supabase
    .from('groups')
    .update({
      platform_status: status,
      platform_expires_at: periodEnd,
      seats,
      provider_subscription_id: data.id,
      provider_customer_id: data.customerId,
    })
    .eq('id', groupId)

  if (error) {
    console.error('[paddle-webhook] Failed to update org platform subscription:', error)
    return
  }
  console.log(
    '[paddle-webhook] Org platform subscription:',
    groupId,
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
    const subId = await grantLearnerPremium(supabase, data, learnerId, 'SSi Premium (tutor bundle)')
    // Link the subscription row back to the teacher — api/teacher/portal
    // resolves the Paddle customer via teachers.own_subscription_id, so
    // without this write "Manage subscription" 404s for every tutor who
    // paid through the canonical tutor_platform checkout.
    if (subId) {
      const { error: linkErr } = await supabase
        .from('teachers')
        .update({ own_subscription_id: subId })
        .eq('id', teacherId)
      if (linkErr) {
        console.error('[paddle-webhook] tutor_platform: own_subscription_id link failed:', linkErr.message)
      }
    }
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

  // The precedence guard only suppresses the redundant subscription-ROW
  // write. Callers (e.g. the tutor-bundle own_subscription_id link) still
  // need a subscription id back even when the write is skipped — returning
  // null here would silently drop that link (portal-404) even though the
  // learner already holds an equal-or-higher-ranked row.
  if (await wouldDowngradePlan(supabase, learnerId, planName)) {
    const { data: existingRow } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('learner_id', learnerId)
      .maybeSingle()
    return existingRow?.id ?? null
  }

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

export async function handlePremiumSubscription(
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
  if (!learnerId) {
    // teachers.learner_id was null — proceeding would write a subscription row
    // keyed on a null learner_id (and the precedence guard would query against
    // null). Fail loud rather than corrupt the money spine.
    console.error('[paddle-webhook] resolved learner_id is null; cannot process premium subscription')
    return
  }

  const status = SUB_STATUS_MAP[data.status] || 'none'
  const periodEnd: string | null =
    data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  const firstItem = Array.isArray(data.items) && data.items.length > 0 ? data.items[0] : null
  const planId: string | null = firstItem?.price?.id || null

  const signupCourse = (customData.course as string | undefined)?.trim() || null

  // The precedence guard only suppresses the redundant subscription-ROW
  // write (an incoming lower-ranked plan must never clobber a higher-ranked
  // one already active). It must NEVER short-circuit the orthogonal side
  // effects below (signup-course attribution, teacher-link/own_subscription_id) —
  // a teacher who already holds the tutor bundle and buys/renews a plain
  // premium checkout still paid Paddle and still needs those effects to run
  // against their EXISTING (higher-ranked) subscription row.
  const skipRowWrite = await wouldDowngradePlan(supabase, learnerId, 'SSi Premium')
  let subRow: { id: string } | null = null

  if (!skipRowWrite) {
    const { data: upsertedRow, error: upsertErr } = await supabase
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

    if (upsertErr || !upsertedRow) {
      console.error('[paddle-webhook] Failed to upsert premium subscription:', upsertErr)
      return
    }
    subRow = upsertedRow
  } else {
    // Row write skipped (existing plan outranks this one) — fetch the
    // existing row so the downstream teacher link still has a subscription
    // id to point at, instead of losing it entirely.
    const { data: existingRow } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('learner_id', learnerId)
      .maybeSingle()
    subRow = existingRow ?? null
  }

  if (!subRow) {
    console.error('[paddle-webhook] No subscription row available (write skipped, none existing) for learner:', learnerId)
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

// ============================================
// SSi FAMILY SUBSCRIPTION (FAMILY-PLAN-SPEC.md §2.3)
// ============================================
// The webhook stays dumb: one absolute, idempotent write to the OWNER's
// subscriptions row. No membership side effects here — family_members is
// managed entirely by /api/family/* afterwards. Checkout never sends member
// info (customData is just { kind: 'family_plan', supabase_user_id }), so
// there is nothing else to do at purchase time. transaction.paid/adjustments
// need zero family-specific changes: a family sub has no teacher_referrals
// row (early return, no commission — correct) and a full refund/chargeback
// rides the existing revoke path, which flips this one owner row and the
// whole family switches off through the entitlement resolver (§3) with no
// fan-out writes.
export async function handleFamilySubscription(
  supabase: any,
  data: any,
  customData: Record<string, unknown>
): Promise<void> {
  const supabaseUserId = customData.supabase_user_id as string | undefined
  if (!supabaseUserId) {
    console.error('[paddle-webhook] Family subscription missing supabase_user_id in customData')
    return
  }

  const { data: learner, error: learnerErr } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', supabaseUserId)
    .single()
  if (learnerErr || !learner) {
    console.error('[paddle-webhook] Learner not found for supabase_user_id:', supabaseUserId, learnerErr)
    return
  }
  const learnerId = learner.id

  const status = SUB_STATUS_MAP[data.status] || 'none'
  const periodEnd: string | null = data.currentBillingPeriod?.endsAt || data.nextBilledAt || null
  const planId = planIdOf(data)

  // 'SSi Family' is top-ranked (PLAN_PRECEDENCE = 4), so this only ever skips
  // when the owner's row is ALREADY 'SSi Family' — i.e. never a downgrade,
  // just the same guard every handler uses for renewals/status updates.
  const skipRowWrite = await wouldDowngradePlan(supabase, learnerId, 'SSi Family')
  if (skipRowWrite) {
    console.log('[paddle-webhook] Family subscription row write skipped (existing row already outranks — unexpected, Family is top rank):', data.id)
    return
  }

  const { error: upsertErr } = await supabase
    .from('subscriptions')
    .upsert(
      {
        learner_id: learnerId,
        status,
        plan_id: planId,
        plan_name: 'SSi Family',
        current_period_end: periodEnd,
        cancel_at_period_end: !!data.scheduledChange,
        provider: 'paddle',
        provider_subscription_id: data.id,
        provider_customer_id: data.customerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'learner_id' }
    )

  if (upsertErr) {
    console.error('[paddle-webhook] Failed to upsert family subscription:', upsertErr)
    return
  }

  console.log('[paddle-webhook] Family subscription processed:', data.id, 'status:', status, 'owner learner:', learnerId)
}

export async function handleStudentSubscription(
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
  // school_id AND group_id both NULL = independent tutor/ACT class → £10 (1000);
  // either set = organisation-owned class → £5 (500). Frozen into
  // teacher_referrals.locked_price_pence below; commission gates on it.
  //
  // group_id is part of the gate because of the COMMISSIONS-NEVER-STACK ruling
  // (founder, 2026-08-02): if a tutor's class is ever attached inside an org's
  // group tree (not built today, deliberately not painted out), its students
  // price as org students and the tutor earns NO per-student commission — the
  // org seat relationship is the compensation. Commission only ever rides a
  // student's own tutor-tier payment, never alongside org/school coverage.
  const { data: priceCls } = await supabase
    .from('classes')
    .select('school_id, group_id, course_code')
    .eq('id', classId)
    .maybeSingle()
  if (!priceCls) {
    // Money-safe default under uncertainty: unknown class → school tier (no commission).
    console.error('[paddle-webhook] Class not found deriving price; defaulting to school/no-commission:', classId)
  }
  const isTutorClass = !!priceCls && priceCls.school_id === null && priceCls.group_id == null
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

  // MONTHLY-ONLY GUARD (founder ruling 2026-08-02): a TUTOR-class student may
  // only ever be sold the monthly plan — the £5 rebate accrues per paid
  // transaction, so an annual tutor student would pay 12 months up front and
  // accrue £5 once. The app no longer offers annual in this lane (WithTeacher.vue
  // + paddle.ts), so this can only fire on a legacy subscription or a
  // hand-built checkout. Entitlement is still honoured (they paid); the log is
  // the audit trail. Commission is unaffected — it rides transaction.paid.
  if (isTutorClass && priceMeta?.period === 'annual') {
    console.warn(
      `[paddle-webhook] TUTOR-ANNUAL (retired): class ${classId} student billed on annual price ${billedPlanId} — tutor lane is monthly-only since 2026-08-02; honouring entitlement, flagged for audit`
    )
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

  // The precedence guard only suppresses the redundant subscription-ROW
  // write (a lower-ranked plan must never clobber a higher-ranked one
  // already active — e.g. a tutor/premium holder buying a class seat).
  // It must NEVER suppress the orthogonal side effects below (referral,
  // tag, class enrollment) — the student paid Paddle for this class seat
  // regardless of which plan_name ends up on their subscriptions row, so
  // enrollment/tagging must always run or the payment is silently lost
  // (webhook 200s, Paddle collected, learner never enrolled).
  const skipRowWrite = await wouldDowngradePlan(supabase, learner.id, 'SSi Student Access')
  let subRow: { id: string } | null = null

  if (!skipRowWrite) {
    const { data: upsertedRow, error: subErr } = await supabase
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

    if (subErr || !upsertedRow) {
      console.error('[paddle-webhook] Failed to upsert student subscription:', subErr)
      return
    }
    subRow = upsertedRow
  } else {
    // Row write skipped (existing plan outranks 'SSi Student Access') —
    // fetch the existing row so the referral upsert below still has a
    // subscription id to key off, instead of losing the referral entirely.
    const { data: existingRow } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('learner_id', learner.id)
      .maybeSingle()
    subRow = existingRow ?? null
  }

  // Upsert teacher_referrals (idempotent on subscription_id via partial unique index).
  // Best-effort: teacher_referrals.subscription_id is required, so this can only run
  // when a row resolved above — but class enrollment/tagging below never depend on it.
  if (subRow) {
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
  } else {
    console.warn('[paddle-webhook] student_via_teacher: no subscription row resolved, referral skipped (enrollment/tagging still proceed):', learner.id)
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

  // HELD per the founder model (2026-08-02): "£5 per completed student-month,
  // paid 30 days AFTER the completed month." The transaction pays for a month
  // of service starting at paid_at; that student-month completes one calendar
  // month later, and the rebate releases 30 days after THAT — so
  // hold_until = paid_at + 1 month + 30 days. (Previously paid_at + 30d, which
  // released at month-completion instead of 30 days after it.) The payout cron
  // only releases accruals whose hold_until has passed.
  const paidAt = data.billedAt ? new Date(data.billedAt) : now
  const monthComplete = new Date(paidAt)
  monthComplete.setUTCMonth(monthComplete.getUTCMonth() + 1)
  const holdUntil = new Date(monthComplete.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()

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

  // Per-student-month LEDGER LINE under the aggregate accrual, so the tutor's
  // statement can show which student-months earned what. Best-effort: the
  // aggregate above is the money source of truth; a missing table (pre-
  // migration) or a duplicate line (webhook retry) is silently tolerated.
  let learnerDisplay: string | null = null
  if (sub.learner_id) {
    const { data: studentLearner } = await supabase
      .from('learners')
      .select('display_name')
      .eq('id', sub.learner_id)
      .maybeSingle()
    learnerDisplay = studentLearner?.display_name || null
  }
  await recordRebateLedgerLine(supabase, {
    teacher_id: teacher.id,
    learner_id: sub.learner_id || null,
    learner_display: learnerDisplay,
    class_id: referral.class_id,
    subscription_id: sub.id,
    provider_ref: data.id,
    entry_type: 'accrual',
    service_month: periodStartIso,
    amount_pence: teacherTakePence,
    hold_until: holdUntil,
  })
}

// Best-effort insert of a tutor_rebate_ledger line. Idempotent via the
// (provider_ref, entry_type) unique index; tolerates the table not existing
// yet (pre-migration) — the aggregate teacher_commissions row is the money
// source of truth, the ledger only feeds the tutor-facing statement.
async function recordRebateLedgerLine(
  supabase: any,
  line: {
    teacher_id: string
    learner_id: string | null
    learner_display: string | null
    class_id: string | null
    subscription_id: string | null
    provider_ref: string
    entry_type: 'accrual' | 'reversal' | 'reaccrual'
    service_month: string
    amount_pence: number
    hold_until: string | null
  }
): Promise<void> {
  try {
    const { error } = await supabase
      .from('tutor_rebate_ledger')
      .upsert(line, { onConflict: 'provider_ref,entry_type', ignoreDuplicates: true })
    if (error) {
      const missingTable =
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /relation .* does not exist|could not find the table/i.test(error.message || '')
      if (missingTable) {
        console.warn('[paddle-webhook] tutor_rebate_ledger absent — statement line skipped (pre-migration)')
      } else {
        console.error('[paddle-webhook] tutor_rebate_ledger write failed (aggregate unaffected):', error)
      }
    }
  } catch (e: any) {
    console.error('[paddle-webhook] tutor_rebate_ledger write threw (aggregate unaffected):', e?.message)
  }
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
    await recordRebateLedgerLine(supabase, {
      teacher_id: teacher.id,
      learner_id: sub.learner_id || null,
      learner_display: null,
      class_id: referral.class_id,
      subscription_id: sub.id,
      provider_ref: data.id,
      entry_type: 'reaccrual',
      service_month: periodStartIso,
      amount_pence: reversePence,
      hold_until: holdUntil,
    })
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

  await recordRebateLedgerLine(supabase, {
    teacher_id: teacher.id,
    learner_id: sub.learner_id || null,
    learner_display: null,
    class_id: referral.class_id,
    subscription_id: sub.id,
    provider_ref: data.id,
    entry_type: 'reversal',
    service_month: periodStartIso,
    amount_pence: -reversePence,
    hold_until: null,
  })
}
