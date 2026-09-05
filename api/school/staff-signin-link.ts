/**
 * Staff sign-in link — POST /api/school/staff-signin-link
 *
 * "Email verification is not a door, it is a permission."
 *
 * A teacher behind a hostile school mail gateway (Hwb / Microsoft EOP
 * education tenants — docs/schools/email-deliverability-plan.md) never
 * receives our OTP. Until now the only rescue was an ssi_admin minting a link
 * by hand (api/admin/create-signin-link.ts), which makes one person at SSi the
 * bottleneck for every locked-out teacher in Wales.
 *
 * This endpoint moves that rescue to the person who is actually standing next
 * to the teacher: their own school admin. The admin opens Teachers, taps
 * "Sign-in link" next to a colleague, and hands over the URL in person, on
 * Teams, on paper — any channel that is not our email.
 *
 * Why this is safe to delegate (the full argument, so nobody has to re-derive
 * it):
 *   - The relationship is already server-verified and already carries a LARGER
 *     power. The same caller resolution used here lets a school admin REMOVE
 *     that teacher outright (api/school/remove-staff.ts) and read every pupil's
 *     data in their school. "Let my colleague back into their own account" is
 *     strictly smaller than "delete my colleague's access".
 *   - CONTAINMENT is enforced, not assumed. The target must be active staff at
 *     the caller's own school AND must hold no role that outranks or reaches
 *     beyond that school. A teacher who is also a group leader, an ssi_admin,
 *     or staff at a second school is refused — otherwise a school admin could
 *     mint their way upward or sideways out of their own scope.
 *   - Every mint is audit-logged to player_events (school_signin_link_minted)
 *     with actor and target, and rate-limited per caller, failing CLOSED if the
 *     audit table can't be read (AUTH-CORE-07 — a quota that evaporates when
 *     the DB misbehaves is not a quota).
 *
 * WHAT IS HANDED OVER (changed 2026-09-02, Tom's ruling): a SHORT TYPEABLE
 * CODE, not a Supabase `action_link`. The design assumes the artefact travels
 * out of band — Teams, a screen, a printed slip, a voice across a staffroom —
 * and a ~200-character URL does not survive any of those. So this mints an
 * 8-character code (api/_utils/accessCode.ts), stores only its hash, and hands
 * back both the code and a short `/join/CODE` URL so whichever channel the
 * admin actually has will work.
 *
 * It is single-use and expires in 48 hours, and minting a new one for the same
 * person KILLS any earlier live code — a stale slip in a shared inbox is worth
 * nothing. Redemption is api/auth/access-code-redeem.ts.
 *
 * Whoever holds the code becomes that user, once. That caveat is load bearing
 * and is shown in the UI, not buried here.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import {
  schoolMembershipsOf,
  schoolReachOf,
  type SchoolMembership,
  type SchoolReach,
} from '../_utils/schoolStaff'
import { getAppOrigin } from '../_utils/appOrigin'
import {
  ACCESS_CODE_TTL_MS,
  accessCodeUrl,
  formatAccessCode,
  generateAccessCode,
  hashAccessCode,
} from '../_utils/accessCode'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const RATE_WINDOW_MS = 15 * 60 * 1000
const PER_CALLER_LIMIT = 10

/** Roles that reach beyond a single school — never mintable by a school admin. */
const OUT_OF_SCOPE_EDU_ROLES = new Set(['govt_admin'])
const OUT_OF_SCOPE_PLATFORM_ROLES = new Set(['ssi_admin', 'god'])

/**
 * The caller's own school, admin-only — resolved from their verified identity,
 * never from the request body.
 *
 * ONE resolver, used for the caller AND the target below
 * (api/_utils/schoolStaff.ts → schoolMembershipsOf). Both spellings of school
 * membership — `schools.admin_user_id` and an active SCHOOL: tag — are answered
 * by that single function, so the caller and the target can never again be
 * asked different questions about the same thing. That asymmetry was the bug:
 * see the header comment on schoolMembershipsOf.
 */
async function callerAdminSchoolId(svc: SupabaseClient, authUid: string): Promise<string | null> {
  const memberships = await schoolMembershipsOf(svc, authUid)
  return memberships.find((m: SchoolMembership) => m.role === 'admin')?.schoolId ?? null
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    console.error('[school/staff-signin-link] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const targetUserId = typeof req.body?.target_user_id === 'string' ? req.body.target_user_id.trim() : ''
  if (!targetUserId) {
    res.status(400).json({ error: 'target_user_id is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const callerSchoolId = await callerAdminSchoolId(supabase, auth.userId)
    if (!callerSchoolId) {
      res.status(403).json({ error: 'Only a school admin can create a sign-in link' })
      return
    }

    // Rate limit BEFORE the expensive admin calls. Fails closed: if the audit
    // table can't be read we refuse rather than mint unbounded session links.
    const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
    const { count: recentCount, error: rateErr } = await supabase
      .from('player_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'school_signin_link_minted')
      .gte('occurred_at', cutoff)
      .contains('payload', { actor_user_id: auth.userId })

    if (rateErr) {
      console.error('[school/staff-signin-link] rate-limit check failed — refusing:', rateErr.message)
      res.status(503).json({ error: 'Please try again in a moment.' })
      return
    }
    if ((recentCount ?? 0) >= PER_CALLER_LIMIT) {
      res.status(429).json({ error: 'Too many sign-in links created just now. Please wait a few minutes.' })
      return
    }

    // --- Target must be ACTIVE STAFF at the caller's own school. ---
    // The caller themselves always qualifies (their own account, e.g. getting
    // onto a second device) even if their adminship comes from
    // schools.admin_user_id rather than a tag.
    const isSelf = targetUserId === auth.userId
    if (!isSelf) {
      // Two questions, two resolvers — deliberately different, because they
      // ARE different questions:
      //   - "is this person staff at MY school?" → schoolMembershipsOf, the
      //     same staff resolver that answered for the caller, so both spellings
      //     of staff membership are seen on both sides of the comparison.
      //   - "does this account reach anywhere ELSE?" → schoolReachOf, which
      //     also counts a PUPIL seat. Minting a session opens whatever the
      //     account can open, and a pupil seat at another school is exactly
      //     that. See the header on schoolReachOf.
      const targetStaffAt = await schoolMembershipsOf(supabase, targetUserId)
      const targetReach = await schoolReachOf(supabase, targetUserId)

      if (!targetStaffAt.some((m: SchoolMembership) => m.schoolId === callerSchoolId)) {
        res.status(404).json({ error: 'That person is not a member of your school' })
        return
      }

      // --- CONTAINMENT: refuse anyone who reaches beyond this school. ---
      // Without this a school admin could mint a session for a colleague who
      // happens to also lead a region or hold a platform role, and step up.
      const { data: targetLearner } = await supabase
        .from('learners')
        .select('id, user_id, display_name, educational_role, platform_role')
        .eq('user_id', targetUserId)
        .maybeSingle()

      const eduRole = String(targetLearner?.educational_role || '')
      const platRole = String(targetLearner?.platform_role || '')
      if (OUT_OF_SCOPE_EDU_ROLES.has(eduRole) || OUT_OF_SCOPE_PLATFORM_ROLES.has(platRole)) {
        res.status(403).json({ error: 'This account is managed above your school — ask SSi support for a link.' })
        return
      }

      // A SECOND school outside the caller's scope — in ANY capacity. That
      // includes one they FOUND (schools.admin_user_id) and were never tagged
      // at, which the old tags-only check could not see, AND one they merely
      // STUDY at, which the old staff-only check could not see either.
      const reachesElsewhere = targetReach.some((m: SchoolReach) => m.schoolId !== callerSchoolId)
      if (reachesElsewhere) {
        res.status(403).json({ error: 'This account belongs to more than one school — ask SSi support for a link.' })
        return
      }
    }

    // --- Confirm the target is a real account before minting anything. ---
    // The code signs THIS user in, so an account with no address on file has
    // nothing for redemption to mint a session against.
    const { data: targetUser, error: userErr } = await supabase.auth.admin.getUserById(targetUserId)
    const email = targetUser?.user?.email
    if (userErr || !email) {
      res.status(404).json({ error: 'That account has no sign-in address on file.' })
      return
    }

    // --- Kill any earlier live code for this person. ---
    // Reissue is the floor under this whole design ("the admin can always
    // reissue"), and it must mean the OLD one stops working — otherwise every
    // reissue leaves another live credential loose in a shared inbox. Expiring
    // rather than deleting keeps the audit trail intact.
    const { error: supersedeErr } = await supabase
      .from('staff_access_codes')
      .update({ expires_at: new Date().toISOString() })
      .eq('target_user_id', targetUserId)
      .is('redeemed_at', null)
      .gt('expires_at', new Date().toISOString())
    if (supersedeErr) {
      // Refuse rather than leave two live codes out for one person.
      console.error('[school/staff-signin-link] supersede failed — refusing:', supersedeErr.message)
      res.status(503).json({ error: 'Please try again in a moment.' })
      return
    }

    const code = generateAccessCode()
    const expiresAt = new Date(Date.now() + ACCESS_CODE_TTL_MS).toISOString()
    const { error: insertErr } = await supabase.from('staff_access_codes').insert({
      code_hash: hashAccessCode(code),
      target_user_id: targetUserId,
      school_id: callerSchoolId,
      created_by: auth.userId,
      expires_at: expiresAt,
    })
    if (insertErr) {
      console.error('[school/staff-signin-link] code insert failed:', insertErr.message)
      res.status(500).json({ error: 'Could not create an access code. Please try again.' })
      return
    }

    // Best-effort audit — never blocks the response, the link already exists.
    try {
      const origin = getAppOrigin(req)
      const { data: targetLearnerRow } = await supabase
        .from('learners')
        .select('id')
        .eq('user_id', targetUserId)
        .maybeSingle()
      const { error: auditErr } = await supabase.from('player_events').insert({
        occurred_at: new Date().toISOString(),
        user_id: targetLearnerRow?.id ?? null,
        learner_id: targetLearnerRow?.id ?? null,
        event_type: 'school_signin_link_minted',
        payload: {
          actor_user_id: auth.userId,
          target_user_id: targetUserId,
          school_id: callerSchoolId,
          self: isSelf,
        },
        env: origin.includes('staging') ? 'staging' : (origin === 'https://saysomethingin.app' ? 'production' : 'dev'),
      })
      if (auditErr) console.warn('[school/staff-signin-link] audit insert failed:', auditErr.message)
    } catch (auditErr) {
      console.warn('[school/staff-signin-link] audit insert threw:', auditErr)
    }

    res.status(200).json({
      success: true,
      access_code: formatAccessCode(code),
      join_url: accessCodeUrl(getAppOrigin(req), code),
      expires_at: expiresAt,
      email,
    })
  } catch (err) {
    console.error('[school/staff-signin-link] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
