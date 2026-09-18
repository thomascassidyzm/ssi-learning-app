/**
 * POST /api/auth/setup-mint — the school door's way in, with no code to type.
 *
 * WHY (Tom, 2026-09-18): "The account IS created. That is the whole point.
 * The account is created instantly. But the teacher does not know it because
 * they are being asked for the code still." Asking for a code already creates
 * the auth account (api/auth/send-code.ts mints through generateLink, which
 * creates the row), but the school itself waited on the six digits — and on a
 * school mail estate (Hwb, Microsoft 365) the six digits arrive late, twice,
 * or never. A head on hwbcymru.net sat as an unconfirmed shell for eight days
 * (job #186, production rows). This route removes the wait: the browser gets a
 * real session for the address the head typed, provisions the school, and
 * lands in the dashboard. The mailbox is proved LATER, from the banner in the
 * dashboard, through the existing api/email/verify.ts round trip — the same
 * "mint now, prove later" shape api/auth/possession-redeem.ts has used for
 * invited teachers since July, and the same needs-verification apparatus.
 *
 * WHAT IT DOES, in order:
 *   1. rate-limit per address and per network (possession_mint_attempts,
 *      `setupmint:` namespace, so no other limiter counts these rows)
 *   2. auth.admin.createUser({ email, email_confirm: false }) — no mail
 *   3. auth.admin.generateLink({ type: 'magiclink' }) — no mail
 *   4. an anon-key client verifyOtp({ token_hash }) server-side: a session
 *   5. stamp the mint UNCLAIMED (api/_utils/unclaimedMint.ts), then hand the
 *      session to the browser, which setSession()s it and provisions.
 * The door then asks send-code for the six digits as a COURTESY — that mint
 * happens after this one, so the code in the mail is the live one.
 *
 * SECURITY RAILS — "anyone can claim the domain" is the thing Tom is worried
 * about, and this is how the door stays open without handing over a school:
 *   - A CONFIRMED account is never minted a session here. Somebody has proved
 *     that mailbox; the only way in is the code. An address that already has a
 *     live account gets `existing: true` and the door falls back to the
 *     ordinary sign-in code with "welcome back" wording.
 *   - An UNCONFIRMED SHELL — created by a code request that nobody ever typed
 *     (the Hwb pattern) — IS adopted, because on this door a stranger could
 *     just as easily create a fresh account for that address; refusing the
 *     shell would protect nothing and would strand exactly the teachers this
 *     exists for. What protects the real owner is the unclaimed-mint marker:
 *     when they later sign in by RECEIVING MAIL at the address, from a session
 *     this mint did not hand out, they are shown the contest card and their
 *     "not me" destroys every credential the stranger planted
 *     (api/auth/claim-account.ts, minted_by 'setup_door' is contestable).
 *   - A session minted here carries user_metadata.onboarded_via='possession',
 *     so the account is UNPROVEN to every reader that already exists
 *     (useAuth needs_verification, the Teachers-page marker, the Settings
 *     "Verify now" row) — and api/onboarding/provision.ts does NOT claim the
 *     email domain for an unproven founding admin. The claim is written when
 *     the mailbox is proved (api/email/verify.ts). So a stranger typing
 *     head@school.wales gets a school called "My school" that vouches for
 *     nobody, and the real head's own sign-in by code evicts them.
 *   - Disposable domains and malformed addresses are refused outright.
 *   - Track-scoped: only the SCHOOL door uses this. The tutor and org doors
 *     keep the code at the door until their owners say otherwise.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { isValidEmailFormat, isDisposableEmailDomain } from '../_utils/emailValidation'
import { getClientIp } from '../_utils/codeAttemptThrottle'
import { buildUnclaimedMint, readSessionId } from '../_utils/unclaimedMint'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

/** The provenance stamped on every mint this route hands out. Named in
 *  CONTESTABLE_MINTS (unclaimedMint.ts) so the mailbox owner can evict it. */
export const SETUP_DOOR_MINT = 'setup_door'

const WINDOW_MS = 15 * 60 * 1000
/** Per address: a head retrying a broken signup, not a script. */
export const SETUP_MINT_PER_ADDRESS_LIMIT = 5
/** Per network: a whole school shares one NAT. */
export const SETUP_MINT_PER_IP_LIMIT = 30

const OUTCOME_MINTED = 'setup_mint_minted'
const OUTCOME_ADOPTED = 'setup_mint_adopted_shell'
const OUTCOME_EXISTING = 'setup_mint_existing'
const OUTCOME_ERROR = 'setup_mint_error'
const OUTCOME_RATE_LIMITED = 'rate_limited_setup_mint'

/** Namespaced hash, same argument as send-code.ts: rows here are never
 *  counted by the redemption, mint or sign-in-code limiters, nor theirs here. */
export function setupMintHash(value: string): string {
  return createHash('sha256').update(`setupmint:${value}`).digest('hex').slice(0, 16)
}

function isAlreadyRegisteredError(error: any): boolean {
  if (!error) return false
  if (error.code === 'email_exists') return true
  const msg = String(error.message || '').toLowerCase()
  return msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')
}

/**
 * A SHELL is an account nobody has ever been inside: never confirmed, never
 * signed in. That is exactly what a code request leaves behind when the code
 * never gets typed (send-code.ts creates the row on mint). Anything else —
 * confirmed, or signed in once — is somebody's account and is never minted
 * here.
 */
export function isUntouchedShell(user: { email_confirmed_at?: string | null; last_sign_in_at?: string | null } | null | undefined): boolean {
  if (!user) return false
  return !user.email_confirmed_at && !user.last_sign_in_at
}

async function mintSession(
  svc: SupabaseClient,
  email: string,
): Promise<{ session: { access_token: string; refresh_token: string }; userId: string } | { error: string }> {
  const { data: linkData, error: linkError } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
  const hashedToken = (linkData as any)?.properties?.hashed_token as string | undefined
  const userId = (linkData as any)?.user?.id as string | undefined
  if (linkError || !hashedToken || !userId) return { error: linkError?.message || 'generateLink returned no hashed_token' }
  // Anon-key client: GoTrue validates the token_hash whichever client presents
  // it, and refuses `email` beside `token_hash` (possession-redeem.ts, live
  // 2026-07-15).
  const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
  if (verifyError || !verifyData?.session) return { error: verifyError?.message || 'verifyOtp returned no session' }
  return {
    userId,
    session: { access_token: verifyData.session.access_token, refresh_token: verifyData.session.refresh_token },
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body || {}
  const raw = body.email
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!isValidEmailFormat(email)) return res.status(400).json({ error: 'Please check the email address.' })
  if (isDisposableEmailDomain(email)) return res.status(400).json({ error: 'Please sign up with a permanent email address.' })
  if (body.track !== 'school') return res.status(400).json({ error: 'This door is for schools.' })

  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    return res.status(503).json({ error: 'Setup not configured', fallback: true })
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ipHash = setupMintHash(getClientIp(req))
  const since = new Date(Date.now() - WINDOW_MS).toISOString()

  const log = async (outcome: string, authUserId: string | null = null, errorDetail?: string): Promise<void> => {
    try {
      await svc.from('possession_mint_attempts').insert({
        invite_code_id: null, ip_hash: ipHash, email, auth_user_id: authUserId, outcome,
        ...(errorDetail ? { error_detail: errorDetail.slice(0, 500) } : {}),
      })
    } catch { /* observability must never break a signup */ }
  }

  // Counting failures fail OPEN (an audit-table blip must not block a head);
  // a real over-limit is refused.
  const countSince = async (column: 'ip_hash' | 'email', value: string): Promise<number | null> => {
    const { count, error } = await svc
      .from('possession_mint_attempts')
      .select('id', { count: 'exact', head: true })
      .eq(column, value)
      .in('outcome', [OUTCOME_MINTED, OUTCOME_ADOPTED])
      .gte('created_at', since)
    if (error) return null
    return count ?? 0
  }
  const byAddress = await countSince('email', email)
  if (byAddress !== null && byAddress >= SETUP_MINT_PER_ADDRESS_LIMIT) {
    await log(OUTCOME_RATE_LIMITED)
    return res.status(429).json({ error: 'That address has been set up several times in the last few minutes. Give it a moment and try again.' })
  }
  const byNetwork = await countSince('ip_hash', ipHash)
  if (byNetwork !== null && byNetwork >= SETUP_MINT_PER_IP_LIMIT) {
    await log(OUTCOME_RATE_LIMITED)
    return res.status(429).json({ error: 'A lot of schools have been set up from this network just now. Give it a moment and try again.' })
  }

  try {
    // Create with no mail. email_confirm:false — the verifyOtp below still
    // marks the auth row confirmed (inherent to magic-link verification), so
    // "unproven" is read from user_metadata.onboarded_via, never from
    // email_confirmed_at, exactly as possession-redeem.ts documents.
    const { data: created, error: createError } = await svc.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: { onboarded_via: 'possession', setup_door: 'school' },
    })

    let userId: string | null = created?.user?.id ?? null
    let adopted = false

    if (createError || !userId) {
      if (!isAlreadyRegisteredError(createError)) {
        await log(OUTCOME_ERROR, null, createError?.message ?? 'createUser returned no user')
        return res.status(500).json({ error: 'Could not set up your account. Please try again.' })
      }
      // The address has a row. Shell (never confirmed, never signed in) →
      // adopt it. Anything else → somebody's account, sign in by code.
      const { data: linkData } = await svc.auth.admin.generateLink({ type: 'magiclink', email })
      const existingUser = (linkData as any)?.user as
        | { id: string; email_confirmed_at?: string | null; last_sign_in_at?: string | null; user_metadata?: Record<string, unknown> }
        | undefined
      if (!existingUser || !isUntouchedShell(existingUser)) {
        await log(OUTCOME_EXISTING, existingUser?.id ?? null)
        return res.status(200).json({ existing: true })
      }
      userId = existingUser.id
      adopted = true
      // Carry the unproven marker onto the shell; send-code's mint stamped none.
      const { error: metaErr } = await svc.auth.admin.updateUserById(userId, {
        user_metadata: { ...(existingUser.user_metadata || {}), onboarded_via: 'possession', setup_door: 'school' },
      })
      if (metaErr) {
        await log(OUTCOME_ERROR, userId, `shell metadata: ${metaErr.message}`)
        return res.status(500).json({ error: 'Could not set up your account. Please try again.' })
      }
      // The trigger seeded this learner as proven (verified_emails = [address]);
      // nothing has been proved. Best-effort — the metadata is the durable flag.
      await svc.from('learners').update({ needs_verification: true }).eq('user_id', userId).then(undefined, () => {})
    }

    const minted = await mintSession(svc, email)
    if ('error' in minted) {
      if (!adopted) await svc.auth.admin.deleteUser(userId).catch(() => {})
      await log(OUTCOME_ERROR, userId, minted.error)
      return res.status(500).json({ error: 'Could not sign you in. Please try again.' })
    }

    // Mark the mint unclaimed BEFORE handing the session over: nothing here
    // proved the address, and the real owner's mail-receipt sign-in must be
    // able to evict this session. A stamp that fails takes the mint with it.
    const sessionId = readSessionId(minted.session.access_token)
    const { data: fresh } = await svc.auth.admin.getUserById(userId)
    const { error: markError } = sessionId
      ? await svc.auth.admin.updateUserById(userId, {
          app_metadata: { ...((fresh?.user?.app_metadata as Record<string, unknown>) || {}), ...buildUnclaimedMint(sessionId, SETUP_DOOR_MINT) },
        })
      : { error: new Error('access token carried no session_id') as any }
    if (markError) {
      if (!adopted) {
        await svc.from('learners').delete().eq('user_id', userId).then(undefined, () => {})
        await svc.auth.admin.deleteUser(userId).catch(() => {})
      }
      await log(OUTCOME_ERROR, userId, `unclaimed-mint stamp: ${markError.message}`)
      return res.status(500).json({ error: 'Could not sign you in. Please try again.' })
    }

    await log(adopted ? OUTCOME_ADOPTED : OUTCOME_MINTED, userId)
    return res.status(200).json({ success: true, adopted, session: minted.session })
  } catch (err: any) {
    await log(OUTCOME_ERROR, null, err?.message ?? String(err))
    return res.status(500).json({ error: 'Internal server error' })
  }
}
