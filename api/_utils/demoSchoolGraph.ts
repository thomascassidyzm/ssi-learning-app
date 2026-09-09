/**
 * demoSchoolGraph — discovers every row that belongs to a demo org's org
 * tree RIGHT NOW, not just the rows the seed script originally wrote.
 *
 * Members with real accounts (a govt_admin leader, a school_admin) can
 * create schools/classes of their own under the org (deliberately — that's
 * the point of a working showcase) — those child creations are DYNAMICALLY
 * discovered here via group_id/school_id, the same way `purgeDemoOrg`
 * already found them, so `expire`'s ban-sweep (and anything else that needs
 * "every staff/student in this org today") stays in sync with the graph
 * instead of drifting from a static `demo_orgs.metadata.staff` snapshot
 * taken at creation/adoption time.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface DemoOrgGraph {
  schoolIds: string[]
  classIds: string[]
  classLearnerIds: string[]
  /** Auth uids — school admins, class teachers, the group's govt_admin(s). */
  staffAuthUids: string[]
  /** Auth uids — synthetic student identities (never real auth accounts). */
  studentUserIds: string[]
}

export async function discoverDemoOrgGraph(
  supabase: SupabaseClient,
  org: { group_id: string | null; school_id: string | null },
): Promise<DemoOrgGraph> {
  const schoolIds: string[] = []
  if (org.school_id) schoolIds.push(org.school_id)
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

  // Student learners: tagged CLASS:<classId> in user_tags (synthetic
  // user_id, never a real auth account — no ban/deleteUser needed for these).
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

  return {
    schoolIds,
    classIds,
    classLearnerIds,
    staffAuthUids: [...new Set(staffAuthUids)],
    studentUserIds: [...new Set(studentUserIds)],
  }
}
