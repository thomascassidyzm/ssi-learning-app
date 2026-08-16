/**
 * SECURITY AUDIT 2026-08-15 — finding SEC15-01 (high).
 *
 * A follow-on audit of the 2026-08-11 fix for ADMIN-ENT-01 / TENANCY-03.
 *
 * The fix is real and it closes what it aimed at: the privileged write to
 * `schools` / `groups` is no longer addressed by `customData.school_id`, which
 * the browser composes. `resolveSchoolTarget` (api/teacher/paddle-webhook.ts)
 * now derives the target from (1) the row already bound to this Paddle
 * subscription id, else (2) "the PAYER's own node".
 *
 * SEC15-01 is about how step (2) decides who the payer is. It reads the email
 * off the Paddle customer record and looks that email up in `learner_emails`:
 *
 *     const customer = await paddle.customers.get(customerId)
 *     const payerEmail = (customer?.email || '').trim().toLowerCase()
 *     ... .from('learner_emails').select('learner_id').eq('email', payerEmail)
 *
 * That email is not a fact about the buyer. It is a field the buyer fills in at
 * checkout — the app's own checkout composes it in browser JS
 * (packages/player-vue/src/composables/useSchoolCheckout.ts:85,
 * `customer: { email }`), and nothing in this repo, and nothing Paddle does at
 * checkout time, proves the buyer owns the mailbox they typed. Paddle emails a
 * receipt there; it does not withhold the customer record until someone clicks
 * it, and the webhook fires on the payment, not on any later verification.
 *
 * So ADMIN-ENT-01 is re-keyed rather than closed. The attacker's prerequisite
 * changes from "know the victim school's UUID" to "know the victim school
 * admin's email address" — which is, if anything, the easier of the two to
 * obtain: it is on school websites, in signature blocks, and in every email
 * that admin has ever sent. The price is unchanged at one legitimate £15 seat.
 *
 * The consequence is unchanged too, because the write is unchanged
 * (paddle-webhook.ts, handleSchoolPlatformSubscription): the victim school's
 * `provider_subscription_id`, `provider_customer_id`, `platform_status`,
 * `platform_expires_at` and `teacher_seats` are overwritten with the attacker's,
 * and a subsequent cancellation writes `platform_status: 'cancelled'` onto the
 * victim.
 *
 * Note the first resolution step does not save the victim. A paying school
 * already carries its own `provider_subscription_id`; the attacker's new
 * subscription has a DIFFERENT id, so no binding matches, resolution falls
 * through to the email, and the write then REPLACES the victim's binding with
 * the attacker's.
 *
 * The secure shape is to stop treating an email as an identity claim: bind the
 * Paddle customer to a learner at checkout-creation time, server-side, from the
 * verified session of whoever opened the checkout (a `provider_customer_id` on
 * the learner/school row minted by an authenticated endpoint), and resolve the
 * webhook through that binding only. Failing that, at minimum require
 * `learner_emails.verified = true` and reject a multi-learner match, which
 * narrows the attack rather than closing it.
 *
 * Full write-up: docs/security-audit-2026-08-15/README.md
 *
 * NOTE ON SCOPE: this test characterises today's behaviour. It changes nothing.
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
}

function makeSupabase(opts: SupabaseOptions = {}) {
  const emailRows = opts.emailRows ?? [{ learner_id: VICTIM_ADMIN_LEARNER, verified: true }]
  const from = (table: string) => {
    const builder: any = {}
    let pending: Record<string, unknown> | null = null
    const filters: Record<string, unknown> = {}

    const resolveRow = (): unknown => {
      if (table === 'schools') {
        // Step 1 of resolveSchoolTarget: is anything bound to this sub id?
        if ('provider_subscription_id' in filters) return null
        // Step 2b: does the payer administer a school?
        if (filters.admin_user_id === VICTIM_ADMIN_AUTH_UID) return { id: VICTIM_SCHOOL_ID }
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

describe('SEC15-01 — the payer is resolved from a buyer-supplied email', () => {
  // SECURITY FINDING SEC15-01: the attacker names the victim admin's email at
  // checkout and pays with their own card. The webhook asks Paddle for "the
  // payer's" email, gets the victim's, and writes the attacker's billing
  // pointers onto the victim's school.
  it('SEC15-01: a £15 payment made under the victim admin’s email writes to the victim’s school (vulnerable, characterized)', async () => {
    await handleSubscriptionEvent(makeSupabase(), attackerSubscription({ kind: 'school_platform' }))

    const write = writes.find((w) => w.table === 'schools')
    expect(write).toBeDefined()
    expect(write!.id).toBe(VICTIM_SCHOOL_ID)
    expect(write!.values.provider_subscription_id).toBe('sub_ATTACKER_NEW')
    expect(write!.values.provider_customer_id).toBe('ctm_ATTACKER')
  })

  // The victim's own binding is not protection: it is overwritten by the same
  // write, so the attacker takes over the addressing for every later event.
  it('SEC15-01: the victim’s existing Paddle binding is replaced, not respected (vulnerable, characterized)', async () => {
    await handleSubscriptionEvent(makeSupabase(), attackerSubscription({ kind: 'school_platform' }))

    const write = writes.find((w) => w.table === 'schools')
    expect(write!.values.provider_subscription_id).not.toBe('sub_VICTIM_LEGITIMATE')
    expect(write!.values.teacher_seats).toBe(1) // the victim's seat count, clobbered
  })

  // And the payoff: cancelling the attacker's own subscription flips the
  // victim's school to `cancelled`, which the coverage gate turns into a
  // school-wide 403.
  it('SEC15-01: the attacker’s cancellation flips the victim’s school dark (vulnerable, characterized)', async () => {
    await handleSubscriptionEvent(
      makeSupabase(),
      attackerSubscription({ kind: 'school_platform' }, 'canceled'),
    )

    const write = writes.find((w) => w.table === 'schools')
    expect(write!.id).toBe(VICTIM_SCHOOL_ID)
    expect(write!.values.platform_status).toBe('cancelled')
  })

  // customData is genuinely ignored now — the 2026-08-11 fix holds on its own
  // terms. This test is the control that keeps that true while SEC15-01 is open.
  it('CONTROL: the school named in customData is not the school written to', async () => {
    await handleSubscriptionEvent(
      makeSupabase(),
      attackerSubscription({ kind: 'school_platform', school_id: 'some-other-school' }),
    )

    const write = writes.find((w) => w.table === 'schools')
    expect(write!.id).not.toBe('some-other-school')
  })

  it.todo(
    'SEC15-01: the Paddle customer should be bound to a learner server-side at checkout creation, ' +
      'from the verified session — never resolved after the fact from an email the buyer typed',
  )
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
