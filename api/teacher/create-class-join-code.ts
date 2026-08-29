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
 *   - an active teacher of the class — the class_teachers relationship
 *     (user_tags CLASS:<id>/teacher) OR the demoted lead pointer
 *     classes.teacher_user_id. Co-teachers count.
 *   - an ssi_admin / god (platform admin)
 *   - the school_admin of the class's school, under EITHER spelling (the
 *     schools.admin_user_id founding pointer or an active SCHOOL: admin tag)
 *
 * The class must exist first — frontend inserts the class, then calls
 * this with the returned class_id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { canTeachClass } from '../_utils/classTeacherAuth'

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

  // This endpoint's ssi_admin bypass (below) exists for genuine admin
  // support actions — it must never fire while an admin is browsing
  // read-only as a persona (see actAsGuard.ts docstring).
  const viewAsRejection = rejectIfViewAs(req)
  if (viewAsRejection) {
    res.status(viewAsRejection.status).json({ error: viewAsRejection.error })
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
      .select('id, teacher_user_id, school_id, group_id, student_join_code')
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

    // Authorization: may the caller TEACH this class? One predicate owns that
    // question — lead pointer, active co-teacher tag, platform admin, or admin
    // of the class's school.
    //
    // TENANCY-08 (fixed 2026-08-25): this used to hand-roll the same four legs,
    // but its school-admin leg read the `schools.admin_user_id` founding pointer
    // ALONE, so every admin who joined after the founder was wrongly denied a
    // join code for her own school's class. canTeachClass()'s isSchoolAdminOf
    // owns both spellings (pointer AND active SCHOOL: admin tag), so this is a
    // strict superset of the old ladder — nobody authorised today loses access.
    const authorized = await canTeachClass(supabase, callerUserId, {
      id: cls.id,
      teacher_user_id: cls.teacher_user_id,
      school_id: cls.school_id,
      group_id: (cls as { group_id?: string | null }).group_id ?? null,
    })

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
