/**
 * Act-as personas — the demo identities an ssi_admin can step into to
 * experience the schools app as a school leader / teacher / group admin.
 *
 * These are resolved DYNAMICALLY from the live demo data (learners.is_demo),
 * so the list always reflects whatever the demo-suite generator
 * (scripts/demo-data/generate-demo-suite.cjs) most recently built — it
 * survives every regenerate, where the old hardcoded test-user ids did not.
 *
 * The goal is "what does it look like for an actual person": one school
 * leader per demo school is enough to drill into classes/teachers/students
 * from inside the dashboard, so those lead. Teachers follow, labelled by
 * school, for a closer-to-the-chalkface view.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActAsPersona } from '@/composables/useUserRole'

/** Human label for a persona's role, for buttons and the act-as banner. */
export function roleLabel(role: ActAsPersona['role']): string {
  switch (role) {
    case 'teacher':
      return 'Teacher'
    case 'school_admin':
      return 'School leader'
    case 'govt_admin':
      return 'Group admin'
  }
}

/**
 * Fetch the current demo personas — one school leader per demo school plus
 * each demo teacher, resolved live. Runs under the ssi_admin's own session,
 * which can read every demo learner/school via the admin-bypass RLS.
 * Returns [] (and the panel hides itself) if there's no demo data.
 */
export async function fetchDemoPersonas(client: SupabaseClient): Promise<ActAsPersona[]> {
  // Demo schools, to name each persona by their school.
  const { data: schools } = await client
    .from('schools')
    .select('id, school_name, admin_user_id')
    .eq('is_demo', true)
    .order('school_name')
  if (!schools?.length) return []

  const adminByUser = new Map<string, string>() // admin_user_id -> school_name
  for (const s of schools) if (s.admin_user_id) adminByUser.set(s.admin_user_id, s.school_name)
  const schoolNameById = new Map(schools.map((s) => [s.id, s.school_name]))

  // Demo staff learners (admins + teachers).
  const { data: staff } = await client
    .from('learners')
    .select('user_id, display_name, educational_role')
    .eq('is_demo', true)
    .in('educational_role', ['school_admin', 'teacher'])
  if (!staff?.length) return []

  // Map each teacher to a school via their SCHOOL: tag.
  const { data: tags } = await client
    .from('user_tags')
    .select('user_id, tag_value')
    .eq('tag_type', 'school')
    .eq('role_in_context', 'teacher')
  const teacherSchool = new Map<string, string>() // user_id -> school_id
  for (const t of tags ?? []) {
    const sid = (t.tag_value as string)?.replace('SCHOOL:', '')
    if (sid) teacherSchool.set(t.user_id, sid)
  }

  const personas: ActAsPersona[] = []
  for (const s of staff) {
    const role = s.educational_role as ActAsPersona['role']
    const schoolName =
      role === 'school_admin'
        ? adminByUser.get(s.user_id)
        : schoolNameById.get(teacherSchool.get(s.user_id) ?? '')
    if (!schoolName) continue // staff not attached to a demo school — skip
    personas.push({
      key: `${role}:${s.user_id}`,
      userId: s.user_id,
      role,
      name: `${s.display_name} · ${schoolName}`,
    })
  }
  // School leaders first, then teachers; alphabetical within each.
  const order: Record<string, number> = { school_admin: 0, teacher: 1, govt_admin: 2 }
  return personas.sort(
    (a, b) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name),
  )
}
