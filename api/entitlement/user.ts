/**
 * User Entitlements API - GET /api/entitlement/user
 *
 * Requires auth. Returns the current user's active (non-expired) entitlements.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveClassCourseCoverage } from '../_utils/classCoverage'
import { resolveOrgCourseCoverage } from '../_utils/orgCoverage'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Get learner_id
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', userId)
      .single()

    if (!learner) {
      res.status(200).json({ entitlements: [] })
      return
    }

    // Get active entitlements (not expired)
    const { data: entitlements, error } = await supabase
      .from('user_entitlements')
      .select('id, access_type, granted_courses, expires_at, redeemed_at, entitlement_code_id')
      .eq('learner_id', learner.id)

    if (error) {
      console.error('[EntitlementUser] Query error:', error)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Filter out expired entitlements
    const now = new Date()
    const active = (entitlements || []).filter((e) => {
      if (!e.expires_at) return true // lifetime
      return new Date(e.expires_at) > now
    })

    // Cascade entitlements from groups → school → class hierarchy
    try {
      const { data: cascadeCourses } = await supabase
        .rpc('get_cascade_courses', { p_user_id: userId })

      if (cascadeCourses && cascadeCourses.length > 0) {
        active.push({
          id: 'cascade',
          access_type: 'courses',
          granted_courses: cascadeCourses,
          expires_at: null,
          redeemed_at: null,
          entitlement_code_id: null,
        })
      }
    } catch (cascadeErr) {
      // Non-fatal — cascade is additive, don't block user entitlements
      console.error('[EntitlementUser] Cascade error (non-fatal):', cascadeErr)
    }

    // Class-coverage entitlement (docs/schools/group-commercial-model.md,
    // "Student entitlement — FINAL model", 2026-07-15): a class-affiliated
    // student gets their class's course in full for as long as that class's
    // school has live platform coverage (trial or paid) — derived fresh on
    // every check, no student-level state to expire or wipe.
    try {
      const classCourses = await resolveClassCourseCoverage(supabase, userId)
      if (classCourses.length > 0) {
        active.push({
          id: 'class-coverage',
          access_type: 'courses',
          granted_courses: classCourses,
          expires_at: null,
          redeemed_at: null,
          entitlement_code_id: null,
        })
      }
    } catch (classCoverageErr) {
      // Non-fatal — additive, don't block user entitlements
      console.error('[EntitlementUser] Class-coverage error (non-fatal):', classCoverageErr)
    }

    // Org-coverage entitlement (founder spec 2026-08-01): a member of an ORG
    // gets ALL languages for as long as that org has live platform coverage —
    // its 30-day trial, then its per-seat subscription. Orgs are class-less by
    // definition, so neither the cascade RPC (which joins through classes) nor
    // class-coverage above reaches their members; without this an org member
    // is entitled to nothing during the trial they were just sold.
    try {
      const orgCourses = await resolveOrgCourseCoverage(supabase, userId)
      if (orgCourses.length > 0) {
        active.push({
          id: 'org-coverage',
          access_type: 'courses',
          granted_courses: orgCourses,
          expires_at: null,
          redeemed_at: null,
          entitlement_code_id: null,
        })
      }
    } catch (orgCoverageErr) {
      // Non-fatal — additive, don't block user entitlements
      console.error('[EntitlementUser] Org-coverage error (non-fatal):', orgCoverageErr)
    }

    res.status(200).json({ entitlements: active })
  } catch (error) {
    console.error('[EntitlementUser] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
