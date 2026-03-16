/**
 * Unified Code Redemption API - POST /api/code/redeem
 *
 * Requires auth. Accepts { code, codeKind } and routes to appropriate logic.
 * - invite: existing invite redemption logic
 * - entitlement: creates user_entitlements row
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

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

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const { code, codeKind } = req.body || {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing code' })
    return
  }
  if (!codeKind || !['invite', 'entitlement'].includes(codeKind)) {
    res.status(400).json({ error: 'Missing or invalid codeKind' })
    return
  }

  const normalizedCode = code.trim().toUpperCase()
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    if (codeKind === 'invite') {
      await redeemInviteCode(supabase, normalizedCode, userId, res)
    } else {
      await redeemEntitlementCode(supabase, normalizedCode, userId, res)
    }
  } catch (error) {
    console.error('[CodeRedeem] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

// ============================================================================
// INVITE CODE REDEMPTION (extracted from api/invite/redeem.ts)
// ============================================================================

async function redeemInviteCode(
  supabase: ReturnType<typeof createClient>,
  normalizedCode: string,
  userId: string,
  res: VercelResponse
): Promise<void> {
  // Re-validate code
  const { data: inviteRow, error: inviteError } = await supabase
    .from('invite_codes')
    .select('id, code, code_type, grants_region, grants_school_id, grants_class_id, metadata, max_uses, use_count, expires_at, is_active')
    .eq('code', normalizedCode)
    .eq('is_active', true)
    .single()

  if (inviteError || !inviteRow) {
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }

  if (inviteRow.expires_at && new Date(inviteRow.expires_at) <= new Date()) {
    res.status(200).json({ success: false, error: 'Code expired' })
    return
  }

  if (inviteRow.max_uses !== null && inviteRow.use_count >= inviteRow.max_uses) {
    res.status(200).json({ success: false, error: 'Code fully used' })
    return
  }

  const codeType: string = inviteRow.code_type

  // Check user hasn't already redeemed same context
  if (codeType === 'teacher' && inviteRow.grants_school_id) {
    const { data: existingTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${inviteRow.grants_school_id}`)
      .is('removed_at', null)
      .maybeSingle()
    if (existingTag) {
      res.status(200).json({ success: false, error: 'Already redeemed for this school' })
      return
    }
  } else if (codeType === 'student' && inviteRow.grants_class_id) {
    const { data: existingTag } = await supabase
      .from('user_tags')
      .select('id')
      .eq('user_id', userId)
      .eq('tag_type', 'class')
      .eq('tag_value', `CLASS:${inviteRow.grants_class_id}`)
      .is('removed_at', null)
      .maybeSingle()
    if (existingTag) {
      res.status(200).json({ success: false, error: 'Already redeemed for this class' })
      return
    }
  }

  // Increment use_count
  const { error: incrementError } = await supabase
    .from('invite_codes')
    .update({ use_count: inviteRow.use_count + 1 })
    .eq('id', inviteRow.id)

  if (incrementError) {
    console.error('[CodeRedeem] Failed to increment use_count:', incrementError)
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  // Update learner role and invite_code_id
  const learnerUpdate: Record<string, unknown> = { invite_code_id: inviteRow.id }
  if (codeType === 'ssi_admin') {
    learnerUpdate.platform_role = 'ssi_admin'
  } else {
    learnerUpdate.educational_role = codeType
  }
  const { error: learnerError } = await supabase
    .from('learners')
    .update(learnerUpdate)
    .eq('user_id', userId)

  if (learnerError) {
    console.error('[CodeRedeem] Failed to update learner:', learnerError)
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  // Create role-specific records
  if (codeType === 'govt_admin') {
    const { error: govtError } = await supabase
      .from('govt_admins')
      .insert({
        user_id: userId,
        region_code: inviteRow.grants_region,
        organization_name: inviteRow.metadata?.organization_name || '',
        created_by: userId,
        invite_code_id: inviteRow.id,
      })
    if (govtError) {
      console.error('[CodeRedeem] Failed to create govt_admin record:', govtError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  } else if (codeType === 'school_admin') {
    const { data: newSchool, error: schoolError } = await supabase
      .from('schools')
      .insert({
        admin_user_id: userId,
        school_name: inviteRow.metadata?.school_name || '',
        region_code: inviteRow.metadata?.region_code || null,
        invite_code_id: inviteRow.id,
      })
      .select('id, teacher_join_code')
      .single()

    if (schoolError || !newSchool) {
      console.error('[CodeRedeem] Failed to create school:', schoolError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    const { error: teacherCodeError } = await supabase
      .from('invite_codes')
      .insert({
        code: newSchool.teacher_join_code,
        code_type: 'teacher',
        grants_school_id: newSchool.id,
        created_by: userId,
        is_active: true,
      })

    if (teacherCodeError) {
      console.error('[CodeRedeem] Failed to create teacher invite code:', teacherCodeError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  } else if (codeType === 'teacher') {
    const { error: tagError } = await supabase
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'school',
        tag_value: `SCHOOL:${inviteRow.grants_school_id}`,
        role_in_context: 'teacher',
        added_by: userId,
      })
    if (tagError) {
      console.error('[CodeRedeem] Failed to create teacher tag:', tagError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  } else if (codeType === 'student') {
    const { error: tagError } = await supabase
      .from('user_tags')
      .insert({
        user_id: userId,
        tag_type: 'class',
        tag_value: `CLASS:${inviteRow.grants_class_id}`,
        role_in_context: 'student',
        added_by: userId,
      })
    if (tagError) {
      console.error('[CodeRedeem] Failed to create student tag:', tagError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
  }

  const redirectTo = codeType === 'ssi_admin' ? '/admin'
    : ['god', 'govt_admin', 'school_admin', 'teacher'].includes(codeType) ? '/schools'
    : '/'

  console.log('[CodeRedeem] Redeemed invite code:', normalizedCode, 'for user:', userId, 'role:', codeType)
  res.status(200).json({
    success: true,
    codeKind: 'invite',
    role: codeType,
    redirectTo,
  })
}

// ============================================================================
// ENTITLEMENT CODE REDEMPTION
// ============================================================================

async function redeemEntitlementCode(
  supabase: ReturnType<typeof createClient>,
  normalizedCode: string,
  userId: string,
  res: VercelResponse
): Promise<void> {
  // Re-validate code
  const { data: entitlementRow, error: entitlementError } = await supabase
    .from('entitlement_codes')
    .select('id, code, access_type, granted_courses, duration_type, duration_days, label, max_uses, use_count, expires_at, is_active, grants_platform_role, grants_dashboard_courses')
    .eq('code', normalizedCode)
    .eq('is_active', true)
    .single()

  if (entitlementError || !entitlementRow) {
    res.status(200).json({ success: false, error: 'Invalid code' })
    return
  }

  if (entitlementRow.expires_at && new Date(entitlementRow.expires_at) <= new Date()) {
    res.status(200).json({ success: false, error: 'Code expired' })
    return
  }

  if (entitlementRow.max_uses !== null && entitlementRow.use_count >= entitlementRow.max_uses) {
    res.status(200).json({ success: false, error: 'Code fully used' })
    return
  }

  // Get learner_id from user_id
  const { data: learner, error: learnerError } = await supabase
    .from('learners')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (learnerError || !learner) {
    console.error('[CodeRedeem] Learner not found for user:', userId)
    res.status(200).json({ success: false, error: 'User not found' })
    return
  }

  // Check if already redeemed this code
  const { data: existing } = await supabase
    .from('user_entitlements')
    .select('id')
    .eq('learner_id', learner.id)
    .eq('entitlement_code_id', entitlementRow.id)
    .maybeSingle()

  if (existing) {
    res.status(200).json({ success: false, error: 'Code already redeemed' })
    return
  }

  // Compute expires_at for the entitlement
  let entitlementExpiresAt: string | null = null
  if (entitlementRow.duration_type === 'time_limited' && entitlementRow.duration_days) {
    const expires = new Date()
    expires.setDate(expires.getDate() + entitlementRow.duration_days)
    entitlementExpiresAt = expires.toISOString()
  }

  // Create user_entitlements row
  const { error: insertError } = await supabase
    .from('user_entitlements')
    .insert({
      learner_id: learner.id,
      entitlement_code_id: entitlementRow.id,
      access_type: entitlementRow.access_type,
      granted_courses: entitlementRow.granted_courses,
      expires_at: entitlementExpiresAt,
    })

  if (insertError) {
    console.error('[CodeRedeem] Failed to create user_entitlement:', insertError)
    res.status(500).json({ error: 'Internal server error' })
    return
  }

  // Increment use_count
  const { error: incrementError } = await supabase
    .from('entitlement_codes')
    .update({ use_count: entitlementRow.use_count + 1 })
    .eq('id', entitlementRow.id)

  if (incrementError) {
    console.error('[CodeRedeem] Failed to increment entitlement use_count:', incrementError)
    // Non-fatal: entitlement was created
  }

  // If code grants dashboard access, update the learner's platform_role and dashboard_courses
  if (entitlementRow.grants_platform_role) {
    const learnerUpdate: Record<string, unknown> = {
      platform_role: entitlementRow.grants_platform_role,
    }
    if (entitlementRow.grants_dashboard_courses) {
      learnerUpdate.dashboard_courses = entitlementRow.grants_dashboard_courses
    }
    const { error: roleError } = await supabase
      .from('learners')
      .update(learnerUpdate)
      .eq('id', learner.id)

    if (roleError) {
      console.error('[CodeRedeem] Failed to update platform_role:', roleError)
      // Non-fatal: entitlement was created, dashboard access just won't work yet
    } else {
      console.log('[CodeRedeem] Granted dashboard access:', entitlementRow.grants_platform_role, 'courses:', entitlementRow.grants_dashboard_courses)
    }
  }

  const redirectTo = entitlementRow.grants_platform_role ? '/' : '/'

  console.log('[CodeRedeem] Redeemed entitlement code:', normalizedCode, 'for user:', userId, 'label:', entitlementRow.label)
  res.status(200).json({
    success: true,
    codeKind: 'entitlement',
    label: entitlementRow.label,
    accessType: entitlementRow.access_type,
    grantsDashboardAccess: !!entitlementRow.grants_platform_role,
    redirectTo,
  })
}
