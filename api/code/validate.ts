/**
 * Unified Code Validation API - POST /api/code/validate
 *
 * No auth required. Checks both invite_codes and entitlement_codes tables.
 * Returns a discriminated response with codeKind: 'invite' | 'entitlement'.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { code } = req.body || {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ valid: false, error: 'Missing code' })
    return
  }

  const normalizedCode = code.trim().toUpperCase()

  try {
    const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
    const supabaseAnon = createClient(supabaseUrl, anonKey)

    // 1. Try invite_code_validation first
    const { data: inviteRow } = await supabaseAnon
      .from('invite_code_validation')
      .select('id, code, code_type, grants_region, grants_school_id, grants_class_id, metadata, max_uses, use_count, expires_at, is_active')
      .eq('code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle()

    if (inviteRow) {
      // Check expiry
      if (inviteRow.expires_at && new Date(inviteRow.expires_at) <= new Date()) {
        res.status(200).json({ valid: false, error: 'Code expired' })
        return
      }
      // Check usage limit
      if (inviteRow.max_uses !== null && inviteRow.use_count >= inviteRow.max_uses) {
        res.status(200).json({ valid: false, error: 'Code fully used' })
        return
      }

      // Resolve display context using service role
      const supabase = createClient(supabaseUrl, supabaseServiceKey)
      const codeType: string = inviteRow.code_type
      const context: Record<string, string | undefined> = {}

      if (codeType === 'govt_admin' && inviteRow.grants_region) {
        const { data: region } = await supabase
          .from('regions')
          .select('name')
          .eq('code', inviteRow.grants_region)
          .single()
        context.regionName = region?.name
      } else if (codeType === 'school_admin') {
        const regionCode = inviteRow.metadata?.region_code
        if (regionCode) {
          const { data: region } = await supabase
            .from('regions')
            .select('name')
            .eq('code', regionCode)
            .single()
          context.regionName = region?.name
        }
      } else if (codeType === 'teacher' && inviteRow.grants_school_id) {
        const { data: school } = await supabase
          .from('schools')
          .select('school_name')
          .eq('id', inviteRow.grants_school_id)
          .single()
        context.schoolName = school?.school_name
      } else if (codeType === 'tester') {
        // No additional context needed for tester codes
        // Auto-entitlement trigger in DB handles course access
      } else if (codeType === 'student' && inviteRow.grants_class_id) {
        const { data: classRow } = await supabase
          .from('classes')
          .select('class_name, school_id, course_code, schools(school_name)')
          .eq('id', inviteRow.grants_class_id)
          .single()
        if (classRow) {
          context.className = classRow.class_name
          context.schoolName = (classRow.schools as any)?.school_name
          context.courseName = classRow.course_code
        }
      }

      console.log('[CodeValidate] Valid invite code:', normalizedCode, codeType)
      res.status(200).json({
        valid: true,
        codeKind: 'invite',
        codeType,
        inviteCodeId: inviteRow.id,
        context,
      })
      return
    }

    // 2. Try entitlement_code_validation
    const { data: entitlementRow } = await supabaseAnon
      .from('entitlement_code_validation')
      .select('id, code, access_type, granted_courses, duration_type, duration_days, label, max_uses, use_count, expires_at, is_active')
      .eq('code', normalizedCode)
      .eq('is_active', true)
      .maybeSingle()

    if (entitlementRow) {
      // Check expiry
      if (entitlementRow.expires_at && new Date(entitlementRow.expires_at) <= new Date()) {
        res.status(200).json({ valid: false, error: 'Code expired' })
        return
      }
      // Check usage limit
      if (entitlementRow.max_uses !== null && entitlementRow.use_count >= entitlementRow.max_uses) {
        res.status(200).json({ valid: false, error: 'Code fully used' })
        return
      }

      // Build access description
      let accessDescription = ''
      if (entitlementRow.access_type === 'full') {
        accessDescription = 'Full access to all courses'
      } else if (entitlementRow.granted_courses?.length) {
        accessDescription = `Access to ${entitlementRow.granted_courses.length} course${entitlementRow.granted_courses.length > 1 ? 's' : ''}`
      }

      let durationDescription = ''
      if (entitlementRow.duration_type === 'lifetime') {
        durationDescription = 'Lifetime'
      } else if (entitlementRow.duration_days) {
        durationDescription = `${entitlementRow.duration_days} days`
      }

      console.log('[CodeValidate] Valid entitlement code:', normalizedCode, entitlementRow.label)
      res.status(200).json({
        valid: true,
        codeKind: 'entitlement',
        entitlementCodeId: entitlementRow.id,
        label: entitlementRow.label,
        accessType: entitlementRow.access_type,
        grantedCourses: entitlementRow.granted_courses,
        durationType: entitlementRow.duration_type,
        durationDays: entitlementRow.duration_days,
        accessDescription,
        durationDescription,
      })
      return
    }

    // 3. Neither found
    console.log('[CodeValidate] Code not found:', normalizedCode)
    res.status(200).json({ valid: false, error: 'Invalid code' })
  } catch (error) {
    console.error('[CodeValidate] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
