/**
 * Teacher Signup API - POST /api/teacher/signup
 *
 * Auth required. Creates:
 *   1. learner row if not exists
 *   2. teachers row (profile + commercial defaults)
 *   3. their first `classes` row (school_id=NULL, auto-generated student_join_code)
 *
 * Idempotent: if the authenticated user already has a teacher row, returns the
 * existing teacher + their classes list.
 *
 * Body:
 *   display_name      (required)  - teacher's public display name
 *   class_name        (required)  - first class name, e.g. "Monday Intermediates"
 *   course_code       (required)  - first class course, e.g. "eng_for_spa"
 *   bio, photo_url, country, teaching_languages (optional)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

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

  const {
    display_name,
    class_name,
    course_code,
    photo_url = null,
    bio = null,
    country = null,
    teaching_languages = [],
  } = req.body || {}

  if (!display_name || typeof display_name !== 'string' || !display_name.trim()) {
    res.status(400).json({ error: 'display_name is required' })
    return
  }
  if (!class_name || typeof class_name !== 'string' || !class_name.trim()) {
    res.status(400).json({ error: 'class_name is required' })
    return
  }
  if (!course_code || typeof course_code !== 'string' || !course_code.trim()) {
    res.status(400).json({ error: 'course_code is required' })
    return
  }
  if (!Array.isArray(teaching_languages)) {
    res.status(400).json({ error: 'teaching_languages must be an array' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Get or create learner (standard pattern: try fetch, insert if PGRST116)
    let { data: learner, error: learnerError } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .single()

    if (learnerError && learnerError.code === 'PGRST116') {
      const { data: newLearner, error: createError } = await supabase
        .from('learners')
        .insert({ user_id: authResult.userId, display_name: display_name.trim() })
        .select('id')
        .single()

      if (createError || !newLearner) {
        console.error('[TeacherSignup] Failed to create learner:', createError)
        res.status(500).json({ error: 'Failed to create user record' })
        return
      }
      learner = newLearner
    } else if (learnerError) {
      console.error('[TeacherSignup] Failed to fetch learner:', learnerError)
      res.status(500).json({ error: 'Failed to fetch user' })
      return
    }

    if (!learner) {
      res.status(500).json({ error: 'Failed to resolve learner' })
      return
    }

    // Idempotent: if teacher row exists, return it + classes list
    const { data: existing } = await supabase
      .from('teachers')
      .select('*')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (existing) {
      const { data: existingClasses } = await supabase
        .from('classes')
        .select('id, class_name, course_code, student_join_code, current_seed, is_active, created_at')
        .eq('teacher_user_id', authResult.userId)
        .order('created_at', { ascending: true })

      res.status(200).json({ teacher: existing, classes: existingClasses || [] })
      return
    }

    // If this learner already has an active premium subscription, link it on
    // creation so an existing premium learner becoming a teacher doesn't need
    // a Paddle round-trip or wait for the next webhook event to wire up.
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id, status')
      .eq('learner_id', learner.id)
      .maybeSingle()

    const linkedSubId =
      existingSub && existingSub.status === 'active' ? existingSub.id : null

    // Create teacher row
    const { data: teacher, error: teacherError } = await supabase
      .from('teachers')
      .insert({
        learner_id: learner.id,
        display_name: display_name.trim(),
        photo_url,
        bio,
        country,
        teaching_languages,
        own_subscription_id: linkedSubId,
      })
      .select('*')
      .single()

    if (teacherError || !teacher) {
      console.error('[TeacherSignup] Insert teacher failed:', teacherError)
      res.status(500).json({ error: teacherError?.message || 'Failed to create teacher' })
      return
    }

    // Create their first class (student_join_code auto-generated by DB trigger)
    const { data: firstClass, error: classError } = await supabase
      .from('classes')
      .insert({
        teacher_user_id: authResult.userId,
        class_name: class_name.trim(),
        course_code: course_code.trim(),
        school_id: null,
        is_active: true,
      })
      .select('id, class_name, course_code, student_join_code, current_seed, is_active, created_at')
      .single()

    if (classError || !firstClass) {
      console.error('[TeacherSignup] Insert class failed:', classError)
      // Teacher row was created; report but don't roll back
      res.status(500).json({
        error: classError?.message || 'Teacher created but failed to create first class',
        teacher,
        classes: [],
      })
      return
    }

    console.log(
      '[TeacherSignup] Created teacher',
      teacher.id,
      '+ first class',
      firstClass.id,
      '(join code:',
      firstClass.student_join_code,
      ')'
    )
    res.status(201).json({ teacher, classes: [firstClass] })
  } catch (error: any) {
    console.error('[TeacherSignup] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
