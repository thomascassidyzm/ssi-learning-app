/**
 * Join-code MINT rate limiting (SEC22-01 part 3).
 *
 * `public.generate_join_code()` mints an XXX-NNN join code from two
 * BEFORE-INSERT triggers — `tr_classes_join_code` on `classes` and
 * `tr_schools_join_code` on `schools`. So EVERY insert into either table
 * mints a fresh code, and any caller-driven route that inserts is a mint
 * faucet. This helper throttles the self-serve ones.
 *
 * It deliberately reuses the existing `possession_mint_attempts` table and
 * the house limiter shape from api/code/validate.ts and
 * api/auth/possession-redeem.ts (15-minute window, hashed IP, count rows,
 * 429, log the attempt). No new table, no new schema.
 *
 * ── Why the IP hash is NAMESPACED ────────────────────────────────────────
 * Both redemption limiters count rows by `ip_hash` alone:
 *
 *     .eq('ip_hash', hashIp(ip)).neq('outcome', 'personal_signin')
 *     .neq('outcome', 'rate_limited_ip').neq('outcome', 'rate_limited_code')
 *
 * They filter on OUTCOME only to drop two known classes, so any NEW outcome
 * written against the plain IP hash — including a mint attempt — would be
 * counted by them. A teacher creating 8 classes would then eat 8 of the 10
 * per-IP redemption attempts, and their students on the same school NAT
 * would start seeing "Too many attempts" on perfectly good join codes.
 * Those two files are out of scope for this change (owned elsewhere), so
 * the isolation has to come from this side.
 *
 * Hashing `mint:<ip>` instead of `<ip>` puts mint rows in a disjoint
 * keyspace: sha256('mint:' + ip) never equals sha256(ip), so the redemption
 * counters cannot see a mint row and this counter cannot see a redemption
 * row. Same column, same 16-hex format, same index — zero interference in
 * both directions. (The per-CODE redemption limiter is already safe: it
 * filters `invite_code_id`, which is NULL on every mint row.)
 *
 * ── Which outcomes count ─────────────────────────────────────────────────
 * The house rule from validate.ts applies unchanged: a limiter counts
 * ACTIONS, not its own REFUSALS. Counting `rate_limited_mint_*` rows would
 * make a block self-perpetuating — a retrying client keeps its own window
 * permanently full and the limit never drains. So the refusal outcomes are
 * excluded from the count, and callers must invoke this only once they are
 * actually about to mint (after auth, validation and cap checks), so a 400
 * or a 409 never burns a real teacher's budget either.
 */

import type { VercelRequest } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

export const MINT_RATE_WINDOW_MS = 15 * 60 * 1000

/**
 * Per-signed-in-user cap. The tightest honest key on these routes: they all
 * require auth, so the user id survives NAT and mobile-CGNAT in a way an IP
 * never does. 20 mints per 15 minutes is more than TWICE the entire
 * TEACHER_CLASS_CAP of 10 active classes, so a teacher who set up their whole
 * roster in one sitting — and archived and remade half of it — still never
 * touches it. A script farming codes gets 80/hour, which makes harvesting
 * pointless.
 */
export const MINT_PER_USER_LIMIT = 20

/**
 * Per-IP cap, deliberately generous because a whole school shares one NAT.
 * 100 per 15 minutes covers a staff-training session where 10 teachers each
 * build a full 10-class roster simultaneously — well past any real INSET day
 * — while still bounding an unauthenticated-looking flood to ~6/minute.
 * The per-user limit is the one that does the real work; this is the backstop
 * for an attacker cycling freshly minted accounts.
 */
export const MINT_PER_IP_LIMIT = 100

/** Outcome written for a class-creating (classes insert) mint. */
export const CLASS_MINT_OUTCOME = 'class_mint_attempt'
/** Outcome written for a school-creating (schools insert) mint. */
export const SCHOOL_MINT_OUTCOME = 'school_mint_attempt'

/** Refusal outcomes — logged for observability, never counted (see header). */
export const RATE_LIMITED_MINT_IP = 'rate_limited_mint_ip'
export const RATE_LIMITED_MINT_USER = 'rate_limited_mint_user'

function getClientIp(req: VercelRequest): string {
  return (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    'unknown'
  )
}

/**
 * Namespaced, truncated sha256 of the caller IP. Raw IPs are never stored.
 * The `mint:` prefix is what keeps mint rows out of the redemption limiters'
 * counts (and vice versa) — see the header.
 */
export function mintIpHash(req: VercelRequest): string {
  return createHash('sha256').update(`mint:${getClientIp(req)}`).digest('hex').slice(0, 16)
}

/**
 * Audit row for a mint attempt (allowed or refused), so abuse is observable
 * in the same place redemption abuse already is. Best-effort: a logging
 * failure must never break class or school creation.
 */
export async function logMintAttempt(
  supabase: SupabaseClient,
  fields: { ipHash: string; authUserId?: string | null; outcome: string },
): Promise<void> {
  try {
    const { error } = await supabase.from('possession_mint_attempts').insert({
      invite_code_id: null,
      ip_hash: fields.ipHash,
      auth_user_id: fields.authUserId ?? null,
      outcome: fields.outcome,
    })
    if (error) console.warn('[MintRateLimit] Failed to log attempt:', error.message)
  } catch (err) {
    console.warn('[MintRateLimit] Failed to log attempt:', err)
  }
}

export type MintRateLimitResult =
  | { ok: true }
  | { ok: false; status: 429; error: string }

/**
 * Enforce the mint throttle and record this attempt.
 *
 * Call it at the LAST moment before the insert that mints — after auth, after
 * body validation, after any cap/idempotence check that would have refused
 * anyway. On success it writes the attempt row itself (the counts above
 * deliberately exclude the current request), so the caller only has to honour
 * the refusal.
 *
 * Fails OPEN on a counting error: an infra blip on the audit table must not
 * block a teacher from creating a class.
 */
export async function enforceMintRateLimit(
  supabase: SupabaseClient,
  req: VercelRequest,
  userId: string | null,
  outcome: string,
): Promise<MintRateLimitResult> {
  const ipHash = mintIpHash(req)
  const since = new Date(Date.now() - MINT_RATE_WINDOW_MS).toISOString()

  if (userId) {
    const { count: userCount, error: userErr } = await supabase
      .from('possession_mint_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('auth_user_id', userId)
      .neq('outcome', RATE_LIMITED_MINT_IP)
      .neq('outcome', RATE_LIMITED_MINT_USER)
      .gte('created_at', since)

    if (!userErr && (userCount ?? 0) >= MINT_PER_USER_LIMIT) {
      await logMintAttempt(supabase, { ipHash, authUserId: userId, outcome: RATE_LIMITED_MINT_USER })
      return {
        ok: false,
        status: 429,
        error: 'You have created a lot of these very quickly. Please try again in a few minutes.',
      }
    }
  }

  const { count: ipCount, error: ipErr } = await supabase
    .from('possession_mint_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .neq('outcome', RATE_LIMITED_MINT_IP)
    .neq('outcome', RATE_LIMITED_MINT_USER)
    .gte('created_at', since)

  if (!ipErr && (ipCount ?? 0) >= MINT_PER_IP_LIMIT) {
    await logMintAttempt(supabase, { ipHash, authUserId: userId, outcome: RATE_LIMITED_MINT_IP })
    return {
      ok: false,
      status: 429,
      error: 'Too many have been created from this network just now. Please try again in a few minutes.',
    }
  }

  await logMintAttempt(supabase, { ipHash, authUserId: userId, outcome })
  return { ok: true }
}
