/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`, finding TENANCY-03 (high).
 *
 * The Paddle webhook validates the *tier* claimed by `customData.kind` against
 * the price actually billed (api/teacher/paddle-webhook.ts:414-429) — money
 * cannot be faked, and that guard is correct. It never validates the *target
 * tenant*: `customData.school_id` / `customData.group_id` come from browser JS
 * (packages/player-vue/src/composables/useSchoolCheckout.ts:86-87,
 * useOrgCheckout.ts:80) and are used as the sole address for a privileged write
 * to `schools` / `groups`.
 *
 * An attacker who pays for a genuine platform subscription while pointing
 * `school_id` at a victim school overwrites that school's
 * provider_subscription_id / provider_customer_id / platform_status /
 * platform_expires_at / teacher_seats. Consequences: the victim admin's billing
 * portal (api/school/portal.ts:43-65) and seat changes
 * (api/school/update-seats.ts:135-167) are redirected onto the attacker's Paddle
 * objects; and a later cancellation flips the victim to `cancelled`, which the
 * coverage gate turns into a school-wide 403 `coverage_expired`.
 *
 * FIXED 2026-08-11: `resolveSchoolTarget` / `resolveOrgTarget` in
 * api/teacher/paddle-webhook.ts derive the target from the row already bound to
 * this Paddle subscription id, else from the PAYER's own node (Paddle customer
 * email → learner_emails → learners.user_id → schools.admin_user_id /
 * govt_admins.group_id). customData is never the address. The tests below are
 * now regression locks on that fix.
 *
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/paddle', () => ({
  paddle: {},
  webhookSecret: 'whsec_test',
}))

/** The live per-seat platform price — PRICE_CATALOG tier 'premium'. */
const PLATFORM_PRICE_ID = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
/** A live but CHEAPER price — tier 'student_school'; the tier gate must reject it. */
const STUDENT_PRICE_ID = 'pri_01kv5wrc5cz17pwgeva4zk8s0r'

interface Write { table: string; values: Record<string, unknown>; id: unknown }
let writes: Write[] = []

function makeSupabase() {
  const from = (table: string) => {
    const builder: any = {}
    let pending: Record<string, unknown> | null = null
    builder.select = () => builder
    builder.is = () => builder
    builder.in = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
    builder.single = () => Promise.resolve({ data: null, error: null })
    builder.update = (values: Record<string, unknown>) => { pending = values; return builder }
    builder.insert = () => builder
    builder.upsert = () => builder
    builder.eq = (_col: string, val: unknown) => {
      if (pending) { writes.push({ table, values: pending, id: val }); pending = null }
      return builder
    }
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }
  return { from } as any
}

let handleSubscriptionEvent: typeof import('./paddle-webhook').handleSubscriptionEvent

/** A signed Paddle subscription payload, as the handler receives it after unmarshal. */
function subscriptionEvent(customData: Record<string, unknown>, priceId = PLATFORM_PRICE_ID) {
  return {
    id: 'sub_ATTACKER',
    status: 'active',
    customerId: 'ctm_ATTACKER',
    customData,
    currentBillingPeriod: { endsAt: '2026-09-11T00:00:00Z' },
    items: [{ price: { id: priceId }, quantity: 3 }],
  }
}

beforeEach(async () => {
  writes = []
  handleSubscriptionEvent = (await import('./paddle-webhook')).handleSubscriptionEvent
})

/**
 * TENANCY-03 REGRESSION LOCK. The supabase mock here resolves every lookup to
 * null, which is exactly the attacker's situation: no row is bound to their
 * subscription id, and their Paddle customer maps to no school admin / org
 * leader. The handler must therefore write nothing at all — the victim named
 * in customData is unreachable.
 */
describe('TENANCY-03 — the webhook no longer addresses tenants from customData', () => {
  it('writes nothing when customData names a school the payer does not administer', async () => {
    await handleSubscriptionEvent(makeSupabase(), subscriptionEvent({
      kind: 'school_platform',
      school_id: 'victim-school-uuid', // ← attacker-chosen, now ignored
    }))

    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  it('a stranger’s cancellation cannot flip the named school dark', async () => {
    const cancelled = subscriptionEvent({ kind: 'school_platform', school_id: 'victim-school-uuid' })
    cancelled.status = 'canceled'
    await handleSubscriptionEvent(makeSupabase(), cancelled)

    // schoolCoverageGate would 403 `coverage_expired` school-wide off this write.
    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  it('writes nothing when customData names an org the payer does not lead', async () => {
    await handleSubscriptionEvent(makeSupabase(), subscriptionEvent({
      kind: 'org_platform',
      group_id: 'victim-org-uuid',
    }))

    expect(writes.find((w) => w.table === 'groups')).toBeUndefined()
  })

  it.todo('TENANCY-03: mint the checkout transaction server-side so the browser never names a target at all')
  it.todo('TENANCY-03: refuse to displace an existing, different provider_subscription_id on the target row')
})

/**
 * CONTROL that holds — the money half of the same handler is correct, and must
 * stay correct. A tampered checkout that claims the platform entitlement while
 * paying the cheap student price is rejected before any write.
 */
describe('CONTROL — the billed-price tier gate rejects a downgraded platform claim', () => {
  it('writes nothing when kind=school_platform is billed on the student price', async () => {
    await handleSubscriptionEvent(
      makeSupabase(),
      subscriptionEvent({ kind: 'school_platform', school_id: 'any-school' }, STUDENT_PRICE_ID),
    )
    expect(writes).toHaveLength(0)
  })

  it('writes nothing when kind=org_platform is billed on the student price', async () => {
    await handleSubscriptionEvent(
      makeSupabase(),
      subscriptionEvent({ kind: 'org_platform', group_id: 'any-org' }, STUDENT_PRICE_ID),
    )
    expect(writes).toHaveLength(0)
  })

  it('writes nothing when school_platform arrives with no school_id at all', async () => {
    await handleSubscriptionEvent(makeSupabase(), subscriptionEvent({ kind: 'school_platform' }))
    expect(writes).toHaveLength(0)
  })

  it('ignores an unrecognised kind entirely', async () => {
    await handleSubscriptionEvent(makeSupabase(), subscriptionEvent({ kind: 'not_a_real_kind', school_id: 'any' }))
    expect(writes).toHaveLength(0)
  })
})
