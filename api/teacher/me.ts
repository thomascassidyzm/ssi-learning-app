/**
 * Teacher Self API - GET / PATCH /api/teacher/me
 *
 * Auth required.
 *   GET  — returns { teacher, classes: [...] } or 404 if not a teacher
 *   PATCH — updates editable profile + price fields on teachers
 *
 * PATCH body (all optional):
 *   display_name, photo_url, bio, country, teaching_languages, student_price_pence
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const EDITABLE_FIELDS = [
  'display_name',
  'photo_url',
  'bio',
  'country',
  'teaching_languages',
  'student_price_pence',
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
      const { data: classes } = await supabase
        .from('classes')
        .select('id, class_name, course_code, student_join_code, current_seed, is_active, created_at')
        .eq('teacher_user_id', authResult.userId)
        .eq('is_active', true)
        .order('created_at', { ascending: true })

      res.status(200).json({ teacher, classes: classes || [] })
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
      'student_price_pence' in updates &&
      (typeof updates.student_price_pence !== 'number' ||
        (updates.student_price_pence as number) < 500 ||
        (updates.student_price_pence as number) > 1500)
    ) {
      res.status(400).json({ error: 'student_price_pence must be between 500 and 1500' })
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
