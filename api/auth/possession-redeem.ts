/**
 * Possession-based invite onboarding — POST /api/auth/possession-redeem
 *
 * docs/schools/email-deliverability-plan.md, Option A: school mail gateways
 * (Microsoft/Exchange Online education tenants, confirmed by header analysis
 * 2026-07-15) silently quarantine our OTP mail — a teacher can never receive
 * the code, so the OTP-gated redemption path is structurally dead for them.
 *
 * The invite LINK is already the real authorization boundary (nothing today
 * checks the typed OTP email against who the invite was meant for — see the
 * plan doc §Option A "Security delta"), so this endpoint establishes the
 * session directly from possession of a valid, non-exhausted invite code:
 *   1. validate the code (same checks as /api/code/validate, invite-only)
 *   2. auth.admin.createUser({ email, email_confirm: false }) — no email sent
 *   3. auth.admin.generateLink({ type: 'magiclink', email }) — no email sent
 *   4. an anon-key client calls auth.verifyOtp({ token_hash, type: 'magiclink' })
 *      server-side, minting a real session without ever emailing anyone
 * The browser then calls supabase.auth.setSession(...) with the returned
 * tokens and proceeds to POST /api/code/redeem exactly as the OTP path does
 * today — this endpoint only ever creates the ACCOUNT + SESSION, never
 * touches invite_codes.use_count or any role/grant logic.
 *
 * Security rails:
 *   - invite-code TYPES only (teacher/school_admin/school_admin_join/
 *     govt_admin/student) — ssi_admin/tester/god codes can't use this path.
 *   - an email that already has an account is NEVER minted a session here —
 *     that would be account takeover (anyone holding a leaked invite link
 *     could otherwise log in as any known email). It falls back to
 *     reason: 'already_registered' so the client offers sign-in-instead.
 *   - per-code and per-IP rate limiting (possession_mint_attempts), checked
 *     before the expensive admin API calls.
 *   - every attempt (blocked or not) is audit-logged; IP is stored hashed,
 *     never raw (same convention as api/try-link/validate.ts).
 *   - real-email enforcement (api/_utils/emailValidation.ts): format +
 *     disposable-domain blocklist are hard rejects; MX lookup is a soft
 *     signal (only a definitive "no mail exchanger" blocks — DNS flakiness
 *     fails open). None of this proves mailbox RECEIPT (this path never
 *     emails anyone, by design) — that's tracked separately as
 *     learners.needs_verification, set true for every possession
 *     account and cleared only by a completed round-trip through
 *     api/email/verify.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { isValidEmailFormat, isDisposableEmailDomain, hasMxRecord } from '../_utils/emailValidation'
import {
  getClientIp,
  hashIp,
  isIpOverLimit,
  logAttempt as logAttemptRow,
  type AttemptFields,
  PER_IP_LIMIT,
} from '../_utils/codeAttemptThrottle'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

// Only these invite types may onboard without ever proving mailbox receipt —
// the population the OTP gateway wall actually blocks. ssi_admin/tester/god
// codes (grant platform-level trust) stay OTP-only, deliberately.
const POSSESSION_ELIGIBLE_CODE_TYPES = new Set([
  'teacher',
  'school_admin',
  'school_admin_join',
  'govt_admin',
  'student',
])

// Link-auth (placeholder-email, no typed address) is for PUPILS only — young
// learners joining a class or group who have no email to give. Named roles
// (teacher/leader/school admin) always pass through the one identity-capture
// screen (name + email) on first redeem — founder ruling 2026-07-20: a
// teacher's account must be real (their name, their recorded email), never a
// link-<uuid> ghost. The client enforces this by never sending linkAuth for
// named roles; this set is the server-side guarantee.
const LINK_AUTH_ELIGIBLE_CODE_TYPES = new Set(['student'])

const RATE_WINDOW_MS = 15 * 60 * 1000
const PER_CODE_LIMIT = 20
// PER_IP_LIMIT, the bucket-key derivation (getClientIp/hashIp) and the audit-row
// writer now come from api/_utils/codeAttemptThrottle.ts. This file used to carry
// byte-equivalent inline copies — the third of the three places
// SEC-AUDIT-2026-08-18 Finding 5 lived — so they are deleted rather than fixed
// three times over.

// Placeholder email domain for link-auth (straight-in) accounts. When a
// teacher/admin/leader clicks their invite link, the LINK itself is the
// credential — we sign them straight in with no form (the founder's "magic
// link with a built-in token"). A brand-new user has no email to give at
// click-time, so the account is minted against a unique address at this
// domain, which never receives mail and is replaced when they add+verify a
// real email on first run (SettingsScreen.vue / api/email/verify.ts). Mirrored
// client-side as isPlaceholderEmail() in SettingsScreen.vue.
const LINK_AUTH_EMAIL_DOMAIN = 'invite.saysomethingin.app'

function isAlreadyRegisteredError(error: any): boolean {
  if (!error) return false
  if (error.code === 'email_exists') return true
  const msg = String(error.message || '').toLowerCase()
  return msg.includes('already been registered') || msg.includes('already registered') || msg.includes('already exists')
}

/** Thin label-binding wrapper over the shared audit writer. */
async function logAttempt(supabase: SupabaseClient, fields: AttemptFields): Promise<void> {
  return logAttemptRow(supabase, '[PossessionRedeem]', fields)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!supabaseServiceKey || !supabaseAnonKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const { code, email, displayName, linkAuth } = req.body || {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ success: false, error: 'Missing code' })
    return
  }

  // Link-auth (straight-in) mode: no client email — the invite link is the
  // credential. The placeholder address is generated only AFTER the code is
  // known-valid (below), so an invalid/guessed code never mints an account.
  // The typed-email path keeps all its format/disposable/MX guards.
  const isLinkAuth = linkAuth === true
  let normalizedEmail = ''
  if (!isLinkAuth) {
    if (!isValidEmailFormat(email)) {
      res.status(400).json({ success: false, error: 'Please enter a valid email address' })
      return
    }
    normalizedEmail = email.trim().toLowerCase()
    if (isDisposableEmailDomain(normalizedEmail)) {
      res.status(400).json({ success: false, error: 'Please use a real, permanent email address — disposable addresses aren\'t accepted.' })
      return
    }
  }
  const cleanDisplayName = typeof displayName === 'string' ? displayName.trim().slice(0, 100) : ''

  const strippedCode = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!strippedCode) {
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }

  const ipHash = hashIp(getClientIp(req))
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Per-IP rate limit first — cheapest check, blocks code-guessing sweeps
    // before we even touch invite_codes. Two outcome classes are EXCLUDED
    // from the count (live repro 2026-07-20: the acceptance walk
    // rate-limited itself, then stayed limited):
    //   1. 'personal_signin' — every login on a personal link is a
    //      possession mint; a founder demo or several people on one NAT
    //      must not burn the guessing budget by using their own links.
    //   2. 'rate_limited_*' — the refusals themselves. Counting them makes
    //      a block self-perpetuating: any client retrying keeps the window
    //      full forever. A limiter counts actions, not its own refusals.
    // Substantive attempts (invalid/expired/exhausted/minted/errors) all
    // still count, and the per-code limit below counts everything.
    if (await isIpOverLimit(supabase, ipHash, PER_IP_LIMIT)) {
      await logAttempt(supabase, { email: normalizedEmail, ipHash, outcome: 'rate_limited_ip' })
      res.status(429).json({ success: false, error: 'Too many attempts. Please try again later.' })
      return
    }

    // Same validation as /api/code/validate (forgiving match against the
    // service-role-only *_code_validation view).
    const { data: inviteRow } = await supabase
      .from('invite_code_validation')
      .select('id, code, code_type, metadata, max_uses, use_count, expires_at, is_active')
      .eq('code_normalized', strippedCode)
      .eq('is_active', true)
      .maybeSingle()

    if (!inviteRow) {
      await logAttempt(supabase, { email: normalizedEmail, ipHash, outcome: 'invalid_code' })
      res.status(200).json({ success: false, error: 'Invalid code' })
      return
    }

    if (inviteRow.expires_at && new Date(inviteRow.expires_at as string) <= new Date()) {
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'expired' })
      res.status(200).json({ success: false, error: 'Code expired' })
      return
    }
    if (inviteRow.max_uses !== null && (inviteRow.use_count as number) >= (inviteRow.max_uses as number)) {
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'exhausted' })
      res.status(200).json({ success: false, error: 'Code fully used' })
      return
    }
    if (!POSSESSION_ELIGIBLE_CODE_TYPES.has(inviteRow.code_type as string)) {
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'unsupported_code_type' })
      res.status(200).json({ success: false, error: 'This invite needs to be redeemed by email sign-in' })
      return
    }
    // Per-code rate limit — bounds abuse of a single leaked/guessed valid
    // code. Runs BEFORE the personal branch so a personal login link gets the
    // same brute-bounding as everything else (personal_signin DOES count
    // here — 20 logins/15min on one link is ample for a person, hostile to a
    // script). Refusal rows are excluded for the same
    // no-self-perpetuation reason as the per-IP limit above.
    const { count: codeCount } = await supabase
      .from('possession_mint_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('invite_code_id', inviteRow.id as string)
      .neq('outcome', 'rate_limited_ip')
      .neq('outcome', 'rate_limited_code')
      .gte('created_at', new Date(Date.now() - RATE_WINDOW_MS).toISOString())

    if ((codeCount ?? 0) >= PER_CODE_LIMIT) {
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'rate_limited_code' })
      res.status(429).json({ success: false, error: 'Too many attempts on this code. Please try again later.' })
      return
    }

    // PERSONAL links (species 1, founder-ruled 2026-07-20): the code is bound
    // at mint time to a PRE-PROVISIONED account (metadata.personal_auth_user_id,
    // written only by the admin-gated mint endpoint — never client-supplied).
    // Possession of the link IS that account's login: mint a session for the
    // stored user, zero screens. The already-registered takeover rail
    // deliberately does not apply — signing into this exact account is the
    // link's entire purpose, and the binding was authorized at mint.
    // Revocation (is_active), expiry and rate limits all still gate above.
    const personalUserId = (inviteRow as any).metadata?.personal_auth_user_id as string | undefined
    if (personalUserId) {
      const { data: personalUser } = await supabase.auth.admin.getUserById(personalUserId)
      const personalEmail = personalUser?.user?.email
      if (!personalEmail) {
        await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: null, ipHash, outcome: 'personal_account_missing' })
        res.status(200).json({ success: false, error: 'This link is no longer valid' })
        return
      }
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: personalEmail,
      })
      const hashedToken = (linkData as any)?.properties?.hashed_token
      if (linkError || !hashedToken) {
        console.error('[PossessionRedeem] personal generateLink failed:', linkError)
        await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: personalEmail, ipHash, outcome: 'error', authUserId: personalUserId, errorDetail: linkError?.message ?? 'generateLink returned no hashed_token' })
        res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' })
        return
      }
      const personalAnonClient = createClient(supabaseUrl, supabaseAnonKey)
      const { data: verifyData, error: verifyError } = await personalAnonClient.auth.verifyOtp({
        token_hash: hashedToken,
        type: 'magiclink',
      })
      if (verifyError || !verifyData?.session) {
        console.error('[PossessionRedeem] personal verifyOtp failed:', verifyError)
        await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: personalEmail, ipHash, outcome: 'mint_failed', authUserId: personalUserId, errorDetail: verifyError?.message ?? 'verifyOtp returned no session' })
        res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' })
        return
      }
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: personalEmail, ipHash, outcome: 'personal_signin', authUserId: personalUserId })
      res.status(200).json({
        success: true,
        personal: true,
        session: {
          access_token: verifyData.session.access_token,
          refresh_token: verifyData.session.refresh_token,
        },
      })
      return
    }

    if (isLinkAuth && !LINK_AUTH_ELIGIBLE_CODE_TYPES.has(inviteRow.code_type as string)) {
      // A named-role link redeemed without a typed email: the client should
      // have shown the identity-capture screen. Refuse the ghost mint and tell
      // it to capture — never create a link-<uuid> account for a teacher/
      // leader/admin.
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: null, ipHash, outcome: 'identity_required' })
      res.status(200).json({ success: false, reason: 'identity_required', error: 'This invite needs your name and email first' })
      return
    }

    // MX lookup is a SOFT signal only (see emailValidation.ts) — a definitive
    // "no mail exchanger" blocks; any DNS flakiness fails open rather than
    // stopping a legitimate teacher from onboarding. Skipped in link-auth mode:
    // the placeholder address is internal and never receives mail by design.
    if (!isLinkAuth) {
      // Bucketed on the same platform-attested IP hash the code throttle uses,
      // so one caller cannot drive unbounded outbound DNS (INPUT-11).
      const mxResult = await hasMxRecord(normalizedEmail, undefined, ipHash)
      if (mxResult === false) {
        await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'no_mx_domain' })
        res.status(400).json({ success: false, error: 'That email domain can\'t receive mail. Please check for a typo.' })
        return
      }
    }

    // Link-auth: the code is now known-valid, non-expired, non-exhausted and of
    // a supported type — mint the unique placeholder address for this account.
    if (isLinkAuth) {
      normalizedEmail = `link-${randomUUID()}@${LINK_AUTH_EMAIL_DOMAIN}`
    }

    // Create the account with no email sent. email_confirm:false — Supabase's
    // own verifyOtp call below will still mark the email confirmed at the
    // auth layer (that's inherent to how magic-link verification works), so
    // app-level "unverified" tracking deliberately does NOT read
    // email_confirmed_at — it reads user_metadata.onboarded_via (set once
    // here, untouched by anything else) instead. See SettingsScreen.vue and
    // learners.needs_verification (api/_utils/emailValidation.ts's
    // format/disposable/MX checks bound obvious junk at signup time; this
    // flag is the durable "never actually proved mailbox receipt" record).
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      email_confirm: false,
      user_metadata: {
        // Deliberately 'possession' for both paths — the whole needs-real-email
        // apparatus (useAuth.needs_verification, SettingsScreen's add-email
        // prompt, api/code/redeem.ts) keys off this exact value, and a link-auth
        // account needs that nudge MORE than a typed-email one, not less. The
        // separate link_auth flag is analytics-only.
        onboarded_via: 'possession',
        ...(isLinkAuth ? { link_auth: true } : {}),
        ...(cleanDisplayName ? { display_name: cleanDisplayName } : {}),
      },
    })

    if (createError || !created?.user) {
      if (isAlreadyRegisteredError(createError)) {
        await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'already_registered' })
        // Never mint a session for a pre-existing email through this
        // unauthenticated path — that would be account takeover.
        res.status(409).json({ success: false, reason: 'already_registered', error: 'An account already exists for this email. Please sign in instead.' })
        return
      }
      console.error('[PossessionRedeem] createUser failed:', createError)
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'error', errorDetail: createError?.message ?? 'createUser returned no user' })
      res.status(500).json({ success: false, error: 'Could not create account. Please try again.' })
      return
    }

    const newUserId = created.user.id

    // Mint a link, then immediately redeem it server-side — no email sent at
    // any point; this is the "no OTP round-trip" step.
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
    })
    const hashedToken = (linkData as any)?.properties?.hashed_token

    if (linkError || !hashedToken) {
      console.error('[PossessionRedeem] generateLink failed:', linkError)
      await supabase.auth.admin.deleteUser(newUserId).catch(() => {})
      await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'error', authUserId: newUserId, errorDetail: linkError?.message ?? 'generateLink returned no hashed_token' })
      res.status(500).json({ success: false, error: 'Could not set up your account. Please try again.' })
      return
    }

    // Anon-key client (not admin) mints the session — GoTrue validates the
    // token_hash regardless of which client presents it. GoTrue rejects the
    // call if `email` is passed alongside `token_hash` ("Only the token_hash
    // and type should be provided") — token_hash verification is meant to be
    // self-contained; confirmed live 2026-07-15 (repro against production
    // Supabase reproduced the exact mint_failed audit outcome, fixed by
    // dropping `email` here).
    const anonClient = createClient(supabaseUrl, supabaseAnonKey)
    const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    })

    if (verifyError || !verifyData?.session) {
      console.error('[PossessionRedeem] verifyOtp (session mint) failed:', verifyError)
      await supabase.auth.admin.deleteUser(newUserId).catch(() => {})
      await logAttempt(supabase, {
        inviteCodeId: inviteRow.id as string,
        email: normalizedEmail,
        ipHash,
        outcome: 'mint_failed',
        authUserId: newUserId,
        errorDetail: verifyError?.message ?? 'verifyOtp returned no session',
      })
      res.status(500).json({ success: false, error: 'Could not sign you in. Please try again.' })
      return
    }

    await logAttempt(supabase, { inviteCodeId: inviteRow.id as string, email: normalizedEmail, ipHash, outcome: 'minted', authUserId: newUserId })

    res.status(200).json({
      success: true,
      session: {
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
      },
    })
  } catch (error: any) {
    console.error('[PossessionRedeem] Error:', error)
    await logAttempt(supabase, { email: normalizedEmail, ipHash, outcome: 'error', errorDetail: error?.message ?? String(error) })
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
}
