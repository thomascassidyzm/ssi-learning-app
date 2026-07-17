/**
 * Onboarding provisioning — POST /api/onboarding/provision
 *
 * Called right after OTP verification (so it runs on a VERIFIED session). It
 * confirms the account AND activates the free trial in one shot:
 *   - ensures a learner row
 *   - grants the ADMIN's OWN play-trial entitlement for a premium course (so
 *     they can try the lesson) — capped per account
 *   - assigns the role: tutor → teachers row (+ a first class); school → the
 *     school_admin role + a school row (NO student cascade grant — students pay)
 *   - activates the PLATFORM subscription trial (lever-3): the dashboard is free
 *     for a window, then £15/teacher/mo. premium-track → 1 month; free-track →
 *     1 year (schools pay for the platform even on free courses); tutor → 1 month.
 *     Limited to ONE trialled language per school, and ONE trial per email per
 *     track FOREVER (email-burn via trial_burns; burn-before-grant).
 *
 * Idempotent: safe to call more than once (re-verify / retry) — it never
 * double-grants or double-creates. Price/trial is decided SERVER-SIDE from the
 * track + the course's live status; the client choice is never trusted blindly.
 *
 * Fails OPEN on the platform columns: if the school_platform_subscription
 * migration is not yet applied (columns/table absent), the platform-trial step
 * is skipped without failing provisioning — accounts still onboard, the gate
 * just stays advisory until the migration lands.
 *
 * Body: { track: 'school' | 'tutor', course_code }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { ensureJoinCodesRegistered } from '../_utils/schoolJoinCodes'
import { provisionSchoolPlatformTrial, provisionTutorPlatformTrial, isMissingPlatformSchema } from '../_utils/schoolPlatformTrial'
import { ensureClassLearnerEntity } from '../_utils/classLearnerEntity'
import { isDisposableEmailDomain } from '../_utils/emailValidation'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const TRACKS = new Set(['school', 'tutor'])
// Premium courses get a free trial then convert to paid; Free/Community are free.
const PREMIUM_TRIAL_DAYS = 30

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }

  const { track, course_code } = req.body || {}
  if (!TRACKS.has(track)) {
    res.status(400).json({ error: 'Invalid track' })
    return
  }
  if (!course_code || typeof course_code !== 'string') {
    res.status(400).json({ error: 'course_code is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Validate the course is genuinely DEPLOYED (live OR beta — mirroring the
    //    in-app catalogue in App.vue) and matches the track. Never trust the
    //    client to pick a not_available/draft or wrong-track course.
    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('course_code, pricing_tier, new_app_status')
      .eq('course_code', course_code)
      .maybeSingle()
    if (courseErr) throw new Error(`course lookup failed: ${courseErr.message}`)
    if (!course || !['live', 'beta'].includes(course.new_app_status)) {
      res.status(400).json({ error: 'That course is not available yet' })
      return
    }
    // The OFFER is the course's tier: Free/Community = free (no grant needed — free
    // courses are already accessible to everyone); Premium = a free trial then paid.
    const isFree = course.pricing_tier === 'free' || course.pricing_tier === 'community'
    // Welsh gets the long (1-year) platform window like free courses, even though
    // it's a premium-tier course — it's the heritage flagship. Only affects the
    // PLATFORM trial DURATION, not whether a learner play-trial is granted.
    const isWelsh = (course.course_code || '').startsWith('cym')

    // 1b. Resolve the auth email — the stable identity the platform trial-burn
    //     is keyed on (trial_burns). Lower-cased + trimmed to normalise.
    const { data: authUserLookup } = await supabase.auth.admin.getUserById(auth.userId)
    const authEmail = (authUserLookup?.user?.email || '').trim().toLowerCase()

    // 1c. Real-email enforcement (api/_utils/emailValidation.ts) — same
    // disposable-domain blocklist possession-redeem applies. This track
    // proves mailbox RECEIPT via a real OTP round-trip before ever reaching
    // here (unlike possession-redeem, which never emails anyone), so the
    // MX/needs_verification machinery doesn't apply — but a disposable
    // provider can still deliver a real OTP, so it's not itself proof
    // against trial-farming with throwaway addresses. Tutor-only: this is
    // a real-earnings product (£15/mo + per-student payouts), the specific
    // population the blocklist exists to slow down.
    if (track === 'tutor' && authEmail && isDisposableEmailDomain(authEmail)) {
      res.status(400).json({ error: 'Please sign up with a permanent email address.' })
      return
    }

    // 2. Ensure a learner row.
    let { data: learner } = await supabase
      .from('learners')
      .select('id, display_name, educational_role')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (!learner) {
      const fallbackName = authEmail?.split('@')[0] || 'Learner'
      const { data: created, error: createErr } = await supabase
        .from('learners')
        .insert({ user_id: auth.userId, display_name: fallbackName })
        .select('id, display_name, educational_role')
        .single()
      if (createErr) {
        if (createErr.code === '23505') {
          // Raced with the client's own ensureLearnerExists (both fire on SIGNED_IN);
          // UNIQUE(user_id) means the row now exists — re-fetch instead of failing.
          const { data: again } = await supabase
            .from('learners')
            .select('id, display_name, educational_role')
            .eq('user_id', auth.userId)
            .maybeSingle()
          if (!again) throw new Error('learner create raced and re-fetch failed')
          learner = again
        } else {
          throw new Error(`learner create failed: ${createErr.message}`)
        }
      } else if (!created) {
        throw new Error('learner create returned no row')
      } else {
        learner = created
      }
    }

    // 3. Access. Free/Community courses are already accessible to everyone, so no
    //    grant is needed. Premium courses get a free trial entitlement, capped so a
    //    single OTP'd account can't farm a trial for the whole premium catalogue.
    let expiresAt: string | null = null
    if (!isFree) {
      expiresAt = new Date(Date.now() + PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const SELF_SERVICE_TRIAL_CAP = 3
      const { data: existingEnts } = await supabase
        .from('user_entitlements')
        .select('id, granted_courses, expires_at')
        .eq('learner_id', learner.id)
        .is('entitlement_code_id', null)
        .is('email_access_grant_id', null)
      const nowMs = Date.now()
      const activeTrialCourses = new Set<string>()
      for (const e of existingEnts || []) {
        const active = !e.expires_at || new Date(e.expires_at).getTime() > nowMs
        if (active && Array.isArray(e.granted_courses)) {
          for (const cc of e.granted_courses) activeTrialCourses.add(cc)
        }
      }
      const alreadyGranted = activeTrialCourses.has(course_code)
      if (!alreadyGranted && activeTrialCourses.size >= SELF_SERVICE_TRIAL_CAP) {
        res.status(409).json({
          error: 'You already have active free trials — get in touch if you need more languages.',
        })
        return
      }
      if (!alreadyGranted) {
        const { error: entErr } = await supabase.from('user_entitlements').insert({
          learner_id: learner.id,
          access_type: 'courses',
          granted_courses: [course_code],
          expires_at: expiresAt,
        })
        if (entErr) throw new Error(`trial grant failed: ${entErr.message}`)
      }
    }

    // 4. Role.
    let role: string
    // The platform-subscription trial result for the response (null until set).
    let platformTrial:
      | { track: string; kind: string; expires_at: string; days: number }
      | null = null
    // True when the email already burned its one trial for this track (no new
    // trial granted; the dashboard gate will route them to checkout).
    let trialBurned = false
    // True when this email already had an account for this track — used by the
    // signup UI to skip the "finishing details" step and say "Welcome back".
    let existingAccount = false
    if (track === 'tutor') {
      role = 'teacher'
      // Tag the learner as a solo tutor so the learner shell can find them again.
      // 'tutor' is deliberately DISTINCT from the school 'teacher'/'school_admin'
      // roles: it stays OUT of hasSchoolRole (so the /schools member guard keeps
      // bouncing a tutor back to /tutors/dashboard instead of the "no school"
      // wall), while still giving BrowseScreen a durable signal to surface the
      // tutor's own dashboard link. Idempotent — only write when it differs.
      //
      // NEVER DOWNGRADE a school role to 'tutor': hasSchoolRole is derived from
      // educational_role ALONE, so clobbering 'school_admin' here would bounce
      // the admin off their own school dashboard forever (the schools row stays
      // intact but the /schools guard no longer lets them near it). A school
      // person can still hold a tutor account — the tutor surface resolves via
      // the teachers row, not this role.
      const KEEP_ROLES = ['school_admin', 'govt_admin', 'teacher']
      if (learner.educational_role !== 'tutor' && !KEEP_ROLES.includes(learner.educational_role || '')) {
        const { error: roleErr } = await supabase
          .from('learners')
          .update({ educational_role: 'tutor' })
          .eq('id', learner.id)
        if (roleErr) throw new Error(`tutor role assignment failed: ${roleErr.message}`)
      }
      const { data: existingTeacher } = await supabase
        .from('teachers')
        .select('id, platform_status')
        .eq('learner_id', learner.id)
        .maybeSingle()
      existingAccount = !!existingTeacher?.id
      let teacherId = existingTeacher?.id
      if (!teacherId) {
        const { data: created, error: tErr } = await supabase
          .from('teachers')
          .insert({
            learner_id: learner.id,
            display_name: learner.display_name || 'Teacher',
            teaching_languages: [course_code],
          })
          .select('id')
          .single()
        if (tErr || !created) throw new Error(`teacher create failed: ${tErr?.message}`)
        teacherId = created.id
        // A first class gives them a share link straight away. Non-fatal.
        const { data: firstClass, error: clsErr } = await supabase
          .from('classes')
          .insert({
            teacher_user_id: auth.userId,
            class_name: 'My class',
            course_code,
            school_id: null,
            is_active: true,
          })
          .select('id')
          .single()
        if (clsErr) console.warn('[onboarding/provision] first class failed (non-fatal):', clsErr.message)
        else if (firstClass) {
          const learnerResult = await ensureClassLearnerEntity(supabase, firstClass.id)
          if ('error' in learnerResult) {
            console.warn('[onboarding/provision] class learner entity failed (non-fatal):', learnerResult.error)
          }
        }
      }

      // PLATFORM TRIAL (tutor = 1 month always). Email-burn first, then set the
      // trial columns on the teacher row. Fails open if the migration is unapplied.
      const r = await provisionTutorPlatformTrial(
        supabase,
        authEmail,
        teacherId,
        existingTeacher?.platform_status ?? null,
      )
      platformTrial = r.trial
      trialBurned = r.burned
    } else {
      role = 'school_admin'
      // Upgrading 'tutor'→'school_admin' is safe (the tutor surface reads the
      // teachers row, not this role) — but never downgrade a govt_admin.
      if (learner.educational_role !== 'school_admin' && learner.educational_role !== 'govt_admin') {
        const { error: roleErr } = await supabase
          .from('learners')
          .update({ educational_role: 'school_admin' })
          .eq('id', learner.id)
        if (roleErr) throw new Error(`role assignment failed: ${roleErr.message}`)
      }
      // Create a school if this admin doesn't have one yet (name set later at CONTINUE).
      // Select the platform columns too (when present) to enforce one-trial-per-school
      // and stay idempotent on re-provision. Use a forgiving select so a pre-migration
      // DB (no platform columns) still resolves the school.
      let existingSchool: { id: string; trial_course_code?: string | null; platform_status?: string | null } | null = null
      const { data: schoolFull, error: schoolFullErr } = await supabase
        .from('schools')
        .select('id, trial_course_code, platform_status')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      if (schoolFullErr && isMissingPlatformSchema(schoolFullErr)) {
        // Pre-migration: re-select just the id.
        const { data: schoolBare } = await supabase
          .from('schools')
          .select('id')
          .eq('admin_user_id', auth.userId)
          .maybeSingle()
        existingSchool = schoolBare
      } else {
        existingSchool = schoolFull
      }
      existingAccount = !!existingSchool?.id

      let schoolId = existingSchool?.id
      if (!schoolId) {
        const { data: school, error: sErr } = await supabase
          .from('schools')
          .insert({ admin_user_id: auth.userId, school_name: 'My school' })
          .select('id')
          .single()
        if (sErr || !school) throw new Error(`school create failed: ${sErr?.message}`)
        schoolId = school.id
      }
      // Unreachable given the insert-or-existing logic above, but narrows the
      // type from `string | undefined` and is a real guard against a silently
      // unresolved id reaching the join-code / trial writes below.
      if (!schoolId) throw new Error('school id unresolved after provision')

      // Register the trigger-generated join codes in invite_codes — redemption
      // (/api/code/validate) reads invite_codes, NOT schools.teacher_join_code,
      // so an unregistered code is shown to the admin but can never be redeemed
      // (the silent-failure class api/admin/create-school.ts fixed for the admin
      // path). Runs on every provision (not just create) so pre-fix schools heal.
      await ensureJoinCodesRegistered(supabase, schoolId, auth.userId)

      // ONE trialled language per school. A second DIFFERENT course on a school
      // that already trialled (and isn't paying) must go through checkout, not a
      // fresh free trial. Same course = idempotent re-call → fine.
      const existingTrialCourse = existingSchool?.trial_course_code ?? null
      if (
        existingTrialCourse &&
        existingTrialCourse !== course_code &&
        existingSchool?.platform_status !== 'active'
      ) {
        res.status(409).json({
          error:
            'Your school has already used its free trial language. Subscribe to add another language.',
          trial_course_code: existingTrialCourse,
          requires_checkout: true,
        })
        return
      }

      // PLATFORM TRIAL (school): premium → 1 month; free courses AND Welsh →
      // 1 year (schools pay for the platform even on free courses). Email-burn
      // first, then set the trial columns. Fails open if migration unapplied.
      const r = await provisionSchoolPlatformTrial(
        supabase,
        authEmail,
        schoolId,
        course_code,
        isWelsh || isFree,
      )
      if (r.denied) {
        res.status(409).json({
          error:
            'This email has already used its free school trial. Subscribe to set up another school.',
          trial_burned: true,
          requires_checkout: true,
        })
        return
      }
      platformTrial = r.trial
      trialBurned = r.burned

      // NB: self-service school signup deliberately creates NO entitlement_grant.
      // A school grant cascades to students as FREE play access (get_cascade_courses
      // → api/entitlement/user.ts), and students are NOT meant to play free — the
      // school relationship entitles them to the cheaper £5 price (driven by
      // class.school_id in WithTeacher), not free access. Free access via the
      // hierarchy is reserved for DELIBERATE ssi_admin/govt comps through
      // api/entitlement/grant.ts, which keeps its full group→school→class heritage.
      // Do not re-add an auto-grant here.
    }

    res.status(200).json({
      trial: isFree ? null : { course_code, expires_at: expiresAt, days: PREMIUM_TRIAL_DAYS },
      free: isFree,
      role,
      // The platform-subscription trial (lever-3): the dashboard window before
      // £15/teacher/mo. null when none was granted (e.g. the email already
      // burned its trial, or the migration is unapplied).
      platform_trial: platformTrial,
      trial_burned: trialBurned,
      // Returning user (already had a teacher/school for this track) — the signup
      // UI skips the finishing-details step and sends them straight in.
      existing: existingAccount,
      redirect: track === 'tutor' ? '/tutors/dashboard' : '/schools',
    })
  } catch (error: any) {
    // Full detail server-side only — the raw message can carry internal
    // implementation detail (e.g. a Postgres constraint name) that has no
    // business reaching the signup page (finding, 2026-07-16 tutor-signup
    // audit: a broken DB constraint surfaced its exact error text to users).
    console.error('[onboarding/provision] Error:', error)
    res.status(500).json({ error: 'We could not finish setting up your account. Please try again.' })
  }
}

