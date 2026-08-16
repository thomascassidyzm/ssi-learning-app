/**
 * A-123 (2026-08-16) — the FIX for SEC15-01, driven through the real
 * `handleSubscriptionEvent`.
 *
 * The sibling file (paddle-payer-email-addressing.security.test.ts) proves the
 * old email channel can no longer reach a node with anything to lose. This one
 * proves the replacement actually works, and that its two hard properties hold:
 *
 *   - a checkout addresses a node through a SERVER-SIGNED intent, minted by
 *     api/billing/bind-customer.ts from a verified session, so the address is
 *     no longer anything the buyer can type or edit;
 *   - the guards Tom's binding condition requires — never write a downgrade to
 *     a node you could not resolve, and never let one subscription steal
 *     another's live binding — hold on the school lane AND the learner lane.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/paddle', () => ({
  // No email is resolvable in this file: every resolution here must come from
  // the signed intent, or not happen at all.
  paddle: { customers: { get: async () => ({ email: 'nobody@example.invalid' }) } },
  webhookSecret: 'whsec_test',
}))

const PLATFORM_PRICE_ID = 'pri_01kqq85gvncyasfmfvvpcv1xfg'
const PREMIUM_PRICE_ID = PLATFORM_PRICE_ID // same 'premium' tier row in PRICE_CATALOG

const BUYER_SCHOOL_ID = 'school-uuid-buyer'
const VICTIM_SCHOOL_ID = 'school-uuid-victim'

interface Write { table: string; values: Record<string, unknown>; id: unknown }
let writes: Write[] = []

interface NodeBilling {
  provider_subscription_id: string | null
  provider_customer_id: string | null
  platform_status: string | null
  platform_expires_at: string | null
}

interface Options {
  /** schools rows by id. */
  schools?: Record<string, NodeBilling>
  /** The learner's existing subscriptions row, if any. */
  subscription?: { provider_subscription_id: string | null; status: string; plan_name: string } | null
}

const UNSUBSCRIBED: NodeBilling = {
  provider_subscription_id: null,
  provider_customer_id: 'ctm_BUYER',
  platform_status: 'trial',
  platform_expires_at: '2027-01-01T00:00:00Z',
}

const LIVE_UNDER_ANOTHER_SUB: NodeBilling = {
  provider_subscription_id: 'sub_VICTIM_LEGITIMATE',
  provider_customer_id: 'ctm_VICTIM',
  platform_status: 'active',
  platform_expires_at: '2027-01-01T00:00:00Z',
}

function makeSupabase(opts: Options = {}) {
  const schools = opts.schools ?? { [BUYER_SCHOOL_ID]: { ...UNSUBSCRIBED } }
  const subscription = opts.subscription === undefined ? null : opts.subscription

  const from = (table: string) => {
    const builder: any = {}
    let pending: Record<string, unknown> | null = null
    const filters: Record<string, unknown> = {}

    const resolveRow = (): unknown => {
      if (table === 'schools') {
        if ('provider_subscription_id' in filters) {
          const hit = Object.entries(schools).find(
            ([, n]) => n.provider_subscription_id && n.provider_subscription_id === filters.provider_subscription_id,
          )
          return hit ? { id: hit[0] } : null
        }
        if ('provider_customer_id' in filters) {
          const hit = Object.entries(schools).find(
            ([, n]) => n.provider_customer_id && n.provider_customer_id === filters.provider_customer_id,
          )
          return hit ? { id: hit[0] } : null
        }
        if (typeof filters.id === 'string' && schools[filters.id]) {
          return { id: filters.id, ...schools[filters.id] }
        }
        return null
      }
      if (table === 'learners') return { id: 'learner-uuid-victim' }
      if (table === 'subscriptions') {
        return subscription ? { id: 'sub-row-1', ...subscription } : null
      }
      return null
    }

    builder.select = () => builder
    builder.is = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.in = () => builder
    builder.maybeSingle = () => Promise.resolve({ data: resolveRow(), error: null })
    builder.single = () => Promise.resolve({ data: resolveRow(), error: null })
    builder.update = (values: Record<string, unknown>) => { pending = values; return builder }
    builder.insert = () => builder
    builder.upsert = (values: Record<string, unknown>) => {
      writes.push({ table, values, id: (values as any).learner_id })
      return builder
    }
    builder.eq = (col: string, val: unknown) => {
      if (pending) { writes.push({ table, values: pending, id: val }); pending = null; return builder }
      filters[col] = val
      return builder
    }
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }
  return { from } as any
}

let handleSubscriptionEvent: typeof import('./paddle-webhook').handleSubscriptionEvent
let mintBillingIntent: typeof import('../_utils/billingIntent').mintBillingIntent

function subscription(customData: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    id: 'sub_NEW',
    status: 'active',
    customerId: 'ctm_BUYER',
    customData,
    currentBillingPeriod: { endsAt: '2026-09-15T00:00:00Z' },
    items: [{ price: { id: PLATFORM_PRICE_ID }, quantity: 3 }],
    ...over,
  }
}

beforeEach(async () => {
  writes = []
  handleSubscriptionEvent = (await import('./paddle-webhook')).handleSubscriptionEvent
  mintBillingIntent = (await import('../_utils/billingIntent')).mintBillingIntent
})

describe('the signed checkout intent addresses the node', () => {
  it('writes to the node the SERVER signed, and to no other', async () => {
    const intent = mintBillingIntent({ scope: 'school', nodeId: BUYER_SCHOOL_ID, authUid: 'auth-buyer' })!
    const supabase = makeSupabase({
      schools: { [BUYER_SCHOOL_ID]: { ...UNSUBSCRIBED }, [VICTIM_SCHOOL_ID]: { ...LIVE_UNDER_ANOTHER_SUB } },
    })

    await handleSubscriptionEvent(
      supabase,
      // The browser also names a victim school in customData; it is ignored.
      subscription({ kind: 'school_platform', billing_intent: intent, school_id: VICTIM_SCHOOL_ID }),
    )

    const write = writes.find((w) => w.table === 'schools')
    expect(write).toBeDefined()
    expect(write!.id).toBe(BUYER_SCHOOL_ID)
    expect(write!.values.platform_status).toBe('active')
    expect(write!.values.teacher_seats).toBe(3)
  })

  // customData is browser-composed, so the token inside it must be worthless
  // unless we signed it. This is the whole reason for the signature.
  it('ignores a forged intent entirely — nothing resolves, nothing is written', async () => {
    const supabase = makeSupabase({
      schools: { [BUYER_SCHOOL_ID]: { ...UNSUBSCRIBED }, [VICTIM_SCHOOL_ID]: { ...LIVE_UNDER_ANOTHER_SUB } },
    })
    const forged =
      Buffer.from(JSON.stringify({ scope: 'school', nodeId: VICTIM_SCHOOL_ID, authUid: 'x', exp: Date.now() + 60_000 }))
        .toString('base64url') + '.deadbeef'

    await handleSubscriptionEvent(
      supabase,
      subscription({ kind: 'school_platform', billing_intent: forged }, { customerId: 'ctm_UNKNOWN' }),
    )

    expect(writes).toHaveLength(0)
  })

  // Even a genuinely signed intent cannot take a live subscription's node.
  // (You would have to be that node's own admin to mint one — but if a
  // legitimate admin double-buys, the honest answer is the same: refuse and
  // let a human sort it out, rather than silently repoint live billing.)
  it('refuses to bind a node still live under a DIFFERENT subscription, even with a valid intent', async () => {
    const intent = mintBillingIntent({ scope: 'school', nodeId: VICTIM_SCHOOL_ID, authUid: 'auth-victim' })!
    const supabase = makeSupabase({ schools: { [VICTIM_SCHOOL_ID]: { ...LIVE_UNDER_ANOTHER_SUB } } })

    await handleSubscriptionEvent(supabase, subscription({ kind: 'school_platform', billing_intent: intent }))

    expect(writes).toHaveLength(0)
  })

  it('refuses an intent minted for an ORG when the checkout claims a school', async () => {
    const intent = mintBillingIntent({ scope: 'org', nodeId: BUYER_SCHOOL_ID, authUid: 'auth-buyer' })!
    const supabase = makeSupabase()

    await handleSubscriptionEvent(supabase, subscription({ kind: 'school_platform', billing_intent: intent }))

    expect(writes).toHaveLength(0)
  })

  // ACCESS: a cancellation that resolves to nothing must write nothing. This is
  // the single most important property in the change — the failure mode Tom
  // named is precisely "someone's access gets removed".
  it('ACCESS: an unresolvable CANCELLATION writes no downgrade anywhere', async () => {
    const supabase = makeSupabase({
      schools: { [VICTIM_SCHOOL_ID]: { ...LIVE_UNDER_ANOTHER_SUB } },
    })

    await handleSubscriptionEvent(
      supabase,
      subscription({ kind: 'school_platform' }, { status: 'canceled', customerId: 'ctm_UNKNOWN' }),
    )

    expect(writes).toHaveLength(0)
  })
})

describe('the learner lane cannot have its live subscription stolen', () => {
  // The learner lane addresses its write by customData.supabase_user_id, which
  // the browser composes — the same trust mistake, keyed on a uuid instead of
  // an email. It has no pre-purchase row to hold a server-made binding, so it
  // is protected from the other side: a live row cannot be re-pointed.
  it('refuses to overwrite a subscriptions row live under a different subscription', async () => {
    const supabase = makeSupabase({
      subscription: {
        provider_subscription_id: 'sub_VICTIM_PREMIUM',
        status: 'active',
        plan_name: 'SSi Premium',
      },
    })

    await handleSubscriptionEvent(
      supabase,
      subscription(
        { kind: 'learner_premium', supabase_user_id: 'auth-uid-victim' },
        { items: [{ price: { id: PREMIUM_PRICE_ID }, quantity: 1 }] },
      ),
    )

    expect(writes.find((w) => w.table === 'subscriptions')).toBeUndefined()
  })

  // ACCESS: and therefore the attacker's later cancellation has nothing to land
  // on — the victim keeps their premium.
  it('ACCESS: the follow-up cancellation cannot flip the victim’s premium off', async () => {
    const supabase = makeSupabase({
      subscription: {
        provider_subscription_id: 'sub_VICTIM_PREMIUM',
        status: 'active',
        plan_name: 'SSi Premium',
      },
    })

    await handleSubscriptionEvent(
      supabase,
      subscription(
        { kind: 'learner_premium', supabase_user_id: 'auth-uid-victim' },
        { status: 'canceled', items: [{ price: { id: PREMIUM_PRICE_ID }, quantity: 1 }] },
      ),
    )

    expect(writes.find((w) => w.table === 'subscriptions')).toBeUndefined()
  })

  // ACCESS: the learner's OWN renewal still writes. The guard keys on "a
  // different subscription", not on "any existing row".
  it('ACCESS: the learner’s own renewal still writes', async () => {
    const supabase = makeSupabase({
      subscription: {
        provider_subscription_id: 'sub_NEW', // same subscription renewing
        status: 'active',
        plan_name: 'SSi Premium',
      },
    })

    await handleSubscriptionEvent(
      supabase,
      subscription(
        { kind: 'learner_premium', supabase_user_id: 'auth-uid-victim' },
        { items: [{ price: { id: PREMIUM_PRICE_ID }, quantity: 1 }] },
      ),
    )

    const write = writes.find((w) => w.table === 'subscriptions')
    expect(write).toBeDefined()
    expect(write!.values.provider_subscription_id).toBe('sub_NEW')
  })
})
