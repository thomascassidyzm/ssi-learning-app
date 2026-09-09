/**
 * Named seats — POST /api/school/named-seat
 *
 * MECHANISM B of the school-belonging design
 * (docs/auth/school-belonging-design-2026-09-09.md). The admin types a NAME,
 * not an address, and gets an 8-character code to hand over on the school's
 * own channel: Teams, a slip of paper, a voice across the staffroom. The
 * teacher spends it on any device, with any address or none, and arrives
 * already vouched and attached to the name the admin typed.
 *
 * WHY A NAME AND NOT AN ADDRESS. Every other way in asks a school to reach a
 * teacher through a mailbox we cannot reach. School gateways quarantine our
 * mail structurally — a real Chepstow teacher's sign-in code was eaten twice —
 * so the only reliable channel to a teacher is the one their admin already
 * has. This endpoint sends nothing to anybody. It produces an artefact the
 * admin carries.
 *
 * HOW IT IS BUILT, and why this shape. The seat is a REAL account from the
 * moment it is named: a shell auth user on the same placeholder address
 * api/auth/possession-redeem.ts already mints for link-auth arrivals, a
 * learner row carrying the typed name, and a SCHOOL: teacher tag added_by the
 * admin. Then the ordinary staff access-code machinery mints against it.
 *
 * That buys three things for no new machinery at all:
 *   - the seat appears on the Teachers page the instant it is named, under
 *     "Not yet given classes", so an admin can give it classes BEFORE the
 *     person arrives — which is the whole thing B has that A does not;
 *   - it is revocable with the Remove button that already exists;
 *   - reissuing a lost code is the existing "Access code" button on that row,
 *     which supersedes the old one. No second reissue path to maintain.
 * Redemption is api/auth/access-code-redeem.ts, entirely unchanged.
 *
 * CONTAINMENT for a seat with nobody behind it. staff-signin-link.ts has to
 * ask hard questions about its target, because that target is a pre-existing
 * account that might reach further than the caller. Here the account does not
 * exist until this endpoint makes it, in this school, with the teacher role
 * and nothing else — so there is no power to inherit and nothing to step up
 * to. That is a stronger guarantee than the check it replaces, not a weaker
 * one. The caller must still be a school admin, and the seat is created at
 * their own school, resolved from their verified identity and never from the
 * request body.
 *
 * The rails that DO carry over, unweakened: single-use, 48-hour expiry,
 * hash-only storage, a per-caller rate limit shared with staff-signin-link so
 * the two cannot be used to lap each other, and an audit that FAILS CLOSED —
 * if the audit table cannot be read we refuse rather than mint unbounded
 * credentials.
 *
 * Whoever holds the code becomes that seat, once. That caveat is load bearing
 * and is shown in the UI, not buried here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { verifyAuthToken } from '../_utils/auth'
import { schoolMembershipsOf, type SchoolMembership } from '../_utils/schoolStaff'
import { getAppOrigin } from '../_utils/appOrigin'
import {
  ACCESS_CODE_TTL_MS,
  accessCodeUrl,
  formatAccessCode,
  generateAccessCode,
  hashAccessCode,
} from '../_utils/accessCode'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Same placeholder domain link-auth arrivals get — never a real mailbox. */
const SEAT_EMAIL_DOMAIN = 'invite.saysomethingin.app'

const RATE_WINDOW_MS = 15 * 60 * 1000
/** Shared with staff-signin-link, counted across BOTH event types. */
const PER_CALLER_LIMIT = 10

const MINT_EVENTS = ['school_signin_link_minted', 'school_named_seat_minted']

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/named-seat] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  // A name, and nothing else. Never an address — asking for one would put the
  // school's mail gateway back in the middle of the only channel that works.
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ').slice(0, 100) : ''
  if (!name) {
    res.status(400).json({ error: 'Type the name of the person this code is for.' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const memberships = await schoolMembershipsOf(supabase, auth.userId)
    const callerSchoolId = memberships.find((m: SchoolMembership) => m.role === 'admin')?.schoolId ?? null
    if (!callerSchoolId) {
      res.status(403).json({ error: 'Only a school admin can create a code for a new teacher' })
      return
    }

    // Rate limit BEFORE anything is created. Fails closed: a quota that
    // evaporates when the database misbehaves is not a quota.
    const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const { count: recentCount, error: rateErr } = await supabase
      .from('player_events')
      .select('id', { count: 'exact', head: true })
      .in('event_type', MINT_EVENTS)
      .gte('occurred_at', cutoff)
      .contains('payload', { actor_user_id: auth.userId })

    if (rateErr) {
      console.error('[school/named-seat] rate-limit check failed — refusing:', rateErr.message)
      res.status(503).json({ error: 'Please try again in a moment.' })
      return
    }
    if ((recentCount ?? 0) >= PER_CALLER_LIMIT) {
      res.status(429).json({ error: 'Too many codes created just now. Please wait a few minutes.' })
      return
    }

    // --- The seat. Created here, in this school, with the teacher role and
    // nothing else — so it can never reach beyond the admin who named it. ---
    const seatEmail = `link-${randomUUID()}@${SEAT_EMAIL_DOMAIN}`
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: seatEmail,
      email_confirm: false,
      // Service-role-only, exactly as api/_utils/shellClaim.ts argues:
      // user_metadata is writable by the account, app_metadata is not. This
      // records that the seat was named by an admin rather than walked in.
      app_metadata: { named_seat: { school_id: callerSchoolId, named_by: auth.userId, named_at: new Date().toISOString() } },
      user_metadata: {
        // The same marker every inbox-free arrival carries, so the
        // "a way to reach you" row appears for them in Settings.
        onboarded_via: 'possession',
        link_auth: true,
        display_name: name,
      },
    })
    if (createErr || !created?.user) {
      console.error('[school/named-seat] could not create the seat:', createErr?.message)
      res.status(500).json({ error: 'Could not create the code. Please try again.' })
      return
    }
    const seatUserId = created.user.id

    // From here on a failure must leave NOTHING behind — a half-made seat is a
    // name on the admin's roster that can never be signed into.
    const unwind = async () => {
      await supabase.from('user_tags').delete().eq('user_id', seatUserId).then(undefined, () => {})
      await supabase.from('learners').delete().eq('user_id', seatUserId).then(undefined, () => {})
      await supabase.auth.admin.deleteUser(seatUserId).catch(() => {})
    }

    const { error: learnerErr } = await supabase.from('learners').insert({
      user_id: seatUserId,
      display_name: name,
      educational_role: 'teacher',
      // Nobody has proved this seat can receive mail, because nobody has sent
      // it any. It has no mailbox at all until the teacher adds one.
      needs_verification: true,
    })
    if (learnerErr) {
      console.error('[school/named-seat] learner insert failed:', learnerErr.message)
      await unwind()
      res.status(500).json({ error: 'Could not create the code. Please try again.' })
      return
    }

    // added_by is THE VOUCH: the admin named this person before they arrived,
    // which is what B buys over A. The roster reads it back.
    const { error: tagErr } = await supabase.from('user_tags').insert({
      user_id: seatUserId,
      tag_type: 'school',
      tag_value: `SCHOOL:${callerSchoolId}`,
      role_in_context: 'teacher',
      added_by: auth.userId,
    })
    if (tagErr) {
      console.error('[school/named-seat] school tag insert failed:', tagErr.message)
      await unwind()
      res.status(500).json({ error: 'Could not create the code. Please try again.' })
      return
    }

    const code = generateAccessCode()
    const expiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS).toISOString()
    const { error: insertErr } = await supabase.from('staff_access_codes').insert({
      code_hash: hashAccessCode(code),
      target_user_id: seatUserId,
      school_id: callerSchoolId,
      created_by: auth.userId,
      expires_at: expiresAt,
    })
    if (insertErr) {
      console.error('[school/named-seat] code insert failed:', insertErr.message)
      await unwind()
      res.status(500).json({ error: 'Could not create the code. Please try again.' })
      return
    }

    // Best-effort audit — the seat and its code already exist, so a logging
    // failure must not fail the response. The rate limit above is the one that
    // fails closed.
    try {
      const { data: seatLearner } = await supabase
        .from('learners')
        .select('id')
        .eq('user_id', seatUserId)
        .maybeSingle()
      await supabase.from('player_events').insert({
        occurred_at: new Date().toISOString(),
        user_id: seatLearner?.id ?? null,
        learner_id: seatLearner?.id ?? null,
        event_type: 'school_named_seat_minted',
        payload: {
          actor_user_id: auth.userId,
          target_user_id: seatUserId,
          school_id: callerSchoolId,
          name,
          expires_at: expiresAt,
        },
      })
    } catch (auditErr: any) {
      console.warn('[school/named-seat] audit write failed (non-fatal):', auditErr?.message)
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      access_code: formatAccessCode(code),
      join_url: accessCodeUrl(getAppOrigin(req), code),
      expires_at: expiresAt,
      name,
      user_id: seatUserId,
    })
  } catch (error: any) {
    console.error('[school/named-seat] Error:', error)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
}
