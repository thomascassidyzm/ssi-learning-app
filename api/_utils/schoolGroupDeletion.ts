/**
 * schoolGroupDeletion — impact preview + FK-safe cascade delete for
 * non-demo schools/groups, used by the admin Schools Setup delete buttons.
 *
 * Demo orgs already have a purge path (demoSchoolTeardown.ts) gated behind
 * the demo_orgs expire/purge lifecycle — this is the equivalent for the
 * plain admin `schools`/`groups` rows, following the SAME deletion order
 * that path proved out (invite_codes/govt_admins/user_tags before the
 * schools/groups row itself): `schools.invite_code_id` and
 * `invite_codes.grants_school_id`/`grants_group_id`, and
 * `govt_admins.group_id`, all reference schools/groups with no ON DELETE
 * behaviour — every school gets 2 invite_codes rows at creation
 * (create-school.ts), so a bare `schools.delete()` 500s on essentially
 * every real school. This is why the existing delete buttons were broken.
 *
 * `classes` -> `class_sessions`/`entitlement_grants` DO cascade
 * (ON DELETE CASCADE, see supabase/schema.sql) so deleting the school row
 * itself is sufficient to clear those.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface DeletionImpact {
  classCount: number
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
}

export interface SchoolImpact extends DeletionImpact {
  schoolId: string
  schoolName: string
}

export interface GroupImpact extends DeletionImpact {
  groupId: string
  groupName: string
  schoolCount: number
  schoolNames: string[]
}

async function classActivity(
  supabase: SupabaseClient,
  classIds: string[],
): Promise<{ sessionCount: number; hasRealActivity: boolean }> {
  if (!classIds.length) return { sessionCount: 0, hasRealActivity: false }
  const { data, error } = await supabase
    .from('class_sessions')
    .select('cycles_completed')
    .in('class_id', classIds)
  if (error) throw new Error(`class_sessions read failed: ${error.message}`)
  const rows = data || []
  return {
    sessionCount: rows.length,
    hasRealActivity: rows.some((r) => (r.cycles_completed as number) > 0),
  }
}

async function tagCounts(
  supabase: SupabaseClient,
  tagValues: string[],
): Promise<{ learnerCount: number; teacherCount: number }> {
  if (!tagValues.length) return { learnerCount: 0, teacherCount: 0 }
  const { data, error } = await supabase
    .from('user_tags')
    .select('user_id, role_in_context')
    .eq('tag_type', 'school')
    .in('tag_value', tagValues)
    .is('removed_at', null)
  if (error) throw new Error(`user_tags read failed: ${error.message}`)
  const rows = data || []
  return {
    learnerCount: new Set(rows.filter((r) => r.role_in_context === 'student').map((r) => r.user_id)).size,
    teacherCount: new Set(rows.filter((r) => r.role_in_context !== 'student').map((r) => r.user_id)).size,
  }
}

export async function computeSchoolImpact(supabase: SupabaseClient, schoolId: string): Promise<SchoolImpact> {
  const { data: school, error: schoolErr } = await supabase
    .from('schools')
    .select('id, school_name')
    .eq('id', schoolId)
    .maybeSingle()
  if (schoolErr) throw new Error(`schools read failed: ${schoolErr.message}`)
  if (!school) throw new Error('School not found')

  const { data: classes, error: classesErr } = await supabase.from('classes').select('id').eq('school_id', schoolId)
  if (classesErr) throw new Error(`classes read failed: ${classesErr.message}`)
  const classIds = (classes || []).map((c) => c.id as string)

  const [{ sessionCount, hasRealActivity }, { learnerCount, teacherCount }] = await Promise.all([
    classActivity(supabase, classIds),
    tagCounts(supabase, [`SCHOOL:${schoolId}`]),
  ])

  return {
    schoolId,
    schoolName: school.school_name as string,
    classCount: classIds.length,
    sessionCount,
    learnerCount,
    teacherCount,
    hasRealActivity,
  }
}

export async function computeGroupImpact(supabase: SupabaseClient, groupId: string): Promise<GroupImpact> {
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .select('id, name')
    .eq('id', groupId)
    .maybeSingle()
  if (groupErr) throw new Error(`groups read failed: ${groupErr.message}`)
  if (!group) throw new Error('Group not found')

  const { data: schools, error: schoolsErr } = await supabase
    .from('schools')
    .select('id, school_name')
    .eq('group_id', groupId)
  if (schoolsErr) throw new Error(`schools read failed: ${schoolsErr.message}`)
  const schoolRows = schools || []
  const schoolIds = schoolRows.map((s) => s.id as string)

  const { data: classes, error: classesErr } = schoolIds.length
    ? await supabase.from('classes').select('id').in('school_id', schoolIds)
    : { data: [] as { id: string }[], error: null }
  if (classesErr) throw new Error(`classes read failed: ${classesErr.message}`)
  const classIds = (classes || []).map((c) => c.id as string)

  const [{ sessionCount, hasRealActivity }, { learnerCount, teacherCount }] = await Promise.all([
    classActivity(supabase, classIds),
    tagCounts(supabase, schoolIds.map((id) => `SCHOOL:${id}`)),
  ])

  return {
    groupId,
    groupName: group.name as string,
    schoolCount: schoolIds.length,
    schoolNames: schoolRows.map((s) => s.school_name as string),
    classCount: classIds.length,
    sessionCount,
    learnerCount,
    teacherCount,
    hasRealActivity,
  }
}

/** FK-safe cascade delete of one school. Caller has already verified admin + confirmation. */
export async function deleteSchoolCascade(supabase: SupabaseClient, schoolId: string): Promise<void> {
  const { error: unlinkErr } = await supabase
    .from('schools')
    .update({ invite_code_id: null })
    .eq('id', schoolId)
    .not('invite_code_id', 'is', null)
  if (unlinkErr) throw new Error(`schools invite_code_id unlink failed: ${unlinkErr.message}`)

  const { error: codesErr } = await supabase.from('invite_codes').delete().eq('grants_school_id', schoolId)
  if (codesErr) throw new Error(`invite_codes delete failed: ${codesErr.message}`)

  const { error: tagsErr } = await supabase
    .from('user_tags')
    .delete()
    .eq('tag_type', 'school')
    .eq('tag_value', `SCHOOL:${schoolId}`)
  if (tagsErr) throw new Error(`user_tags delete failed: ${tagsErr.message}`)

  // classes -> class_sessions/entitlement_grants cascade via ON DELETE CASCADE.
  const { error: deleteErr } = await supabase.from('schools').delete().eq('id', schoolId)
  if (deleteErr) throw new Error(`schools delete failed: ${deleteErr.message}`)
}

/** FK-safe cascade delete of one group. Schools in the group are ungrouped, not deleted. */
export async function deleteGroupCascade(supabase: SupabaseClient, groupId: string): Promise<void> {
  const { error: unlinkErr } = await supabase
    .from('govt_admins')
    .update({ invite_code_id: null })
    .eq('group_id', groupId)
    .not('invite_code_id', 'is', null)
  if (unlinkErr) throw new Error(`govt_admins invite_code_id unlink failed: ${unlinkErr.message}`)

  const { error: codesErr } = await supabase.from('invite_codes').delete().eq('grants_group_id', groupId)
  if (codesErr) throw new Error(`invite_codes delete failed: ${codesErr.message}`)

  const { error: govtErr } = await supabase.from('govt_admins').delete().eq('group_id', groupId)
  if (govtErr) throw new Error(`govt_admins delete failed: ${govtErr.message}`)

  const { error: ungroupError } = await supabase.from('schools').update({ group_id: null }).eq('group_id', groupId)
  if (ungroupError) throw new Error(`ungroup schools failed: ${ungroupError.message}`)

  const { error: deleteErr } = await supabase.from('groups').delete().eq('id', groupId)
  if (deleteErr) throw new Error(`groups delete failed: ${deleteErr.message}`)
}
