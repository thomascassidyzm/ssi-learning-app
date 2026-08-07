/**
 * Teacher Self API - GET / PATCH /api/teacher/me
 *
 * Auth required.
 *   GET  — returns { teacher, classes: [...] } or 404 if not a teacher
 *   PATCH — updates editable profile + price fields on teachers
 *
 * PATCH body (all optional):
 *   display_name, photo_url, bio, country, teaching_languages
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const CLASS_SELECT =
  'id, class_name, course_code, student_join_code, current_seed, is_active, created_at'

/**
 * The classes this user CO-TEACHES via the class_teachers relationship
 * (`user_tags` tag_type='class', role_in_context='teacher'), restricted to the
 * personal tutor surface. `classes.teacher_user_id` is only the demoted lead
 * pointer, so a list built from it alone silently hides every co-taught class —
 * see docs/methodology/class-first-class-citizen.md. Mirrors the helper in
 * api/teacher/classes.ts.
 */
async function listCoTaughtClasses(
  supabase: any,
  userId: string,
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
    .select(CLASS_SELECT)
    .in('id', ids)
    .eq('is_active', true)
    .is('school_id', null)
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { classes: rows || [] }
}

const EDITABLE_FIELDS = [
  'display_name',
  'photo_url',
  'bio',
  'country',
  'teaching_languages',
] as const

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
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
      .select('*')
      .eq('learner_id', learner.id)
      .maybeSingle()

    if (!teacher) {
      res.status(404).json({ error: 'Not a teacher' })
      return
    }

    if (req.method === 'GET') {
      // school_id IS NULL: personal tutor surface only — school-assigned
      // classes belong to the /schools dashboard, not the freelance one.
      const { data: classes, error: classesError } = await supabase
        .from('classes')
        .select(CLASS_SELECT)
        .eq('teacher_user_id', authResult.userId)
        .eq('is_active', true)
        .is('school_id', null)
        .order('created_at', { ascending: true })

      if (classesError) {
        console.error('[TeacherMe] Class list failed:', classesError)
        res.status(500).json({ error: classesError.message })
        return
      }

      // Union the CO-TAUGHT classes — teacher_user_id is only the lead pointer.
      const coTaught = await listCoTaughtClasses(supabase, authResult.userId)
      if ('error' in coTaught) {
        console.error('[TeacherMe] Co-taught list failed:', coTaught.error)
        res.status(500).json({ error: coTaught.error })
        return
      }

      const led = classes || []
      const seen = new Set(led.map((c: any) => c.id))
      const merged = [...led, ...coTaught.classes.filter((c: any) => !seen.has(c.id))]

      res.status(200).json({ teacher, classes: merged })
      return
    }

    // PATCH
    const updates: Record<string, unknown> = {}
    const body = req.body || {}

    for (const field of EDITABLE_FIELDS) {
      if (field in body) updates[field] = body[field]
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No editable fields provided' })
      return
    }

    if (
      'display_name' in updates &&
      (typeof updates.display_name !== 'string' || !(updates.display_name as string).trim())
    ) {
      res.status(400).json({ error: 'display_name cannot be empty' })
      return
    }

    if ('teaching_languages' in updates && !Array.isArray(updates.teaching_languages)) {
      res.status(400).json({ error: 'teaching_languages must be an array' })
      return
    }

    const { data: updated, error: updateError } = await supabase
      .from('teachers')
      .update(updates)
      .eq('id', teacher.id)
      .select('*')
      .single()

    if (updateError || !updated) {
      console.error('[TeacherMe] Update failed:', updateError)
      res.status(500).json({ error: updateError?.message || 'Update failed' })
      return
    }

    res.status(200).json({ teacher: updated })
  } catch (error: any) {
    console.error('[TeacherMe] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
