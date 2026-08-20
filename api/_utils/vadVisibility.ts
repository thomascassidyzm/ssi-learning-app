/**
 * vadVisibility — "whose VAD may this caller see?", as ONE predicate.
 *
 * FOUNDER RULING, 2026-08-20, verbatim:
 *
 *   "no, the VAD data should follow the same hierarchy of visibility that all
 *    data follows
 *
 *    students < teachers < school leaders < group leaders
 *
 *    as long as the hierarchy is legitimate, the data should be viewable"
 *
 * So VAD is ORDINARY ORG DATA. It is not a special class with its own gate; it
 * rides the same subtree scoping every other org read already uses. This module
 * is deliberately thin for that reason — it COMPOSES the two existing
 * resolvers rather than inventing a third authz model:
 *
 *   - resolveVisibleScope (schoolScope.ts) answers "which STUDENT learners may
 *     this caller see?" for teacher / school_admin / govt_admin, by exactly the
 *     joins the schools rollup endpoints already enforce. That is the whole
 *     learner-level half of the ruling, already written and already tested.
 *   - leaderGroupIdFor + isWithinLeaderSubtree (groupTreeAuth / orgLeader)
 *     answer "is this NODE inside the caller's subtree?", the predicate the
 *     node home and the write paths share.
 *
 * The one thing neither reached is a TEACHER at node level, and that is on
 * purpose: resolveGroupTreeCaller gates node surfaces on the educational_role,
 * "NOT on mere school membership — a teacher also carries a SCHOOL: tag but
 * stays on the teacher surfaces". Tom's hierarchy puts teachers above their own
 * students, so a teacher gets VAD for the learners in their own classes — via
 * resolveVisibleScope's class-membership set, which is what "their own classes"
 * already means everywhere else. It does NOT widen their node-surface access.
 * (Chosen over widening resolveGroupTreeCaller's leader gate, which would have
 * handed teachers the node rail, invites and structure tree nobody asked for.)
 *
 * WHY LEARNER-SET INTERSECTION AND NOT A SECOND SUBTREE WALK: every scope this
 * serves ends in a set of learners.id. Resolving the requested scope's roster
 * and INTERSECTING it with the caller's own visible learner set means there is
 * one place a mistake could widen access, and it is the resolver both the
 * schools endpoints and this one already share. A caller who requests a node
 * they cannot see gets 403 from the node predicate before any roster is read;
 * the intersection is the belt to that braces.
 *
 * THE IDENTITY TRAP (CLAUDE.md): learner ids here are learners.id throughout —
 * that is what learner_lego_metrics.learner_id holds and what
 * player_events.user_id holds despite its name. Auth uids (TEXT) appear only in
 * user_tags.user_id / learners.user_id and never leave this module.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from './auth'
import { leaderGroupIdFor } from './groupTreeAuth'
import { isWithinLeaderSubtree } from './orgLeader'
import { ensureSchoolNode } from './schoolNode'
import { chunk, resolveVisibleScope, type CallerScope } from './schoolScope'
import { descendantIds, type ParentLinked } from './groupSubtree'

export interface VadCaller {
  /** auth uid (TEXT) */
  userId: string
  /** learners.id of the caller, when they have a learner row */
  learnerId: string | null
  isAdmin: boolean
  /** The leader's own governed group (govt_admin group, or a school_admin's school node). Null for admin/teacher/student. */
  ownGroupId: string | null
  /** teacher / school_admin / govt_admin scope — classes + student learner ids. */
  scope: CallerScope
}

/**
 * Resolve the caller. Writes its own 401 and returns null when unauthenticated.
 *
 * Never 403s by itself: "who are you" and "may you see THIS scope" are separate
 * questions, and a student legitimately reaching their own VAD is a caller with
 * an empty leader scope, not a rejected one.
 */
export async function resolveVadCaller(
  req: VercelRequest,
  res: VercelResponse,
  svc: SupabaseClient,
): Promise<VadCaller | null> {
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) {
    const scope = await resolveVisibleScope(svc, adminResult.userId)
    return {
      userId: adminResult.userId,
      learnerId: scope.learnerId,
      isAdmin: true,
      ownGroupId: null,
      scope,
    }
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return null
  }

  const [ownGroupId, scope] = await Promise.all([
    leaderGroupIdFor(svc, authResult.userId),
    resolveVisibleScope(svc, authResult.userId),
  ])

  return {
    userId: authResult.userId,
    learnerId: scope.learnerId,
    isAdmin: false,
    ownGroupId,
    scope,
  }
}

/**
 * May this caller see this ONE learner's VAD?
 *
 * The ruling in a single line: admin sees the forest; anyone above the learner
 * in the hierarchy sees them (that is exactly resolveVisibleScope's set — a
 * teacher's classes, a school leader's school, a group leader's subtree); a
 * learner sees themselves; nobody sees sideways or upwards.
 */
export async function canSeeLearnerVad(
  caller: VadCaller,
  learnerId: string,
): Promise<boolean> {
  if (caller.isAdmin) return true
  if (caller.learnerId && caller.learnerId === learnerId) return true
  return caller.scope.learnerIds.includes(learnerId)
}

// ---------------------------------------------------------------------------
// Scope resolution — the requested target → its roster
// ---------------------------------------------------------------------------

export interface VadClassScope {
  classId: string
  className: string
  courseCode: string | null
  learnerIds: string[]
}

export interface VadScope {
  /** 'group' | 'class' | 'learner' — which target was resolved */
  kind: 'group' | 'class' | 'learner'
  /** the resolved node/class/learner id */
  id: string
  label: string
  /** FULL roster for the scope (learners.id) — the honest denominator. */
  learnerIds: string[]
  /** Class breakdown, when the scope has classes under it. */
  classes: VadClassScope[]
}

/** Denial carries its own status so the endpoint doesn't re-derive it. */
export interface VadScopeDenied { denied: true; status: 403 | 404; error: string }

export type VadScopeResult = VadScope | VadScopeDenied

export function isDenied(r: VadScopeResult): r is VadScopeDenied {
  return (r as VadScopeDenied).denied === true
}

/**
 * Every school in a node's subtree, under BOTH attachments.
 *
 * schoolsForGroupSubtree matches schools.group_id only. That is right for a
 * govt_admin's own governed group, but a school reached through its NODE
 * (schools.node_group_id — THE MODEL I2) is invisible to it, and 11 of the 24
 * live schools carry a node_group_id with no group_id (checked 2026-08-20). So
 * this takes the same union api/groups/[id]/home.ts counts through, rather than
 * quietly under-reporting a leader's own subtree.
 */
async function schoolIdsForNodeSubtree(svc: SupabaseClient, nodeId: string): Promise<string[]> {
  const { data: forest } = await svc.from('groups').select('id, parent_id')
  const groupIds = descendantIds((forest ?? []) as ParentLinked[], nodeId)
  if (groupIds.length === 0) return []

  const ids = new Set<string>()
  await Promise.all(chunk(groupIds).flatMap((batch) => [
    svc.from('schools').select('id').in('group_id', batch).then(({ data }) => {
      for (const s of data ?? []) if ((s as { id?: string }).id) ids.add((s as { id: string }).id)
    }),
    svc.from('schools').select('id').in('node_group_id', batch).then(({ data }) => {
      for (const s of data ?? []) if ((s as { id?: string }).id) ids.add((s as { id: string }).id)
    }),
  ]))
  return [...ids]
}

interface ClassMetaRow { id: string; class_name: string | null; course_code: string | null }

/** Active classes for a set of schools, with the metadata the panel labels them by. */
async function classesForSchools(svc: SupabaseClient, schoolIds: string[]): Promise<ClassMetaRow[]> {
  const out = new Map<string, ClassMetaRow>()
  for (const batch of chunk(schoolIds)) {
    const { data } = await svc
      .from('classes')
      .select('id, class_name, course_code')
      .in('school_id', batch)
      .eq('is_active', true)
    for (const c of (data ?? []) as ClassMetaRow[]) out.set(c.id, c)
  }
  return [...out.values()]
}

/**
 * classId → student learner ids, by the SAME join the demo generator and
 * vadUptake.buildScopes use: user_tags(tag_type 'class', role_in_context
 * 'student', tag_value 'CLASS:<id>') → learners on user_id (auth uid, TEXT) →
 * learners.id (uuid).
 */
export async function studentLearnerIdsByClass(
  svc: SupabaseClient,
  classIds: string[],
): Promise<Record<string, string[]>> {
  if (classIds.length === 0) return {}

  const authUidsByClass: Record<string, string[]> = {}
  const allAuthUids = new Set<string>()
  for (const batch of chunk(classIds)) {
    const { data } = await svc
      .from('user_tags')
      .select('tag_value, user_id')
      .eq('tag_type', 'class')
      .eq('role_in_context', 'student')
      .is('removed_at', null)
      .in('tag_value', batch.map((id) => `CLASS:${id}`))
    for (const t of (data ?? []) as { tag_value: string; user_id: string }[]) {
      if (!t.user_id) continue
      const classId = t.tag_value.replace('CLASS:', '')
      ;(authUidsByClass[classId] ||= []).push(t.user_id)
      allAuthUids.add(t.user_id)
    }
  }

  const learnerIdByAuthUid = new Map<string, string>()
  for (const batch of chunk([...allAuthUids])) {
    const { data } = await svc
      .from('learners')
      .select('id, user_id')
      .eq('educational_role', 'student')
      .in('user_id', batch)
    for (const l of (data ?? []) as { id: string; user_id: string }[]) {
      if (l.id && l.user_id) learnerIdByAuthUid.set(l.user_id, l.id)
    }
  }

  const out: Record<string, string[]> = {}
  for (const [classId, uids] of Object.entries(authUidsByClass)) {
    const set = new Set<string>()
    for (const u of uids) {
      const lid = learnerIdByAuthUid.get(u)
      if (lid) set.add(lid)
    }
    if (set.size) out[classId] = [...set]
  }
  return out
}

/**
 * Resolve the requested target to a roster, or deny.
 *
 * `target.id` is CLIENT INPUT and is treated as such: it is resolved to a real
 * node/class/learner, then checked against the caller's own scope BEFORE any
 * roster is read. Order matters — a 403 must not be distinguishable from a
 * populated read by timing or by an error message that leaks membership.
 */
export async function resolveVadScope(
  svc: SupabaseClient,
  caller: VadCaller,
  target: { groupId?: string | null; classId?: string | null; learnerId?: string | null },
): Promise<VadScopeResult> {
  if (target.learnerId) {
    const learnerId = target.learnerId
    if (!(await canSeeLearnerVad(caller, learnerId))) {
      return { denied: true, status: 403, error: 'You do not have access to this learner' }
    }
    const { data } = await svc.from('learners').select('id, display_name').eq('id', learnerId).maybeSingle()
    if (!data) return { denied: true, status: 404, error: 'Not found' }
    return {
      kind: 'learner',
      id: learnerId,
      label: (data as { display_name?: string | null }).display_name || 'Unnamed learner',
      learnerIds: [learnerId],
      classes: [],
    }
  }

  if (target.classId) {
    const classId = target.classId
    const { data: cls } = await svc
      .from('classes')
      .select('id, class_name, course_code, school_id, group_id')
      .eq('id', classId)
      .maybeSingle()
    if (!cls) return { denied: true, status: 404, error: 'Not found' }
    const c = cls as { id: string; class_name: string | null; course_code: string | null; school_id: string | null; group_id: string | null }

    const allowed = caller.isAdmin
      || caller.scope.classIds.includes(classId)
      || (await classIsUnderLeader(svc, caller, c))
    if (!allowed) {
      return { denied: true, status: 403, error: 'You do not have access to this class' }
    }

    const byClass = await studentLearnerIdsByClass(svc, [classId])
    const learnerIds = byClass[classId] ?? []
    return {
      kind: 'class',
      id: classId,
      label: c.class_name || 'Unnamed class',
      learnerIds,
      classes: [{
        classId,
        className: c.class_name || 'Unnamed class',
        courseCode: c.course_code,
        learnerIds,
      }],
    }
  }

  const groupId = target.groupId
  if (!groupId) return { denied: true, status: 404, error: 'No scope requested' }

  // A node id, or a school id bridged to its node (same precedence as
  // api/groups/[id]/home.ts, so /org/:id and this endpoint agree on what :id
  // means and a leader never sees one resolve and the other 404).
  let nodeId: string | null = null
  let label = ''
  const { data: asGroup } = await svc.from('groups').select('id, name').eq('id', groupId).maybeSingle()
  if (asGroup) {
    nodeId = groupId
    label = (asGroup as { name?: string }).name || 'Group'
  } else {
    const { data: asSchool } = await svc
      .from('schools')
      .select('id, school_name, group_id, node_group_id, is_demo, is_test')
      .eq('id', groupId)
      .maybeSingle()
    if (asSchool) {
      const s = asSchool as { school_name?: string; node_group_id?: string | null; is_demo?: boolean; is_test?: boolean }
      nodeId = s.node_group_id
        || (await ensureSchoolNode(svc, asSchool as never, { is_demo: !!s.is_demo, is_test: !!s.is_test }))
      label = s.school_name || 'School'
    }
  }
  if (!nodeId) return { denied: true, status: 404, error: 'Not found' }

  const allowed = caller.isAdmin || (await isWithinLeaderSubtree(svc, caller.ownGroupId, nodeId))
  if (!allowed) {
    return { denied: true, status: 403, error: 'You do not have access to this group' }
  }

  const schoolIds = await schoolIdsForNodeSubtree(svc, nodeId)
  const classRows = await classesForSchools(svc, schoolIds)
  const byClass = await studentLearnerIdsByClass(svc, classRows.map((c) => c.id))

  const classes: VadClassScope[] = []
  const union = new Set<string>()
  for (const c of classRows) {
    const ids = byClass[c.id]
    if (!ids || ids.length === 0) continue          // empty classes carry no read
    classes.push({
      classId: c.id,
      className: c.class_name || 'Unnamed class',
      courseCode: c.course_code,
      learnerIds: ids,
    })
    for (const id of ids) union.add(id)
  }
  classes.sort((a, b) => a.className.localeCompare(b.className))

  return { kind: 'group', id: nodeId, label, learnerIds: [...union], classes }
}

/**
 * Is this class under the caller's leader subtree? The school_admin/govt_admin
 * half of the class check, for the case where resolveVisibleScope's classIds
 * hasn't got there (a govt_admin whose subtree schools are node-bridged only).
 * Same predicate as everything else — isWithinLeaderSubtree, no second copy.
 */
async function classIsUnderLeader(
  svc: SupabaseClient,
  caller: VadCaller,
  cls: { school_id: string | null; group_id: string | null },
): Promise<boolean> {
  if (!caller.ownGroupId) return false
  const targets: string[] = []
  if (cls.group_id) targets.push(cls.group_id)
  if (cls.school_id) {
    const { data } = await svc
      .from('schools')
      .select('group_id, node_group_id')
      .eq('id', cls.school_id)
      .maybeSingle()
    const s = data as { group_id?: string | null; node_group_id?: string | null } | null
    if (s?.node_group_id) targets.push(s.node_group_id)
    if (s?.group_id) targets.push(s.group_id)
  }
  for (const t of targets) {
    if (await isWithinLeaderSubtree(svc, caller.ownGroupId, t)) return true
  }
  return false
}
