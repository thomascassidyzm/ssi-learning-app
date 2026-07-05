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

/**
 * Server-side tutor platform gate for class-mutating calls. Open when the
 * platform columns say active / mid-dunning past_due / unexpired trial /
 * NULL (legacy, fail open); when they say expired, a linked TUTOR-PLATFORM
 * subscriptions row (active|past_due) still counts as paid — the webhook-lag
 * backstop api/school/subscription.ts uses. Fails OPEN on read errors.
 */
async function tutorPlatformOpen(
  supabase: any,
  teacher: { platform_status?: string | null; platform_expires_at?: string | null },
  learnerId: string,
): Promise<boolean> {
  const status = teacher.platform_status ?? null
  if (status == null) return true
  if (status === 'active' || status === 'past_due') return true
  if (status === 'trial') {
    const exp = teacher.platform_expires_at
    if (!exp || new Date(exp).getTime() > Date.now()) return true
  }
  try {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('status, plan_name')
      .eq('learner_id', learnerId)
      .maybeSingle()
    return (
      sub?.plan_name === 'SSi Premium (tutor bundle)' &&
      (sub?.status === 'active' || sub?.status === 'past_due')
    )
  } catch {
    return true // never lock a write path on an infra blip
  }
}

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
      .select('id, platform_status, platform_expires_at')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!teacher) {
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    if (req.method === 'GET') {
      // school_id IS NULL: this is the PERSONAL tutor surface. A dual-role
      // user (school-employed teacher who also freelances) must not see the
      // school's classes — roster, share link, play — in their own dashboard.
      const { data: classes, error } = await supabase
        .from('classes')
        .select(CLASS_SELECT)
        .eq('teacher_user_id', authResult.userId)
        .eq('is_active', true)
        .is('school_id', null)
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

    // Server-side platform gate: the dashboard hides the create button when
    // the trial has lapsed, but the API must not accept writes from an
    // expired account either (the gate was UI-only). Mirrors the
    // api/school/subscription semantics: NULL fails open (legacy), past_due
    // stays open (Paddle mid-dunning), only an elapsed trial or an explicit
    // expired/cancelled locks — with the tutor-bundle subscriptions row as
    // the webhook-lag backstop.
    if (!(await tutorPlatformOpen(supabase, teacher, learner.id))) {
      res.status(403).json({
        error: 'Your free trial has ended — subscribe to keep creating classes.',
        requires_checkout: true,
      })
      return
    }

    // Per-teacher cap: 10 active classes (personal classes only — school-
    // assigned classes must not eat the freelance cap).
    const TEACHER_CLASS_CAP = 10
    const { count: activeClassCount, error: countError } = await supabase
      .from('classes')
      .select('id', { count: 'exact', head: true })
      .eq('teacher_user_id', authResult.userId)
      .eq('is_active', true)
      .is('school_id', null)

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
