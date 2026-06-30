/**
 * Class Public Lookup API - GET /api/teacher/by-code?code=ABC-123
 *
 * Public (no auth). Returns the class + its owning teacher's public profile
 * for the student-side attribution gateway at /with/{code}.
 *
 * Code is a `classes.student_join_code` (auto-generated ABC-123 format).
 *
 * Returns 404 in two distinguishable cases (both keep status 404 so existing
 * consumers are unaffected, but carry a `reason` + friendly `message` a client
 * can surface):
 *   - reason 'not_found'   — the code matches no class (the link is wrong)
 *   - reason 'unavailable' — the code matches a real class/teacher, but the
 *                            class is inactive or the teacher has paused their
 *                            referral link (the link is right, just not open)
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
      .select('id, class_name, course_code, teacher_user_id, is_active, student_join_code, school_id')
      .eq('student_join_code', code)
      .maybeSingle()

    if (classError) {
      console.error('[ClassByCode] Class lookup failed:', classError)
      res.status(500).json({ error: classError.message })
      return
    }

    if (!classRow) {
      res.status(404).json({ error: 'Class not found', reason: 'not_found' })
      return
    }

    if (!classRow.is_active) {
      // The link is valid, but this class is no longer accepting students.
      res.status(404).json({
        error: 'Class unavailable',
        reason: 'unavailable',
        message: 'This teacher link is temporarily unavailable.',
      })
      return
    }

    // Pricing tier of the class's course. The webhook re-derives price/commission
    // server-side; this drives the client's FREE vs PAID join branch. Fail money-
    // safe: an unknown tier is treated as premium (paid) rather than free.
    let courseIsFree = false
    {
      const { data: courseRow } = await supabase
        .from('courses')
        .select('pricing_tier')
        .eq('course_code', classRow.course_code)
        .maybeSingle()
      const tier = courseRow?.pricing_tier
      courseIsFree = tier === 'free' || tier === 'community'
    }

    const isSchoolClass = !!classRow.school_id

    // Resolve a public display profile for the class's assigned teacher (used by
    // both branches for the "with {teacher}" line).
    const { data: teacherLearner } = await supabase
      .from('learners')
      .select('id, display_name')
      .eq('user_id', classRow.teacher_user_id)
      .maybeSingle()

    let teacherPayload: {
      id: string
      display_name: string
      photo_url: string | null
      bio: string | null
      country: string | null
      teaching_languages: string[]
    } | null = null

    if (isSchoolClass) {
      // SCHOOL class: there is no freelance teacher/referral to gate on — the
      // class is owned by an institution. Gate on the school's platform status
      // (fail OPEN when unknown/absent, mirroring the app's own rule) and build a
      // display profile from the assigned teacher, falling back to the school name.
      const { data: school } = await supabase
        .from('schools')
        .select('school_name, platform_status')
        .eq('id', classRow.school_id)
        .maybeSingle()

      const ps = school?.platform_status
      if (ps === 'expired' || ps === 'cancelled') {
        res.status(404).json({
          error: 'Class unavailable',
          reason: 'unavailable',
          message: 'This teacher link is temporarily unavailable.',
        })
        return
      }

      const displayName =
        (teacherLearner?.display_name && teacherLearner.display_name.trim()) ||
        school?.school_name ||
        'Your teacher'

      teacherPayload = {
        id: classRow.teacher_user_id,
        display_name: displayName,
        photo_url: null,
        bio: null,
        country: null,
        teaching_languages: [],
      }
    } else {
      // TUTOR / ACT class (school_id null): keep the freelance-teacher gate. The
      // teacher must have a teachers row with referral_active set.
      if (!teacherLearner) {
        res.status(404).json({
          error: 'Class unavailable',
          reason: 'unavailable',
          message: 'This teacher link is temporarily unavailable.',
        })
        return
      }

      const { data: teacher } = await supabase
        .from('teachers')
        .select(
          'id, referral_active, display_name, photo_url, bio, country, teaching_languages'
        )
        .eq('learner_id', teacherLearner.id)
        .maybeSingle()

      if (!teacher || !teacher.referral_active) {
        res.status(404).json({
          error: 'Class unavailable',
          reason: 'unavailable',
          message: 'This teacher link is temporarily unavailable.',
        })
        return
      }

      const { referral_active: _ignored, id: teacherId, ...publicProfile } = teacher
      teacherPayload = { id: teacherId, ...(publicProfile as any) }
    }

    // Seat accounting. The webhook writes teacher_referrals.status as 'active'
    // (live/dunning) or 'cancelled'/'lapsed' — it never writes 'pending', so the
    // occupied-seat count is the 'active' rows. School classes are uncapped (an
    // institution buys per-teacher, not per-seat here); tutor classes keep the cap.
    const TUTOR_SEAT_CAP = 20
    const { count: referralCount, error: countError } = await supabase
      .from('teacher_referrals')
      .select('id', { count: 'exact', head: true })
      .eq('class_id', classRow.id)
      .eq('status', 'active')

    if (countError) {
      console.error('[ClassByCode] Referral count failed:', countError)
      res.status(500).json({ error: countError.message })
      return
    }

    const activeCount = referralCount ?? 0
    const seatsRemaining = isSchoolClass
      ? null
      : Math.max(0, TUTOR_SEAT_CAP - activeCount)
    const isFull = isSchoolClass ? false : activeCount >= TUTOR_SEAT_CAP

    res.status(200).json({
      class: {
        id: classRow.id,
        class_name: classRow.class_name,
        course_code: classRow.course_code,
        student_join_code: classRow.student_join_code,
        // null = tutor/ACT class (£10 student); set = school class (£5 student).
        school_id: classRow.school_id,
        // true = free-tier course → student joins free, no checkout.
        course_is_free: courseIsFree,
      },
      teacher: teacherPayload,
      seats_remaining: seatsRemaining,
      is_full: isFull,
    })
  } catch (error: any) {
    console.error('[ClassByCode] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
