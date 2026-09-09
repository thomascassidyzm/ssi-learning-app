/**
 * Set Trial State API - POST /api/admin/set-trial
 *
 * Admin-only test helper: "skip to end of trial" (or restore it) for one user.
 * Backdates the platform-subscription trial (school + tutor) and any self-granted
 * course play-trial entitlement so the end-of-trial gates fire immediately on the
 * target account's next load. Touches ONLY the rows owned by the target user.
 *
 * Requires auth. Only ssi_admin (or legacy god) users can call this.
 *
 * Body: { user_id: string (auth uid of the target), action: 'expire' | 'restore' }
 *
 * NOTE: a 'trial' with a null/future expiry resolves to ACTIVE (fail-open), so
 * expiring sets BOTH platform_status='expired' AND a past expiry. Restore sets
 * status back to 'trial' with THE WINDOW THAT ACCOUNT KIND ACTUALLY GETS —
 * never a hard-coded 30 (founder report 2026-09-09: restoring a Welsh school's
 * 365-day trial handed it 30 days and silently rewrote the school's clock).
 * The lengths come from trialPolicy.ts, the single trial-length policy point.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { trialDaysFor, TUTOR_TRIAL_DAYS, SCHOOL_PREMIUM_TRIAL_DAYS } from '../_utils/trialPolicy'
import { isCommercialCourse, trialDaysForCourse } from '../../packages/core/src/pricing'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * The window a school's trial restores to: whatever provision.ts would mint
 * for the language it is trialling. Falls back to the recorded trial_kind, and
 * finally to the heritage window for a school that never named a course.
 */
export function schoolRestoreDays(school: { trial_course_code?: string | null; trial_kind?: string | null }): number {
  const courseCode = school?.trial_course_code || null
  if (courseCode) return trialDaysFor('school', !isCommercialCourse({ course_code: courseCode }))
  if (school?.trial_kind === 'premium_1mo') return SCHOOL_PREMIUM_TRIAL_DAYS
  return trialDaysFor('school', true)
}

/** The window one course play-trial restores to, from its own course. */
export function entitlementRestoreDays(grantedCourses: unknown): number {
  const first = Array.isArray(grantedCourses)
    ? grantedCourses.find((c): c is string => typeof c === 'string' && c.length > 0)
    : null
  if (!first) return SCHOOL_PREMIUM_TRIAL_DAYS
  return trialDaysForCourse({ course_code: first })
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const { user_id, action } = req.body || {}
  if (!user_id || typeof user_id !== 'string') {
    res.status(400).json({ error: 'user_id (auth uid) is required' })
    return
  }
  if (action !== 'expire' && action !== 'restore') {
    res.status(400).json({ error: "action must be 'expire' or 'restore'" })
    return
  }

  const restore = action === 'restore'
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const isoIn = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const status = restore ? 'trial' : 'expired'

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Resolve the learner PK from the auth uid (teachers + entitlements key on it).
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', user_id)
      .single()
    const learnerId = learner?.id ?? null

    // Schools the user administers. Restoring uses each school's OWN window:
    // the language it is trialling decides it (heritage — Welsh and every
    // non-Big-10 target — a year; commercial a month), exactly as
    // provision.ts minted it. A school with no course recorded yet defaults to
    // the generous window, mirroring govt/create-school.ts.
    const { data: schoolRows, error: schoolsReadError } = await supabase
      .from('schools')
      .select('id, trial_course_code, trial_kind')
      .eq('admin_user_id', user_id)
    if (schoolsReadError) {
      console.error('[SetTrial] schools read failed:', schoolsReadError)
      res.status(500).json({ error: 'Failed to read school trial state', detail: schoolsReadError.message })
      return
    }

    const schools: { id: string }[] = []
    for (const school of schoolRows || []) {
      const when = restore ? isoIn(schoolRestoreDays(school)) : past
      const { error: schoolsError } = await supabase
        .from('schools')
        .update({ platform_status: status, platform_expires_at: when })
        .eq('id', school.id)
      if (schoolsError) {
        console.error('[SetTrial] schools update failed:', schoolsError)
        res.status(500).json({ error: 'Failed to update school trial state', detail: schoolsError.message })
        return
      }
      schools.push({ id: school.id })
    }

    let teachers: unknown[] | null = null
    let entitlements: unknown[] | null = null
    if (learnerId) {
      // Tutor platform trial: always the standard window (trialPolicy.ts).
      const t = await supabase
        .from('teachers')
        .update({
          platform_status: status,
          platform_expires_at: restore ? isoIn(TUTOR_TRIAL_DAYS) : past,
        })
        .eq('learner_id', learnerId)
        .select('id')
      if (t.error) {
        console.error('[SetTrial] teachers update failed:', t.error)
        res.status(500).json({ error: 'Failed to update teacher trial state', detail: t.error.message })
        return
      }
      teachers = t.data

      // Self-granted course play-trials only (not code/email-grant backed).
      // Each row restores to ITS OWN course's trial length — a Welsh play-trial
      // is a year, a Spanish one a month (packages/core/src/pricing).
      const { data: entRows, error: entReadError } = await supabase
        .from('user_entitlements')
        .select('id, granted_courses')
        .eq('learner_id', learnerId)
        .is('email_access_grant_id', null)
        .not('expires_at', 'is', null)
      if (entReadError) {
        console.error('[SetTrial] user_entitlements read failed:', entReadError)
        res.status(500).json({ error: 'Failed to read entitlement trial state', detail: entReadError.message })
        return
      }
      const touched: { id: string }[] = []
      for (const row of entRows || []) {
        const when = restore ? isoIn(entitlementRestoreDays(row.granted_courses)) : past
        const { error: entWriteError } = await supabase
          .from('user_entitlements')
          .update({ expires_at: when })
          .eq('id', row.id)
        if (entWriteError) {
          console.error('[SetTrial] user_entitlements update failed:', entWriteError)
          res.status(500).json({ error: 'Failed to update entitlement trial state', detail: entWriteError.message })
          return
        }
        touched.push({ id: row.id })
      }
      entitlements = touched
    }

    res.status(200).json({
      success: true,
      action,
      changed: {
        schools: schools?.length ?? 0,
        teachers: teachers?.length ?? 0,
        entitlements: entitlements?.length ?? 0,
      },
    })
  } catch (err) {
    console.error('[SetTrial] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
