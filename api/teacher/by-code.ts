/**
 * Class Public Lookup API - GET /api/teacher/by-code?code=ABC-123
 *
 * Public (no auth). Returns the class + its owning teacher's public profile
 * for the student-side attribution gateway at /with/{code}.
 *
 * Code is a `classes.student_join_code` (auto-generated ABC-123 format).
 *
 * Returns 404 if the code is unknown, the class is inactive, or the teacher's
 * referral link is inactive.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const codeRaw = req.query.code
  const code = typeof codeRaw === 'string' ? codeRaw.trim().toUpperCase() : ''

  if (!code) {
    res.status(400).json({ error: 'code is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Look up class by join code
    const { data: classRow, error: classError } = await supabase
      .from('classes')
      .select('id, class_name, course_code, teacher_user_id, is_active, student_join_code')
      .eq('student_join_code', code)
      .maybeSingle()

    if (classError) {
      console.error('[ClassByCode] Class lookup failed:', classError)
      res.status(500).json({ error: classError.message })
      return
    }

    if (!classRow || !classRow.is_active) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    // Find teacher via teacher_user_id → learners.user_id → teachers.learner_id
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', classRow.teacher_user_id)
      .maybeSingle()

    if (!learner) {
      res.status(404).json({ error: 'Teacher not found' })
      return
    }

    const { data: teacher } = await supabase
      .from('teachers')
      .select(
        'id, referral_active, display_name, photo_url, bio, country, teaching_languages'
      )
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!teacher || !teacher.referral_active) {
      res.status(404).json({ error: 'Teacher not found' })
      return
    }

    const { referral_active: _ignored, id: teacherId, ...publicProfile } = teacher

    // Per-class cap: 20 active paying student subscriptions. Frontend uses
    // seats_remaining / is_full to gate the "Start learning" button.
    const CLASS_SEAT_CAP = 20
    const { count: referralCount, error: countError } = await supabase
      .from('teacher_referrals')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', classRow.id)
      .in('status', ['pending', 'active'])

    if (countError) {
      console.error('[ClassByCode] Referral count failed:', countError)
      res.status(500).json({ error: countError.message })
      return
    }

    const activeCount = referralCount ?? 0
    const seatsRemaining = Math.max(0, CLASS_SEAT_CAP - activeCount)
    const isFull = activeCount >= CLASS_SEAT_CAP

    res.status(200).json({
      class: {
        id: classRow.id,
        class_name: classRow.class_name,
        course_code: classRow.course_code,
        student_join_code: classRow.student_join_code,
      },
      teacher: {
        id: teacherId,
        ...publicProfile,
      },
      seats_remaining: seatsRemaining,
      is_full: isFull,
    })
  } catch (error: any) {
    console.error('[ClassByCode] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
