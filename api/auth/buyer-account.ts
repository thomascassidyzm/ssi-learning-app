/**
 * Buyer account minting — POST /api/auth/buyer-account
 *
 * WHY THIS EXISTS (Tom, 2026-09-07, walking the live Family purchase himself):
 *
 *   "clicked upgrade / Selected family plan / was asked to create an account /
 *    was sent an email / verified email with code / then got nothing"
 *   "if they opt to pay for a family account, they could then be asked for
 *    their email - but they shouldn't have to verify their email account yet -
 *    that's messy"
 *
 * Email verification was standing between a person who wanted to pay and
 * paying. This endpoint removes it: the buyer types their address (and, if
 * they want, a password), and gets an account and a real session back with NO
 * mail sent and no code to fetch. Paddle opens next, on the plan they already
 * chose.
 *
 * The mechanism is the one api/auth/possession-redeem.ts already proved in
 * production, minus the invite code:
 *   1. auth.admin.createUser({ email, email_confirm: false })  — sends nothing
 *   2. auth.admin.generateLink({ type: 'magiclink' })          — sends nothing
 *   3. an ANON-key client calls verifyOtp({ token_hash })      — a real session
 * The browser then calls supabase.auth.setSession(...) with the returned pair.
 *
 * VERIFICATION HAPPENS AFTER, NOT BEFORE. The account is stamped
 * user_metadata.onboarded_via = 'possession' and its learner row carries
 * needs_verification = true — the exact pair the existing add-and-verify
 * apparatus (useAuth, SettingsScreen's add-email prompt, api/email/verify.ts)
 * already keys off, and the durable record that this mailbox was never proved.
 *
 * BE CLEAR ABOUT WHAT learner_emails SAYS. The `sync_email_on_auth_user`
 * trigger writes learner_emails on every auth.users insert with
 * `verified = email_confirmed_at IS NOT NULL`, and this project's GoTrue
 * stamps email_confirmed_at at creation regardless of email_confirm:false —
 * measured live 2026-09-07. So an account minted here reads verified=true in
 * that table without anybody having proved receipt. That is NOT new: it is
 * exactly what api/auth/possession-redeem has done in production since July,
 * for the same reason and through the same trigger. It does mean the
 * webhook's email-based payer-resolution rail (SEC15-04) is weaker than its
 * own comment claims for possession-class accounts. Nothing in THIS flow
 * relies on it — the Family and Premium checkouts always carry
 * customData.supabase_user_id — but it is logged as an open question rather
 * than papered over. `needs_verification` is the field that tells the truth.
 *
 * Security rails, all carried over from possession-redeem:
 *   - AN ADDRESS THAT ALREADY HAS AN ACCOUNT IS NEVER MINTED A SESSION. That
 *     would be account takeover by anyone who can type an email. It comes back
 *     as 409 { reason: 'already_registered' } and the client offers a real
 *     sign-in (password, or the OTP modal) with the plan choice preserved.
 *   - real-email enforcement: format + disposable-domain blocklist are hard
 *     rejects; MX lookup is a SOFT signal (a definitive "no mail exchanger"
 *     blocks; DNS flakiness fails open).
 *   - rate limiting + audit through the shared possession_mint_attempts
 *     apparatus (api/_utils/mintRateLimit.ts), on its own namespaced IP hash
 *     and its own outcome, so it cannot eat anyone else's budget and no new
 *     table is needed.
 *   - a password, when given, is set at creation so it is a real credential
 *     the buyer holds next time. It is never logged.
 *   - THE ACCOUNT IS MINTED UNCLAIMED. Nothing above proves the address, so
 *     everything minted here — the password and this very session — is marked
 *     provisional in `app_metadata` and DIES the moment somebody signs in by
 *     receiving mail at it (api/_utils/unclaimedMint.ts,
 *     api/auth/claim-account.ts). Without that, typing a stranger's address
 *     planted a password and a session on it that survived the real owner's
 *     own sign-in for the life of the account — reproduced live, job #345,
 *     2026-09-07. The 409 below stops a squatter taking a LIVE account; this
 *     stops them holding one they got to first.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { isValidEmailFormat, isDisposableEmailDomain, hasMxRecord } from '../_utils/emailValidation'
import {
  enforceMintRateLimit,
  logMintAttempt,
  mintIpHash,
} from '../_utils/mintRateLimit'
import { buildUnclaimedMint } from '../_utils/unclaimedMint'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

/** Outcome written for a buyer-account mint. Its own value, so the existing
 *  limiters and dashboards can tell this traffic apart from class/school mints. */
export const BUYER_MINT_OUTCOME = 'buyer_account_mint'

/** Supabase's own floor is 6; we do not add a policy of our own on top of it. */
const MIN_PASSWORD_LENGTH = 6

function isAlreadyRegisteredError(error: any): boolean {
  if (!error) return false
  if (error.code === 'email_exists') return true
  const msg = String(error.message || '').toLowerCase()
  return (
    msg.includes('already been registered') ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    res.status(500).json({ success: false, error: 'Server misconfigured' })
    return
  }

  const body = (req.body || {}) as { email?: unknown; password?: unknown }
  const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' && body.password ? body.password : undefined

  if (!isValidEmailFormat(rawEmail)) {
    res.status(400).json({ success: false, error: 'Please check that email address.' })
    return
  }
  if (isDisposableEmailDomain(rawEmail)) {
    res.status(400).json({
      success: false,
      error: 'Please use an email address you can receive mail at — your receipt goes there.',
    })
    return
  }
  if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({
      success: false,
      error: `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`,
    })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)
  const ipHash = mintIpHash(req)

  // MX is a soft signal: only a definitive "this domain accepts no mail" blocks.
  const mx = await hasMxRecord(rawEmail, 2000, ipHash)
  if (mx === false) {
    await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_no_mx' })
    res.status(400).json({ success: false, error: 'That email domain does not accept mail. Please check it.' })
    return
  }

  // Last gate before the expensive admin calls — and it writes this attempt's
  // own audit row, so the throttle counts real mints rather than its refusals.
  const limit = await enforceMintRateLimit(supabase, req, null, BUYER_MINT_OUTCOME)
  if (!limit.ok) {
    res.status(limit.status).json({ success: false, error: limit.error })
    return
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: rawEmail,
    email_confirm: false, // nothing is sent, and nothing downstream trusts this address yet
    ...(password ? { password } : {}),
    user_metadata: {
      // 'possession' is deliberate and load-bearing: useAuth, SettingsScreen's
      // add-email prompt and api/code/redeem.ts all key the needs-a-real-email
      // nudge off this exact value. A buyer who never verified needs that
      // nudge more than anyone, not less. `purchase_intent` is analytics only.
      onboarded_via: 'possession',
      purchase_intent: true,
    },
  })

  if (createError || !created?.user) {
    if (isAlreadyRegisteredError(createError)) {
      // NEVER mint a session for a live pre-existing account on an
      // unauthenticated path — that is account takeover by anyone who can
      // type somebody's email. The client offers a real sign-in instead, and
      // the plan they chose survives it.
      await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_already_registered' })
      res.status(409).json({
        success: false,
        reason: 'already_registered',
        error: 'You already have an account with this email.',
      })
      return
    }
    console.error('[BuyerAccount] createUser failed:', createError)
    await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_error' })
    res.status(500).json({ success: false, error: 'We could not set up your account. Please try again.' })
    return
  }

  const newUserId = created.user.id

  // Roll back BOTH rows on a later failure. learners.user_id is a plain TEXT
  // column with no FK to auth.users, so deleting the auth user alone would
  // strand a learner row that every future sign-in on this address would then
  // silently adopt.
  const rollback = async () => {
    await supabase.from('learners').delete().eq('user_id', newUserId).then(undefined, () => {})
    await supabase.auth.admin.deleteUser(newUserId).catch(() => {})
  }

  // THE LEARNER ROW ALREADY EXISTS. The `on_auth_user_created` trigger on
  // auth.users inserts it (display_name = the address's local part), so this
  // stamps the one field the trigger cannot know: that nobody has ever proved
  // this mailbox. Verified live 2026-09-07 — an INSERT here fails 23505 on
  // learners_user_id_key every time, which is exactly how the first staging
  // walk of this endpoint died.
  //
  // It matters that the row is settled BEFORE Paddle opens: the webhook
  // resolves the payer by customData.supabase_user_id → learners.user_id, so
  // a purchase racing the row's creation would be a subscription written
  // nowhere.
  const { data: learnerRow, error: learnerError } = await supabase
    .from('learners')
    .update({ needs_verification: true })
    .eq('user_id', newUserId)
    .select('id')
    .maybeSingle()
  if (learnerError || !learnerRow) {
    console.error('[BuyerAccount] learner row not settled:', learnerError)
    await rollback()
    await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_error' })
    res.status(500).json({ success: false, error: 'We could not set up your account. Please try again.' })
    return
  }

  // Mint a link and redeem it here — no email is sent at any point.
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: rawEmail,
  })
  const hashedToken = (linkData as any)?.properties?.hashed_token as string | undefined
  if (linkError || !hashedToken) {
    console.error('[BuyerAccount] generateLink failed:', linkError)
    await rollback()
    await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_error' })
    res.status(500).json({ success: false, error: 'We could not set up your account. Please try again.' })
    return
  }

  // Anon-key client mints the session. GoTrue rejects `email` alongside
  // `token_hash` ("Only the token_hash and type should be provided") —
  // confirmed live 2026-07-15 on the possession path.
  const anonClient = createClient(supabaseUrl, supabaseAnonKey)
  const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
    token_hash: hashedToken,
    type: 'magiclink',
  })
  if (verifyError || !verifyData?.session) {
    console.error('[BuyerAccount] verifyOtp (session mint) failed:', verifyError)
    await rollback()
    await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_mint_failed' })
    res.status(500).json({ success: false, error: 'We could not sign you in. Please try again.' })
    return
  }

  // MARK THE MINT UNCLAIMED, naming the session we are about to hand out.
  // `app_metadata` because only the service role may write it — a marker the
  // account holder could clear through supabase.auth.updateUser() would be
  // cleared first by the one person it exists to stop.
  //
  // It has to happen HERE rather than at createUser: the id of the session
  // does not exist until the line above mints it. If the stamp fails we roll
  // the whole account back rather than return an UNMARKED session — an
  // unmarked mint is exactly the defect this closes.
  const mintSessionId = readSessionId(verifyData.session.access_token)
  const { error: markError } = mintSessionId
    ? await supabase.auth.admin.updateUserById(newUserId, {
        app_metadata: {
          ...((created.user.app_metadata as Record<string, unknown>) || {}),
          ...buildUnclaimedMint(mintSessionId, 'buyer_account'),
        },
      })
    : { error: new Error('access token carried no session_id') as any }
  if (markError) {
    console.error('[BuyerAccount] could not mark the mint unclaimed:', markError)
    await rollback()
    await logMintAttempt(supabase, { ipHash, outcome: 'buyer_account_error' })
    res.status(500).json({ success: false, error: 'We could not set up your account. Please try again.' })
    return
  }

  res.status(200).json({
    success: true,
    session: {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    },
  })
}

/** The `session_id` GoTrue stamps on every access token. Verified live
 *  2026-09-07: present on this project's tokens and stable across refresh. */
export function readSessionId(accessToken: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1] || '', 'base64').toString('utf8'))
    return typeof payload?.session_id === 'string' && payload.session_id ? payload.session_id : null
  } catch {
    return null
  }
}
