/**
 * SEC22-05 — regression locks on the binding ladder, the fix for the critical
 * that the 2026-08-11 audit found twice (ADMIN-ENT-01 / TENANCY-03, then
 * SEC15-01 when the first fix was itself found bypassable).
 *
 * Audit 2026-08-22 (branch security/audit-2026-08-22). This file reports NO new
 * vulnerability. It exists because the finding was re-opened once already —
 * `customData.school_id` was replaced by "the payer's own node, resolved from
 * the Paddle customer's email", and the hijack survived one substitution
 * (type the victim's EMAIL instead of their UUID). A fix that has been bypassed
 * once deserves its invariants pinned, so the third version cannot be reached
 * by accident.
 *
 * VERDICT OF THIS AUDIT ON THE MONEY PATH: closed, and closed properly. The
 * address of a privileged billing write is now a server-signed token minted
 * from a verified session (api/_utils/billingIntent.ts), and the browser never
 * gets to name the node it is paying for. Two further things were checked by
 * hand and are locked below, because the ladder's soundness rests on them and
 * neither is obvious from reading the ladder itself:
 *
 *   1. Step 1 of the ladder ("some row already carries this subscription id")
 *      is deliberately UNGUARDED. That is only safe if `provider_subscription_id`
 *      cannot be attacker-influenced — i.e. if the webhook is its only writer.
 *      Verified 2026-08-22: it is. Every other reference in api/** reads it.
 *   2. Steps 3-4 rest on `provider_customer_id`, which must only ever be written
 *      from a SESSION-resolved node. Verified: exactly one writer,
 *      api/billing/bind-customer.ts, which resolves the node from the session
 *      and takes only `scope` from the body.
 *
 * If either invariant breaks, the ladder silently degrades back to "the buyer
 * can address the write" — which is the critical. These tests are the tripwire.
 *
 * Nothing here touches Paddle, the network or a database.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const apiRoot = resolve(here, '..')

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests'
})

/** Every non-test .ts file under api/. */
function apiSources(dir = apiRoot, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = resolve(dir, entry)
    if (statSync(full).isDirectory()) { apiSources(full, acc); continue }
    if (!entry.endsWith('.ts') || entry.includes('.test.')) continue
    acc.push(full)
  }
  return acc
}

/** Files whose source contains a PostgREST write of `column`. */
function writersOf(column: string): string[] {
  return apiSources().filter((file) => {
    const src = readFileSync(file, 'utf8')
    // A write is an object literal key in an .update()/.insert()/.upsert() payload.
    return new RegExp(`(update|insert|upsert)\\s*\\(\\s*\\{[^}]*\\b${column}\\s*:`, 's').test(src)
  }).map((f) => relative(apiRoot, f))
}

describe('SEC22-05: the trust roots the ladder rests on', () => {
  // INVARIANT 1. Step 1 returns a node with no guard applied at all, on the
  // reasoning that "this row IS this subscription's node, so there is nothing
  // to steal". True only while the webhook alone writes the column.
  it('provider_subscription_id is written ONLY by the Paddle webhook', () => {
    expect(writersOf('provider_subscription_id')).toEqual(['teacher/paddle-webhook.ts'])
  })

  // INVARIANT 2. Steps 3-4 address by customer id. That is a weaker claim than
  // a signature (Paddle may attach a customer to a checkout by email), which is
  // exactly why those steps are fenced to nodes holding no live entitlement —
  // but it still must never be settable from a request body.
  //
  // Two writers, and both are safe for DIFFERENT reasons — which is why this
  // asserts the exact set rather than a count. bind-customer.ts writes it from
  // a session-resolved node (below). paddle-webhook.ts writes it only inside
  // the update to a node the ladder has ALREADY resolved and guarded, so it
  // records the customer of a binding rather than establishing one. A THIRD
  // writer is the regression this is here to catch: any endpoint that sets this
  // column from request input re-opens steps 3-4 of the ladder.
  it('provider_customer_id has exactly two writers, both downstream of a resolved node', () => {
    expect(writersOf('provider_customer_id').sort()).toEqual([
      'billing/bind-customer.ts',
      'teacher/paddle-webhook.ts',
    ])
  })

  // The body of that one writer takes exactly one field, and it is not a node id.
  it('bind-customer takes only `scope` from the request body — never a node id', () => {
    const src = readFileSync(resolve(here, 'bind-customer.ts'), 'utf8')

    const bodyReads = [...src.matchAll(/req\.body[^\n]*/g)].map((m) => m[0])
    expect(bodyReads).toHaveLength(1)
    expect(bodyReads[0]).toContain('scope')

    // The node comes from the verified session's uid, on both branches.
    expect(src).toContain(".eq('admin_user_id', auth.userId)")
    expect(src).toContain('leaderGroupId(supabase as any, auth.userId)')
    // And the email is read from auth.users, never from the caller.
    expect(src).toContain('supabase.auth.admin.getUserById(auth.userId)')
    expect(src).not.toMatch(/req\.body[^\n]*email/)
  })

  // The original critical, stated as a test: the browser-composed field may
  // still be READ (it is logged, so a mis-wired client is visible), but it must
  // never reach a resolution path. `logTargetMismatch` is a logger.
  it('customData.school_id / group_id survive only as log material, never as an address', () => {
    const src = readFileSync(resolve(apiRoot, 'teacher/paddle-webhook.ts'), 'utf8')

    // Prose lines (the file documents the finding at length) are not uses.
    const codeLines = src
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))

    for (const field of ['school_id', 'group_id']) {
      const uses = codeLines.filter((l) => l.includes(`customData.${field}`)).map((l) => l.trim())
      expect(uses.length).toBeGreaterThan(0)
      // Every remaining use is an argument to the mismatch LOGGER.
      for (const use of uses) expect(use).toContain('logTargetMismatch')
    }
  })
})

describe('SEC22-05: the ladder\'s own refusals', () => {
  it('a signed intent for one scope cannot address the other scope', async () => {
    const { mintBillingIntent, verifyBillingIntent } = await import('../_utils/billingIntent')
    const token = mintBillingIntent({ scope: 'school', nodeId: 'n1', authUid: 'a1' })!

    // The token itself is honest about what it addresses; the webhook's
    // intentNode() compares this against the checkout's claimed scope and
    // refuses a mismatch.
    expect(verifyBillingIntent(token)!.scope).toBe('school')

    const src = readFileSync(resolve(apiRoot, 'teacher/paddle-webhook.ts'), 'utf8')
    expect(src).toContain('if (payload.scope !== scope)')
  })

  it('an expired intent resolves to nothing rather than degrading to a weaker claim', async () => {
    const { mintBillingIntent, verifyBillingIntent, BILLING_INTENT_TTL_MS } =
      await import('../_utils/billingIntent')
    const token = mintBillingIntent({ scope: 'school', nodeId: 'n1', authUid: 'a1' })!

    expect(verifyBillingIntent(token)).not.toBeNull()
    expect(verifyBillingIntent(token, Date.now() + BILLING_INTENT_TTL_MS + 1)).toBeNull()
  })

  // Tom's binding condition on A-123: no legitimate node may lose access as a
  // side effect of closing the hijack. These are the predicates that encode it.
  it('refuses to move a live binding from one subscription to another', async () => {
    const { wouldStealLiveBinding } = await import('../_utils/billingBinding')

    // The hijack shape: a brand-new subscription landing on an entitled row.
    expect(wouldStealLiveBinding({
      existingSubscriptionId: 'sub_victim',
      incomingSubscriptionId: 'sub_attacker',
      status: 'active',
      expiresAt: null,
    })).toBe(true)

    // The normal shapes that must keep working.
    expect(wouldStealLiveBinding({
      existingSubscriptionId: null,           // first purchase on a trial node
      incomingSubscriptionId: 'sub_new',
      status: 'trialing',
      expiresAt: null,
    })).toBe(false)
    expect(wouldStealLiveBinding({
      existingSubscriptionId: 'sub_same',     // this subscription's own renewal
      incomingSubscriptionId: 'sub_same',
      status: 'active',
      expiresAt: null,
    })).toBe(false)
  })

  it('a past-due or status-less node is treated as still entitled, so it cannot be taken', async () => {
    const { holdsLivePlatformEntitlement } = await import('../_utils/billingBinding')

    // Card being retried — Paddle has not finished with them, nor should we.
    expect(holdsLivePlatformEntitlement('past_due', null)).toBe(true)
    // Legacy / pre-migration row: fail OPEN (protected), never exposed.
    expect(holdsLivePlatformEntitlement(null, null)).toBe(true)
    expect(holdsLivePlatformEntitlement(undefined, undefined)).toBe(true)
  })
})
