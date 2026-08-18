/**
 * The server-signed billing intent (A-123 / SEC15-01).
 *
 * This token is what replaces "an email the buyer typed" as the address of a
 * privileged billing write, so the properties that matter are: an honest token
 * verifies, a forged one does not, and an expired one does not. Nothing here
 * touches Paddle or the database.
 */
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests'
})

// Imported lazily so the env var above is in place when the module reads it.
async function mod() {
  return await import('./billingIntent')
}

describe('billing intent', () => {
  it('round-trips the node it was minted for', async () => {
    const { mintBillingIntent, verifyBillingIntent } = await mod()
    const token = mintBillingIntent({ scope: 'school', nodeId: 'school-1', authUid: 'auth-1' })!
    const payload = verifyBillingIntent(token)

    expect(payload).not.toBeNull()
    expect(payload!.nodeId).toBe('school-1')
    expect(payload!.scope).toBe('school')
    expect(payload!.authUid).toBe('auth-1')
  })

  // THE POINT OF THE WHOLE MECHANISM: the buyer can edit customData in the
  // browser, so a token whose body says "the victim's school" must not verify
  // unless it was signed by us.
  it('refuses a body that was edited after signing', async () => {
    const { mintBillingIntent, verifyBillingIntent } = await mod()
    const token = mintBillingIntent({ scope: 'school', nodeId: 'attacker-school', authUid: 'auth-1' })!
    const [, sig] = token.split('.')

    const forgedBody = Buffer.from(
      JSON.stringify({ scope: 'school', nodeId: 'VICTIM-school', authUid: 'auth-1', exp: Date.now() + 60_000 }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(verifyBillingIntent(`${forgedBody}.${sig}`)).toBeNull()
  })

  it('refuses a token with no signature, a junk signature, or junk entirely', async () => {
    const { verifyBillingIntent } = await mod()
    expect(verifyBillingIntent('')).toBeNull()
    expect(verifyBillingIntent('not-a-token')).toBeNull()
    expect(verifyBillingIntent('body.deadbeef')).toBeNull()
    expect(verifyBillingIntent(undefined)).toBeNull()
    expect(verifyBillingIntent({ nodeId: 'school-1' })).toBeNull()
  })

  it('refuses an expired token', async () => {
    const { mintBillingIntent, verifyBillingIntent, BILLING_INTENT_TTL_MS } = await mod()
    const mintedAt = 1_700_000_000_000
    const token = mintBillingIntent({ scope: 'school', nodeId: 'school-1', authUid: 'auth-1' }, mintedAt)!

    expect(verifyBillingIntent(token, mintedAt + BILLING_INTENT_TTL_MS - 1)).not.toBeNull()
    expect(verifyBillingIntent(token, mintedAt + BILLING_INTENT_TTL_MS + 1)).toBeNull()
  })
})
