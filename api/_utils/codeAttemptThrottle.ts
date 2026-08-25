/**
 * Shared code-attempt throttle (SEC-AUDIT-2026-08-18 Finding 2).
 *
 * The threat this exists for is written up in api/code/validate.ts in its own
 * words: an endpoint that answers "is this code good?" for any submitted string
 * is a code-enumeration oracle — the ~13.8M ABC-123 keyspace is sweepable, and
 * a hit yields an elevated-role invite (teacher/school_admin/govt_admin).
 *
 * The machinery is the one already in the estate: count recent rows in
 * `possession_mint_attempts` for this IP hash, refuse over the limit, and log
 * every attempt (429s included) so abuse is observable. Window and limit are
 * the SAME numbers as api/auth/possession-redeem.ts and api/code/validate.ts —
 * all three throttle the same codes against the same table, so if one changes
 * they all must.
 *
 * Finding 5 (the bucket key is a client-set header) is FIXED here as of
 * 2026-08-25 — see getClientIp below — and the three siblings that carried
 * byte-equivalent inline copies (api/code/validate.ts, api/auth/possession-redeem.ts,
 * api/try-link/validate.ts) now import from this module rather than duplicating
 * it, so there is exactly one bucket-key definition in the estate.
 */

import type { VercelRequest } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

export const RATE_WINDOW_MS = 15 * 60 * 1000
export const PER_IP_LIMIT = 10

/**
 * Redemption gets a wider window than minting or validation, because the
 * legitimate shape of the traffic is different: a teacher onboards a whole
 * class from one school building, so every student redeems a valid code
 * through a single NAT'd IP inside a few minutes. At PER_IP_LIMIT that
 * cohort is locked out on the eleventh child, holding a correct code.
 *
 * It still bounds the enumeration hole it was raised for, and it is worth
 * being straight about how much: a per-IP limit caps one address, and a
 * distributed attacker routes around it at any value — that was equally true
 * at 10. Against the ~13.8M ABC-123 keyspace, 120 per quarter-hour leaves a
 * single address around twelve days short of even one percent, on a table
 * that logs every attempt including the refusals. The limit exists to make
 * the endpoint useless as a quiet oracle, not to cap a school's morning.
 */
export const REDEEM_PER_IP_LIMIT = 120

/**
 * sha256-truncated, identical to possession-redeem.ts / validate.ts — IPs are
 * only ever stored hashed, and the hash must match across endpoints so one
 * machine's attempts correlate into a single bucket.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

/**
 * The throttle bucket key. FIXED 2026-08-25 (SEC-AUDIT-2026-08-18 Finding 5 =
 * AUTH-CORE-05 = ADMIN-ENT-06 = SEC25-A-01) by keying on platform-attested
 * sources only.
 *
 * What was wrong: this read `x-forwarded-for.split(',')[0]`, which is the entry
 * the ORIGINAL CLIENT wrote, and fell back to `x-real-ip`, which any client can
 * send. Both are attacker input, so an enumerating caller bought a fresh window
 * on every request simply by incrementing a header — and the window it defeated
 * is the only anti-enumeration control in front of api/code/redeem.ts, which
 * grants `platform_role = 'ssi_admin'`.
 *
 * What it reads now, in order:
 *   1. `x-vercel-forwarded-for` — set by the Vercel edge, which OVERWRITES rather
 *      than appends, so a caller cannot pre-seed it. Its leftmost entry is the
 *      platform's own view of the peer.
 *   2. `req.socket.remoteAddress` — transport truth, unforgeable by definition;
 *      the value when running outside Vercel (local dev, any other host).
 *   3. the literal 'unknown'.
 *
 * `x-forwarded-for` and `x-real-ip` are deliberately NOT consulted at all, not
 * even as a later fallback: a fallback an attacker can reach by suppressing the
 * headers above is not a fallback, it is the same hole one step down.
 *
 * On (3): 'unknown' is a real bucket, not an exemption. Everything that lands
 * there shares ONE window, which is strictly more restrictive than a per-IP one —
 * a missing platform header must never buy an unlimited allowance. In practice
 * it is unreachable on Vercel (the edge header is always present) and on any
 * normal socket, so the shared bucket cannot lock out real traffic.
 */
export function getClientIp(req: VercelRequest): string {
  // Defensive on `headers` itself: this runs before anything else on an
  // unauthenticated path, so a malformed request must produce a bucket, never
  // a thrown 500 that skips the throttle entirely.
  const headers = req?.headers ?? {}
  const vercelForwarded = (headers['x-vercel-forwarded-for'] as string | undefined)
    ?.split(',')[0]
    ?.trim()
  if (vercelForwarded) return vercelForwarded

  const socketAddr = (req as unknown as { socket?: { remoteAddress?: string } }).socket
    ?.remoteAddress
  if (socketAddr) return socketAddr

  return 'unknown'
}

/**
 * Outcomes that must NOT count toward the window (2026-07-20 ruling, carried
 * over verbatim from the siblings so this endpoint cannot re-open the bug next
 * door):
 *   - 'personal_signin' — a successful login on a personal link is not an
 *     enumeration attempt; counting it locks out a whole NAT'd office.
 *   - 'rate_limited_*' — a limiter counts actions, not its own refusals;
 *     counting them makes a block self-perpetuating under client retry.
 */
const UNCOUNTED_OUTCOMES = ['personal_signin', 'rate_limited_ip', 'rate_limited_code']

export interface AttemptFields {
  inviteCodeId?: string | null
  email?: string | null
  authUserId?: string | null
  ipHash: string
  outcome: string
  errorDetail?: string | null
}

/**
 * Audit row for the throttle. Best-effort: a logging failure must never break
 * the request it is observing.
 */
export async function logAttempt(
  supabase: SupabaseClient,
  label: string,
  fields: AttemptFields
): Promise<void> {
  try {
    const { error } = await supabase.from('possession_mint_attempts').insert({
      invite_code_id: fields.inviteCodeId ?? null,
      email: fields.email ?? null,
      auth_user_id: fields.authUserId ?? null,
      ip_hash: fields.ipHash,
      outcome: fields.outcome,
      error_detail: fields.errorDetail ?? null,
    })
    if (error) console.warn(`[${label}] Failed to log attempt:`, error.message)
  } catch (err) {
    console.warn(`[${label}] Failed to log attempt:`, err)
  }
}

/**
 * True when this IP has already spent its window. The current request is
 * deliberately not counted here — the caller logs it afterwards so the window
 * accumulates.
 */
export async function isIpOverLimit(
  supabase: SupabaseClient,
  ipHash: string,
  limit: number = PER_IP_LIMIT
): Promise<boolean> {
  let query = supabase
    .from('possession_mint_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
  for (const outcome of UNCOUNTED_OUTCOMES) query = query.neq('outcome', outcome)
  const { count } = await query.gte(
    'created_at',
    new Date(Date.now() - RATE_WINDOW_MS).toISOString()
  )
  return (count ?? 0) >= limit
}
