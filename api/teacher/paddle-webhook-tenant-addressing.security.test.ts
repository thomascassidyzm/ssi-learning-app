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
 * SECURITY FINDING TENANCY-03: the school row addressed by the write is taken
 * verbatim from client-supplied customData. Nothing ties the payer to that
 * school, so a paid checkout carrying a victim's uuid rewrites the victim's
 * billing pointers and platform status.
 *
 * WHAT SHOULD HAPPEN INSTEAD: the checkout should be minted by an authenticated
 * endpoint that has already proved the caller administers that school, with the
 * webhook resolving the target from that server-issued binding — or, minimally,
 * the handler should refuse to displace an existing, different
 * provider_subscription_id on the target row.
 */
describe('SECURITY FINDING TENANCY-03 — webhook addresses tenants from client-supplied customData', () => {
  it('writes an attacker’s subscription onto ANY school id given in customData (current behaviour)', async () => {
    await handleSubscriptionEvent(makeSupabase(), subscriptionEvent({
      kind: 'school_platform',
      school_id: 'victim-school-uuid', // ← attacker-chosen, never verified
    }))

    const write = writes.find((w) => w.table === 'schools')
    expect(write).toBeDefined()
    expect(write!.id).toBe('victim-school-uuid') // ← the defect
    expect(write!.values.provider_subscription_id).toBe('sub_ATTACKER')
    expect(write!.values.provider_customer_id).toBe('ctm_ATTACKER')
    expect(write!.values.platform_status).toBe('active')
  })

  it('a later cancellation flips the victim school dark (current behaviour)', async () => {
    const cancelled = subscriptionEvent({ kind: 'school_platform', school_id: 'victim-school-uuid' })
    cancelled.status = 'canceled'
    await handleSubscriptionEvent(makeSupabase(), cancelled)

    const write = writes.find((w) => w.table === 'schools')
    expect(write!.id).toBe('victim-school-uuid')
    // schoolCoverageGate then 403s `coverage_expired` across the school's surfaces.
    expect(write!.values.platform_status).toBe('cancelled')
  })

  it('the same hole addresses the groups table for orgs (current behaviour)', async () => {
    await handleSubscriptionEvent(makeSupabase(), subscriptionEvent({
      kind: 'org_platform',
      group_id: 'victim-org-uuid',
    }))

    const write = writes.find((w) => w.table === 'groups')
    expect(write).toBeDefined()
    expect(write!.id).toBe('victim-org-uuid') // ← the defect
    expect(write!.values.provider_subscription_id).toBe('sub_ATTACKER')
  })

  it.todo('TENANCY-03: school_id/group_id must be bound server-side at checkout, not read from customData')
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
