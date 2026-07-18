/**
 * Current-user Teaching Context API - GET /api/me/teaching-context
 *
 * THE-MODEL.md §6, the ONE capability read the teacher shell gates on:
 * `{ groups, classes, can_play_as_class }`. Tutor-ness is NEVER stored —
 * it's `groups.length === 0 && classes.length > 0`, computed here on every
 * call from the current group/school-tag and teacher/class-membership rows
 * (THE-MODEL §1.3/§2.2/I5).
 *
 * Auth required. Service-role: reads across learners/user_tags/schools/
 * classes/class_teachers, scoped to the caller's own auth uid only — never
 * accepts a caller-supplied id.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface TeachingGroup {
  id: string
  label: 'school' | 'group'
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const authUid = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data: learner } = await supabase
      .from('learners')
      .select('id')
      .eq('user_id', authUid)
      .maybeSingle()

    if (!learner) {
      res.status(200).json({ groups: [], classes: [], can_play_as_class: false })
      return
    }

    const [groups, classes] = await Promise.all([
      resolveGroups(supabase, authUid),
      resolveTaughtClassIds(supabase, authUid),
    ])

    res.status(200).json({
      groups,
      classes,
      can_play_as_class: classes.length > 0,
    })
  } catch (error: any) {
    console.error('[me/teaching-context] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}

/**
 * Every school/group affiliation this user currently holds — active
 * `user_tags` rows (tag_type school|group), plus the legacy
 * `schools.admin_user_id` fallback for admins created before tags existed
 * (mirrors useSchoolContext.resolveUser). Deduped by (label, id).
 */
async function resolveGroups(supabase: any, authUid: string): Promise<TeachingGroup[]> {
  const out: TeachingGroup[] = []
  const seen = new Set<string>()
  const add = (label: TeachingGroup['label'], id: string) => {
    const key = `${label}:${id}`
    if (id && !seen.has(key)) {
      seen.add(key)
      out.push({ id, label })
    }
  }

  const { data: tags } = await supabase
    .from('user_tags')
    .select('tag_type, tag_value')
    .eq('user_id', authUid)
    .in('tag_type', ['school', 'group'])
    .is('removed_at', null)

  for (const t of tags ?? []) {
    const tagType = t.tag_type as 'school' | 'group'
    const id =
      tagType === 'school'
        ? (t.tag_value as string).replace('SCHOOL:', '')
        : (t.tag_value as string).replace('GROUP:', '')
    add(tagType, id)
  }

  const { data: adminSchool } = await supabase
    .from('schools')
    .select('id')
    .eq('admin_user_id', authUid)
    .limit(1)
    .maybeSingle()
  if (adminSchool?.id) add('school', adminSchool.id)

  return out
}

/**
 * Classes this user teaches: the union of the `class_teachers` relationship
 * (lead + co-taught) and the legacy lead-pointer column, mirroring
 * classTeacherScope.myTaughtClassIds (client) — same union, service-role.
 */
async function resolveTaughtClassIds(supabase: any, authUid: string): Promise<string[]> {
  const ids = new Set<string>()

  const [{ data: rel }, { data: owned }] = await Promise.all([
    supabase.from('class_teachers').select('class_id').eq('teacher_user_id', authUid),
    supabase.from('classes').select('id').eq('teacher_user_id', authUid).eq('is_active', true),
  ])
  for (const r of rel ?? []) if (r.class_id) ids.add(r.class_id as string)
  for (const c of owned ?? []) if (c.id) ids.add(c.id as string)

  return [...ids]
}
