/**
 * Invite Code Validation API - POST /api/invite/validate
 *
 * No auth required. Validates an invite code and returns display context
 * for pre-auth UI (show what the code grants before user signs up).
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
    // Use anon key for the public view query — no auth needed
    const anonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
    const supabaseAnon = createClient(supabaseUrl, anonKey)

    const { data: inviteRow, error: inviteError } = await supabaseAnon
      .from('invite_code_validation')
      .select('id, code, code_type, grants_region, grants_school_id, grants_class_id, metadata, max_uses, use_count, expires_at, is_active')
      .eq('code', normalizedCode)
      .eq('is_active', true)
      .single()

    if (inviteError || !inviteRow) {
      console.log('[InviteValidate] Code not found or not active:', normalizedCode)
      res.status(200).json({ valid: false, error: 'Invalid code' })
      return
    }

    // Check expiry
    if (inviteRow.expires_at && new Date(inviteRow.expires_at) <= new Date()) {
      console.log('[InviteValidate] Code expired:', normalizedCode)
      res.status(200).json({ valid: false, error: 'Code expired' })
      return
    }

    // Check usage limit
    if (inviteRow.max_uses !== null && inviteRow.use_count >= inviteRow.max_uses) {
      console.log('[InviteValidate] Code fully used:', normalizedCode)
      res.status(200).json({ valid: false, error: 'Code fully used' })
      return
    }

    // Resolve display context using service role (needs access across RLS boundaries)
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
      // Region from metadata
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

    console.log('[InviteValidate] Valid code:', normalizedCode, codeType)
    res.status(200).json({
      valid: true,
      codeType,
      inviteCodeId: inviteRow.id,
      context,
    })
  } catch (error) {
    console.error('[InviteValidate] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
