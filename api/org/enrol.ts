/**
 * Org enrolment — POST /api/org/enrol
 * ===================================
 *
 * One sign-up link, and everyone who follows it — new to the app or not —
 * comes through here once. The old system had a second link for under-25s and
 * people used the wrong one and landed in the wrong cohort; there is exactly
 * one link, and age is a TICK on this step.
 *
 * What one call does, in this order, and idempotently:
 *   1. refuses without the data-sharing tick. No tick, no free access.
 *   2. makes sure a learners row exists (the sign-up race, below).
 *   3. refuses a second enrolment anywhere under the same org root.
 *   4. writes the org_enrolments row — UNIQUE (group_id, learner_id) means a
 *      replay lands on the existing row instead of creating a twin.
 *   5. tags group membership by the same rule api/code/redeem.ts uses.
 *   6. grants the free period as a per-learner user_entitlements row, so each
 *      person's year runs from THEIR enrolment date.
 *   7. records — and only records — whether they hold a paying subscription
 *      that will need cancelling.
 *
 * THE LINE ON SUBSCRIPTIONS. Step 7 writes a state and returns a flag. It
 * does not call Paddle, does not schedule anything, and there is no code path
 * in this repository that cancels a subscription as a consequence of an
 * enrolment. A learner who already pays is TOLD, in the enrolment UI, that
 * their subscription needs cancelling, and is shown the date their free year
 * ends. Somebody with authority does the cancelling, and records it through
 * api/org/enrolment-cancellation.ts, which likewise only writes a note.
 *
 * THE SIGN-UP RACE. A brand-new learner has just verified an OTP. Three
 * writers can be trying to create their learners row at that instant: the
 * client's own useAuth.ts ensureLearnerExists(), api/code/redeem.ts, and this
 * endpoint. All three insert on user_id, all three tolerate 23505, and this
 * one re-reads after a conflict rather than failing — so hitting back and
 * resubmitting, or a double-tap on a slow phone, converges on one learner and
 * one enrolment.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { verifyAuthToken } from '../_utils/auth'
import { affiliateToGroupNode } from '../_utils/groupAffiliation'
import { getClientIp, hashIp, isIpOverLimit, logAttempt, REDEEM_PER_IP_LIMIT } from '../_utils/codeAttemptThrottle'
import { canonicalEmail } from '../_utils/identity/emailCanon'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface EnrolmentPolicy {
  group_id: string
  org_display_name: string
  consent_statement: string
  consent_version: string
  ask_age_band: boolean
  age_band_label: string
  free_months: number
  granted_courses: string[]
  is_active: boolean
  link_expires_at: string | null
}

/**
 * Forgiving lookup, matching the stored `code_normalized` column and
 * api/code/validate.ts exactly: 'ABC-123', 'abc 123' and 'abc123' are one code.
 */
export function normalizeCode(code: string): string {
  return String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** enrolled_at + free_months, in UTC. Kept pure so the date the learner is shown is testable. */
export function freeAccessUntil(from: Date, months: number): string {
  const d = new Date(from.getTime())
  const targetMonth = d.getUTCMonth() + months
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(targetMonth)
  // 31 Jan + 1 month is 28/29 Feb, never 2/3 March.
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDayOfTarget))
  return d.toISOString()
}

/** The root of a group's slug path — two cohorts of one org share it. */
export function rootOfPath(path: string | null | undefined, fallbackId: string): string {
  const p = (path || '').trim()
  return p ? p.split('/')[0] : fallbackId
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET,POST' })) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  // ── GET: what does this link's enrolment step SAY? ──────────────────────
  //
  // The page needs the org's name, the consent sentence and the age question
  // before anybody is signed in — a learner arriving from the Canolfan should
  // read what they are agreeing to before creating an account. Public, and
  // therefore carrying the SAME per-IP limiter as api/code/validate.ts, since
  // any public code lookup is an enumeration oracle if it is not throttled.
  //
  // The budget is the WIDE one (REDEEM_PER_IP_LIMIT, 120/15min), not
  // PER_IP_LIMIT — and for the reason that limit exists. A whole class opens
  // one Canolfan link from one room's NAT, and opening the link is what calls
  // this endpoint, so at 10 the eleventh learner was told the link was not
  // found while holding a perfectly good one. Same number, same window, same
  // table as api/code/validate.ts and api/try-link/validate.ts.
  if (req.method === 'GET') {
    const svc = createClient(supabaseUrl, supabaseServiceKey)
    const code = normalizeCode(String(req.query.code || ''))
    const ipHash = hashIp(getClientIp(req))
    if (!code) {
      res.status(400).json({ error: 'code is required' })
      return
    }
    if (await isIpOverLimit(svc, ipHash, REDEEM_PER_IP_LIMIT)) {
      res.status(429).json({ error: 'Too many attempts. Please try again later.' })
      return
    }
    const { data: inv } = await svc
      .from('invite_codes')
      .select('grants_group_id, is_active, expires_at')
      .eq('code_normalized', code)
      .maybeSingle()
    const ok = !!inv && (inv as any).is_active && (inv as any).grants_group_id &&
      (!(inv as any).expires_at || new Date((inv as any).expires_at) > new Date())
    await logAttempt(svc, 'org-enrol-policy', { ipHash, outcome: ok ? 'valid' : 'invalid' })
    if (!ok) {
      res.status(200).json({ found: false })
      return
    }
    const { data: pol } = await svc
      .from('org_enrolment_policies')
      .select('group_id, org_display_name, consent_statement, consent_version, ask_age_band, age_band_label, free_months, is_active')
      .eq('group_id', (inv as any).grants_group_id)
      .maybeSingle()
    if (!pol || !(pol as any).is_active) {
      res.status(200).json({ found: false })
      return
    }
    const p = pol as any
    res.status(200).json({
      found: true,
      orgName: p.org_display_name,
      consentStatement: p.consent_statement,
      askAgeBand: p.ask_age_band,
      ageBandLabel: p.age_band_label,
      freeMonths: p.free_months,
    })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  const userId = auth.userId

  const body = (req.body || {}) as Record<string, unknown>
  const rawCode = String(body.code || '').trim()
  const ageBand = body.ageBand16to24 === true
  const consent = body.dataSharingConsent === true
  if (!rawCode) {
    res.status(400).json({ error: 'code is required' })
    return
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // ── The code, and the org behind it ────────────────────────────────────
    const { data: inviteRow } = await supabase
      .from('invite_codes')
      .select('id, code, code_type, grants_group_id, is_active, expires_at, max_uses, use_count')
      .eq('code_normalized', normalizeCode(rawCode))
      .maybeSingle()

    const invite = inviteRow as any
    if (!invite || !invite.is_active || !invite.grants_group_id) {
      res.status(200).json({ success: false, error: 'Invalid code' })
      return
    }
    if (invite.expires_at && new Date(invite.expires_at) <= new Date()) {
      res.status(200).json({ success: false, error: 'This link has expired' })
      return
    }

    // ── NO CAP ON THE SIGN-UP LINK ─────────────────────────────────────────
    //
    // THE FAILURE THIS EXISTS TO PREVENT. On the old system the sign-up link
    // had a hard maximum, and it was hit — thousands of learners arrived at
    // once and the ones past the cap could not get in (Kai, 2026-09-08). A
    // Canolfan cohort genuinely does arrive together: a tutor puts the link on
    // a screen and a whole class taps it inside a minute.
    //
    // So `use_count` is NOT a gate on this path, at all. There is no branch
    // below that refuses an enrolment because a number got big, and
    // api/admin/org-enrolment-setup.ts refuses to mint a capped link in the
    // first place. If a cap somehow reaches a link anyway — hand-edited, or
    // minted by an older tool — it is logged loudly and IGNORED, because the
    // funder's learners not getting in is a far worse outcome than a counter
    // exceeding a number somebody typed once.
    if (invite.max_uses !== null && invite.max_uses !== undefined) {
      console.warn(
        '[org/enrol] enrolment link carries max_uses =',
        invite.max_uses,
        '— IGNORED. Enrolment links are uncapped by design; see api/admin/org-enrolment-setup.ts.',
      )
    }

    const { data: policyRow } = await supabase
      .from('org_enrolment_policies')
      .select('group_id, org_display_name, consent_statement, consent_version, ask_age_band, age_band_label, free_months, granted_courses, is_active, link_expires_at')
      .eq('group_id', invite.grants_group_id)
      .maybeSingle()
    const policy = policyRow as EnrolmentPolicy | null
    if (!policy || !policy.is_active) {
      res.status(200).json({ success: false, error: 'This link has no enrolment step' })
      return
    }

    // HOW LONG THE LINK LIVES IS DATA, in two places that agree: the code's own
    // expires_at and the org's link_expires_at. NULL in both means the link
    // stays live — which is what "leave it up all year" looks like — and a
    // timestamp in either is honoured, which is what "refresh it every year"
    // looks like. Kai has not settled which the Canolfan wants, so neither is
    // compiled in and switching between them is an UPDATE.
    if (policy.link_expires_at && new Date(policy.link_expires_at) <= new Date()) {
      res.status(200).json({ success: false, error: 'This link has expired' })
      return
    }

    // ── No tick, no free access ────────────────────────────────────────────
    // Checked AFTER the code and policy resolve so the page can render the
    // real consent wording, and BEFORE anything is written.
    if (!consent) {
      res.status(200).json({
        success: false,
        error: 'We can only give you free access if you agree to the data-sharing statement.',
        needsConsent: true,
      })
      return
    }

    // ── The learner row (see THE SIGN-UP RACE above) ───────────────────────
    let learnerId: string | null = null
    {
      const { data: existing } = await supabase.from('learners').select('id').eq('user_id', userId).maybeSingle()
      learnerId = (existing as any)?.id ?? null
    }
    if (!learnerId) {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId)
      const email = authUser?.user?.email
      const displayName =
        (typeof authUser?.user?.user_metadata?.display_name === 'string' && authUser.user.user_metadata.display_name.trim()) ||
        (email && !email.endsWith('@invite.saysomethingin.app') ? email.split('@')[0] : undefined) ||
        'User'
      const { data: inserted, error: insertErr } = await supabase
        .from('learners')
        .insert({ user_id: userId, display_name: displayName })
        .select('id')
        .maybeSingle()
      if (insertErr) {
        // 23505: another writer won the race. Re-read rather than fail — this
        // is the back-button / double-submit path, and it must converge.
        const { data: raced } = await supabase.from('learners').select('id').eq('user_id', userId).maybeSingle()
        learnerId = (raced as any)?.id ?? null
      } else {
        learnerId = (inserted as any)?.id ?? null
      }
      if (!learnerId) {
        console.error('[org/enrol] could not resolve a learner for', userId)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    }

    // ── One person, one cohort, under one org ──────────────────────────────
    // The failure Kai named: a learner in an old and a new cohort at once.
    // Groups under one org share the first segment of their slug path.
    const { data: thisGroup } = await supabase.from('groups').select('id, path').eq('id', invite.grants_group_id).maybeSingle()
    const orgRoot = rootOfPath((thisGroup as any)?.path, invite.grants_group_id)

    const { data: priorEnrolments } = await supabase
      .from('org_enrolments')
      .select('id, group_id, enrolled_at, free_access_until, age_band_16_24, cancellation_state, reporting_from')
      .eq('learner_id', learnerId)
    const priors = (priorEnrolments ?? []) as any[]

    if (priors.length) {
      const groupIds = [...new Set(priors.map((p) => p.group_id))]
      const { data: priorGroups } = await supabase.from('groups').select('id, path').in('id', groupIds)
      const rootById = new Map(
        ((priorGroups ?? []) as any[]).map((g) => [g.id, rootOfPath(g.path, g.id)]),
      )
      const sameOrg = priors.find((p) => rootById.get(p.group_id) === orgRoot)
      if (sameOrg) {
        // Already in. Idempotent, and deliberately NOT an error: a refresh, a
        // back button, or somebody clicking the link again next week all land
        // here and are shown the enrolment they already have.
        res.status(200).json({
          success: true,
          alreadyEnrolled: true,
          orgName: policy.org_display_name,
          freeAccessUntil: sameOrg.free_access_until,
          cancellationNeeded: sameOrg.cancellation_state === 'needed',
        })
        return
      }
    }

    // ── What they hold today ───────────────────────────────────────────────
    //
    // THE FAILURE THIS EXISTS TO PREVENT. On the old system, enrolment
    // sometimes did not recognise a learner who already had an account — so
    // their existing subscription was never flagged and never cancelled, and
    // Kai reports some of those are STILL running, a year on, quietly charging
    // people who thought they were on a free Canolfan year.
    //
    // Recognition here is by EMAIL, not only by the account row this session
    // happens to sit on. Supabase Auth already collapses one address to one
    // auth user, so the residual case is the one that actually bites: a person
    // holding more than one learner record against the same verified address —
    // which the live database has (24 addresses shared across accounts as of
    // the 8 September survey, deliberate tester accounts among them). Checking
    // only `learner_id = mine` misses the subscription sitting on the sibling.
    //
    // What this still cannot see, stated rather than papered over: somebody
    // who pays under one address and enrols under a different one. No lookup
    // can join those, so the enrolment page's wording never claims we have
    // checked everywhere — it tells them to go and look.
    const { data: authForEmail } = await supabase.auth.admin.getUserById(userId)
    const signInEmail = canonicalEmail(authForEmail?.user?.email)

    const learnerIdsToCheck = new Set<string>([learnerId])
    if (signInEmail) {
      const { data: siblings } = await supabase
        .from('learners')
        .select('id')
        .contains('verified_emails', [signInEmail])
      for (const l of ((siblings ?? []) as any[])) learnerIdsToCheck.add(l.id)
    }

    const { data: subRows } = await supabase
      .from('subscriptions')
      .select('id, learner_id, status, plan_name, current_period_end, cancel_at_period_end')
      .in('learner_id', [...learnerIdsToCheck])

    const isLive = (r: any) =>
      !!r &&
      r.status === 'active' &&
      !r.cancel_at_period_end &&
      (!r.current_period_end || new Date(r.current_period_end) > new Date())

    const all = ((subRows ?? []) as any[])
    // Prefer a LIVE subscription wherever it sits; fall back to this learner's
    // own row so the recorded status is still honest when nothing is live.
    const sub = all.find(isLive) ?? all.find((r) => r.learner_id === learnerId) ?? null
    const paying = isLive(sub)
    // Whether the paying account is a sibling rather than this one — the
    // enrolment page says so, because "cancel your subscription" is confusing
    // advice if they are looking at an account that has none.
    const payingOnAnotherAccount = paying && sub!.learner_id !== learnerId

    const now = new Date()
    const until = freeAccessUntil(now, policy.free_months)

    const enrolmentRow = {
      group_id: invite.grants_group_id as string,
      learner_id: learnerId,
      enrolled_at: now.toISOString(),
      reporting_from: now.toISOString().slice(0, 10),
      age_band_16_24: policy.ask_age_band ? ageBand : false,
      age_ticked_at: policy.ask_age_band && ageBand ? now.toISOString() : null,
      data_sharing_consent: true,
      consent_at: now.toISOString(),
      consent_version: policy.consent_version,
      free_access_until: until,
      prior_subscription_status: sub?.status ?? null,
      prior_subscription_id: sub?.id ?? null,
      cancellation_state: paying ? 'needed' : 'not_needed',
      invite_code_id: invite.id,
    }

    const { data: written, error: writeErr } = await supabase
      .from('org_enrolments')
      .insert(enrolmentRow)
      .select('id, free_access_until, cancellation_state')
      .maybeSingle()

    let enrolment = written as any
    if (writeErr) {
      if (writeErr.code !== '23505') {
        console.error('[org/enrol] enrolment insert failed:', writeErr)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
      // The UNIQUE (group_id, learner_id) constraint fired: two submits raced.
      // Re-read the winner. Nothing is written twice, and the learner sees the
      // same answer either way.
      const { data: raced } = await supabase
        .from('org_enrolments')
        .select('id, free_access_until, cancellation_state')
        .eq('group_id', invite.grants_group_id)
        .eq('learner_id', learnerId)
        .maybeSingle()
      enrolment = raced
      if (!enrolment) {
        res.status(500).json({ error: 'Internal server error' })
        return
      }
      res.status(200).json({
        success: true,
        alreadyEnrolled: true,
        orgName: policy.org_display_name,
        freeAccessUntil: enrolment.free_access_until,
        cancellationNeeded: enrolment.cancellation_state === 'needed',
      })
      return
    }

    // ── Membership, by the same rule as every other join path ──────────────
    const tagError = await affiliateToGroupNode(supabase, userId, invite.grants_group_id as string, 'student')
    if (tagError) {
      // Non-fatal: the enrolment row is the record that matters for reporting
      // and for the free year. A missing tag costs dashboard visibility and is
      // repairable; failing here would leave them enrolled but told otherwise.
      console.error('[org/enrol] group tag failed (non-fatal):', tagError)
    }

    // ── The free period ────────────────────────────────────────────────────
    if (policy.granted_courses?.length) {
      const { error: entErr } = await supabase.from('user_entitlements').insert({
        learner_id: learnerId,
        access_type: 'courses',
        granted_courses: policy.granted_courses,
        expires_at: until,
      })
      if (entErr) console.error('[org/enrol] entitlement insert failed (non-fatal):', entErr)
    }

    // Count the use — for information only, never as a gate (see NO CAP
    // above). Done through the ATOMIC rpc rather than a read-then-write
    // increment, because a burst of concurrent sign-ups is exactly the case
    // this endpoint is built for and read-then-write loses most of them. A
    // failure here is swallowed: a wrong counter is a cosmetic problem, and a
    // learner refused entry over one is not.
    const { error: countErr } = await supabase.rpc('claim_invite_code_use', { p_id: invite.id })
    if (countErr) {
      console.warn('[org/enrol] use_count not incremented (non-fatal):', countErr.message)
    }

    res.status(200).json({
      success: true,
      alreadyEnrolled: false,
      orgName: policy.org_display_name,
      freeAccessUntil: until,
      cancellationNeeded: paying,
      priorPlanName: paying ? (sub?.plan_name ?? null) : null,
      payingOnAnotherAccount,
      // Said out loud so the page never implies we searched everywhere: an
      // address we have never seen on this account is an address we cannot
      // check.
      recognisedBy: signInEmail ? 'email' : 'account',
    })
  } catch (error: any) {
    console.error('[org/enrol] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
