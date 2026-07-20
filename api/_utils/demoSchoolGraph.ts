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

/**
 * A demo org's root group can now grow an arbitrary-depth sub-tree (founder
 * org model, `2f919488` / `20260717c`) — a school can live several levels
 * below the root the demo-schools tool created. `groups.path` is a slug
 * path (`root-slug/child-slug/...`), so "every group in this org" is every
 * row whose path equals the root's, or starts with the root's path + '/'.
 */
export async function resolveGroupSubtreeIds(supabase: SupabaseClient, rootGroupId: string): Promise<string[]> {
  const { data: rootRows } = await supabase.from('groups').select('id, path').eq('id', rootGroupId)
  const rootPath = rootRows?.[0]?.path as string | undefined
  if (!rootPath) return [rootGroupId]
  const { data: rows } = await supabase.from('groups').select('id, path')
  return (rows || [])
    .filter((r) => r.path === rootPath || (typeof r.path === 'string' && r.path.startsWith(`${rootPath}/`)))
    .map((r) => r.id as string)
}

export interface DemoOrgGraph {
  /** The org's root group plus every descendant group, any depth. */
  groupIds: string[]
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
  const groupIds = org.group_id ? await resolveGroupSubtreeIds(supabase, org.group_id) : []
  if (groupIds.length) {
    const { data: groupSchools } = await supabase.from('schools').select('id').in('group_id', groupIds)
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
  if (groupIds.length) {
    const { data: govtAdmins } = await supabase.from('govt_admins').select('user_id').in('group_id', groupIds)
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
    groupIds,
    schoolIds,
    classIds,
    classLearnerIds,
    staffAuthUids: [...new Set(staffAuthUids)],
    studentUserIds: [...new Set(studentUserIds)],
  }
}
