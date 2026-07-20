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

export interface GroupDetail {
  id: string
  label: 'school' | 'group'
  name: string
}

export interface ClassDetail {
  id: string
  name: string
  course_code: string | null
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

    const [groupsDetail, classesDetail] = await Promise.all([
      resolveGroupsDetail(supabase, groups),
      resolveClassesDetail(supabase, classes),
    ])

    res.status(200).json({
      groups,
      classes,
      can_play_as_class: classes.length > 0,
      groups_detail: groupsDetail,
      classes_detail: classesDetail,
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

/**
 * Display names for each group affiliation — school name via `schools`,
 * group name via `groups`. A plain-words caller (TeacherInsightsView) needs
 * a name to show, not just an id; kept as a parallel array (not fields added
 * to `groups`) so the existing `groups: {id,label}[]` shape stays untouched.
 */
async function resolveGroupsDetail(supabase: any, groups: TeachingGroup[]): Promise<GroupDetail[]> {
  const schoolIds = groups.filter((g) => g.label === 'school').map((g) => g.id)
  const groupIds = groups.filter((g) => g.label === 'group').map((g) => g.id)

  const [{ data: schools }, { data: groupRows }] = await Promise.all([
    schoolIds.length
      ? supabase.from('schools').select('id, school_name').in('id', schoolIds)
      : Promise.resolve({ data: [] }),
    groupIds.length
      ? supabase.from('groups').select('id, name').in('id', groupIds)
      : Promise.resolve({ data: [] }),
  ])

  const schoolNames = new Map((schools ?? []).map((s: any) => [s.id, s.school_name as string]))
  const groupNames = new Map((groupRows ?? []).map((g: any) => [g.id, g.name as string]))

  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    name: (g.label === 'school' ? schoolNames.get(g.id) : groupNames.get(g.id)) ?? '',
  }))
}

/** Name + course for each taught class, so a caller can render a picker without a second round trip. */
async function resolveClassesDetail(supabase: any, classIds: string[]): Promise<ClassDetail[]> {
  if (!classIds.length) return []
  const { data } = await supabase
    .from('classes')
    .select('id, class_name, course_code')
    .in('id', classIds)
  return (data ?? []).map((c: any) => ({
    id: c.id,
    name: c.class_name as string,
    course_code: (c.course_code as string) ?? null,
  }))
}
