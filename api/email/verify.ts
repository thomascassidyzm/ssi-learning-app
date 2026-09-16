/**
 * POST /api/email/verify
 *
 * Verifies an OTP for a new email and adds it to the learner's verified_emails.
 * Uses the service role to verify the OTP server-side so the client session
 * isn't disrupted.
 *
 * Body: { email: string, token: string }
 * Auth: Bearer token (current user's JWT)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../_utils/cors'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAuthUserId } from '../_utils/auth'
import {
  getClientIp,
  hashIp,
  logAttempt,
  RATE_WINDOW_MS,
} from '../_utils/codeAttemptThrottle'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * AUTH-CORE-04 — a local budget on OTP guesses.
 *
 * Every {email, token} pair used to be relayed straight to GoTrue with no
 * counter of our own, so an attacker's guesses against a 6-digit code shared
 * whatever budget GoTrue applies globally rather than being isolated per
 * caller. Counted on BOTH axes, because they defeat different attacks:
 *   - per target email: stops one mailbox being ground down from many sessions;
 *   - per account (auth_user_id): stops one signed-in account grinding many
 *     mailboxes, which is the shape that matters here — this endpoint attaches
 *     a verified email to the CALLER's learner row.
 * Refusals are excluded from the window for the reason the sibling endpoints
 * exclude them: a limiter that counts its own refusals never drains.
 */
const OTP_ATTEMPT_LIMIT = 10

async function otpAttemptsOverLimit(
  admin: SupabaseClient,
  column: 'email' | 'auth_user_id',
  value: string
): Promise<boolean> {
  const { count } = await admin
    .from('possession_mint_attempts')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .eq('outcome', 'email_verify_attempt')
    .gte('created_at', new Date(Date.now() - RATE_WINDOW_MS).toISOString())
  return (count ?? 0) >= OTP_ATTEMPT_LIMIT
}

/**
 * The tables a learner leaves footprints in. A stub minted by the sign-in
 * code path has none of these; a real second account has at least one, or
 * carries more than the one address, or its auth user is somebody else's.
 */
const ACTIVITY_TABLES = ['sessions', 'course_enrollments', 'lego_progress', 'seed_progress'] as const

async function isAbsorbableStub(
  admin: SupabaseClient,
  learnerId: string,
  stubUserId: string,
  email: string
): Promise<boolean> {
  const { data: row, error } = await admin
    .from('learners')
    .select('verified_emails')
    .eq('id', learnerId)
    .maybeSingle()
  if (error || !row) return false
  const emails: string[] = (row.verified_emails || []).map((e: string) => e.toLowerCase().trim())
  if (emails.length !== 1 || emails[0] !== email) return false

  const { data: stubUser } = await admin.auth.admin.getUserById(stubUserId)
  if (stubUser?.user?.email?.toLowerCase().trim() !== email) return false

  for (const table of ACTIVITY_TABLES) {
    const { count, error: countErr } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('learner_id', learnerId)
    if (countErr || (count ?? 0) > 0) return false
  }
  const { count: tagCount, error: tagErr } = await admin
    .from('user_tags')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', stubUserId)
  if (tagErr || (tagCount ?? 0) > 0) return false
  return true
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cross-origin (native shell) policy + preflight. No-op same-origin.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Verify the requesting user is authenticated
  const userId = await getAuthUserId(req)
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' })
  }

  const { email, token } = req.body || {}

  // INPUT-07: a shaped body ({email: {...}}) used to reach .toLowerCase() and
  // throw a raw TypeError out of the handler — an opaque 500 with a stack
  // trace in the logs, where the honest answer is a 400. Type-check before
  // touching either value.
  if (typeof email !== 'string' || typeof token !== 'string' || !email || !token) {
    return res.status(400).json({ error: 'Missing email or token' })
  }

  const normalizedEmail = email.toLowerCase().trim()

  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Server configuration error' })
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey)
  // A SECOND client, used for nothing but the OTP round-trip.
  //
  // supabase-js keeps the session a successful verifyOtp returns ON THE
  // CLIENT IT WAS CALLED ON, and every later PostgREST call from that client
  // then goes out as that user instead of as the service role. When the code
  // being verified belongs to the CALLER's own primary email that is
  // invisible — same person either way. When it belongs to a SECOND address,
  // the session is the address's own stub, and the rest of this handler ran
  // as the stub under own-row RLS: it could delete the stub's learner row and
  // then could not see the caller's, so every genuine second-email link
  // ended in 404 "Learner not found" (staging, 2026-09-16, job #998 — the
  // fix that shipped for job #646 got as far as absorbing the stub and no
  // further). Keeping the OTP on its own client keeps `admin` the service
  // role for the whole request.
  const otpClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const ipHash = hashIp(getClientIp(req))

  try {
    if (
      (await otpAttemptsOverLimit(admin, 'email', normalizedEmail)) ||
      (await otpAttemptsOverLimit(admin, 'auth_user_id', userId))
    ) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' })
    }
    // Logged BEFORE the guess is relayed, so a crash mid-verify still spends
    // the budget — a limiter that only counts completed attempts can be
    // drained by abandoning requests.
    await logAttempt(admin, '[email/verify]', {
      email: normalizedEmail,
      authUserId: userId,
      ipHash,
      outcome: 'email_verify_attempt',
    })

    // Verify the OTP server-side, on otpClient, so the session it returns
    // cannot follow `admin` into the queries below. This confirms the person
    // has access to this email without affecting their browser session.
    const { error: verifyError } = await otpClient.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: 'email',
    })

    if (verifyError) {
      return res.status(400).json({ error: verifyError.message || 'Invalid code' })
    }

    // OTP is valid — check this email isn't already linked to a DIFFERENT learner.
    //
    // AUTH-CORE-06: this was `.single()` with the error discarded. `.single()`
    // errors on zero rows AND on two-or-more, so once two learners already
    // held an address the probe returned no data and the guard silently
    // stopped firing for a third — the collision check failed OPEN precisely
    // in the case it exists for. `.limit(1).maybeSingle()` returns the first
    // colliding row instead of erroring, and the error branch now refuses
    // rather than being dropped: an unreadable learners table must not read as
    // "no collision".
    const { data: existingLearner, error: collisionError } = await admin
      .from('learners')
      .select('id, user_id')
      .contains('verified_emails', [normalizedEmail])
      .limit(1)
      .maybeSingle()

    if (collisionError) {
      console.error('[email/verify] Collision probe failed:', collisionError)
      return res.status(503).json({ error: 'Verification unavailable, please try again' })
    }

    if (existingLearner && existingLearner.user_id !== userId) {
      // Is the "other account" real, or the stub this very flow just minted?
      //
      // api/auth/send-code.ts mints the code with generateLink({type:'magiclink'}),
      // which CREATES an auth.users row for an address nobody has seen before,
      // and the on_auth_user_created trigger (handle_new_user) then inserts a
      // learners row carrying verified_emails=[that address]. So by the time
      // the person types the code, a brand-new address ALREADY "belongs to
      // another account" — an empty one, seconds old, created by us — and the
      // collision guard refused every fresh link (Tom, 2026-09-14, production:
      // thomas.cassidy+ssi_2 refused as "already linked to another account").
      //
      // A stub is absorbed, not refused: it must hold ONLY this address, its
      // auth user must BE this address, and it must carry no learner data at
      // all. Anything else is a genuine second account and stays a 409.
      const stub = await isAbsorbableStub(admin, existingLearner.id, existingLearner.user_id, normalizedEmail)
      if (!stub) {
        return res.status(409).json({
          error: 'This email is already linked to another account',
          code: 'email_on_other_account',
        })
      }
      // learners(id) is the CASCADE root for every learner-scoped table
      // (learner_emails included), and auth.users has no FK to learners, so
      // both deletes are needed and this order leaves nothing behind.
      const { error: stubLearnerErr } = await admin.from('learners').delete().eq('id', existingLearner.id)
      if (stubLearnerErr) {
        console.error('[email/verify] Could not remove stub learner:', stubLearnerErr)
        return res.status(503).json({ error: 'Verification unavailable, please try again' })
      }
      const { error: stubUserErr } = await admin.auth.admin.deleteUser(existingLearner.user_id)
      if (stubUserErr) console.warn('[email/verify] Stub auth user not removed (non-fatal):', stubUserErr.message)
    }

    // Add the email to this learner's verified_emails
    const { data: learner } = await admin
      .from('learners')
      .select('id, verified_emails')
      .eq('user_id', userId)
      .single()

    if (!learner) {
      return res.status(404).json({ error: 'Learner not found' })
    }

    const currentEmails: string[] = learner.verified_emails || []
    if (!currentEmails.includes(normalizedEmail)) {
      const updated = [...currentEmails, normalizedEmail]
      const { error: updateError } = await admin
        .from('learners')
        .update({ verified_emails: updated })
        .eq('id', learner.id)

      if (updateError) {
        return res.status(500).json({ error: updateError.message })
      }
    }

    // Possession-onboarded accounts (api/auth/possession-redeem.ts) carry
    // user_metadata.onboarded_via='possession' and start with no proof their
    // typed email is receive-capable. verified_emails can't record that proof
    // on its own — useAuth.ts's ensureLearnerExists() unconditionally
    // back-fills the session's own email into verified_emails on every load
    // (it treats "has a valid session as this email" as sufficient), which
    // would silently launder an unproven possession email into "verified"
    // the moment the browser next loads, regardless of whether this endpoint
    // ever ran. A completed OTP round-trip through THIS endpoint, for the
    // account's OWN primary email, is the one signal that only happens on
    // genuine mailbox receipt — recorded as a durable flag nothing else
    // touches, so SettingsScreen.vue's "unverified" badge can rely on it.
    const { data: authUser } = await admin.auth.admin.getUserById(userId)
    if (authUser?.user?.email?.toLowerCase().trim() === normalizedEmail) {
      await admin.auth.admin.updateUserById(userId, {
        user_metadata: { ...(authUser.user?.user_metadata || {}), email_confirmed_manually: true },
      })
      // Mirror onto learners.needs_verification — the admin-facing /
      // other-team-facing signal, kept in sync so nothing has to join out to
      // auth.users metadata to read it. Best-effort: the metadata flag above
      // is already the durable source of truth.
      const { error: clearErr } = await admin
        .from('learners')
        .update({ needs_verification: false })
        .eq('user_id', userId)
      if (clearErr) console.warn('[email/verify] Failed to clear needs_verification (non-fatal):', clearErr.message)
    }

    return res.status(200).json({ success: true, email: normalizedEmail })
  } catch (err: any) {
    console.error('[email/verify] Error:', err)
    return res.status(500).json({ error: 'Verification failed' })
  }
}
