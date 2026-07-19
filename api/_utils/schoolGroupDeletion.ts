/**
 * schoolGroupDeletion — impact preview + FK-safe cascade delete for
 * schools/groups/classes, used by the admin Schools Setup delete buttons AND
 * the owner self-serve delete endpoints (api/school/delete-class.ts,
 * api/admin/update-school.ts, api/groups/[id].ts — "every level can delete
 * the things it created and everything below them", founder ruling).
 *
 * Demo orgs already have a purge path (demoSchoolTeardown.ts) gated behind
 * the demo_orgs expire/purge lifecycle — this is the equivalent for the
 * plain `schools`/`groups`/`classes` rows, following the SAME deletion order
 * that path proved out (invite_codes/govt_admins/user_tags before the
 * schools/groups/classes row itself).
 *
 * As of 20260718c_invite_codes_ondelete_fk.sql the invite_codes grants FKs
 * (`grants_class_id`/`grants_school_id`/`grants_group_id`) are ON DELETE
 * CASCADE and the redeemer FKs (`learners`/`schools`/`govt_admins`.
 * `invite_code_id`) are ON DELETE SET NULL — so codes now die with their org
 * row on EVERY path (incl. the schools->classes cascade that used to 500 on
 * fk_invite_codes_class, the founder's live bug) with no learner-redeemer
 * blocking. The explicit invite_codes/`invite_code_id` cleanup below is now
 * belt-and-braces (runs a moment before the FK would); it is retained because
 * `govt_admins.group_id` and `user_tags` (string-keyed, no FK) still need
 * manual cleanup, and keeping the ordering intact is cheaper than proving each
 * removal safe against the tangle of reverse FKs.
 *
 * `classes` -> `class_sessions`/`entitlement_grants`/`teacher_referrals` DO
 * cascade (ON DELETE CASCADE, see supabase/schema.sql) so deleting the
 * school or class row itself is sufficient to clear those.
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
  /** Schools that will be DELETED (their own node is inside the subtree). */
  schoolCount: number
  schoolNames: string[]
  /** Descendant groups that will be DELETED with this one (subtree cascade). */
  descendantGroupCount: number
  descendantGroupNames: string[]
  /** Legacy-attached schools that survive but lose their parent (appear at top level). */
  orphanedSchoolCount: number
  orphanedSchoolNames: string[]
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
  tagType: 'school' | 'class' = 'school',
): Promise<{ learnerCount: number; teacherCount: number }> {
  if (!tagValues.length) return { learnerCount: 0, teacherCount: 0 }
  const { data, error } = await supabase
    .from('user_tags')
    .select('user_id, role_in_context')
    .eq('tag_type', tagType)
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

/**
 * Impact preview mirrors deleteGroupCascade EXACTLY (the honest-delete
 * ruling, founder pass C 2026-07-19): the whole descendant subtree of
 * groups is deleted; a school whose OWN node (`node_group_id`) is in the
 * subtree dies with it; legacy-attached schools (group_id in the subtree,
 * node elsewhere/none) are ungrouped — they survive and appear at top
 * level. Counts (classes/sessions/learners/teachers) cover only what is
 * actually deleted, i.e. the deleted schools' classes and rosters.
 */
export async function computeGroupImpact(supabase: SupabaseClient, groupId: string): Promise<GroupImpact> {
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .select('id, name, path')
    .eq('id', groupId)
    .maybeSingle()
  if (groupErr) throw new Error(`groups read failed: ${groupErr.message}`)
  if (!group) throw new Error('Group not found')

  let descendants: { id: string; name: string }[] = []
  if (group.path) {
    const { data: rows, error: subErr } = await supabase
      .from('groups')
      .select('id, name, path')
      .like('path', `${group.path}/%`)
    if (subErr) throw new Error(`groups subtree read failed: ${subErr.message}`)
    descendants = (rows || []).map((r) => ({ id: r.id as string, name: r.name as string }))
  }
  const subtreeIds = [groupId, ...descendants.map((d) => d.id)]

  // One query per FK lane: schools attached anywhere in the subtree by
  // parent (group_id) or by own node (node_group_id).
  const [{ data: parented, error: parentedErr }, { data: noded, error: nodedErr }] = await Promise.all([
    supabase.from('schools').select('id, school_name, node_group_id').in('group_id', subtreeIds),
    supabase.from('schools').select('id, school_name, node_group_id').in('node_group_id', subtreeIds),
  ])
  if (parentedErr) throw new Error(`schools read failed: ${parentedErr.message}`)
  if (nodedErr) throw new Error(`schools node read failed: ${nodedErr.message}`)
  const subtreeIdSet = new Set(subtreeIds)
  const byId = new Map<string, { id: string; school_name: string; node_group_id: string | null }>()
  for (const s of [...(parented || []), ...(noded || [])] as any[]) byId.set(s.id, s)
  const deletedSchools: { id: string; school_name: string }[] = []
  const orphanedSchools: { id: string; school_name: string }[] = []
  for (const s of byId.values()) {
    if (s.node_group_id && subtreeIdSet.has(s.node_group_id)) deletedSchools.push(s)
    else orphanedSchools.push(s)
  }
  const deletedSchoolIds = deletedSchools.map((s) => s.id)

  const { data: classes, error: classesErr } = deletedSchoolIds.length
    ? await supabase.from('classes').select('id').in('school_id', deletedSchoolIds)
    : { data: [] as { id: string }[], error: null }
  if (classesErr) throw new Error(`classes read failed: ${classesErr.message}`)
  const classIds = (classes || []).map((c) => c.id as string)

  const [{ sessionCount, hasRealActivity }, { learnerCount, teacherCount }] = await Promise.all([
    classActivity(supabase, classIds),
    tagCounts(supabase, deletedSchoolIds.map((id) => `SCHOOL:${id}`)),
  ])

  return {
    groupId,
    groupName: group.name as string,
    schoolCount: deletedSchools.length,
    schoolNames: deletedSchools.map((s) => s.school_name),
    descendantGroupCount: descendants.length,
    descendantGroupNames: descendants.map((d) => d.name),
    orphanedSchoolCount: orphanedSchools.length,
    orphanedSchoolNames: orphanedSchools.map((s) => s.school_name),
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

/**
 * FK-safe cascade delete of a group AND its whole subtree (THE MODEL,
 * 2026-07-18: one recursive node — "every level can delete the things it
 * created and everything below them", so deleting a node takes its subtree).
 *
 * Walks the trigger-maintained `path` ('/'-separated slugs) to find every
 * descendant group, deepest-first. Per group: a school whose OWN node
 * (`node_group_id`) is that group is deleted via the full school cascade —
 * under the one-node model the school IS the node; they live and die
 * together. Schools merely *parented* there without a node in the subtree
 * (pre-model legacy shape) keep the old semantics: ungrouped, not deleted.
 * demo_orgs mint records survive with nulled pointers (ON DELETE SET NULL,
 * 20260718d_the_model_delete_family.sql).
 */
export async function deleteGroupCascade(supabase: SupabaseClient, groupId: string): Promise<void> {
  const { data: root, error: rootErr } = await supabase
    .from('groups')
    .select('id, path')
    .eq('id', groupId)
    .maybeSingle()
  if (rootErr) throw new Error(`groups read failed: ${rootErr.message}`)
  if (!root) return

  let subtree: { id: string; path: string | null }[] = [{ id: root.id as string, path: root.path as string | null }]
  if (root.path) {
    const { data: descendants, error: subErr } = await supabase
      .from('groups')
      .select('id, path')
      .like('path', `${root.path}/%`)
    if (subErr) throw new Error(`groups subtree read failed: ${subErr.message}`)
    subtree = subtree.concat((descendants || []) as { id: string; path: string | null }[])
  }
  // deepest-first so no child row ever blocks its parent's delete
  subtree.sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))

  for (const group of subtree) {
    const { error: unlinkErr } = await supabase
      .from('govt_admins')
      .update({ invite_code_id: null })
      .eq('group_id', group.id)
      .not('invite_code_id', 'is', null)
    if (unlinkErr) throw new Error(`govt_admins invite_code_id unlink failed: ${unlinkErr.message}`)

    const { error: codesErr } = await supabase.from('invite_codes').delete().eq('grants_group_id', group.id)
    if (codesErr) throw new Error(`invite_codes delete failed: ${codesErr.message}`)

    const { error: govtErr } = await supabase.from('govt_admins').delete().eq('group_id', group.id)
    if (govtErr) throw new Error(`govt_admins delete failed: ${govtErr.message}`)

    // one-node: a school whose node is this group dies with it
    const { data: nodeSchools, error: nodeErr } = await supabase
      .from('schools')
      .select('id')
      .eq('node_group_id', group.id)
    if (nodeErr) throw new Error(`schools node read failed: ${nodeErr.message}`)
    for (const school of nodeSchools || []) {
      await deleteSchoolCascade(supabase, school.id as string)
    }

    // legacy attachments (no node in this subtree): ungrouped, not deleted
    const { error: ungroupError } = await supabase.from('schools').update({ group_id: null }).eq('group_id', group.id)
    if (ungroupError) throw new Error(`ungroup schools failed: ${ungroupError.message}`)

    // classes.group_id (direct affiliation, THE MODEL I7) has NO ON DELETE
    // behaviour — a class still pointing here would block the groups delete.
    // school_id stays authoritative during the expand phase, so detaching is
    // lossless: the class lives on under its school (or standalone).
    const { error: detachErr } = await supabase.from('classes').update({ group_id: null }).eq('group_id', group.id)
    if (detachErr) throw new Error(`detach classes failed: ${detachErr.message}`)

    // group-affiliation tags are string-keyed (no FK) — remove them so no
    // learner/teacher is left "affiliated" to a group that no longer exists.
    const { error: groupTagsErr } = await supabase
      .from('user_tags')
      .delete()
      .eq('tag_type', 'group')
      .eq('tag_value', `GROUP:${group.id}`)
    if (groupTagsErr) throw new Error(`group tags delete failed: ${groupTagsErr.message}`)

    const { error: deleteErr } = await supabase.from('groups').delete().eq('id', group.id)
    if (deleteErr) throw new Error(`groups delete failed: ${deleteErr.message}`)
  }
}

export interface ClassImpact extends DeletionImpact {
  classId: string
  className: string
}

/** Deletion-impact preview for a single class — teacher self-serve delete. */
export async function computeClassImpact(supabase: SupabaseClient, classId: string): Promise<ClassImpact> {
  const { data: klass, error: classErr } = await supabase
    .from('classes')
    .select('id, class_name')
    .eq('id', classId)
    .maybeSingle()
  if (classErr) throw new Error(`classes read failed: ${classErr.message}`)
  if (!klass) throw new Error('Class not found')

  const [{ sessionCount, hasRealActivity }, { learnerCount, teacherCount }] = await Promise.all([
    classActivity(supabase, [classId]),
    tagCounts(supabase, [`CLASS:${classId}`], 'class'),
  ])

  return {
    classId,
    className: klass.class_name as string,
    classCount: 1,
    sessionCount,
    learnerCount,
    teacherCount,
    hasRealActivity,
  }
}

/**
 * FK-safe cascade delete of one class — "delete a class: its class_sessions,
 * enrolments, the class-entity learner, the class row" (founder ruling).
 * class_sessions/entitlement_grants/teacher_referrals cascade automatically
 * via ON DELETE CASCADE once the classes row itself is deleted; invite_codes
 * and user_tags (both teacher and student CLASS: tags — enrolments) do not
 * and need manual cleanup first, same shape as school/group deletion.
 *
 * The class-entity learner (classes.class_learner_id, the synthetic learner
 * row backing "play as class" aggregate progress) references classes with
 * no ON DELETE — it must be deleted AFTER the classes row (which removes the
 * referencing FK), never before, or the learners delete 500s.
 */
export async function deleteClassCascade(supabase: SupabaseClient, classId: string): Promise<void> {
  const { data: klass, error: classReadErr } = await supabase
    .from('classes')
    .select('class_learner_id')
    .eq('id', classId)
    .maybeSingle()
  if (classReadErr) throw new Error(`classes read failed: ${classReadErr.message}`)
  const classLearnerId = (klass as any)?.class_learner_id as string | null | undefined

  const { error: codesErr } = await supabase.from('invite_codes').delete().eq('grants_class_id', classId)
  if (codesErr) throw new Error(`invite_codes delete failed: ${codesErr.message}`)

  const { error: tagsErr } = await supabase.from('user_tags').delete().eq('tag_value', `CLASS:${classId}`)
  if (tagsErr) throw new Error(`user_tags delete failed: ${tagsErr.message}`)

  // class_sessions/entitlement_grants/teacher_referrals cascade via ON DELETE CASCADE.
  const { error: deleteErr } = await supabase.from('classes').delete().eq('id', classId)
  if (deleteErr) throw new Error(`classes delete failed: ${deleteErr.message}`)

  if (classLearnerId) {
    const { error: learnerErr } = await supabase.from('learners').delete().eq('id', classLearnerId)
    if (learnerErr) throw new Error(`class-entity learner delete failed: ${learnerErr.message}`)
  }
}
