/**
 * groupRollups — per-node stats for the Structure UI's two lenses (table +
 * tree), THE-MODEL.md §1.9/§6. Computes, for a batch of group node ids:
 *   - childGroupCount: direct child groups
 *   - teacherCount / classCount / learnerCount: people & classes affiliated
 *     to the node, unioning the NEW direct model (classes.group_id,
 *     user_tags tag_type='group') with the LEGACY school-shaped path
 *     (schools.node_group_id -> classes.school_id -> user_tags tag_type='school'/'class')
 *     so counts are meaningful today, before any dual-write backfill lands.
 *   - commercial: the schools row's commercial fields, attached via
 *     schools.node_group_id, for nodes that have one (THE-MODEL.md §4).
 *
 * Batched with chunk() (schoolScope.ts) so large subtrees don't blow the
 * PostgREST .in() URL cap. Service-role only — call from server-mediated
 * endpoints, never exposed directly to the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

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

export async function computeNodeExtras(
  svc: SupabaseClient,
  nodeIds: string[],
): Promise<Record<string, NodeExtras>> {
  const extras: Record<string, NodeExtras> = {}
  for (const id of nodeIds) {
    extras[id] = { rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 }, commercial: null }
  }
  if (nodeIds.length === 0) return extras

  // 1. Direct child group counts.
  for (const batch of chunk(nodeIds)) {
    const { data } = await svc.from('groups').select('parent_id').in('parent_id', batch)
    for (const g of data ?? []) {
      const pid = (g as any).parent_id as string | null
      if (pid && extras[pid]) extras[pid].rollup.childGroupCount++
    }
  }

  // 2. Commercial attachment (schools.node_group_id) + reverse map for the legacy paths below.
  const nodeBySchool = new Map<string, string>()
  for (const batch of chunk(nodeIds)) {
    const { data } = await svc
      .from('schools')
      .select('id, node_group_id, platform_status, trial_course_code, trial_kind, platform_expires_at, teacher_seats')
      .in('node_group_id', batch)
    for (const s of data ?? []) {
      const nodeId = (s as any).node_group_id as string
      nodeBySchool.set((s as any).id, nodeId)
      if (extras[nodeId]) {
        extras[nodeId].commercial = {
          schoolId: (s as any).id,
          platformStatus: (s as any).platform_status,
          trialCourseCode: (s as any).trial_course_code,
          trialKind: (s as any).trial_kind,
          platformExpiresAt: (s as any).platform_expires_at,
          teacherSeats: (s as any).teacher_seats,
        }
      }
    }
  }
  const schoolIds = [...nodeBySchool.keys()]

  // 3. Classes: direct group affiliation (I7) + legacy school_id affiliation.
  const classIdsByNode = new Map<string, Set<string>>()
  const nodeByClass = new Map<string, string>()
  const addClass = (nodeId: string | null | undefined, classId: string) => {
    if (!nodeId) return
    if (!classIdsByNode.has(nodeId)) classIdsByNode.set(nodeId, new Set())
    classIdsByNode.get(nodeId)!.add(classId)
    nodeByClass.set(classId, nodeId)
  }
  for (const batch of chunk(nodeIds)) {
    const { data } = await svc.from('classes').select('id, group_id').in('group_id', batch).eq('is_active', true)
    for (const c of data ?? []) addClass((c as any).group_id, (c as any).id)
  }
  if (schoolIds.length) {
    for (const batch of chunk(schoolIds)) {
      const { data } = await svc.from('classes').select('id, school_id').in('school_id', batch).eq('is_active', true)
      for (const c of data ?? []) addClass(nodeBySchool.get((c as any).school_id), (c as any).id)
    }
  }
  for (const [nodeId, ids] of classIdsByNode) {
    if (extras[nodeId]) extras[nodeId].rollup.classCount = ids.size
  }

  // 4. Teachers: group tags (THE MODEL) + legacy school tags.
  const teacherSetByNode = new Map<string, Set<string>>()
  for (const batch of chunk(nodeIds)) {
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
  }
  if (schoolIds.length) {
    for (const batch of chunk(schoolIds)) {
      const { data } = await svc
        .from('user_tags')
        .select('tag_value, user_id')
        .eq('tag_type', 'school')
        .eq('role_in_context', 'teacher')
        .is('removed_at', null)
        .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
      for (const t of data ?? []) {
        const schoolId = ((t as any).tag_value as string).replace('SCHOOL:', '')
        const nodeId = nodeBySchool.get(schoolId)
        if (nodeId) addPerson(teacherSetByNode, nodeId, (t as any).user_id)
      }
    }
  }
  for (const [nodeId, set] of teacherSetByNode) {
    if (extras[nodeId]) extras[nodeId].rollup.teacherCount = set.size
  }

  // 5. Learners: students in this node's classes (CLASS: tags) + directly group-tagged students.
  const learnerSetByNode = new Map<string, Set<string>>()
  const allClassIds = [...nodeByClass.keys()]
  for (const batch of chunk(allClassIds)) {
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
  }
  for (const batch of chunk(nodeIds)) {
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
  }
  for (const [nodeId, set] of learnerSetByNode) {
    if (extras[nodeId]) extras[nodeId].rollup.learnerCount = set.size
  }

  return extras
}
