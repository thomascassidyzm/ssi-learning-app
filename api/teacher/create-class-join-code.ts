/**
 * Create Class Join Code API - POST /api/teacher/create-class-join-code
 *
 * Inserts the invite_codes row that backs a class's student_join_code.
 * Replaces the direct client INSERT in
 * packages/player-vue/src/composables/schools/useClassesData.ts:610
 * (broken by 20260521180000_block_anon_role_escalation, which
 * REVOKEd INSERT on invite_codes).
 *
 * The classes table itself isn't REVOKE'd, so the class insert stays
 * client-side; only this join-code write moves server-side. Same
 * minimal-surgery pattern as the admin retrofits.
 *
 * Auth: verifyAuthToken + caller must be one of:
 *   - the class's teacher_user_id
 *   - an ssi_admin / god (platform admin)
 *   - the school_admin of the class's school (admin_user_id on schools row)
 *
 * The class must exist first — frontend inserts the class, then calls
 * this with the returned class_id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface CreateClassJoinCodeBody {
  class_id?: string
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

  const { class_id: classId } = (req.body || {}) as CreateClassJoinCodeBody
  if (!classId || typeof classId !== 'string') {
    res.status(400).json({ error: 'class_id is required' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  const callerUserId = authResult.userId

  try {
    // Load the class so we can both authorize the caller and read the code.
    const { data: cls, error: classError } = await supabase
      .from('classes')
      .select('id, teacher_user_id, school_id, student_join_code')
      .eq('id', classId)
      .single()

    if (classError || !cls) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    if (!cls.student_join_code) {
      res.status(400).json({ error: 'Class has no student_join_code to back' })
      return
    }

    // Authorization: caller is the teacher, OR is a platform admin, OR
    // is the admin of the school this class belongs to.
    let authorized = cls.teacher_user_id === callerUserId

    if (!authorized) {
      const { data: caller } = await supabase
        .from('learners')
        .select('platform_role, educational_role')
        .eq('user_id', callerUserId)
        .maybeSingle()

      if (caller?.platform_role === 'ssi_admin' || caller?.educational_role === 'god') {
        authorized = true
      }
    }

    if (!authorized && cls.school_id) {
      const { data: school } = await supabase
        .from('schools')
        .select('admin_user_id')
        .eq('id', cls.school_id)
        .maybeSingle()
      if (school?.admin_user_id === callerUserId) authorized = true
    }

    if (!authorized) {
      res.status(403).json({ error: 'Not authorized to create a join code for this class' })
      return
    }

    // Idempotency: if a row already exists for this code, return ok rather
    // than 500. The DB has a unique constraint on invite_codes.code.
    const { data: existing } = await supabase
      .from('invite_codes')
      .select('code')
      .eq('code', cls.student_join_code)
      .maybeSingle()

    if (existing) {
      res.status(200).json({ created: false, code: cls.student_join_code })
      return
    }

    const { error: insertError } = await supabase.from('invite_codes').insert({
      code: cls.student_join_code,
      code_type: 'student',
      grants_class_id: cls.id,
      created_by: callerUserId,
      is_active: true,
    })

    if (insertError) {
      console.error('[CreateClassJoinCode] insert failed:', insertError)
      res.status(500).json({ error: 'Failed to create join code', detail: insertError.message })
      return
    }

    console.log('[CreateClassJoinCode] created code for class', cls.id, 'by', callerUserId)
    res.status(200).json({ created: true, code: cls.student_join_code })
  } catch (err) {
    console.error('[CreateClassJoinCode] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
