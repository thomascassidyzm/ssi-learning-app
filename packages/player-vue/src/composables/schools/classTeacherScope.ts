/**
 * classTeacherScope — resolve "the classes a teacher teaches" via the
 * teacher↔class RELATIONSHIP, not the legacy `classes.teacher_user_id`
 * ownership column.
 *
 * Background: a class used to be owned by exactly one teacher
 * (`classes.teacher_user_id NOT NULL`). As of the 2026-06-13 first-class-class
 * migration, teacher↔class is a time-bounded relationship in
 * `user_tags(tag_type='class', role_in_context='teacher')`, surfaced by the
 * `class_teachers` view (lead + co-taught), with `classes.teacher_user_id`
 * demoted to a denormalised lead pointer. See
 * `docs/methodology/class-first-class-citizen.md` §4.
 *
 * This helper is the single place the schools composables ask "which classes
 * are mine?" so the ownership→membership swap happens once.
 *
 * Transitional UNION (non-breaking): the source of truth is the relationship
 * (`class_teachers`), but we also include the lead pointer so a class created
 * *after* the migration — which sets `teacher_user_id` but cannot yet write a
 * `class/teacher` tag (that needs the service-role endpoint, a separate item) —
 * still appears for its creator. Once the write path and the RLS rebase land,
 * the lead-pointer arm becomes redundant and can be dropped (Phase 3).
 */

import { getSchoolsClient } from './client'

/**
 * The set of class IDs `teacherUserId` teaches: the union of
 *   - `class_teachers` (active lead + co-taught relationships), and
 *   - active classes whose lead pointer still names them.
 * Both reads run under the caller's RLS (the authed schools client).
 */
export async function myTaughtClassIds(teacherUserId: string): Promise<string[]> {
  const client = getSchoolsClient()
  const ids = new Set<string>()

  // Relationship — the durable source of truth (lead + co-taught).
  const { data: rel } = await client
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_user_id', teacherUserId)
  for (const r of rel ?? []) {
    if (r.class_id) ids.add(r.class_id as string)
  }

  // Lead pointer — catches classes created before a class/teacher tag exists.
  const { data: owned } = await client
    .from('classes')
    .select('id')
    .eq('teacher_user_id', teacherUserId)
    .eq('is_active', true)
  for (const c of owned ?? []) {
    if (c.id) ids.add(c.id as string)
  }

  return [...ids]
}

/**
 * Active teachers of the given classes, keyed by class_id, from `class_teachers`.
 * Each entry: { user_id, is_lead }. Used to attribute classes/students to
 * teachers (e.g. useTeachersData) and to populate ClassInfo.teachers.
 */
export interface ClassTeacherRef {
  user_id: string
  is_lead: boolean
}

export async function teachersByClassId(
  classIds: string[]
): Promise<Map<string, ClassTeacherRef[]>> {
  const out = new Map<string, ClassTeacherRef[]>()
  if (classIds.length === 0) return out
  const client = getSchoolsClient()
  const { data } = await client
    .from('class_teachers')
    .select('class_id, teacher_user_id, is_lead')
    .in('class_id', classIds)
  for (const r of data ?? []) {
    const cid = r.class_id as string
    if (!cid) continue
    const list = out.get(cid) ?? []
    list.push({ user_id: r.teacher_user_id as string, is_lead: !!r.is_lead })
    out.set(cid, list)
  }
  return out
}
