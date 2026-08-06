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
import { descendantIds, type ParentLinked } from './groupSubtree'

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
  /** school ids in the caller's scope (school_admin: their own school; govt_admin: every school in their group subtree; teacher: []) */
  schoolIds: string[]
  /** the caller's own group id (govt_admin only; null otherwise) — the ONE group-level entity they may select */
  groupId: string | null
}

const EMPTY: CallerScope = {
  learnerId: null, role: null, classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null,
}

/** Chunk an array so a PostgREST .in() filter never blows the URL length cap. */
export function chunk<T>(arr: T[], size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Classes a teacher teaches: class_teachers relationship + legacy lead pointer. */
async function taughtClassIds(svc: SupabaseClient, authUid: string): Promise<string[]> {
  const ids = new Set<string>()
  // The two sources are independent (relationship rows vs the legacy owner
  // column) — run them concurrently instead of paying two round trips in series.
  const [{ data: rel }, { data: owned }] = await Promise.all([
    svc.from('class_teachers').select('class_id').eq('teacher_user_id', authUid),
    svc.from('classes').select('id').eq('teacher_user_id', authUid).eq('is_active', true),
  ])
  for (const r of rel ?? []) if ((r as any).class_id) ids.add((r as any).class_id)
  for (const c of owned ?? []) if ((c as any).id) ids.add((c as any).id)

  return [...ids]
}

/**
 * The school a staff member (school_admin OR teacher) belongs to:
 * first-joined SCHOOL: tag, else admin_user_id. Exported so endpoints that
 * need a TEACHER's own school (resolveVisibleScope deliberately leaves a
 * teacher's schoolIds empty — see filterActiveScope's docstring, a teacher
 * can span schools) can resolve the same "home school" the client's
 * useSchoolContext.resolveUser() shows them, without re-deriving it from
 * classIds (which can't distinguish "no school" from "multiple schools").
 */
export async function schoolIdForAdmin(svc: SupabaseClient, authUid: string): Promise<string | null> {
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

/**
 * Bridge a tree node back to its OWN school-shaped row (schools.node_group_id
 * = nodeId), THE MODEL I2. School-node duality: since the expand migration
 * every school owns a node, but older data (invite codes, entitlement grants,
 * SCHOOL:/CLASS: tags) still references the school by `schools.id`. A facet
 * keyed on the node id alone (e.g. the node panel's "ways in" invite links)
 * silently finds nothing — this is the single bridge that lets those facets
 * resolve the school row behind a node. Returns null for a plain group node
 * (no attached school).
 */
export async function ownSchoolIdForNode(svc: SupabaseClient, nodeId: string): Promise<string | null> {
  const { data } = await svc.from('schools').select('id').eq('node_group_id', nodeId).maybeSingle()
  return (data as any)?.id ?? null
}

/** Schools + own group id a govt_admin governs: group-path subtree (preferred), else region_code. */
/**
 * Every school in a group's subtree (this group + every descendant, matched
 * by path prefix — same rule the client's govt-admin class query in
 * useClassesData uses). Factored out of scopeForGovtAdmin so admin passthrough
 * endpoints (an ssi_admin viewing an ARBITRARY group, not their own) can reuse
 * the identical subtree rule without a govt_admins row of their own.
 */
export async function schoolsForGroupSubtree(svc: SupabaseClient, groupId: string): Promise<string[]> {
  // Membership walks parent_id, NOT the slug path: `path LIKE '<root>%'` both
  // (a) folds in an unrelated same-named tenant (two orgs named "Deborah
  // Testing" both slug to 'deborah-testing' — live, 2026-08-06) and (b) has no
  // '/' boundary, so 'ime-demo' would swallow 'ime-demo-two'. This is a scope
  // resolver, so either is a cross-tenant read. See groupSubtree.ts.
  const { data: forest } = await svc.from('groups').select('id, parent_id')
  const groupIds = descendantIds((forest ?? []) as ParentLinked[], groupId)
  if (groupIds.length === 0) return []

  const schoolIds = new Set<string>()
  for (const batch of chunk(groupIds)) {
    const { data: schools } = await svc.from('schools').select('id').in('group_id', batch)
    for (const s of schools ?? []) if ((s as any).id) schoolIds.add((s as any).id)
  }
  return [...schoolIds]
}

/**
 * Is `targetGroupId` a STRICT descendant (child, grandchild, ...) of
 * `ancestorGroupId`, by parent_id walk — same rule schoolsForGroupSubtree uses
 * for the subtree of schools, applied to groups themselves. Used by the
 * group-leader self-serve delete path (api/groups/[id].ts): a leader may
 * delete their own SUB-groups ("everything below them", founder ruling),
 * never their own governed group (that would delete their own seat) and
 * never a sideways or ancestor group.
 */
export async function isStrictDescendantGroup(
  svc: SupabaseClient,
  ancestorGroupId: string,
  targetGroupId: string,
): Promise<boolean> {
  if (ancestorGroupId === targetGroupId) return false
  // parent_id walk, not a path prefix — a bare `startsWith` GRANTS authority
  // over an unrelated sibling whose slug happens to be a prefix ('ime-demo' →
  // 'ime-demo-two'), and slugs are not unique in the first place. This decides
  // whether a leader may act on a node, so it gets the real relation.
  const { data: forest } = await svc.from('groups').select('id, parent_id')
  const rows = (forest ?? []) as ParentLinked[]
  if (!rows.some((r) => r.id === ancestorGroupId) || !rows.some((r) => r.id === targetGroupId)) return false
  return descendantIds(rows, ancestorGroupId).includes(targetGroupId)
}

async function scopeForGovtAdmin(svc: SupabaseClient, authUid: string): Promise<{ schoolIds: string[]; groupId: string | null }> {
  const { data: govt } = await svc
    .from('govt_admins')
    .select('region_code, group_id')
    .eq('user_id', authUid)
    .maybeSingle()
  if (!govt) return { schoolIds: [], groupId: null }

  if ((govt as any).group_id) {
    const groupId = (govt as any).group_id as string
    const schoolIds = await schoolsForGroupSubtree(svc, groupId)
    return { schoolIds, groupId }
  }

  // Legacy fallback: region_code (govt admins created before the group tree)
  // — no group tree, so no group-level entity to select.
  if ((govt as any).region_code) {
    const { data: schools } = await svc.from('schools').select('id').eq('region_code', (govt as any).region_code)
    return { schoolIds: (schools ?? []).map((s: any) => s.id).filter(Boolean), groupId: null }
  }
  return { schoolIds: [], groupId: null }
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

// Short-TTL in-memory cache, keyed by authUid. Each of the three
// api/school/* endpoints calls resolveVisibleScope independently on every
// request (no shared invocation), and a single tab visit can trigger several
// of them in quick succession (e.g. the Analytics tab's filter watchers all
// fire fetchRealComparison on mount) — each one otherwise re-running ~4-5
// sequential DB round trips to re-derive the IDENTICAL scope. This caches the
// SCOPE (who may I see — school/class/learner ids), never the fetched data,
// so a tab always re-fetches its own numbers; only the redundant re-derivation
// of "who am I" is skipped. 20s is short enough that a genuine membership
// change (a student added to a class) is visible on the next natural refresh,
// long enough to absorb a burst of same-session calls. Only helps when Vercel
// reuses a warm instance across nearby requests — cold instances just miss.
const SCOPE_CACHE_TTL_MS = 20_000
const scopeCache = new Map<string, { scope: CallerScope; expiresAt: number }>()

/**
 * Resolve the caller's visible student scope. `authUid` MUST come from a
 * verified JWT (see verifyAuthToken), never from client-supplied input.
 */
export async function resolveVisibleScope(svc: SupabaseClient, authUid: string): Promise<CallerScope> {
  const cached = scopeCache.get(authUid)
  if (cached && cached.expiresAt > Date.now()) return cached.scope

  const scope = await resolveVisibleScopeUncached(svc, authUid)
  scopeCache.set(authUid, { scope, expiresAt: Date.now() + SCOPE_CACHE_TTL_MS })
  return scope
}

async function resolveVisibleScopeUncached(svc: SupabaseClient, authUid: string): Promise<CallerScope> {
  const { data: learner } = await svc
    .from('learners')
    .select('id, educational_role')
    .eq('user_id', authUid)
    .maybeSingle()
  if (!learner) return EMPTY
  const role = (learner as any).educational_role as string | null
  const learnerId = (learner as any).id as string

  let classIds: string[] = []
  let schoolIds: string[] = []
  let groupId: string | null = null
  if (role === 'teacher') {
    classIds = await taughtClassIds(svc, authUid)
  } else if (role === 'school_admin') {
    const schoolId = await schoolIdForAdmin(svc, authUid)
    if (schoolId) {
      schoolIds = [schoolId]
      classIds = await classIdsForSchools(svc, [schoolId])
    }
  } else if (role === 'govt_admin') {
    const govtScope = await scopeForGovtAdmin(svc, authUid)
    schoolIds = govtScope.schoolIds
    groupId = govtScope.groupId
    if (schoolIds.length) classIds = await classIdsForSchools(svc, schoolIds)
  } else {
    // ssi_admin / god / student / unknown: these endpoints are teacher/school/gov
    // facing. Admin surfaces have their own admin RPCs; a student has no scope.
    return { ...EMPTY, learnerId, role }
  }

  if (classIds.length === 0) return { learnerId, role, classIds: [], learnerIds: [], studentsByClass: {}, schoolIds, groupId }

  const byClass = await studentsByClass(svc, classIds)
  const flat = new Set<string>()
  for (const ids of Object.values(byClass)) for (const id of ids) flat.add(id)
  return { learnerId, role, classIds, learnerIds: [...flat], studentsByClass: byClass, schoolIds, groupId }
}
