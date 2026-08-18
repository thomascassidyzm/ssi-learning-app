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
 * Those two siblings predate this module and still carry their own inline
 * copies of hashIp/getClientIp/logAttempt. They are byte-equivalent to the
 * functions here; migrating them onto this module is the natural moment to fix
 * Finding 5 (the bucket key is a client-set header), which touches getClientIp
 * in all three at once. Deliberately not done here — this branch fixes
 * Findings 1 and 2 only, and Finding 5 stays red on purpose.
 */

import type { VercelRequest } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

export const RATE_WINDOW_MS = 15 * 60 * 1000
export const PER_IP_LIMIT = 10

/**
 * sha256-truncated, identical to possession-redeem.ts / validate.ts — IPs are
 * only ever stored hashed, and the hash must match across endpoints so one
 * machine's attempts correlate into a single bucket.
 */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16)
}

export function getClientIp(req: VercelRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    'unknown'
  )
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
