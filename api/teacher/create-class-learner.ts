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
 *   - the school_admin of the class's school, under EITHER spelling (the
 *     schools.admin_user_id founding pointer or an active SCHOOL: admin tag)
 * (same authorization shape as create-class-join-code.ts)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { ensureClassLearnerEntity } from '../_utils/classLearnerEntity'
import { ensureSchoolTrialCourse } from '../_utils/schoolPlatformTrial'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { canTeachClass } from '../_utils/classTeacherAuth'

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
      .select('id, teacher_user_id, school_id, group_id, course_code')
      .eq('id', classId)
      .single()

    if (classError || !cls) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    // May the caller TEACH this class? One predicate owns that question — lead
    // pointer, active co-teacher tag, platform admin, or admin of the class's
    // school under EITHER spelling.
    //
    // TENANCY-08 (fixed 2026-08-25): the hand-rolled ladder this replaces read
    // the schools.admin_user_id founding pointer alone on its school-admin leg,
    // wrongly denying a tag-admin a learner entity for her own school's class.
    // canTeachClass() is a strict superset — nobody authorised today loses out.
    const authorized = await canTeachClass(supabase, callerUserId, {
      id: cls.id,
      teacher_user_id: cls.teacher_user_id,
      school_id: cls.school_id,
      group_id: (cls as { group_id?: string | null }).group_id ?? null,
    })

    if (!authorized) {
      res.status(403).json({ error: 'Not authorized to create a learner entity for this class' })
      return
    }

    // A trial school that never chose a language at signup (invite-born —
    // redeem.ts has no course to pass) records it HERE, the first time it
    // creates a class with a course. Fill-once and guarded inside the helper;
    // fail-open, so it can never block the learner-entity mint below.
    try {
      await ensureSchoolTrialCourse(supabase, cls.school_id, (cls as { course_code?: string | null }).course_code)
    } catch (trialErr) {
      console.warn('[CreateClassLearner] trial-course record failed (non-fatal):', trialErr)
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
