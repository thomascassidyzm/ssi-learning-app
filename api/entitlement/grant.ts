/**
 * Entitlement Grant API - POST /api/entitlement/grant
 *
 * Assign a BINARY entitlement to a group, school, or class (THE-MODEL.md
 * §1.11, founder-ruled 2026-07-18): "there are only two options: all courses
 * (if paid up), X_for_Y (if on a trial)." Kills the 150-course checkbox wall
 * — a node is either:
 *   { state: 'trial', course_code }  — exactly ONE course, expiry auto-derived
 *                                       (30d if that course is premium, 365d
 *                                       if free/community — same derivation
 *                                       schoolPlatformTrial.ts already uses).
 *   { state: 'paid' }                — every live/beta course, no list, no
 *                                       expiry.
 *
 * Compat (I10): entitlement_grants.granted_courses is still written on every
 * grant so existing readers (get_cascade_courses RPC, api/groups/index.ts)
 * keep working unchanged with zero code change — trial writes a single-course
 * array, paid writes a full live/beta-catalogue expansion (the same shape an
 * admin checking every one of the old 150 boxes would have produced).
 *
 * Requires auth. Only ssi_admin/god users can manage grants.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { PLATFORM_TRIAL_PREMIUM_DAYS, PLATFORM_TRIAL_FREE_DAYS } from '../_utils/schoolPlatformTrial'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function isoIn(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const adminResult = await verifyAdmin(req)
  if ('error' in adminResult) {
    res.status(adminResult.status).json({ error: adminResult.error })
    return
  }
  const userId = adminResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { group_id, school_id, class_id, state, course_code } = req.body || {}

    // Validate exactly one target
    const targets = [group_id, school_id, class_id].filter(Boolean)
    if (targets.length !== 1) {
      res.status(400).json({ error: 'Exactly one of group_id, school_id, or class_id is required' })
      return
    }

    if (state !== 'trial' && state !== 'paid') {
      res.status(400).json({ error: "state must be 'trial' or 'paid'" })
      return
    }

    let granted_courses: string[]
    let expires_at: string | null

    if (state === 'trial') {
      if (!course_code || typeof course_code !== 'string') {
        res.status(400).json({ error: 'course_code is required for a trial grant' })
        return
      }

      // Same validation the self-serve onboarding trial uses: course must be
      // genuinely deployed, and its pricing_tier decides the trial length.
      const { data: course, error: courseErr } = await supabase
        .from('courses')
        .select('course_code, pricing_tier, new_app_status')
        .eq('course_code', course_code)
        .maybeSingle()
      if (courseErr) throw courseErr
      if (!course || !['live', 'beta'].includes(course.new_app_status)) {
        res.status(400).json({ error: 'That course is not available' })
        return
      }

      const isFree = course.pricing_tier === 'free' || course.pricing_tier === 'community'
      const days = isFree ? PLATFORM_TRIAL_FREE_DAYS : PLATFORM_TRIAL_PREMIUM_DAYS
      granted_courses = [course_code]
      expires_at = isoIn(days)
    } else {
      if (course_code) {
        res.status(400).json({ error: 'course_code must not be set for a paid grant — paid is all courses, no list' })
        return
      }

      const { data: allCourses, error: coursesErr } = await supabase
        .from('courses')
        .select('course_code')
        .in('new_app_status', ['live', 'beta'])
      if (coursesErr) throw coursesErr
      granted_courses = (allCourses || []).map((c: { course_code: string }) => c.course_code)
      expires_at = null
    }

    // Upsert: if a grant already exists for this target, update it
    const matchColumn = group_id ? 'group_id' : school_id ? 'school_id' : 'class_id'
    const matchValue = group_id || school_id || class_id

    // Check for existing grant
    const { data: existing } = await supabase
      .from('entitlement_grants')
      .select('id')
      .eq(matchColumn, matchValue)
      .single()

    if (existing) {
      // Update existing grant
      const { data, error } = await supabase
        .from('entitlement_grants')
        .update({
          state,
          granted_courses,
          granted_by: userId,
          updated_at: new Date().toISOString(),
          expires_at,
          is_active: true,
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) throw error
      res.status(200).json({ grant: data, updated: true })
    } else {
      // Create new grant
      const row: Record<string, unknown> = {
        state,
        granted_courses,
        granted_by: userId,
        is_active: true,
        expires_at,
      }
      if (group_id) row.group_id = group_id
      if (school_id) row.school_id = school_id
      if (class_id) row.class_id = class_id

      const { data, error } = await supabase
        .from('entitlement_grants')
        .insert(row)
        .select()
        .single()

      if (error) throw error
      res.status(201).json({ grant: data, created: true })
    }
  } catch (error) {
    console.error('[EntitlementGrant] Error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
