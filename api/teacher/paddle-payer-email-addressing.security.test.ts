/**
 * SECURITY AUDIT 2026-08-15 — finding SEC15-01 (high), and its FIX.
 *
 * ── THE HOLE ───────────────────────────────────────────────────────────────
 * The 2026-08-11 fix for ADMIN-ENT-01 / TENANCY-03 was real but incomplete. It
 * stopped `customData.school_id` — browser-composed — being the address of a
 * privileged write to `schools`. It replaced that with "the PAYER's own node",
 * resolved from the email on the Paddle customer record:
 *
 *     const customer = await paddle.customers.get(customerId)
 *     const payerEmail = (customer?.email || '').trim().toLowerCase()
 *     ... .from('learner_emails').select('learner_id').eq('email', payerEmail)
 *
 * That email is not a fact about the buyer. It is a field the buyer fills in at
 * checkout (useSchoolCheckout.ts passed `customer: { email }` straight from the
 * browser), and nothing in this repo — and nothing Paddle does before the
 * subscription-created webhook fires — proves the buyer owns that mailbox. So
 * the attack survived one substitution: know the victim admin's EMAIL rather
 * than their school UUID, which is the easier of the two to obtain. Price
 * unchanged at one legitimate £15 seat; payoff unchanged — the victim's billing
 * pointers overwritten, and a later cancellation flipping their school dark.
 *
 * ── THE FIX (A-123, 2026-08-16) ────────────────────────────────────────────
 * Tom scheduled the real fix with one binding condition: "making sure no-one's
 * access is removed". Both halves are asserted below.
 *
 * Identity is now established BEFORE money moves, not inferred afterwards.
 * api/billing/bind-customer.ts resolves the node from the caller's verified
 * Supabase session, binds a Paddle customer to it, and mints a server-SIGNED
 * checkout intent naming that node. The webhook resolves down a ladder of
 * claims the buyer cannot type (api/teacher/paddle-webhook.ts, THE BINDING
 * LADDER): the existing subscription binding, then the signed intent, then the
 * customer binding, then — fenced to nodes that hold nothing to lose — the
 * verified payer email. Anything else is refused and logged.
 *
 * And no legitimate node can lose access by it: a refusal writes NOTHING, one
 * subscription can never overwrite a row still live under another, and every
 * existing subscriber keeps resolving on the first rung, which is unchanged.
 *
 * Full write-up: docs/security-audit-2026-08-15/README.md
 *
 * NOTE ON SCOPE: these tests were written by the 2026-08-15 audit to
 * CHARACTERIZE the vulnerable behaviour. They are deliberately converted here
 * to assert the fixed behaviour, and access-preservation cases are added.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

/** The email the ATTACKER typed into the checkout. It belongs to the victim. */
const VICTIM_ADMIN_EMAIL = 'head@victim-school.example'
const VICTIM_ADMIN_LEARNER = 'learner-uuid-victim'
const VICTIM_ADMIN_AUTH_UID = 'auth-uid-victim'
const VICTIM_SCHOOL_ID = 'school-uuid-victim'

/**
 * Paddle returns whatever email the buyer supplied at checkout. The SDK is the
 * webhook's only source for it, so mocking it here is mocking exactly the
 * attacker-controlled channel.
 */
const customersGet = vi.fn(async () => ({ email: VICTIM_ADMIN_EMAIL }))
vi.mock('../_utils/paddle', () => ({
  paddle: { customers: { get: (...args: unknown[]) => customersGet(...(args as [])) } },
  webhookSecret: 'whsec_test',
}))

/** The live per-seat platform price — PRICE_CATALOG tier 'premium'. */
const PLATFORM_PRICE_ID = 'pri_01kqq85gvncyasfmfvvpcv1xfg'

interface Write { table: string; values: Record<string, unknown>; id: unknown }
let writes: Write[] = []

/**
 * A supabase double that answers exactly as the live DB would for a victim
 * school whose admin's email address is public knowledge:
 *   - no row is bound to the attacker's subscription id (they are new)
 *   - `learner_emails` knows the victim's address (every learner has their
 *     address there — the table is trigger-synced from auth.users)
 *   - the victim's learner row carries their auth uid
 *   - the victim admins their own school
 */
interface SupabaseOptions {
  /** The learner_emails rows the victim's address resolves to. Default: one
   *  verified row, i.e. the strongest case the attacker can hope for. */
  emailRows?: Array<{ learner_id: string; verified: boolean }>
  /** The victim school's own billing state. Default: a live, paying school
   *  bound to its OWN subscription — the case the finding is about. */
  victimBilling?: {
    provider_subscription_id: string | null
    provider_customer_id?: string | null
    platform_status: string | null
    platform_expires_at: string | null
  } | null
}

const VICTIM_LIVE_BILLING = {
  provider_subscription_id: 'sub_VICTIM_LEGITIMATE',
  provider_customer_id: 'ctm_VICTIM',
  platform_status: 'active',
  platform_expires_at: '2027-01-01T00:00:00Z',
}

function makeSupabase(opts: SupabaseOptions = {}) {
  const emailRows = opts.emailRows ?? [{ learner_id: VICTIM_ADMIN_LEARNER, verified: true }]
  const victimBilling = opts.victimBilling === undefined ? VICTIM_LIVE_BILLING : opts.victimBilling
  const from = (table: string) => {
    const builder: any = {}
    let pending: Record<string, unknown> | null = null
    const filters: Record<string, unknown> = {}

    const resolveRow = (): unknown => {
      if (table === 'schools') {
        // Ladder step 1: is anything bound to this subscription id? (For the
        // attacker's brand-new subscription: no. For the victim's own
        // renewal: yes, their school.)
        if ('provider_subscription_id' in filters) {
          return victimBilling?.provider_subscription_id === filters.provider_subscription_id
            ? { id: VICTIM_SCHOOL_ID }
            : null
        }
        // Ladder step 3: is anything bound to the attacker's customer id?
        if ('provider_customer_id' in filters) {
          return victimBilling?.provider_customer_id === filters.provider_customer_id
            ? { id: VICTIM_SCHOOL_ID }
            : null
        }
        // Ladder step 4: does the payer administer a school?
        if (filters.admin_user_id === VICTIM_ADMIN_AUTH_UID) return { id: VICTIM_SCHOOL_ID }
        // The guards' read of the candidate node's own billing state.
        if (filters.id === VICTIM_SCHOOL_ID) {
          return victimBilling ? { id: VICTIM_SCHOOL_ID, ...victimBilling } : null
        }
        return null
      }
      if (table === 'groups') return null
      if (table === 'user_tags') return null
      return null
    }

    builder.select = () => builder
    builder.is = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.in = (_col: string, _vals: unknown) => builder
    builder.maybeSingle = () => Promise.resolve({ data: resolveRow(), error: null })
    builder.single = () => Promise.resolve({ data: resolveRow(), error: null })
    builder.update = (values: Record<string, unknown>) => { pending = values; return builder }
    builder.insert = () => builder
    builder.upsert = () => builder
    builder.eq = (col: string, val: unknown) => {
      if (pending) { writes.push({ table, values: pending, id: val }); pending = null; return builder }
      filters[col] = val
      return builder
    }
    // Terminal await on a filtered select (learner_emails / learners lookups).
    builder.then = (resolve: any) => {
      if (table === 'learner_emails') {
        const hit = filters.email === VICTIM_ADMIN_EMAIL
        // The handler now filters on `verified` — model it, so a test that
        // supplies unverified rows really does see them filtered out.
        const rows = hit
          ? emailRows.filter((r) => !('verified' in filters) || r.verified === filters.verified)
          : []
        return resolve({ data: rows, error: null })
      }
      if (table === 'learners') {
        return resolve({ data: [{ user_id: VICTIM_ADMIN_AUTH_UID }], error: null })
      }
      return resolve({ data: [], error: null })
    }
    return builder
  }
  return { from } as any
}

let handleSubscriptionEvent: typeof import('./paddle-webhook').handleSubscriptionEvent

function attackerSubscription(customData: Record<string, unknown>, status = 'active') {
  return {
    id: 'sub_ATTACKER_NEW',
    status,
    customerId: 'ctm_ATTACKER',
    customData,
    currentBillingPeriod: { endsAt: '2026-09-15T00:00:00Z' },
    items: [{ price: { id: PLATFORM_PRICE_ID }, quantity: 1 }],
  }
}

beforeEach(async () => {
  writes = []
  customersGet.mockClear()
  handleSubscriptionEvent = (await import('./paddle-webhook')).handleSubscriptionEvent
})

describe('SEC15-01 — CLOSED: an email the buyer typed can no longer address a school', () => {
  // THE FINDING, now asserted the other way round. The attacker types the
  // victim admin's address at checkout and pays £15 with their own card. The
  // webhook still asks Paddle for "the payer's" email and still gets the
  // victim's — but the email is now the WEAKEST rung of the binding ladder,
  // and a weak claim may not touch a node that holds a live entitlement.
  it('SEC15-01: a £15 payment made under the victim admin’s email writes NOTHING to the victim’s school', async () => {
    await handleSubscriptionEvent(makeSupabase(), attackerSubscription({ kind: 'school_platform' }))

    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  // The victim's own binding is now protection, which is the whole point:
  // one subscription may never steal another's.
  it('SEC15-01: the victim’s existing Paddle binding is respected, not replaced', async () => {
    await handleSubscriptionEvent(makeSupabase(), attackerSubscription({ kind: 'school_platform' }))

    expect(writes).toHaveLength(0)
  })

  // The payoff is gone: the attacker's cancellation lands nowhere. This is
  // Tom's binding condition on A-123 made mechanical — no legitimate node may
  // lose access as a side effect of anything here.
  it('SEC15-01: the attacker’s cancellation can no longer flip the victim’s school dark', async () => {
    await handleSubscriptionEvent(
      makeSupabase(),
      attackerSubscription({ kind: 'school_platform' }, 'canceled'),
    )

    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  // Paddle MAY attach a checkout to a pre-existing customer record when the
  // buyer types an address that already has one. So the customer id is a weak
  // claim too, and is fenced identically — this is the substitution that would
  // otherwise re-key the finding a third time.
  it('SEC15-01: arriving on the victim’s OWN Paddle customer id is refused just the same', async () => {
    const sub = attackerSubscription({ kind: 'school_platform' })
    sub.customerId = 'ctm_VICTIM' // Paddle matched the typed address to the victim's customer

    await handleSubscriptionEvent(makeSupabase(), sub)

    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  // customData is genuinely ignored as an address — the 2026-08-11 fix holds on
  // its own terms, and this control keeps it true.
  it('CONTROL: the school named in customData is not the school written to', async () => {
    await handleSubscriptionEvent(
      makeSupabase(),
      attackerSubscription({ kind: 'school_platform', school_id: 'some-other-school' }),
    )

    expect(writes.find((w) => w.id === 'some-other-school')).toBeUndefined()
  })

  // ACCESS: the legitimate first purchase still works. A school that is not yet
  // subscribed has nothing to lose, so the legacy email path may still bind it
  // — which is what keeps a client running stale cached JS (no signed intent)
  // able to buy.
  it('ACCESS: an unsubscribed school can still be bound by the legacy email path', async () => {
    const supabase = makeSupabase({
      victimBilling: {
        provider_subscription_id: null,
        provider_customer_id: null,
        platform_status: 'cancelled',
        platform_expires_at: null,
      },
    })
    await handleSubscriptionEvent(supabase, attackerSubscription({ kind: 'school_platform' }))

    const write = writes.find((w) => w.table === 'schools')
    expect(write).toBeDefined()
    expect(write!.id).toBe(VICTIM_SCHOOL_ID)
    expect(write!.values.platform_status).toBe('active')
  })

  // ACCESS / GRANDFATHERING: every existing subscriber resolves on rung 1, the
  // subscription binding, which is untouched by all of this. Their renewals and
  // cancellations keep tracking exactly as before.
  it('ACCESS: an existing subscriber’s own renewal still resolves and still writes', async () => {
    const supabase = makeSupabase()
    const renewal = attackerSubscription({ kind: 'school_platform' })
    renewal.id = 'sub_VICTIM_LEGITIMATE' // the school's OWN subscription renewing
    renewal.customerId = 'ctm_VICTIM'

    await handleSubscriptionEvent(supabase, renewal)

    const write = writes.find((w) => w.table === 'schools')
    expect(write).toBeDefined()
    expect(write!.values.platform_status).toBe('active')
    // and the binding heals itself: the customer id is (re)written on every event
    expect(write!.values.provider_customer_id).toBe('ctm_VICTIM')
  })
})

describe('SEC15-04 — the email lookup ignores verification and multiplicity', () => {
  // SECURITY FINDING SEC15-04 (low, compounds SEC15-01): resolvePayerAuthUid
  // selects from `learner_emails` with no `.eq('verified', true)` even though
  // the column exists (supabase/schema.sql:7483), and then takes
  // `.map(l => l.user_id).find(Boolean)` — an ARBITRARY row — when the address
  // maps to several learners. CLAUDE.md records that multiple accounts per
  // person are intentional ("tester accounts — do NOT merge learners"), so a
  // multi-match is an expected state, not an anomaly, and which account wins is
  // decided by Postgres row order.
  // FIXED 2026-08-16 (A-123 step 1). `verified` is now required. An address
  // nobody proved they hold resolves to nothing — and resolving to nothing
  // writes NOTHING, which is the access-preserving half of the same change.
  it('SEC15-04: an UNVERIFIED learner_emails row no longer proves who paid — nothing is written', async () => {
    const supabase = makeSupabase({
      emailRows: [{ learner_id: VICTIM_ADMIN_LEARNER, verified: false }],
    })
    await handleSubscriptionEvent(supabase, attackerSubscription({ kind: 'school_platform' }))

    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  // Multiple accounts per person are INTENTIONAL (CLAUDE.md: tester accounts,
  // do not merge learners), so a multi-match is an expected state and picking
  // one by Postgres row order is not an answer on the money path.
  it('SEC15-04: a multi-learner match is REFUSED, not resolved arbitrarily — nothing is written', async () => {
    const supabase = makeSupabase({
      emailRows: [
        { learner_id: VICTIM_ADMIN_LEARNER, verified: true },
        { learner_id: 'learner-uuid-victim-tester-account', verified: true },
      ],
    })
    await handleSubscriptionEvent(supabase, attackerSubscription({ kind: 'school_platform' }))

    expect(writes.find((w) => w.table === 'schools')).toBeUndefined()
  })

  // ACCESS PRESERVATION (Tom's binding condition, 2026-08-16): a refusal must
  // mean "write nothing and log", never "write cancelled". Prove it on the
  // event that would otherwise be most destructive — a cancellation.
  it('ACCESS: a refused resolution on a CANCELLATION writes no downgrade at all', async () => {
    const supabase = makeSupabase({
      emailRows: [{ learner_id: VICTIM_ADMIN_LEARNER, verified: false }],
    })
    await handleSubscriptionEvent(
      supabase,
      attackerSubscription({ kind: 'school_platform' }, 'canceled'),
    )

    expect(writes).toHaveLength(0)
  })
})
