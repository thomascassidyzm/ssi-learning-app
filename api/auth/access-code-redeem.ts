/**
 * Staff access-code redemption — POST /api/auth/access-code-redeem
 *
 * The RETURN route. A school admin minted a short code for a colleague
 * (api/school/staff-signin-link.ts) and handed it over on a channel our email
 * cannot reach. This is where the teacher spends it.
 *
 * Tom's ruling, 2026-09-02: "one-off redemption — yes, but redeem into what?"
 * A code that lets somebody in ONCE has solved nothing; they are back at the
 * quarantined inbox the next time the session dies. So redemption mints a
 * DURABLE session — the app's normal long-lived one, the same one a password
 * sign-in yields — and the client's very next screen asks them to set a
 * credential they own. The code buys a standing seat, not a single entry.
 *
 * The mint is the shape possession-redeem.ts already proved out and which is
 * the whole reason no email is sent at any point:
 *   auth.admin.generateLink({ type: 'magiclink' })  → hashed_token, sends nothing
 *   anonClient.auth.verifyOtp({ token_hash })       → a real session
 * Deliberately NOT the `action_link` half of that response: an action_link
 * carries a `redirect_to` that Supabase only honours for allow-listed origins,
 * which is why an admin-minted link on the dev alias lands on production. A
 * token_hash has no origin in it, so this path is immune to that entirely.
 *
 * Rails:
 *   - SINGLE USE, enforced by an atomic claim UPDATE (`where redeemed_at is
 *     null`), not by a read-then-write. Two simultaneous redemptions cannot
 *     both win.
 *   - 48-hour expiry, checked in the same claim.
 *   - per-IP throttling on the SHARED bucket (api/_utils/codeAttemptThrottle),
 *     so this endpoint is no better an enumeration oracle than its siblings,
 *     and checked BEFORE any lookup.
 *   - every attempt, refusals included, audit-logged with a hashed IP.
 *   - the code is never compared in the clear: we look up its sha256.
 *   - a refusal never says WHICH of expired / used / unknown it was. All three
 *     get one message pointing at the admin, because distinguishing them tells
 *     an enumerator that a code existed.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { normaliseAccessCode, hashAccessCode } from '../_utils/accessCode'
import {
  getClientIp,
  hashIp,
  isIpOverLimit,
  logAttempt,
  PER_IP_LIMIT,
} from '../_utils/codeAttemptThrottle'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

const LABEL = '[AccessCodeRedeem]'

/**
 * One message for unknown, expired and already-used alike. A teacher's next
 * move is identical in all three cases — ask the person who gave it to them —
 * and telling an enumerator which of the three they hit is free intelligence.
 */
const REFUSAL =
  'That code has expired or has already been used. Ask whoever gave it to you for a new one — they can make another straight away.'

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    console.error(`${LABEL} Missing Supabase configuration`)
    res.status(500).json({ success: false, error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const ipHash = hashIp(getClientIp(req))

  try {
    // Throttle FIRST — before the lookup, so a sweeper never gets to spend our
    // database on guesses.
    if (await isIpOverLimit(supabase, ipHash, PER_IP_LIMIT)) {
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'rate_limited_ip' })
      res.status(429).json({ success: false, error: 'Too many attempts. Please wait a few minutes and try again.' })
      return
    }

    const code = normaliseAccessCode(req.body?.code)
    if (!code) {
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'access_code_malformed' })
      res.status(400).json({
        success: false,
        error: 'That does not look like an access code. It is 8 characters, like ABCD-EFGH.',
      })
      return
    }

    const codeHash = hashAccessCode(code)
    const nowIso = new Date().toISOString()

    // --- The atomic claim. This single UPDATE is the whole single-use rule. ---
    // Nothing above it may decide the code is good; a read-then-write here is
    // the classic double-redeem race, and this endpoint mints sessions.
    const { data: claimed, error: claimErr } = await supabase
      .from('staff_access_codes')
      .update({ redeemed_at: nowIso, redeemed_ip_hash: ipHash })
      .eq('code_hash', codeHash)
      .is('redeemed_at', null)
      .gt('expires_at', nowIso)
      .select('id, target_user_id, school_id')
      .maybeSingle()

    if (claimErr) {
      // Doubt refuses. A read error must never be read as "code is fine".
      console.error(`${LABEL} claim failed:`, claimErr.message)
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'error', errorDetail: claimErr.message })
      res.status(503).json({ success: false, error: 'Please try again in a moment.' })
      return
    }
    if (!claimed) {
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'access_code_rejected' })
      res.status(404).json({ success: false, error: REFUSAL })
      return
    }

    const targetUserId = String(claimed.target_user_id)

    const { data: targetUser, error: userErr } = await supabase.auth.admin.getUserById(targetUserId)
    const email = targetUser?.user?.email
    if (userErr || !email) {
      console.error(`${LABEL} target user has no email:`, userErr?.message)
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'error', authUserId: targetUserId, errorDetail: 'target has no email' })
      res.status(500).json({ success: false, error: 'Could not sign you in. Ask your school admin for a new code.' })
      return
    }

    // --- Mint the session. generateLink sends nothing; it hands us the token. ---
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const hashedToken = (linkData as any)?.properties?.hashed_token
    if (linkError || !hashedToken) {
      console.error(`${LABEL} generateLink failed:`, linkError)
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'error', email, authUserId: targetUserId, errorDetail: linkError?.message ?? 'no hashed_token' })
      res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' })
      return
    }

    // Anon-key client mints it. GoTrue rejects `email` alongside `token_hash`
    // ("Only the token_hash and type should be provided") — confirmed live
    // 2026-07-15 in possession-redeem.ts, and the same rule applies here.
    const anonClient = createClient(supabaseUrl, supabaseAnonKey)
    const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    })
    if (verifyError || !verifyData?.session) {
      console.error(`${LABEL} verifyOtp failed:`, verifyError)
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'mint_failed', email, authUserId: targetUserId, errorDetail: verifyError?.message ?? 'no session' })
      res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' })
      return
    }

    await logAttempt(supabase, LABEL, { ipHash, outcome: 'access_code_minted', email, authUserId: targetUserId })

    // Whether the client should put the set-a-credential screen in front of
    // them. Someone who already has a password has a way back in and does not
    // need asking again.
    const hasPassword = !!(verifyData.user?.user_metadata as any)?.has_password

    res.status(200).json({
      success: true,
      session: {
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
      },
      needs_credential: !hasPassword,
      email,
    })
  } catch (error: any) {
    console.error(`${LABEL} Error:`, error)
    try {
      await logAttempt(supabase, LABEL, { ipHash, outcome: 'error', errorDetail: String(error?.message || error) })
    } catch { /* logging must never mask the original failure */ }
    res.status(500).json({ success: false, error: 'Something went wrong. Please try again.' })
  }
}
