/**
 * Taking ownership of an unclaimed account — POST /api/auth/claim-account
 *
 * The other end of "pay first, verify later" (job #345). api/auth/buyer-account
 * hands a session to whoever types an address, and api/auth/possession-redeem
 * does the same for whoever spends an invite code — neither has proved the
 * mailbox. This is what happens when the person who OWNS that mailbox finally
 * signs in: everything minted before them dies.
 *
 * Called by the browser once, straight after any sign-in, from useAuth's single
 * SIGNED_IN chokepoint (packages/player-vue/src/auth/claimAccount.ts). It is
 * safe to call on every sign-in and on every account — an account with nothing
 * to claim gets a 200 and no writes.
 *
 * WHAT IT DESTROYS, when it fires:
 *   - the password, whoever set it. Rotated to a value nobody holds. The
 *     account holder sets a new one from Settings, which is the door they
 *     already have (useAuth.setPassword, `has_password`).
 *   - every session on the account, including the caller's own — a GLOBAL
 *     sign-out, so no still-unexpired access token survives either (verified
 *     live 2026-09-07: after a global sign-out another session's refresh token
 *     AND its access token both come back dead).
 * The caller is then handed a FRESH session, minted the same way
 * buyer-account mints one, so the person who just proved the mailbox stays
 * signed in and nobody else does.
 *
 * WHAT IT RECORDS: the address is now proved. `email_confirmed_manually`,
 * `learners.needs_verification = false` and the address appended to
 * `learners.verified_emails` — the same three api/email/verify.ts writes, for
 * the same reason and read by the same screens.
 *
 * IT LEAKS NOTHING. The caller is already authenticated as the account it is
 * asking about, so there is no address here it did not already hold a session
 * for, and no response that differs by whether some OTHER address exists.
 *
 * THE DECISION ITSELF IS NOT MADE HERE — it is api/_utils/unclaimedMint.ts's
 * `mayClaim`, so the rule has one home and is testable without a network.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'crypto'
import { applyCors } from '../_utils/cors'
import { getAuthUserId } from '../_utils/auth'
import {
  readUnclaimedMint,
  clearedUnclaimedMint,
  mayClaim,
} from '../_utils/unclaimedMint'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

/** Read `session_id` and `amr` out of an access token that getAuthUserId has
 *  ALREADY verified against GoTrue. Signature checking is not this function's
 *  job and must never be inferred from it — it is a payload read, nothing more. */
export function readVerifiedTokenClaims(token: string): { sessionId: string | null; amr: unknown } {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'))
    return {
      sessionId: typeof payload?.session_id === 'string' ? payload.session_id : null,
      amr: payload?.amr,
    }
  } catch {
    return { sessionId: null, amr: undefined }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  // Verified against GoTrue, not decoded and trusted.
  const userId = await getAuthUserId(req)
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }
  const token = String(req.headers.authorization || '').slice(7)
  const { sessionId, amr } = readVerifiedTokenClaims(token)

  const admin: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: found, error: readError } = await admin.auth.admin.getUserById(userId)
  if (readError || !found?.user) {
    console.error('[ClaimAccount] could not read the account:', readError)
    res.status(500).json({ error: 'Could not read your account.' })
    return
  }
  const user = found.user
  const marker = readUnclaimedMint(user as any)

  if (!mayClaim(marker, sessionId, amr)) {
    // Nothing to claim, or this is the minting session asking to be let off,
    // or a password sign-in asking to legitimise the credential it used.
    // All three are the same answer and none of them writes anything.
    res.status(200).json({ claimed: false })
    return
  }

  const email = (user.email || '').toLowerCase().trim()

  // 1. Kill every session on the account — the caller's own included, because
  //    a sweep with an exception in it is not a sweep. The caller gets a fresh
  //    one at step 3.
  //
  //    THIS RUNS FIRST, and the order is not arbitrary: signOut needs the
  //    caller's token to still be valid, and step 2's password change revokes
  //    it (measured 2026-09-07 — with the rotate first, this call came back
  //    400 and the owner was left holding nothing). If step 2 then fails, the
  //    marker is still set and every session is already dead, so the next
  //    sign-in claims again. Failing in that direction costs a sign-in;
  //    failing in the other would leave a live password behind.
  const { error: signOutError } = await admin.auth.admin.signOut(token, 'global')
  if (signOutError) {
    console.error('[ClaimAccount] global sign-out failed:', signOutError)
    res.status(500).json({ error: 'Could not secure your account. Please try again.' })
    return
  }

  // 2. Kill the password. Nobody holds this value, including us — it is
  //    generated, used once and dropped. `has_password:false` is what
  //    SettingsScreen reads to offer "set a password" again.
  const { error: rotateError } = await admin.auth.admin.updateUserById(userId, {
    password: randomBytes(48).toString('base64url'),
    email_confirm: true,
    user_metadata: {
      ...(user.user_metadata || {}),
      has_password: false,
      email_confirmed_manually: true,
    },
    app_metadata: clearedUnclaimedMint(user.app_metadata as any),
  })
  if (rotateError) {
    console.error('[ClaimAccount] could not rotate the planted credential:', rotateError)
    // REFUSE LOUDLY, and leave the marker standing so the next sign-in
    // retries. Reporting a claim we did not finish would leave the owner
    // believing the squatter is gone.
    res.status(500).json({ error: 'Could not secure your account. Please try again.' })
    return
  }

  // 3. Hand the mailbox owner a session of their own — the same mint
  //    buyer-account uses, and no mail is sent by it.
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  const hashedToken = (linkData as any)?.properties?.hashed_token as string | undefined
  if (linkError || !hashedToken) {
    console.error('[ClaimAccount] could not mint the replacement session:', linkError)
    // The account IS secured at this point — that is the part that mattered
    // and it is done. Say so, and let the browser send them back through
    // sign-in rather than pretending nothing happened.
    res.status(200).json({ claimed: true, session: null })
    return
  }
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: verifyData, error: verifyError } = await anonClient.auth.verifyOtp({
    token_hash: hashedToken,
    type: 'magiclink',
  })
  if (verifyError || !verifyData?.session) {
    console.error('[ClaimAccount] replacement session mint failed:', verifyError)
    res.status(200).json({ claimed: true, session: null })
    return
  }

  // 4. Record that the address is proved — the same three writes
  //    api/email/verify.ts makes, so the same screens read the same truth.
  //    Best-effort by design: the security work above is already committed and
  //    must not be undone by a bookkeeping failure.
  const { data: learnerRow } = await admin
    .from('learners')
    .select('id, verified_emails')
    .eq('user_id', userId)
    .maybeSingle()
  if (learnerRow) {
    const current: string[] = (learnerRow as any).verified_emails || []
    await admin
      .from('learners')
      .update({
        needs_verification: false,
        verified_emails: current.includes(email) ? current : [...current, email],
      })
      .eq('id', (learnerRow as any).id)
  }

  res.status(200).json({
    claimed: true,
    session: {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    },
  })
}
