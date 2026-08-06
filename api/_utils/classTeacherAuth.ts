/**
 * classTeacherAuth — WHO MAY CHANGE WHO TEACHES A CLASS.
 *
 * Founder ruling, 2026-08-06, verbatim:
 *
 *   "any group leader or the current teacher of the class can add the
 *    co-teacher I think"
 *
 * So the rule for co-teacher MANAGEMENT (add / hand the lead over / remove
 * someone else / mint a co-teacher invite link) is exactly two principals,
 * plus the standing platform-admin support bypass:
 *
 *   1. the CURRENT (lead) teacher of that specific class, and
 *   2. any group leader ABOVE the class in the hierarchy — the class's school
 *      admin, and any govt_admin whose governed group is the class's group /
 *      the school's group or node, or an ancestor of either.
 *
 * What this is deliberately NOT:
 *   - not "any teacher of the class" (a co-teacher cannot recruit further
 *     co-teachers, nor unseat the lead who invited them), and
 *   - not "any teacher in the school".
 *
 * Distinguish this from TEACHING a class. Day-to-day teaching verbs — minting
 * student join codes, creating learner entities, running a class session — are
 * membership tests over every active teacher, co-teachers included (A-74 S2/S3),
 * and keep using `isActiveClassTeacher`. Only the who-teaches-here question
 * narrows to the lead-or-leader set above.
 *
 * The leader half delegates to `isWithinLeaderSubtree` — the SAME predicate the
 * other write paths (groups create/rename, invite minting) enforce. Two copies
 * of an authz rule is precisely where surfaces drift apart, so there is
 * deliberately only one.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isWithinLeaderSubtree } from './orgLeader'

export interface ClassAuthRow {
  id: string
  teacher_user_id: string | null
  school_id: string | null
  group_id: string | null
}

/** The class row every predicate here needs. Null when the class does not exist. */
export async function fetchClassAuthRow(
  svc: SupabaseClient,
  classId: string,
): Promise<ClassAuthRow | null> {
  const { data } = await svc
    .from('classes')
    .select('id, teacher_user_id, school_id, group_id')
    .eq('id', classId)
    .maybeSingle()
  return (data as unknown as ClassAuthRow) ?? null
}

/** ssi_admin / god — the platform support bypass, unchanged by the ruling. */
export async function isPlatformAdmin(svc: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await svc
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', userId)
    .maybeSingle()
  const role = data as unknown as { platform_role?: string; educational_role?: string } | null
  return role?.platform_role === 'ssi_admin' || role?.educational_role === 'god'
}

/** Does the caller hold an active teacher relationship with this class? */
export async function isActiveClassTeacher(
  svc: SupabaseClient,
  userId: string,
  classId: string,
): Promise<boolean> {
  const { data } = await svc
    .from('user_tags')
    .select('id')
    .eq('tag_type', 'class')
    .eq('tag_value', `CLASS:${classId}`)
    .eq('role_in_context', 'teacher')
    .eq('user_id', userId)
    .is('removed_at', null)
    .maybeSingle()
  return !!data
}

/**
 * Any group leader ABOVE this class: the school's own admin, or a govt_admin
 * whose governed group contains the class (its group, the school's group, or
 * the school's node) at any depth.
 *
 * Sideways and descendant leaders are excluded by `isWithinLeaderSubtree`,
 * which is self-or-strict-descendant only.
 */
export async function isLeaderAboveClass(
  svc: SupabaseClient,
  userId: string,
  classRow: ClassAuthRow,
): Promise<boolean> {
  const targetGroupIds: string[] = []
  if (classRow.group_id) targetGroupIds.push(classRow.group_id)

  if (classRow.school_id) {
    const { data: school } = await svc
      .from('schools')
      .select('admin_user_id, group_id, node_group_id')
      .eq('id', classRow.school_id)
      .maybeSingle()
    const s = school as unknown as {
      admin_user_id?: string | null
      group_id?: string | null
      node_group_id?: string | null
    } | null
    // The school admin IS the leader directly above the class.
    if (s?.admin_user_id && s.admin_user_id === userId) return true
    if (s?.node_group_id) targetGroupIds.push(s.node_group_id)
    if (s?.group_id) targetGroupIds.push(s.group_id)
  }


  if (!targetGroupIds.length) return false

  const { data: govtAdmin } = await svc
    .from('govt_admins')
    .select('group_id')
    .eq('user_id', userId)
    .maybeSingle()
  const ownGroupId = (govtAdmin as unknown as { group_id?: string } | null)?.group_id
  if (!ownGroupId) return false

  for (const target of targetGroupIds) {
    if (await isWithinLeaderSubtree(svc, ownGroupId, target)) return true
  }
  return false
}

/**
 * THE RULING, as one predicate: may `userId` change who teaches this class?
 *
 * Lead-pointer edge case: a class whose `teacher_user_id` is null has no lead
 * to be narrower than, so any active teacher of it counts as "the current
 * teacher of the class". Live check 2026-08-06 found zero such classes carrying
 * teacher tags, so this is a safety net, not a live path.
 */
export async function canManageClassTeachers(
  svc: SupabaseClient,
  userId: string,
  classRow: ClassAuthRow,
): Promise<boolean> {
  if (classRow.teacher_user_id === userId) return true
  if (!classRow.teacher_user_id && (await isActiveClassTeacher(svc, userId, classRow.id))) return true
  if (await isLeaderAboveClass(svc, userId, classRow)) return true
  return isPlatformAdmin(svc, userId)
}

/** Is the caller the admin of this class's school? */
export async function isSchoolAdminOfClass(
  svc: SupabaseClient,
  userId: string,
  classRow: ClassAuthRow,
): Promise<boolean> {
  if (!classRow.school_id) return false
  const { data } = await svc
    .from('schools')
    .select('admin_user_id')
    .eq('id', classRow.school_id)
    .maybeSingle()
  return (data as unknown as { admin_user_id?: string } | null)?.admin_user_id === userId
}

/**
 * May the caller TEACH this class — the day-to-day membership test, unchanged
 * by the ruling. Every active teacher counts, co-teachers included: minting a
 * student join code or creating a learner entity for a class you co-teach is
 * the whole point of co-teaching (A-74 S2/S3).
 */
export async function canTeachClass(
  svc: SupabaseClient,
  userId: string,
  classRow: ClassAuthRow,
): Promise<boolean> {
  if (classRow.teacher_user_id === userId) return true
  if (await isActiveClassTeacher(svc, userId, classRow.id)) return true
  if (await isPlatformAdmin(svc, userId)) return true
  return isSchoolAdminOfClass(svc, userId, classRow)
}
