/**
 * demoSchoolTeardown — hard-delete purge for demo_orgs (finishes what
 * `expire` starts). `expire` (api/admin/demo-schools.ts) bans staff auth
 * accounts and marks the row 'expired' — reversible, so an admin can
 * `extend` a still-useful showcase back to life. `purgeDemoOrg` is the
 * one-way door: deletes every row this tool created (staff + student
 * learners, their progress/session data, classes incl. class-entity
 * learners, invite_codes, schools/groups, the demo_orgs row itself) and
 * hard-deletes the staff auth accounts. Only call on an already-expired org.
 *
 * Deletion order respects FK dependencies (children before parents):
 * progress/session tables -> user_tags -> course_enrollments -> class-entity
 * learners -> invite_codes -> classes -> student/staff learners -> auth
 * users -> schools -> groups -> demo_orgs row.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PurgeResult {
  demoOrgId: string
  prospectName: string
  schoolsDeleted: number
  classesDeleted: number
  learnersDeleted: number
  authAccountsDeleted: number
}

async function deleteInChunks(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { error } = await supabase.from(table).delete().in(column, chunk)
    if (error) throw new Error(`${table} delete failed: ${error.message}`)
  }
}

export async function purgeDemoOrg(
  supabase: SupabaseClient,
  demoOrgId: string,
): Promise<PurgeResult> {
  const { data: org, error: orgErr } = await supabase
    .from('demo_orgs')
    .select('id, prospect_name, status, group_id, school_id')
    .eq('id', demoOrgId)
    .maybeSingle()
  if (orgErr) throw new Error(`demo_orgs read failed: ${orgErr.message}`)
  if (!org) throw new Error('Demo org not found')
  if (org.status !== 'expired') {
    throw new Error('Demo org must be expired before it can be purged — expire it first')
  }

  const schoolIds: string[] = []
  if (org.school_id) schoolIds.push(org.school_id as string)
  if (org.group_id) {
    const { data: groupSchools } = await supabase.from('schools').select('id').eq('group_id', org.group_id)
    for (const s of groupSchools || []) schoolIds.push(s.id as string)
  }

  const { data: classes } = schoolIds.length
    ? await supabase.from('classes').select('id, class_learner_id').in('school_id', schoolIds)
    : { data: [] as { id: string; class_learner_id: string | null }[] }
  const classIds = (classes || []).map((c) => c.id as string)
  const classLearnerIds = (classes || []).map((c) => c.class_learner_id).filter(Boolean) as string[]

  const { data: schools } = schoolIds.length
    ? await supabase.from('schools').select('id, admin_user_id').in('id', schoolIds)
    : { data: [] as { id: string; admin_user_id: string }[] }
  const staffAuthUids = (schools || []).map((s) => s.admin_user_id).filter(Boolean) as string[]

  if (classIds.length) {
    const { data: teacherRows } = await supabase.from('classes').select('teacher_user_id').in('id', classIds)
    for (const t of teacherRows || []) if (t.teacher_user_id) staffAuthUids.push(t.teacher_user_id as string)
  }
  if (org.group_id) {
    const { data: govtAdmins } = await supabase.from('govt_admins').select('user_id').eq('group_id', org.group_id)
    for (const g of govtAdmins || []) if (g.user_id) staffAuthUids.push(g.user_id as string)
  }

  // Student learners: tagged CLASS:<classId> in user_tags (they were never
  // real auth accounts — synthetic user_id, no auth.admin.deleteUser needed).
  const studentUserIds: string[] = []
  if (classIds.length) {
    const classTagValues = classIds.map((id) => `CLASS:${id}`)
    const { data: tagRows } = await supabase
      .from('user_tags')
      .select('user_id')
      .in('tag_value', classTagValues)
      .eq('role_in_context', 'student')
    for (const r of tagRows || []) if (r.user_id) studentUserIds.push(r.user_id as string)
  }

  const { data: studentLearners } = studentUserIds.length
    ? await supabase.from('learners').select('id, user_id').in('user_id', studentUserIds)
    : { data: [] as { id: string; user_id: string }[] }
  const studentLearnerIds = (studentLearners || []).map((l) => l.id as string)

  const { data: staffLearners } = staffAuthUids.length
    ? await supabase.from('learners').select('id, user_id').in('user_id', staffAuthUids)
    : { data: [] as { id: string; user_id: string }[] }
  const staffLearnerIds = (staffLearners || []).map((l) => l.id as string)

  const allLearnerIds = [...studentLearnerIds, ...staffLearnerIds, ...classLearnerIds]

  // ---- children first ----
  if (allLearnerIds.length) {
    await deleteInChunks(supabase, 'seed_progress', 'learner_id', allLearnerIds)
    await deleteInChunks(supabase, 'lego_progress', 'learner_id', allLearnerIds)
    await deleteInChunks(supabase, 'sessions', 'learner_id', allLearnerIds)
    await deleteInChunks(supabase, 'course_enrollments', 'learner_id', allLearnerIds)
  }
  if (classIds.length) {
    await deleteInChunks(supabase, 'class_sessions', 'class_id', classIds)
  }
  const allTaggedUserIds = [...studentUserIds, ...staffAuthUids]
  if (allTaggedUserIds.length) {
    await deleteInChunks(supabase, 'user_tags', 'user_id', allTaggedUserIds)
  }
  if (schoolIds.length) {
    await deleteInChunks(supabase, 'invite_codes', 'grants_school_id', schoolIds)
  }

  if (classIds.length) {
    await deleteInChunks(supabase, 'classes', 'id', classIds)
  }
  if (allLearnerIds.length) {
    await deleteInChunks(supabase, 'learners', 'id', allLearnerIds)
  }

  let authAccountsDeleted = 0
  for (const uid of staffAuthUids) {
    try {
      const { error } = await supabase.auth.admin.deleteUser(uid)
      if (!error) authAccountsDeleted++
      else console.warn('[demoSchoolTeardown] auth delete failed for', uid, error.message)
    } catch (err) {
      console.warn('[demoSchoolTeardown] auth delete threw for', uid, err)
    }
  }

  // demo_orgs.school_id/group_id FK into schools/groups — drop the row that
  // references them before deleting the schools/groups themselves.
  const { error: demoOrgDeleteErr } = await supabase.from('demo_orgs').delete().eq('id', demoOrgId)
  if (demoOrgDeleteErr) throw new Error(`demo_orgs delete failed: ${demoOrgDeleteErr.message}`)

  if (schoolIds.length) {
    await deleteInChunks(supabase, 'schools', 'id', schoolIds)
  }
  if (org.group_id) {
    await supabase.from('govt_admins').delete().eq('group_id', org.group_id)
    const { error: groupErr } = await supabase.from('groups').delete().eq('id', org.group_id)
    if (groupErr) throw new Error(`groups delete failed: ${groupErr.message}`)
  }

  return {
    demoOrgId,
    prospectName: org.prospect_name as string,
    schoolsDeleted: schoolIds.length,
    classesDeleted: classIds.length,
    learnersDeleted: allLearnerIds.length,
    authAccountsDeleted,
  }
}
