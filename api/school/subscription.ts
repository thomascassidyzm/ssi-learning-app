/**
 * School / tutor PLATFORM subscription status — GET /api/school/subscription
 *
 * Server-side read of the platform-subscription gate (lever-3) so the
 * dashboard's "is this account still entitled to the dashboard?" decision has a
 * server source of truth, not just the client composable. Mirrors the shape of
 * GET /api/subscription.
 *
 * Auth required. Resolves the caller's school (admin_user_id or school user_tag)
 * and/or teacher row, and returns the platform status + computed `active`.
 *
 * FAILS OPEN: if the school_platform_subscription migration is not yet applied
 * (platform_* columns / table absent), the platform fields come back null and
 * `active` is TRUE — the gate must not lock anyone out pre-migration.
 *
 * Returns:
 *   {
 *     school:  { id, platform_status, platform_expires_at, trial_course_code,
 *                trial_kind, teacher_seats, teacher_count } | null,
 *     teacher: { platform_status, platform_expires_at } | null,
 *     active:  boolean,        // OR of school-active / teacher-active / fail-open
 *     reason:  string,
 *   }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { isPlatformActive } from '../_utils/platformStatus'
import { countSchoolTeachers } from '../_utils/schoolTeachers'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

// The plan_name the tutor_platform webhook stamps on the subscriptions row it
// creates for a freelance tutor (see api/teacher/paddle-webhook.ts → the
// grantLearnerPremium('SSi Premium (tutor bundle)') call in the tutor_platform
// branch). It is unique to the tutor platform purchase: learner_premium writes
// 'SSi Premium' and student_via_teacher writes 'SSi Student Access', so matching
// on this string scopes the platform backstop to genuine tutor-platform payers
// and avoids over-granting the paid dashboard to learner-premium-only teachers.
const TUTOR_PLATFORM_PLAN_NAME = 'SSi Premium (tutor bundle)'

function isMissingPlatformSchema(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  if (['PGRST204', 'PGRST205', '42703', '42P01'].includes(err.code || '')) return true
  return /column .* does not exist|relation .* does not exist|could not find the .* column|schema cache/i.test(
    err.message || '',
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized', active: true })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[school/subscription] Missing Supabase configuration')
    // Fail open on a server-config blip — never lock a dashboard on infra.
    res.status(200).json({ school: null, teacher: null, active: true, reason: 'config-unavailable' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // ssi_admin / god / govt_admin bypass the gate entirely.
    const { data: learner } = await supabase
      .from('learners')
      .select('id, platform_role, educational_role')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (
      learner?.platform_role === 'ssi_admin' ||
      learner?.educational_role === 'god' ||
      learner?.educational_role === 'govt_admin'
    ) {
      res.status(200).json({ school: null, teacher: null, active: true, reason: 'admin-bypass' })
      return
    }

    let schoolOut: Record<string, unknown> | null = null
    let teacherOut: Record<string, unknown> | null = null
    let schemaMissing = false

    // --- School (admin) ---
    // Resolve the school: admin_user_id, else the school user_tag.
    let schoolId: string | null = null
    {
      const { data: ownSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      schoolId = ownSchool?.id ?? null
      if (!schoolId) {
        const { data: tag } = await supabase
          .from('user_tags')
          .select('tag_value')
          .eq('user_id', auth.userId)
          .eq('tag_type', 'school')
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (tag?.tag_value) schoolId = String(tag.tag_value).replace('SCHOOL:', '')
      }
    }

    if (schoolId) {
      const { data: school, error: schoolErr } = await supabase
        .from('schools')
        .select('id, platform_status, platform_expires_at, trial_course_code, trial_kind, teacher_seats')
        .eq('id', schoolId)
        .maybeSingle()
      if (schoolErr && isMissingPlatformSchema(schoolErr)) {
        schemaMissing = true
      } else if (school) {
        // `teacher_count` = the school's ACTUAL staff, mirroring org.member_count
        // in api/org/subscription.ts. It exists so the Subscribe page can seed
        // its seat stepper from reality instead of a hard-coded 1 (a school with
        // three teachers was being offered one seat), and so the honest
        // "N joined · M paid" line has a server source of truth. It is a
        // DEFAULT and a display, never a cap: the admin steps it freely.
        schoolOut = { ...school, teacher_count: await countSchoolTeachers(supabase, schoolId) }
      }
    }

    // --- Teacher (tutor) ---
    if (learner?.id) {
      const { data: teacher, error: teacherErr } = await supabase
        .from('teachers')
        .select('platform_status, platform_expires_at')
        .eq('learner_id', learner.id)
        .maybeSingle()
      if (teacherErr && isMissingPlatformSchema(teacherErr)) {
        schemaMissing = true
      } else if (teacher) {
        teacherOut = teacher
      }
    }

    // Fail open if the migration is unapplied OR the account has neither a school
    // nor a teacher row (nothing to gate on — let the role check decide access).
    if (schemaMissing || (!schoolOut && !teacherOut)) {
      res.status(200).json({
        school: schoolOut,
        teacher: teacherOut,
        active: true,
        reason: schemaMissing ? 'pre-migration' : 'no-platform-record',
      })
      return
    }

    // Schools get the same dunning grace as tutors (mirrors teacherPaid below):
    // 'past_due' RETAINS dashboard access while Paddle's dunning retries run —
    // only a terminal 'expired'/'cancelled' locks. Surfaced as `school_past_due`
    // so the client can show a payment-problem banner instead of a silent grace.
    const schoolPastDue = schoolOut ? schoolOut.platform_status === 'past_due' : false

    const schoolActive =
      schoolPastDue ||
      (schoolOut
        ? isPlatformActive(schoolOut.platform_status as string | null, schoolOut.platform_expires_at as string | null)
        : false)

    // PAID = a live Paddle platform subscription exists on the teacher row —
    // 'active', or 'past_due' while Paddle's dunning retries run (still billed,
    // still a live subscription; opening a SECOND checkout would double-bill).
    // Distinct from an open TRIAL, which is active-but-not-paid: the upgrade
    // page needs the difference (paid → "Manage subscription" via the portal;
    // trial → "Subscribe" checkout), so it's returned as `teacher_paid` below.
    let teacherPaid = teacherOut
      ? ['active', 'past_due'].includes((teacherOut.platform_status as string) || '')
      : false

    // Defensive backstop: a paying tutor must never be locked out of the
    // dashboard. The tutor_platform checkout sets teachers.platform_status, but
    // in case that write hasn't landed (webhook lag / a pre-platform-column
    // payer) ALSO treat a teacher with a linked active TUTOR-PLATFORM
    // subscription as paid.
    //
    // SCOPED to the tutor platform plan, NOT any active subscription: the
    // subscriptions table also holds learner_premium and student_via_teacher
    // rows, so an unscoped check would hand the paid tutor dashboard to a
    // teacher who merely bought £15 learner-premium (an entitlement leak in a
    // live-payments app). The tutor_platform webhook stamps a unique plan_name
    // ('SSi Premium (tutor bundle)') that learner_premium ('SSi Premium') and
    // student ('SSi Student Access') purchases never use, so we match on it.
    // Status is restricted to the values the subscriptions_status_check CHECK
    // actually permits (active | past_due — 'none'/'cancelled' are inactive).
    // Fails open on any read error — never lock on this lookup.
    if (teacherOut && !teacherPaid && learner?.id) {
      try {
        const { data: sub } = await supabase
          .from('subscriptions')
          .select('status, plan_name')
          .eq('learner_id', learner.id)
          .maybeSingle()
        const s = sub?.status
        const isTutorPlatformPlan = sub?.plan_name === TUTOR_PLATFORM_PLAN_NAME
        if (isTutorPlatformPlan && (s === 'active' || s === 'past_due')) {
          teacherPaid = true
        }
      } catch {
        /* non-fatal — fall back to the platform_status gate above */
      }
    }

    // Tutor gate: paid (incl. mid-dunning past_due — Paddle is still billing
    // and retrying; instant lockout would strand a customer who just needs to
    // update a card) OR an open trial.
    const teacherActive =
      teacherPaid ||
      (teacherOut
        ? isPlatformActive(teacherOut.platform_status as string | null, teacherOut.platform_expires_at as string | null)
        : false)

    // Active if EITHER the school or the tutor record is active. (A school admin
    // is gated by their school; a tutor by their teacher row.)
    const active = schoolActive || teacherActive

    res.status(200).json({
      school: schoolOut,
      teacher: teacherOut,
      teacher_paid: teacherPaid,
      school_past_due: schoolPastDue,
      active,
      reason: active ? 'active' : 'expired',
    })
  } catch (err) {
    console.error('[school/subscription] Error:', err)
    // Fail open on any unexpected server error — never lock the dashboard on a blip.
    res.status(200).json({ school: null, teacher: null, active: true, reason: 'error-fail-open' })
  }
}
