/**
 * Svix webhook signature verification — the scheme Resend uses to sign its
 * delivery webhooks.
 *
 * Kept as its own unit, away from any handler, for the same reason the Paddle
 * verification is: a signature check that can only be exercised by booting a
 * serverless route does not get exercised. Everything here is pure.
 *
 * THE SCHEME (svix.com/docs/receiving/verifying-payloads):
 *   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
 *   signature      = base64( HMAC-SHA256( base64decode(secret after "whsec_"),
 *                                         signed content ) )
 * The `svix-signature` header is a space-separated list of `v<n>,<signature>`
 * pairs — a list because secrets can be rotated with both live at once — so a
 * match against ANY v1 entry passes.
 *
 * The timestamp is checked too. Without it a signature captured off the wire
 * stays valid forever, and this endpoint writes to a live table.
 */

import { createHmac, timingSafeEqual } from 'crypto'

/** Svix's own tolerance. Five minutes either way absorbs clock skew and retries. */
export const SVIX_TOLERANCE_MS = 5 * 60 * 1000

export interface SvixVerifyInput {
  /** The endpoint's signing secret, `whsec_…` (the prefix is optional). */
  secret: string
  /** Raw request body, byte-for-byte as received. A re-serialised object will not match. */
  body: string
  svixId: string | undefined
  svixTimestamp: string | undefined
  svixSignature: string | undefined
  /** Injectable for tests. */
  nowMs?: number
}

export type SvixVerifyResult = { ok: true } | { ok: false; reason: string }

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function verifySvixSignature(input: SvixVerifyInput): SvixVerifyResult {
  const { secret, body, svixId, svixTimestamp, svixSignature } = input
  const now = input.nowMs ?? Date.now()

  if (!secret) return { ok: false, reason: 'no signing secret configured' }
  if (!svixId || !svixTimestamp || !svixSignature) return { ok: false, reason: 'missing svix headers' }

  const tsSeconds = Number(svixTimestamp)
  if (!Number.isFinite(tsSeconds)) return { ok: false, reason: 'unparseable timestamp' }
  if (Math.abs(now - tsSeconds * 1000) > SVIX_TOLERANCE_MS) return { ok: false, reason: 'timestamp outside tolerance' }

  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let key: Buffer
  try {
    key = Buffer.from(raw, 'base64')
  } catch {
    return { ok: false, reason: 'malformed signing secret' }
  }
  if (key.length === 0) return { ok: false, reason: 'malformed signing secret' }

  const expected = createHmac('sha256', key)
    .update(`${svixId}.${svixTimestamp}.${body}`)
    .digest('base64')

  for (const part of svixSignature.split(' ')) {
    const comma = part.indexOf(',')
    if (comma < 0) continue
    if (part.slice(0, comma) !== 'v1') continue
    if (safeEqual(part.slice(comma + 1), expected)) return { ok: true }
  }
  return { ok: false, reason: 'signature mismatch' }
}
