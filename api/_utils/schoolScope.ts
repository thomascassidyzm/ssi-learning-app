/**
 * schoolScope — server-side resolution of "which student learners may this
 * caller see?" across the schools hierarchy (teacher ⊂ school ⊂ group/region).
 *
 * This is the single authorization primitive behind the server-mediated schools
 * rollup endpoints. It runs with the SERVICE ROLE (RLS bypassed on purpose) and
 * enforces access HERE, in code — the caller can never request arbitrary
 * learners; the visible set is derived from their own verified identity. That's
 * the deliberate alternative to RLS on the schools tables (whose silent-failure
 * modes we avoid): reads go through endpoints that call this resolver.
 *
 * It mirrors the exact scope model the client already uses (and RLS-guards) in
 * useClassesData / useSchoolContext / classTeacherScope:
 *   - teacher      → classes they teach (class_teachers view + lead pointer)
 *   - school_admin → their school's classes
 *   - govt_admin   → schools in their group-path subtree (or region_code), classes
 * then class → student user_tags → learners.id.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CallerScope {
  /** learners.id of the caller (null if no learner row) */
  learnerId: string | null
  /** learners.educational_role */
  role: string | null
  /** class ids in the caller's scope */
  classIds: string[]
  /** flat, deduped set of student learner ids (learners.id) the caller may see */
  learnerIds: string[]
  /** classId → its student learner ids (for per-class rollups) */
  studentsByClass: Record<string, string[]>
}

const EMPTY: CallerScope = { learnerId: null, role: null, classIds: [], learnerIds: [], studentsByClass: {} }

/** Chunk an array so a PostgREST .in() filter never blows the URL length cap. */
function chunk<T>(arr: T[], size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Classes a teacher teaches: class_teachers relationship + legacy lead pointer. */
async function taughtClassIds(svc: SupabaseClient, authUid: string): Promise<string[]> {
  const ids = new Set<string>()
  const { data: rel } = await svc
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_user_id', authUid)
  for (const r of rel ?? []) if ((r as any).class_id) ids.add((r as any).class_id)

  const { data: owned } = await svc
    .from('classes')
    .select('id')
    .eq('teacher_user_id', authUid)
    .eq('is_active', true)
  for (const c of owned ?? []) if ((c as any).id) ids.add((c as any).id)

  return [...ids]
}

/** The school a school_admin belongs to: first-joined SCHOOL: tag, else admin_user_id. */
async function schoolIdForAdmin(svc: SupabaseClient, authUid: string): Promise<string | null> {
  const { data: tag } = await svc
    .from('user_tags')
    .select('tag_value')
    .eq('user_id', authUid)
    .eq('tag_type', 'school')
    .is('removed_at', null)
    .order('added_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (tag?.tag_value) return (tag.tag_value as string).replace('SCHOOL:', '')

  const { data: school } = await svc
    .from('schools')
    .select('id')
    .eq('admin_user_id', authUid)
    .limit(1)
    .maybeSingle()
  return (school as any)?.id ?? null
}

/** Schools a govt_admin governs: group-path subtree (preferred), else region_code. */
async function schoolIdsForGovtAdmin(svc: SupabaseClient, authUid: string): Promise<string[]> {
  const { data: govt } = await svc
    .from('govt_admins')
    .select('region_code, group_id')
    .eq('user_id', authUid)
    .maybeSingle()
  if (!govt) return []

  if ((govt as any).group_id) {
    const { data: group } = await svc
      .from('groups')
      .select('path')
      .eq('id', (govt as any).group_id)
      .maybeSingle()
    const path = (group as any)?.path as string | undefined
    if (path) {
      // Subtree = this group and every descendant (path prefix). Matches the
      // client's govt-admin class query in useClassesData.
      const { data: subtree } = await svc.from('groups').select('id').like('path', `${path}%`)
      const groupIds = (subtree ?? []).map((g: any) => g.id).filter(Boolean)
      if (groupIds.length === 0) return []
      const schoolIds = new Set<string>()
      for (const batch of chunk(groupIds)) {
        const { data: schools } = await svc.from('schools').select('id').in('group_id', batch)
        for (const s of schools ?? []) if ((s as any).id) schoolIds.add((s as any).id)
      }
      return [...schoolIds]
    }
  }

  // Legacy fallback: region_code (govt admins created before the group tree).
  if ((govt as any).region_code) {
    const { data: schools } = await svc.from('schools').select('id').eq('region_code', (govt as any).region_code)
    return (schools ?? []).map((s: any) => s.id).filter(Boolean)
  }
  return []
}

/** Active class ids for a set of schools. */
async function classIdsForSchools(svc: SupabaseClient, schoolIds: string[]): Promise<string[]> {
  const ids = new Set<string>()
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc.from('classes').select('id').in('school_id', batch).eq('is_active', true)
    for (const c of data ?? []) if ((c as any).id) ids.add((c as any).id)
  }
  return [...ids]
}

/**
 * classId → student learner ids. Reads the student user_tags (auth uids), then
 * maps those auth uids to learners.id. Chunked so large scopes (a whole region)
 * don't blow the .in() URL cap.
 */
async function studentsByClass(svc: SupabaseClient, classIds: string[]): Promise<Record<string, string[]>> {
  if (classIds.length === 0) return {}

  // 1. class → student auth uids
  const authUidByClass: Record<string, string[]> = {}
  const allAuthUids = new Set<string>()
  for (const batch of chunk(classIds)) {
    const tagValues = batch.map(id => `CLASS:${id}`)
    const { data: tags } = await svc
      .from('user_tags')
      .select('tag_value, user_id')
      .eq('tag_type', 'class')
      .eq('role_in_context', 'student')
      .is('removed_at', null)
      .in('tag_value', tagValues)
    for (const t of tags ?? []) {
      const classId = ((t as any).tag_value as string).replace('CLASS:', '')
      const authUid = (t as any).user_id as string
      if (!authUid) continue
      ;(authUidByClass[classId] ||= []).push(authUid)
      allAuthUids.add(authUid)
    }
  }

  // 2. auth uid → learners.id
  const learnerIdByAuthUid = new Map<string, string>()
  for (const batch of chunk([...allAuthUids])) {
    const { data: learners } = await svc.from('learners').select('id, user_id').in('user_id', batch)
    for (const l of learners ?? []) {
      if ((l as any).user_id && (l as any).id) learnerIdByAuthUid.set((l as any).user_id, (l as any).id)
    }
  }

  // 3. class → learner ids
  const out: Record<string, string[]> = {}
  for (const [classId, authUids] of Object.entries(authUidByClass)) {
    const set = new Set<string>()
    for (const a of authUids) {
      const lid = learnerIdByAuthUid.get(a)
      if (lid) set.add(lid)
    }
    if (set.size) out[classId] = [...set]
  }
  return out
}

/**
 * Resolve the caller's visible student scope. `authUid` MUST come from a
 * verified JWT (see verifyAuthToken), never from client-supplied input.
 */
export async function resolveVisibleScope(svc: SupabaseClient, authUid: string): Promise<CallerScope> {
  const { data: learner } = await svc
    .from('learners')
    .select('id, educational_role')
    .eq('user_id', authUid)
    .maybeSingle()
  if (!learner) return EMPTY
  const role = (learner as any).educational_role as string | null
  const learnerId = (learner as any).id as string

  let classIds: string[] = []
  if (role === 'teacher') {
    classIds = await taughtClassIds(svc, authUid)
  } else if (role === 'school_admin') {
    const schoolId = await schoolIdForAdmin(svc, authUid)
    if (schoolId) classIds = await classIdsForSchools(svc, [schoolId])
  } else if (role === 'govt_admin') {
    const schoolIds = await schoolIdsForGovtAdmin(svc, authUid)
    if (schoolIds.length) classIds = await classIdsForSchools(svc, schoolIds)
  } else {
    // ssi_admin / god / student / unknown: these endpoints are teacher/school/gov
    // facing. Admin surfaces have their own admin RPCs; a student has no scope.
    return { ...EMPTY, learnerId, role }
  }

  if (classIds.length === 0) return { learnerId, role, classIds: [], learnerIds: [], studentsByClass: {} }

  const byClass = await studentsByClass(svc, classIds)
  const flat = new Set<string>()
  for (const ids of Object.values(byClass)) for (const id of ids) flat.add(id)
  return { learnerId, role, classIds, learnerIds: [...flat], studentsByClass: byClass }
}
