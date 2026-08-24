/**
 * groupRollups — per-node stats for the Structure UI's two lenses (table +
 * tree), THE-MODEL.md §1.9/§6. Computes, for a batch of group node ids:
 *   - childGroupCount: DIRECT child groups (the "3 schools under IME" count —
 *     stays direct; it is the fan-out at this node, not a subtree total).
 *   - teacherCount / classCount / learnerCount: people & classes affiliated
 *     across the node's ENTIRE SUBTREE (the node itself + every descendant),
 *     so a parent node tells the SAME story as its group dashboard (founder
 *     ruling 2026-07-18 — "every lens must tell the same story as the group
 *     dashboard"). A programme like IME shows its schools' combined 6 teachers
 *     / 80 learners, not the 0/0/0 of its own direct affiliations. Each count
 *     unions the NEW direct model (classes.group_id, user_tags tag_type='group')
 *     with the LEGACY school-shaped path (schools.node_group_id ->
 *     classes.school_id -> user_tags tag_type='school'/'class'), then rolls the
 *     per-node sets up the tree — DISTINCT users/classes, never a naive sum, so
 *     a teacher shared across two schools counts once at their shared ancestor.
 *   - commercial: the node's OWN schools row's commercial fields, attached via
 *     schools.node_group_id (THE-MODEL.md §4) — a per-node attachment, NOT
 *     rolled up (a parent has no single commercial identity).
 *
 * Subtree membership walks `parent_id` (groupSubtree.descendantIds) — slug
 * paths are NOT unique, so a path match merges two same-named tenants. The
 * whole groups forest is fetched once (it is small) rather than one query per
 * target.
 *
 * Batched with chunk() (schoolScope.ts) so large subtrees don't blow the
 * PostgREST .in() URL cap. Service-role only — call from server-mediated
 * endpoints, never exposed directly to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'
import { SCHOOL_STAFF_ROLES } from './schoolStaff'
import { descendantIds, type ParentLinked } from './groupSubtree'

export interface NodeRollup {
  childGroupCount: number
  teacherCount: number
  classCount: number
  learnerCount: number
}

export interface CommercialInfo {
  schoolId: string
  platformStatus: string
  trialCourseCode: string | null
  trialKind: string | null
  platformExpiresAt: string | null
  teacherSeats: number
}

export interface NodeExtras {
  rollup: NodeRollup
  commercial: CommercialInfo | null
}

function addPerson(map: Map<string, Set<string>>, nodeId: string, userId: string): void {
  if (!userId) return
  if (!map.has(nodeId)) map.set(nodeId, new Set())
  map.get(nodeId)!.add(userId)
}

export interface GroupPathRow { id: string; path: string | null; parent_id: string | null }

export async function computeNodeExtras(
  svc: SupabaseClient,
  targetNodeIds: string[],
  preloadedGroups?: GroupPathRow[],
): Promise<Record<string, NodeExtras>> {
  const extras: Record<string, NodeExtras> = {}
  for (const id of targetNodeIds) {
    extras[id] = { rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 }, commercial: null }
  }
  if (targetNodeIds.length === 0) return extras

  // 0. The whole forest's (id, path, parent_id) — small; one fetch lets us
  // resolve every target's subtree + direct-child count in memory. Callers
  // that already hold the forest (home.ts) pass it in and skip the re-fetch.
  const allGroups = preloadedGroups
    ?? ((await svc.from('groups').select('id, path, parent_id')).data as GroupPathRow[] | null)
  const directChildCount = new Map<string, number>()
  for (const g of allGroups ?? []) {
    const pid = (g as any).parent_id as string | null
    if (pid) directChildCount.set(pid, (directChildCount.get(pid) || 0) + 1)
  }

  // Descendants (incl. self) per target, and the union of every node we must
  // compute DIRECT sets for. Resolved through parent_id — two nodes can share
  // a slug path (groupSubtree.ts header), and a path match then merges tenants.
  const descendantsByTarget = new Map<string, string[]>()
  const allNodeIds = new Set<string>()
  for (const tid of targetNodeIds) {
    const desc = descendantIds((allGroups ?? []) as ParentLinked[], tid)
    for (const id of desc) allNodeIds.add(id)
    descendantsByTarget.set(tid, desc)
  }
  const nodeIds = [...allNodeIds]

  // 1-4 run as three dependency WAVES, every query within a wave in parallel
  // (the serial version cost one DB round trip per step — 8 in a row — which
  // dominated node-home latency; the data dependencies only need three).
  const nodeBySchool = new Map<string, string>()
  const commercialByNode = new Map<string, CommercialInfo>()
  const classIdsByNode = new Map<string, Set<string>>()
  const nodeByClass = new Map<string, string>()
  const teacherSetByNode = new Map<string, Set<string>>()
  const learnerSetByNode = new Map<string, Set<string>>()
  const addClass = (nodeId: string | null | undefined, classId: string) => {
    if (!nodeId) return
    if (!classIdsByNode.has(nodeId)) classIdsByNode.set(nodeId, new Set())
    classIdsByNode.get(nodeId)!.add(classId)
    nodeByClass.set(classId, nodeId)
  }

  // Wave 1 — everything that only needs nodeIds: commercial attachment
  // (schools.node_group_id), direct group-attached classes (I7), group
  // teacher tags, group student tags.
  await Promise.all([
    ...chunk(nodeIds).map(async (batch) => {
      const { data } = await svc
        .from('schools')
        .select('id, node_group_id, platform_status, trial_course_code, trial_kind, platform_expires_at, teacher_seats')
        .in('node_group_id', batch)
      for (const s of data ?? []) {
        const nodeId = (s as any).node_group_id as string
        nodeBySchool.set((s as any).id, nodeId)
        commercialByNode.set(nodeId, {
          schoolId: (s as any).id,
          platformStatus: (s as any).platform_status,
          trialCourseCode: (s as any).trial_course_code,
          trialKind: (s as any).trial_kind,
          platformExpiresAt: (s as any).platform_expires_at,
          teacherSeats: (s as any).teacher_seats,
        })
      }
    }),
    ...chunk(nodeIds).map(async (batch) => {
      const { data } = await svc.from('classes').select('id, group_id').in('group_id', batch).eq('is_active', true)
      for (const c of data ?? []) addClass((c as any).group_id, (c as any).id)
    }),
    ...chunk(nodeIds).map(async (batch) => {
      const { data } = await svc
        .from('user_tags')
        .select('tag_value, user_id')
        .eq('tag_type', 'group')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)
        .in('tag_value', batch.map((id) => `GROUP:${id}`))
      for (const t of data ?? []) {
        const nodeId = ((t as any).tag_value as string).replace('GROUP:', '')
        addPerson(teacherSetByNode, nodeId, (t as any).user_id)
      }
    }),
    ...chunk(nodeIds).map(async (batch) => {
      const { data } = await svc
        .from('user_tags')
        .select('tag_value, user_id')
        .eq('tag_type', 'group')
        .eq('role_in_context', 'student')
        .is('removed_at', null)
        .in('tag_value', batch.map((id) => `GROUP:${id}`))
      for (const t of data ?? []) {
        const nodeId = ((t as any).tag_value as string).replace('GROUP:', '')
        addPerson(learnerSetByNode, nodeId, (t as any).user_id)
      }
    }),
  ])
  const schoolIds = [...nodeBySchool.keys()]

  // Wave 2 — the legacy school-shaped paths (need schoolIds from wave 1):
  // school-attached classes + school teacher tags.
  await Promise.all([
    ...chunk(schoolIds).map(async (batch) => {
      const { data } = await svc.from('classes').select('id, school_id').in('school_id', batch).eq('is_active', true)
      for (const c of data ?? []) addClass(nodeBySchool.get((c as any).school_id), (c as any).id)
    }),
    ...chunk(schoolIds).map(async (batch) => {
      const { data } = await svc
        .from('user_tags')
        .select('tag_value, user_id')
        .eq('tag_type', 'school')
        // STAFF = teacher OR admin (SCHOOL_STAFF_ROLES): the school's own
        // admin counts toward the node's staff rollup, matching the school
        // dashboard's own Teachers list and school_summary.teacher_count.
        .in('role_in_context', SCHOOL_STAFF_ROLES)
        .is('removed_at', null)
        .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
      for (const t of data ?? []) {
        const schoolId = ((t as any).tag_value as string).replace('SCHOOL:', '')
        const nodeId = nodeBySchool.get(schoolId)
        if (nodeId) addPerson(teacherSetByNode, nodeId, (t as any).user_id)
      }
    }),
  ])

  // Wave 3 — students in this node's classes (needs the full class set).
  const allClassIds = [...nodeByClass.keys()]
  await Promise.all(chunk(allClassIds).map(async (batch) => {
    const { data } = await svc
      .from('user_tags')
      .select('tag_value, user_id')
      .eq('tag_type', 'class')
      .eq('role_in_context', 'student')
      .is('removed_at', null)
      .in('tag_value', batch.map((id) => `CLASS:${id}`))
    for (const t of data ?? []) {
      const classId = ((t as any).tag_value as string).replace('CLASS:', '')
      const nodeId = nodeByClass.get(classId)
      if (nodeId) addPerson(learnerSetByNode, nodeId, (t as any).user_id)
    }
  }))

  // 5. Roll each target's descendants' DIRECT sets up into a DISTINCT subtree
  // total. childGroupCount stays direct; commercial is the node's own.
  for (const tid of targetNodeIds) {
    const desc = descendantsByTarget.get(tid) || [tid]
    const teachers = new Set<string>()
    const classes = new Set<string>()
    const learners = new Set<string>()
    for (const nid of desc) {
      for (const u of teacherSetByNode.get(nid) || []) teachers.add(u)
      for (const c of classIdsByNode.get(nid) || []) classes.add(c)
      for (const l of learnerSetByNode.get(nid) || []) learners.add(l)
    }
    extras[tid].rollup = {
      childGroupCount: directChildCount.get(tid) || 0,
      teacherCount: teachers.size,
      classCount: classes.size,
      learnerCount: learners.size,
    }
    extras[tid].commercial = commercialByNode.get(tid) || null
  }

  return extras
}
