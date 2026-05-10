/**
 * Teacher Classes API - POST /api/teacher/classes, GET /api/teacher/classes
 *
 * Auth required.
 *   POST  — create a new class for the authenticated teacher
 *   GET   — list the authenticated teacher's classes
 *
 * POST body:
 *   class_name    (required)
 *   course_code   (required)
 *
 * Note: v1 does NOT gate on the teacher's Paddle Extra Class quantity. That
 * gating will be added when we wire subscription-quantity updates in a later
 * phase. For now, any active teacher can create as many classes as they like.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const CLASS_SELECT =
  'id, class_name, course_code, student_join_code, current_seed, is_active, created_at'

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Ensure the caller is a teacher
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authResult.userId)
      .maybeSingle()

    if (!learner) {
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    const { data: teacher } = await supabase
      .from('teachers')
      .select('id')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!teacher) {
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    if (req.method === 'GET') {
      const { data: classes, error } = await supabase
        .from('classes')
        .select(CLASS_SELECT)
        .eq('teacher_user_id', authResult.userId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      if (error) {
        console.error('[TeacherClasses] List failed:', error)
        res.status(500).json({ error: error.message })
        return
      }

      res.status(200).json({ classes: classes || [] })
      return
    }

    // POST — create a new class
    const { class_name, course_code } = req.body || {}

    if (!class_name || typeof class_name !== 'string' || !class_name.trim()) {
      res.status(400).json({ error: 'class_name is required' })
      return
    }
    if (!course_code || typeof course_code !== 'string' || !course_code.trim()) {
      res.status(400).json({ error: 'course_code is required' })
      return
    }

    // Per-teacher cap: 10 active classes.
    const TEACHER_CLASS_CAP = 10
    const { count: activeClassCount, error: countError } = await supabase
      .from('classes')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_user_id', authResult.userId)
      .eq('is_active', true)

    if (countError) {
      console.error('[TeacherClasses] Active class count failed:', countError)
      res.status(500).json({ error: countError.message })
      return
    }

    if ((activeClassCount ?? 0) >= TEACHER_CLASS_CAP) {
      res.status(409).json({
        error: 'You have reached the 10-class maximum. Archive a class to create another.',
      })
      return
    }

    const { data: created, error: insertError } = await supabase
      .from('classes')
      .insert({
        teacher_user_id: authResult.userId,
        class_name: class_name.trim(),
        course_code: course_code.trim(),
        school_id: null,
        is_active: true,
      })
      .select(CLASS_SELECT)
      .single()

    if (insertError || !created) {
      console.error('[TeacherClasses] Insert failed:', insertError)
      res.status(500).json({ error: insertError?.message || 'Failed to create class' })
      return
    }

    console.log(
      '[TeacherClasses] Created class',
      created.id,
      'for teacher',
      authResult.userId,
      '(join code:',
      created.student_join_code,
      ')'
    )
    res.status(201).json({ class: created })
  } catch (error: any) {
    console.error('[TeacherClasses] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
