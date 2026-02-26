/**
 * Invite Code Redemption API - POST /api/invite/redeem
 *
 * Requires Clerk JWT. Validates and redeems an invite code for the authenticated user,
 * creating the appropriate role records and updating learner data.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyClerkToken } from '../_utils/clerk'

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

  // Verify Clerk JWT
  const authResult = await verifyClerkToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const { code } = req.body || {}
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing code' })
    return
  }

  const normalizedCode = code.trim().toUpperCase()
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Step 1: Re-validate code
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

    // Step 2: Check user hasn't already redeemed same context
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

    // Step 3: Increment use_count
    const { error: incrementError } = await supabase
      .from('invite_codes')
      .update({ use_count: inviteRow.use_count + 1 })
      .eq('id', inviteRow.id)

    if (incrementError) {
      console.error('[InviteRedeem] Failed to increment use_count:', incrementError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Step 4: Update learner educational_role and invite_code_id
    const { error: learnerError } = await supabase
      .from('learners')
      .update({
        educational_role: codeType,
        invite_code_id: inviteRow.id,
      })
      .eq('user_id', userId)

    if (learnerError) {
      console.error('[InviteRedeem] Failed to update learner:', learnerError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }

    // Step 5: Create role-specific records
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
        console.error('[InviteRedeem] Failed to create govt_admin record:', govtError)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    } else if (codeType === 'school_admin') {
      // Insert school row (trigger auto-generates teacher_join_code)
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
        console.error('[InviteRedeem] Failed to create school:', schoolError)
        res.status(500).json({ error: 'Internal server error' })
        return
      }

      // Create invite_codes row for the teacher join code
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
        console.error('[InviteRedeem] Failed to create teacher invite code:', teacherCodeError)
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
        console.error('[InviteRedeem] Failed to create teacher tag:', tagError)
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
        console.error('[InviteRedeem] Failed to create student tag:', tagError)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
    }

    const isAdminOrTeacher = ['god', 'govt_admin', 'school_admin', 'teacher'].includes(codeType)
    const redirectTo = isAdminOrTeacher ? '/schools' : '/'

    console.log('[InviteRedeem] Redeemed code:', normalizedCode, 'for user:', userId, 'role:', codeType)
    res.status(200).json({
      success: true,
      role: codeType,
      redirectTo,
    })
  } catch (error) {
    console.error('[InviteRedeem] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
