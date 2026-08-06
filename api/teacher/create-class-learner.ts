/**
 * Create Class Learner API - POST /api/teacher/create-class-learner
 *
 * Mints (or re-syncs) the class's own learner entity — see
 * api/_utils/classLearnerEntity.ts. Client-side class creation
 * (useClassesData.createClass) inserts the `classes` row directly (RLS is
 * disabled on `classes`), then calls this endpoint with the new class_id —
 * same two-step shape as the existing student_join_code follow-up
 * (create-class-join-code.ts). The `learners` insert itself MUST be
 * server-mediated: learners has RLS enabled and a class entity's synthetic
 * user_id can never satisfy `learners_insert_self` (auth.uid() match).
 *
 * Auth: verifyAuthToken + caller must be one of:
 *   - an active teacher of the class — the class_teachers relationship
 *     (user_tags CLASS:<id>/teacher) OR the demoted lead pointer
 *     classes.teacher_user_id. Co-teachers count.
 *   - an ssi_admin / god (platform admin)
 *   - the school_admin of the class's school (admin_user_id on schools row)
 * (same authorization shape as create-class-join-code.ts)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { ensureClassLearnerEntity } from '../_utils/classLearnerEntity'
import { rejectIfViewAs } from '../_utils/actAsGuard'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface CreateClassLearnerBody {
  class_id?: string
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
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

  const { class_id: classId } = (req.body || {}) as CreateClassLearnerBody
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
    const { data: cls, error: classError } = await supabase
      .from('classes')
      .select('id, teacher_user_id, school_id')
      .eq('id', classId)
      .single()

    if (classError || !cls) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    // Teacher of the class = the class_teachers relationship OR the demoted
    // lead pointer. Canonical membership pattern: class-teachers.ts:104-113.
    let authorized = cls.teacher_user_id === callerUserId

    if (!authorized) {
      const { data: callerTag } = await supabase
        .from('user_tags')
        .select('id')
        .eq('tag_type', 'class')
        .eq('tag_value', `CLASS:${cls.id}`)
        .eq('role_in_context', 'teacher')
        .eq('user_id', callerUserId)
        .is('removed_at', null)
        .maybeSingle()
      if (callerTag) authorized = true
    }

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
      res.status(403).json({ error: 'Not authorized to create a learner entity for this class' })
      return
    }

    const result = await ensureClassLearnerEntity(supabase, classId)
    if ('error' in result) {
      console.error('[CreateClassLearner] failed:', result.error)
      res.status(500).json({ error: result.error })
      return
    }

    res.status(200).json({ class_learner_id: result.learnerId })
  } catch (err) {
    console.error('[CreateClassLearner] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
