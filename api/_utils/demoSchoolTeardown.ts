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
import { discoverDemoOrgGraph } from './demoSchoolGraph'

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

  const { groupIds, schoolIds, classIds, classLearnerIds, staffAuthUids, studentUserIds } = await discoverDemoOrgGraph(supabase, org)

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
  if (groupIds.length) {
    await deleteInChunks(supabase, 'govt_admins', 'group_id', groupIds)
    // Whole subtree in one statement (root + every sub-group the admin
    // built on top of it) — deepest-first isn't needed, self-FK checks
    // resolve at statement end once every row in the batch is gone.
    await deleteInChunks(supabase, 'groups', 'id', groupIds)
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
