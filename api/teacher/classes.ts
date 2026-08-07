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
import { ensureClassLearnerEntity } from '../_utils/classLearnerEntity'
import { ensureClassTeacherTag } from '../_utils/classTeacherTag'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const CLASS_SELECT =
  'id, class_name, course_code, student_join_code, current_seed, class_learner_id, is_active, created_at'

/**
 * The classes this user CO-TEACHES via the class_teachers relationship
 * (`user_tags` tag_type='class', role_in_context='teacher'), restricted to the
 * personal tutor surface (school_id IS NULL, active). `classes.teacher_user_id`
 * is only the demoted lead pointer, so a list built from it alone silently
 * hides every class the user co-teaches — see
 * docs/methodology/class-first-class-citizen.md. Read errors are RETURNED,
 * never swallowed into an empty list.
 */
async function listCoTaughtClasses(
  supabase: any,
  userId: string,
  select: string,
): Promise<{ classes: any[] } | { error: string }> {
  const { data: tags, error: tagError } = await supabase
    .from('user_tags')
    .select('tag_value')
    .eq('user_id', userId)
    .eq('tag_type', 'class')
    .eq('role_in_context', 'teacher')
    .is('removed_at', null)

  if (tagError) return { error: tagError.message }

  const ids = (tags || [])
    .map((t: any) => String(t?.tag_value || '').replace('CLASS:', ''))
    .filter(Boolean)
  if (ids.length === 0) return { classes: [] }

  const { data: rows, error } = await supabase
    .from('classes')
    .select(select)
    .in('id', ids)
    .eq('is_active', true)
    .is('school_id', null)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { classes: rows || [] }
}

/** Union two class lists on id, preserving the first list's order. */
function mergeClassesById(primary: any[], extra: any[]): any[] {
  const seen = new Set(primary.map((c: any) => c.id))
  return [...primary, ...extra.filter((c: any) => !seen.has(c.id))]
}

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

      // Union the CO-TAUGHT classes. teacher_user_id is only the demoted lead
      // pointer — without this a co-teacher's own list is empty even though
      // every other guard lets them in (class-first-class-citizen.md).
      const coTaught = await listCoTaughtClasses(supabase, authResult.userId, CLASS_SELECT)
      if ('error' in coTaught) {
        console.error('[TeacherClasses] Co-taught list failed:', coTaught.error)
        res.status(500).json({ error: coTaught.error })
        return
      }

      res.status(200).json({ classes: mergeClassesById(classes || [], coTaught.classes) })
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
    // assigned classes must not eat the freelance cap). Counted on
    // `teacher_user_id`, which IS the lead pointer, so classes you merely
    // CO-TEACH never inflate your own cap — only the ones you lead do.
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

    // Dual-write the teacher↔class RELATIONSHIP alongside the lead pointer.
    // Writing only the pointer is exactly how 47 of 62 live classes ended up
    // with a lead and no tag, so the backfill would rot again without this.
    // NOT swallowed: a class whose creator is not a recorded teacher of it is
    // a broken class, not a partial success.
    const tagResult = await ensureClassTeacherTag(supabase, created.id, authResult.userId, authResult.userId)
    if ('error' in tagResult) {
      console.error('[TeacherClasses] class/teacher tag write failed:', tagResult.error)
      res.status(500).json({ error: `Class created but teacher record failed: ${tagResult.error}` })
      return
    }

    // Mint the class's own learner entity (owner ruling 2026-07-16). `created`
    // was already fetched before this write, so patch its class_learner_id in
    // memory rather than re-querying.
    const learnerResult = await ensureClassLearnerEntity(supabase, created.id)
    if ('error' in learnerResult) {
      console.error('[TeacherClasses] class learner entity failed (non-fatal):', learnerResult.error)
    } else {
      created.class_learner_id = learnerResult.learnerId
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
