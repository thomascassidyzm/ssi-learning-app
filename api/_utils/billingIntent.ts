/**
 * The BILLING INTENT token — a server-signed statement of "this checkout is for
 * THIS node, opened by THIS session", minted before the checkout opens and
 * verified when the webhook arrives.
 *
 * WHY A TOKEN AND NOT JUST A CUSTOMER BINDING (A-123 / SEC15-01, 2026-08-16).
 *
 * The audit's prescription was to bind the Paddle customer to the node
 * server-side before money moves, and have the webhook resolve only through
 * that binding. That is right, and api/billing/bind-customer.ts does it. But a
 * customer id is only as unforgeable as Paddle's own customer semantics: a
 * hosted checkout opened with `customer: { email }` may be ATTACHED by Paddle
 * to a pre-existing customer record with that address. If it is, an attacker
 * who types a victim's address can arrive at the webhook already carrying the
 * victim's customer id — and a webhook that trusts the customer id as an
 * address is hijacked again, one substitution further along. That is precisely
 * the failure mode this whole finding is: an identity claim that the buyer can
 * type.
 *
 * A token signed with a server-only secret has no such dependency. The buyer
 * cannot type it, cannot guess it, and cannot mint it — only an authenticated
 * session on our own endpoint can, and that endpoint resolves the node from the
 * session rather than from anything the caller sent. So the webhook gets an
 * address it can actually trust, and the fix stops resting on an assumption
 * about somebody else's product.
 *
 * The secret is DERIVED from SUPABASE_SERVICE_ROLE_KEY rather than being a new
 * env var, deliberately: a new required secret that nobody set in production is
 * a way for this change to break real checkouts, which is the one thing it must
 * not do. The service key is server-only, always present wherever these two
 * files run, and never leaves the server — the derived key is one-way, so the
 * token cannot leak it.
 *
 * The token is short-lived. It addresses a checkout the buyer is opening now.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

/** A checkout intent is good for one hour — long enough for a hesitant buyer,
 *  short enough that a leaked token is not a standing capability. */
export const BILLING_INTENT_TTL_MS = 60 * 60 * 1000

export interface BillingIntentPayload {
  /** 'school' | 'org' — which table the node lives in. */
  scope: string
  /** The node id: schools.id or groups.id. */
  nodeId: string
  /** The auth uid of the session that opened the checkout (audit trail). */
  authUid: string
  /** Expiry, epoch ms. */
  exp: number
}

function signingKey(): string | null {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!serviceKey) return null
  return createHmac('sha256', serviceKey).update('ssi-billing-intent-v1').digest('hex')
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(body: string, key: string): string {
  return b64url(createHmac('sha256', key).update(body).digest())
}

/** Mint a token for a node resolved from a verified session. Returns null when
 *  the server has no signing material — the caller then fails closed. */
export function mintBillingIntent(
  payload: Omit<BillingIntentPayload, 'exp'>,
  nowMs: number = Date.now(),
): string | null {
  const key = signingKey()
  if (!key) return null
  const full: BillingIntentPayload = { ...payload, exp: nowMs + BILLING_INTENT_TTL_MS }
  const body = b64url(Buffer.from(JSON.stringify(full), 'utf8'))
  return `${body}.${sign(body, key)}`
}

/**
 * Verify a token. Returns the payload only when the signature is valid AND the
 * token has not expired; null otherwise — and a null is always treated by the
 * caller as "resolve nothing and write nothing", never as a downgrade.
 */
export function verifyBillingIntent(
  token: unknown,
  nowMs: number = Date.now(),
): BillingIntentPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const key = signingKey()
  if (!key) return null

  const idx = token.lastIndexOf('.')
  const body = token.slice(0, idx)
  const provided = token.slice(idx + 1)
  const expected = sign(body, key)

  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const json = Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const payload = JSON.parse(json) as BillingIntentPayload
    if (!payload?.nodeId || !payload?.scope) return null
    if (!Number.isFinite(payload.exp) || payload.exp <= nowMs) return null
    return payload
  } catch {
    return null
  }
}
