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

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const TRACKS = new Set(['school', 'tutor'])
// Premium courses get a free trial then convert to paid; Free/Community are free.
const PREMIUM_TRIAL_DAYS = 30

// Platform-subscription trial windows (lever-3). A school pays £15/teacher/mo
// for the dashboard; the trial is time-limited even on free courses.
const PLATFORM_TRIAL_PREMIUM_DAYS = 30   // premium-track school + every tutor
const PLATFORM_TRIAL_FREE_DAYS = 365     // free-track school (still pays for the platform)

function isoIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

// True when a Supabase/PostgREST error means the school_platform_subscription
// migration hasn't been applied yet (missing table/column/relationship). The
// platform-trial step degrades to a no-op in that case so onboarding still works.
function isMissingPlatformSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  // PGRST204 missing column, PGRST205 missing table, 42703 undefined_column,
  // 42P01 undefined_table — plus a message-level fallback for variants.
  if (['PGRST204', 'PGRST205', '42703', '42P01'].includes(err.code || '')) return true
  return /column .* does not exist|relation .* does not exist|could not find the .* column|schema cache/i.test(
    err.message || '',
  )
}

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

    // 1b. Resolve the auth email — the stable identity the platform trial-burn
    //     is keyed on (trial_burns). Lower-cased + trimmed to normalise.
    const { data: authUserLookup } = await supabase.auth.admin.getUserById(auth.userId)
    const authEmail = (authUserLookup?.user?.email || '').trim().toLowerCase()

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
    if (track === 'tutor') {
      role = 'teacher'
      const { data: existingTeacher } = await supabase
        .from('teachers')
        .select('id, platform_status')
        .eq('learner_id', learner.id)
        .maybeSingle()
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
        const { error: clsErr } = await supabase.from('classes').insert({
          teacher_user_id: auth.userId,
          class_name: 'My class',
          course_code,
          school_id: null,
          is_active: true,
        })
        if (clsErr) console.warn('[onboarding/provision] first class failed (non-fatal):', clsErr.message)
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
      if (learner.educational_role !== 'school_admin') {
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

      // PLATFORM TRIAL (school): premium course → 1 month, free course → 1 year
      // (schools pay for the platform even on free courses). Email-burn first,
      // then set the trial columns on the schools row. Fails open if the
      // migration is unapplied.
      const r = await provisionSchoolPlatformTrial(
        supabase,
        authEmail,
        schoolId,
        course_code,
        isFree,
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
      redirect: track === 'tutor' ? '/teach' : '/schools',
    })
  } catch (error: any) {
    console.error('[onboarding/provision] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}

// ============================================================================
// PLATFORM-TRIAL provisioning (lever-3). Email-burn FIRST then grant. Both
// helpers FAIL OPEN: if the school_platform_subscription migration is unapplied
// (trial_burns / platform_* columns absent) they no-op cleanly so onboarding
// keeps working — the dashboard gate is advisory until the migration lands.
// ============================================================================

type PlatformTrial = { track: string; kind: string; expires_at: string; days: number }

/**
 * Burn one trial on (email, track). Returns:
 *   - { burned: false }                 → first time; the caller may grant.
 *   - { burned: true, ownedBy }         → already burned; ownedBy = the burn's
 *                                         school_id (school) so the caller can
 *                                         tell an idempotent retry from a farm.
 *   - { schemaUnavailable: true }       → trial_burns absent (pre-migration).
 */
async function burnTrial(
  supabase: any,
  email: string,
  track: 'school' | 'tutor',
  schoolId: string | null,
): Promise<{ burned: boolean; ownedBy?: string | null; schemaUnavailable?: boolean }> {
  if (!email) {
    // No email to key the burn on — can't enforce; skip (fail open).
    return { burned: false, schemaUnavailable: true }
  }
  const { error } = await supabase
    .from('trial_burns')
    .insert({ email, track, school_id: schoolId })
  if (!error) return { burned: false }
  if (error.code === '23505') {
    // Already burned. Fetch the owning row so the caller can disambiguate a
    // legitimate retry (same school) from a farm (different/deleted school).
    const { data: existing } = await supabase
      .from('trial_burns')
      .select('school_id')
      .eq('email', email)
      .eq('track', track)
      .maybeSingle()
    return { burned: true, ownedBy: existing?.school_id ?? null }
  }
  if (isMissingPlatformSchema(error)) return { burned: false, schemaUnavailable: true }
  // Any other DB error: fail open (don't block onboarding on the burn ledger).
  console.warn('[onboarding/provision] trial-burn insert failed (fail-open):', error.code, error.message)
  return { burned: false, schemaUnavailable: true }
}

async function provisionSchoolPlatformTrial(
  supabase: any,
  email: string,
  schoolId: string,
  courseCode: string,
  isFree: boolean,
): Promise<{ trial: PlatformTrial | null; burned: boolean; denied: boolean }> {
  const kind = isFree ? 'free_1yr' : 'premium_1mo'
  const days = isFree ? PLATFORM_TRIAL_FREE_DAYS : PLATFORM_TRIAL_PREMIUM_DAYS
  const expiresAt = isoIn(days)

  const burn = await burnTrial(supabase, email, 'school', schoolId)
  if (burn.schemaUnavailable) {
    // Pre-migration (or no email): skip the platform trial entirely (fail open).
    return { trial: null, burned: false, denied: false }
  }
  if (burn.burned) {
    // Idempotent retry if the surviving burn belongs to THIS school; otherwise a
    // genuine re-trial attempt (deleted/recreated school) → deny the free trial.
    if (burn.ownedBy && burn.ownedBy === schoolId) {
      // Same school re-provisioning. Ensure the trial columns are present without
      // re-extending the window: only set them if not already on a trial.
      const { data: cur } = await supabase
        .from('schools')
        .select('platform_status, platform_expires_at, trial_course_code')
        .eq('id', schoolId)
        .maybeSingle()
      if (cur && cur.platform_status === 'trial' && cur.platform_expires_at) {
        return {
          trial: { track: 'school', kind, expires_at: cur.platform_expires_at, days },
          burned: false,
          denied: false,
        }
      }
      // No trial set yet (burn raced ahead of the column write) — set it now.
      await setSchoolTrialColumns(supabase, schoolId, courseCode, kind, expiresAt)
      return { trial: { track: 'school', kind, expires_at: expiresAt, days }, burned: false, denied: false }
    }
    return { trial: null, burned: true, denied: true }
  }

  // Fresh burn → grant the trial on the schools row.
  await setSchoolTrialColumns(supabase, schoolId, courseCode, kind, expiresAt)
  return { trial: { track: 'school', kind, expires_at: expiresAt, days }, burned: false, denied: false }
}

async function setSchoolTrialColumns(
  supabase: any,
  schoolId: string,
  courseCode: string,
  kind: string,
  expiresAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('schools')
    .update({
      platform_status: 'trial',
      trial_course_code: courseCode,
      trial_kind: kind,
      platform_expires_at: expiresAt,
    })
    .eq('id', schoolId)
  if (error && !isMissingPlatformSchema(error)) {
    console.warn('[onboarding/provision] school trial-column write failed (fail-open):', error.code, error.message)
  }
}

async function provisionTutorPlatformTrial(
  supabase: any,
  email: string,
  teacherId: string,
  existingStatus: string | null,
): Promise<{ trial: PlatformTrial | null; burned: boolean }> {
  const days = PLATFORM_TRIAL_PREMIUM_DAYS // tutor = 1 month always
  const expiresAt = isoIn(days)

  const burn = await burnTrial(supabase, email, 'tutor', null)
  if (burn.schemaUnavailable) {
    return { trial: null, burned: false }
  }
  if (burn.burned) {
    // Re-provision of an existing tutor that already has a trial set = idempotent
    // (return its existing expiry without extending it). If the burn exists but
    // this teacher has NO trial, it was burned on a prior (deleted) teacher row →
    // don't re-grant (the gate routes them to checkout).
    if (existingStatus === 'trial') {
      const { data: cur } = await supabase
        .from('teachers')
        .select('platform_expires_at')
        .eq('id', teacherId)
        .maybeSingle()
      if (cur?.platform_expires_at) {
        return { trial: { track: 'tutor', kind: 'premium_1mo', expires_at: cur.platform_expires_at, days }, burned: false }
      }
    }
    return { trial: null, burned: true }
  }

  // Fresh burn → grant the 1-month trial on the teacher row.
  const { error } = await supabase
    .from('teachers')
    .update({ platform_status: 'trial', platform_expires_at: expiresAt })
    .eq('id', teacherId)
  if (error && !isMissingPlatformSchema(error)) {
    console.warn('[onboarding/provision] tutor trial-column write failed (fail-open):', error.code, error.message)
  }
  return { trial: { track: 'tutor', kind: 'premium_1mo', expires_at: expiresAt, days }, burned: false }
}
