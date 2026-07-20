/**
 * Unified Code Validation API - POST /api/code/validate
 *
 * No auth required. Checks both invite_codes and entitlement_codes tables.
 * Returns a discriminated response with codeKind: 'invite' | 'entitlement'.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

/**
 * Already-redeemed check (founder ruling 2026-07-20: subsequent redeems of a
 * personal link go STRAIGHT to the person's surface — no confirm screen, no
 * second code spend). Mirrors redeem.ts's own dedup checks exactly, read-only.
 * Returns the role landing when the bearer user has already redeemed THIS
 * code's context, else null.
 */
async function checkAlreadyRedeemed(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  inviteRow: any
): Promise<string | null> {
  const codeType: string = inviteRow.code_type
  const landing = codeType === 'ssi_admin' ? '/admin'
    : ['school_admin', 'govt_admin', 'school_admin_join', 'teacher'].includes(codeType) ? '/schools'
    : '/'

  const hasTag = async (tagType: string, tagValue: string): Promise<boolean> => {
    const { data } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', tagType)
      .eq('tag_value', tagValue)
      .is('removed_at', null)
      .maybeSingle()
    return !!data
  }

  if ((codeType === 'teacher' || codeType === 'school_admin_join') && inviteRow.grants_school_id) {
    if (await hasTag('school', `SCHOOL:${inviteRow.grants_school_id}`)) return landing
  } else if (codeType === 'student' && inviteRow.grants_class_id) {
    if (await hasTag('class', `CLASS:${inviteRow.grants_class_id}`)) return landing
  } else if ((codeType === 'teacher' || codeType === 'student') && inviteRow.grants_group_id) {
    if (await hasTag('group', `GROUP:${inviteRow.grants_group_id}`)) return landing
  } else if (codeType === 'govt_admin') {
    const { data: govt } = await supabase
      .from('govt_admins')
      .select('group_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (govt && (!inviteRow.grants_group_id || (govt as any).group_id === inviteRow.grants_group_id)) return landing
  } else if (codeType === 'school_admin') {
    const { data: school } = await supabase
      .from('schools')
      .select('id')
      .eq('admin_user_id', userId)
      .maybeSingle()
    if (school) return landing
  }
  return null
}

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

  // Forgiving lookup: strip everything non-alphanumeric and uppercase, so
  // 'ZVK-078', 'zvk-078', 'ZVK 078', 'zvk078' all resolve to the same code.
  // This matches the STORED `code_normalized` column on both code tables.
  const stripped = String(code).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!stripped) {
    res.status(200).json({ valid: false, error: 'Invalid code' })
    return
  }

  try {
    // Service-role client (this is a server-side route). The *_code_validation
    // views are SECURITY DEFINER and were readable by anon, which let anyone
    // enumerate every invite/entitlement code (a privilege-escalation vector).
    // Reading them as service-role lets us REVOKE anon/authenticated SELECT on
    // the views without breaking validation.
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 1. Try invite_code_validation first
    const { data: inviteRow } = await supabase
      .from('invite_code_validation')
      .select('id, code, code_type, grants_region, grants_school_id, grants_class_id, grants_group_id, metadata, max_uses, use_count, expires_at, is_active')
      .eq('code_normalized', stripped)
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

      // Resolve display context (reuse the service-role client above)
      const codeType: string = inviteRow.code_type
      const context: Record<string, string | undefined> = {}

      if (codeType === 'govt_admin' && inviteRow.grants_group_id) {
        // Prefer the group (real node — may be a leader-named region already,
        // e.g. "Gwynedd Education Authority"); fall back to the legacy
        // regions lookup only when no group is attached yet.
        const { data: group } = await supabase
          .from('groups')
          .select('name')
          .eq('id', inviteRow.grants_group_id)
          .single()
        context.groupName = group?.name
      } else if (codeType === 'govt_admin' && inviteRow.grants_region) {
        const { data: region } = await supabase
          .from('regions')
          .select('name')
          .eq('code', inviteRow.grants_region)
          .single()
        context.groupName = region?.name
      } else if (codeType === 'govt_admin' && inviteRow.metadata?.organization_name) {
        // Brand-new leader-named group (no grants_group_id/grants_region yet —
        // the group is created at redemption, region-tier-design.md §1c). The
        // /group landing page still wants something to show in its hero.
        context.groupName = inviteRow.metadata.organization_name
      } else if (codeType === 'school_admin' && inviteRow.grants_group_id) {
        const { data: group } = await supabase
          .from('groups')
          .select('name')
          .eq('id', inviteRow.grants_group_id)
          .single()
        context.groupName = group?.name
      } else if (codeType === 'school_admin') {
        const regionCode = inviteRow.metadata?.region_code
        if (regionCode) {
          const { data: region } = await supabase
            .from('regions')
            .select('name')
            .eq('code', regionCode)
            .single()
          context.groupName = region?.name
        }
      } else if (codeType === 'school_admin_join' && inviteRow.grants_school_id) {
        const { data: school } = await supabase
          .from('schools')
          .select('school_name')
          .eq('id', inviteRow.grants_school_id)
          .single()
        context.schoolName = school?.school_name
      } else if (codeType === 'teacher' && inviteRow.grants_school_id) {
        const { data: school } = await supabase
          .from('schools')
          .select('school_name')
          .eq('id', inviteRow.grants_school_id)
          .single()
        context.schoolName = school?.school_name
      } else if ((codeType === 'teacher' || codeType === 'student') && inviteRow.grants_group_id) {
        // Node-scoped codes (ways-in mints, THE-MODEL §1.10): the invite is
        // AT a group node. Without this the capture screen showed a bare
        // "Teacher Invite"/"Student Invite" with no place name — every link
        // looked like the same generic link (founder finding 2026-07-20).
        // If the node is a school's own node, prefer the school's name.
        const { data: group } = await supabase
          .from('groups')
          .select('name')
          .eq('id', inviteRow.grants_group_id)
          .single()
        context.groupName = group?.name
        const { data: schoolNode } = await supabase
          .from('schools')
          .select('school_name')
          .eq('node_group_id', inviteRow.grants_group_id)
          .maybeSingle()
        if (schoolNode?.school_name) context.schoolName = schoolNode.school_name
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

      // Optional bearer: when the visitor already has a session, report
      // whether THEY have already redeemed this code's context, so the client
      // can go straight to their surface (no confirm screen, no second spend).
      let alreadyRedeemed = false
      let redirectTo: string | undefined
      if (req.headers.authorization) {
        const authResult = await verifyAuthToken(req)
        if (authResult.valid && authResult.userId) {
          const landing = await checkAlreadyRedeemed(supabase, authResult.userId, inviteRow)
          if (landing) {
            alreadyRedeemed = true
            redirectTo = landing
          }
        }
      }

      console.log('[CodeValidate] Valid invite code:', inviteRow.code, codeType)
      res.status(200).json({
        valid: true,
        codeKind: 'invite',
        codeType,
        inviteCodeId: inviteRow.id,
        context,
        alreadyRedeemed,
        ...(redirectTo ? { redirectTo } : {}),
      })
      return
    }

    // 2. Try entitlement_code_validation
    const { data: entitlementRow } = await supabase
      .from('entitlement_code_validation')
      .select('id, code, access_type, granted_courses, duration_type, duration_days, label, max_uses, use_count, expires_at, is_active')
      .eq('code_normalized', stripped)
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

      console.log('[CodeValidate] Valid entitlement code:', entitlementRow.code, entitlementRow.label)
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
    console.log('[CodeValidate] Code not found:', stripped)
    res.status(200).json({ valid: false, error: 'Invalid code' })
  } catch (error) {
    console.error('[CodeValidate] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
