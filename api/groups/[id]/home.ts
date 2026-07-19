/**
 * GET /api/groups/:id/home — the NODE HOME payload (docs/THE-VIEW.md).
 *
 * One endpoint serves the one recursive dashboard at every level. `:id` is
 * resolved in order: a group node id, a school id (bridged to its node via
 * schools.node_group_id — minted on demand, THE-MODEL I2), or a class id
 * (kind 'class'). The page's five parts map straight onto the payload:
 *   - MAP RAIL     → ancestors (root→parent), siblings, children
 *   - IDENTITY     → node {name, label, demo, commercial trial/paid state}
 *   - STATS ROW    → node.rollup (subtree totals via computeNodeExtras — the
 *                    SAME resolver as the tree/table lenses) + practiceHours
 *                    (subtree school_summary sum, the group-dashboard story)
 *   - CHILDREN     → children (direct child nodes, each with rollups), or the
 *                    subtree-wide lens payload when ?lens= is set
 *   - VERBS        → client-side, calling the existing invite/create endpoints
 *
 * Lenses (?lens=groups|schools|teachers|classes) are FILTERS over the one
 * view, never separate pages — each returns the matching subtree-wide list.
 *
 * Server-mediated, service-role; authz via resolveGroupTreeCaller +
 * callerCanSeeGroup (ssi_admin: whole forest; group leader: own subtree,
 * with ancestors/siblings trimmed to their visible scope).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveGroupTreeCaller, callerCanSeeGroup } from '../../_utils/groupTreeAuth'
import { computeNodeExtras, type NodeExtras } from '../../_utils/groupRollups'
import { ensureSchoolNode } from '../../_utils/schoolNode'
import { chunk } from '../../_utils/schoolScope'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

interface GroupRow {
  id: string
  name: string
  type: string
  parent_id: string | null
  path: string | null
  is_demo: boolean
  is_test: boolean
}

interface NodeRef { id: string; name: string; label: string; is_demo: boolean; hasSchool: boolean }

function toRef(g: GroupRow, schoolNodeIds: Set<string>): NodeRef {
  return { id: g.id, name: g.name, label: g.type, is_demo: g.is_demo, hasSchool: schoolNodeIds.has(g.id) }
}

function inSubtree(path: string | null | undefined, rootPath: string): boolean {
  return typeof path === 'string' && (path === rootPath || path.startsWith(rootPath + '/'))
}

/** Learner display names for a set of auth uids, via learners.user_id. */
async function namesForAuthUids(svc: SupabaseClient, uids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const batch of chunk(uids)) {
    const { data } = await svc.from('learners').select('user_id, display_name').in('user_id', batch)
    for (const l of data ?? []) {
      const uid = (l as any).user_id as string
      // Multiple learner accounts per person are intentional — first name wins.
      if (!names.has(uid)) names.set(uid, (l as any).display_name || 'Unnamed')
    }
  }
  return names
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const caller = await resolveGroupTreeCaller(req, res, svc)
  if (!caller) return

  const rawId = String(req.query.id || '')
  const lens = typeof req.query.lens === 'string' ? req.query.lens : null

  try {
    // ─── Resolve :id → a group node (or a class) ───
    let nodeId: string | null = null
    let classRow: { id: string; class_name: string; course_code: string; school_id: string | null; group_id: string | null; teacher_user_id: string | null } | null = null

    const { data: asGroup } = await svc.from('groups').select('id').eq('id', rawId).maybeSingle()
    if (asGroup) {
      nodeId = rawId
    } else {
      const { data: asSchool } = await svc
        .from('schools')
        .select('id, school_name, group_id, node_group_id, is_demo, is_test')
        .eq('id', rawId)
        .maybeSingle()
      if (asSchool) {
        nodeId = (asSchool as any).node_group_id
          || (await ensureSchoolNode(svc, asSchool as any, { is_demo: (asSchool as any).is_demo, is_test: (asSchool as any).is_test }))
      } else {
        const { data: asClass } = await svc
          .from('classes')
          .select('id, class_name, course_code, school_id, group_id, teacher_user_id')
          .eq('id', rawId)
          .maybeSingle()
        if (asClass) {
          classRow = asClass as any
          if (classRow!.school_id) {
            const { data: sch } = await svc
              .from('schools')
              .select('id, school_name, group_id, node_group_id, is_demo, is_test')
              .eq('id', classRow!.school_id)
              .maybeSingle()
            if (sch) {
              nodeId = (sch as any).node_group_id
                || (await ensureSchoolNode(svc, sch as any, { is_demo: (sch as any).is_demo, is_test: (sch as any).is_test }))
            }
          }
          if (!nodeId && classRow!.group_id) nodeId = classRow!.group_id
        }
      }
    }
    if (!nodeId) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (!(await callerCanSeeGroup(svc, caller, nodeId))) {
      res.status(403).json({ error: 'You do not have access to this group' })
      return
    }

    // ─── Forest maps (one small fetch, like groupRollups) ───
    const { data: allGroupsData } = await svc
      .from('groups')
      .select('id, name, type, parent_id, path, is_demo, is_test')
    const allGroups = (allGroupsData ?? []) as GroupRow[]
    const byId = new Map(allGroups.map((g) => [g.id, g]))
    const nodeRow = byId.get(nodeId)
    if (!nodeRow) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // Subtree membership + subtree school ids (node bridge ∪ legacy parent
    // attachment — same union groupRollups counts through).
    const subtreeIds = nodeRow.path
      ? allGroups.filter((g) => inSubtree(g.path, nodeRow.path!)).map((g) => g.id)
      : [nodeId]
    const subtreeIdSet = new Set(subtreeIds)

    const schoolRows: { id: string; school_name: string; node_group_id: string | null; group_id: string | null }[] = []
    const seenSchoolIds = new Set<string>()
    for (const batch of chunk(subtreeIds)) {
      const [{ data: byNode }, { data: byParent }] = await Promise.all([
        svc.from('schools').select('id, school_name, node_group_id, group_id').in('node_group_id', batch),
        svc.from('schools').select('id, school_name, node_group_id, group_id').in('group_id', batch),
      ])
      for (const s of [...(byNode ?? []), ...(byParent ?? [])]) {
        if (!seenSchoolIds.has((s as any).id)) { seenSchoolIds.add((s as any).id); schoolRows.push(s as any) }
      }
    }
    const schoolNodeIds = new Set(schoolRows.map((s) => s.node_group_id).filter(Boolean) as string[])
    const subtreeSchoolIds = schoolRows.map((s) => s.id)

    // ─── Map rail: ancestors, siblings, children — trimmed to the caller's
    // visible scope (a leader never sees above their own governed group). ───
    const scopeRootId = caller.isAdmin ? null : caller.ownGroupId
    const ancestors: NodeRef[] = []
    if (!scopeRootId || nodeId !== scopeRootId) {
      let cursor = nodeRow.parent_id ? byId.get(nodeRow.parent_id) : undefined
      while (cursor) {
        ancestors.unshift(toRef(cursor, schoolNodeIds))
        if (scopeRootId && cursor.id === scopeRootId) break
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined
      }
      if (scopeRootId && !ancestors.some((a) => a.id === scopeRootId)) {
        // Node reachable but its chain never met the leader's root — hide the chain.
        ancestors.length = 0
      }
    }

    const parentVisible = caller.isAdmin
      || (scopeRootId !== null && nodeRow.parent_id !== null && ancestors.some((a) => a.id === nodeRow.parent_id))
    const siblings: NodeRef[] = parentVisible
      ? allGroups
          .filter((g) => g.parent_id === nodeRow.parent_id && g.id !== nodeId)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((g) => toRef(g, schoolNodeIds))
      : []

    const childRows = allGroups
      .filter((g) => g.parent_id === nodeId)
      .sort((a, b) => a.name.localeCompare(b.name))

    // ─── Rollups: node + direct children (the same shared resolver). ───
    const extras = await computeNodeExtras(svc, [nodeId, ...childRows.map((c) => c.id)])
    const withExtras = (g: GroupRow) => {
      const ex: NodeExtras = extras[g.id] || { rollup: { childGroupCount: 0, teacherCount: 0, classCount: 0, learnerCount: 0 }, commercial: null }
      return { ...toRef(g, schoolNodeIds), is_test: g.is_test, rollup: ex.rollup, commercial: ex.commercial }
    }

    // ─── Practice hours: subtree school_summary sum (incl. staff) — the same
    // number the old group dashboard told. ───
    let practiceHours = 0
    for (const batch of chunk(subtreeSchoolIds)) {
      const { data } = await svc.from('school_summary').select('school_id, total_practice_hours').in('school_id', batch)
      for (const r of data ?? []) practiceHours += Number((r as any).total_practice_hours) || 0
    }

    // ─── Class kind — leaf home: teachers (read-only, co-teacher view) +
    // learners as children. ───
    if (classRow) {
      const [{ data: ct }, { data: csp }] = await Promise.all([
        svc.from('class_teachers').select('teacher_user_id, is_lead').eq('class_id', classRow.id),
        svc.from('class_student_progress').select('learner_id, student_name, total_practice_seconds, last_active_at').eq('class_id', classRow.id),
      ])
      const teacherIds = new Set<string>((ct ?? []).map((t: any) => t.teacher_user_id))
      if (classRow.teacher_user_id) teacherIds.add(classRow.teacher_user_id)
      const teacherNames = await namesForAuthUids(svc, [...teacherIds])
      const teachers = [...teacherIds].map((uid) => ({
        user_id: uid,
        name: teacherNames.get(uid) || 'Unnamed',
        is_lead: uid === classRow!.teacher_user_id || (ct ?? []).some((t: any) => t.teacher_user_id === uid && t.is_lead),
      })).sort((a, b) => Number(b.is_lead) - Number(a.is_lead) || a.name.localeCompare(b.name))

      const students = (csp ?? []).map((s: any) => ({
        learner_id: s.learner_id,
        name: s.student_name || 'Unnamed',
        practice_hours: Math.round(((Number(s.total_practice_seconds) || 0) / 3600) * 10) / 10,
        last_active_at: s.last_active_at,
      })).sort((a, b) => b.practice_hours - a.practice_hours)

      const classHours = (csp ?? []).reduce((sum: number, s: any) => sum + (Number(s.total_practice_seconds) || 0), 0) / 3600

      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        kind: 'class',
        node: {
          id: classRow.id,
          name: classRow.class_name,
          label: 'class',
          is_demo: nodeRow.is_demo,
          course_code: classRow.course_code,
          rollup: { childGroupCount: 0, teacherCount: teachers.length, classCount: 1, learnerCount: students.length },
          commercial: null,
        },
        // The class's school node is the last ancestor — the rail runs root →
        // … → school → class.
        ancestors: [...ancestors, toRef(nodeRow, schoolNodeIds)],
        siblings: [],
        children: [],
        teachers,
        students,
        practiceHours: Math.round(classHours * 10) / 10,
        schoolId: classRow.school_id,
        nodeId,
      })
      return
    }

    // ─── Lens payloads (subtree-wide filters over the one view) ───
    let lensPayload: Record<string, unknown> | null = null

    if (lens === 'groups') {
      const descendants = allGroups
        .filter((g) => subtreeIdSet.has(g.id) && g.id !== nodeId)
        .sort((a, b) => (a.path || '').localeCompare(b.path || ''))
      const descExtras = await computeNodeExtras(svc, descendants.map((d) => d.id))
      lensPayload = {
        groups: descendants.map((g) => ({
          ...toRef(g, schoolNodeIds),
          parentName: g.parent_id ? byId.get(g.parent_id)?.name || null : null,
          depth: nodeRow.path && g.path ? g.path.split('/').length - nodeRow.path.split('/').length : 1,
          rollup: descExtras[g.id]?.rollup,
          commercial: descExtras[g.id]?.commercial,
        })),
      }
    } else if (lens === 'schools') {
      const summaries = new Map<string, any>()
      for (const batch of chunk(subtreeSchoolIds)) {
        const { data } = await svc.from('school_summary').select('*').in('school_id', batch)
        for (const r of data ?? []) summaries.set((r as any).school_id, r)
      }
      // Teachers per school (names, for the "with teachers" lens promise).
      const teacherUidsBySchool = new Map<string, Set<string>>()
      for (const batch of chunk(subtreeSchoolIds)) {
        const { data } = await svc
          .from('user_tags')
          .select('tag_value, user_id')
          .eq('tag_type', 'school').eq('role_in_context', 'teacher').is('removed_at', null)
          .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
        for (const t of data ?? []) {
          const sid = ((t as any).tag_value as string).replace('SCHOOL:', '')
          if (!teacherUidsBySchool.has(sid)) teacherUidsBySchool.set(sid, new Set())
          teacherUidsBySchool.get(sid)!.add((t as any).user_id)
        }
      }
      const allUids = [...new Set([...teacherUidsBySchool.values()].flatMap((s) => [...s]))]
      const names = await namesForAuthUids(svc, allUids)
      lensPayload = {
        schools: schoolRows.map((s) => {
          const sum = summaries.get(s.id)
          return {
            schoolId: s.id,
            nodeId: s.node_group_id,
            name: sum?.school_name || s.school_name,
            teacherCount: Number(sum?.teacher_count) || 0,
            classCount: Number(sum?.class_count) || 0,
            studentCount: Number(sum?.student_count) || 0,
            practiceHours: Math.round((Number(sum?.total_practice_hours) || 0) * 10) / 10,
            hasAdmin: Boolean(sum?.has_admin),
            teachers: [...(teacherUidsBySchool.get(s.id) || [])].map((uid) => names.get(uid) || 'Unnamed').sort(),
          }
        }).sort((a, b) => b.practiceHours - a.practiceHours),
      }
    } else if (lens === 'teachers' || lens === 'classes') {
      // Subtree classes: node-attached (group_id) ∪ legacy school-attached.
      const classes: { id: string; class_name: string; school_id: string | null; group_id: string | null; teacher_user_id: string | null }[] = []
      const seenClassIds = new Set<string>()
      const addClasses = (rows: any[] | null) => {
        for (const c of rows ?? []) if (!seenClassIds.has(c.id)) { seenClassIds.add(c.id); classes.push(c) }
      }
      for (const batch of chunk(subtreeIds)) {
        const { data } = await svc.from('classes').select('id, class_name, school_id, group_id, teacher_user_id').in('group_id', batch).eq('is_active', true)
        addClasses(data)
      }
      for (const batch of chunk(subtreeSchoolIds)) {
        const { data } = await svc.from('classes').select('id, class_name, school_id, group_id, teacher_user_id').in('school_id', batch).eq('is_active', true)
        addClasses(data)
      }
      const classIds = classes.map((c) => c.id)

      // Teacher↔class from the source of truth, lead pointer unioned in.
      const teachersByClass = new Map<string, Set<string>>()
      for (const batch of chunk(classIds)) {
        const { data } = await svc.from('class_teachers').select('class_id, teacher_user_id').in('class_id', batch)
        for (const t of data ?? []) {
          const cid = (t as any).class_id as string
          if (!teachersByClass.has(cid)) teachersByClass.set(cid, new Set())
          teachersByClass.get(cid)!.add((t as any).teacher_user_id)
        }
      }
      for (const c of classes) {
        if (c.teacher_user_id) {
          if (!teachersByClass.has(c.id)) teachersByClass.set(c.id, new Set())
          teachersByClass.get(c.id)!.add(c.teacher_user_id)
        }
      }

      // Students + hours per class.
      const studentCountByClass = new Map<string, number>()
      const hoursByClass = new Map<string, number>()
      for (const batch of chunk(classIds)) {
        const { data } = await svc.from('class_student_progress').select('class_id, total_practice_seconds').in('class_id', batch)
        for (const r of data ?? []) {
          const cid = (r as any).class_id as string
          studentCountByClass.set(cid, (studentCountByClass.get(cid) || 0) + 1)
          hoursByClass.set(cid, (hoursByClass.get(cid) || 0) + (Number((r as any).total_practice_seconds) || 0) / 3600)
        }
      }

      const schoolNameById = new Map(schoolRows.map((s) => [s.id, s.school_name]))
      const homeName = (c: { school_id: string | null; group_id: string | null }) =>
        (c.school_id && schoolNameById.get(c.school_id)) || (c.group_id && byId.get(c.group_id)?.name) || null

      if (lens === 'classes') {
        const allUids = [...new Set([...teachersByClass.values()].flatMap((s) => [...s]))]
        const names = await namesForAuthUids(svc, allUids)
        lensPayload = {
          classes: classes.map((c) => ({
            id: c.id,
            name: c.class_name,
            home: homeName(c),
            teachers: [...(teachersByClass.get(c.id) || [])].map((uid) => names.get(uid) || 'Unnamed').sort(),
            studentCount: studentCountByClass.get(c.id) || 0,
            practiceHours: Math.round((hoursByClass.get(c.id) || 0) * 10) / 10,
          })).sort((a, b) => (a.home || '').localeCompare(b.home || '') || a.name.localeCompare(b.name)),
        }
      } else {
        // teachers lens: every teacher below (school + group tags), with
        // their classes in this subtree.
        const teacherUids = new Set<string>()
        for (const batch of chunk(subtreeSchoolIds)) {
          const { data } = await svc
            .from('user_tags').select('user_id')
            .eq('tag_type', 'school').eq('role_in_context', 'teacher').is('removed_at', null)
            .in('tag_value', batch.map((id) => `SCHOOL:${id}`))
          for (const t of data ?? []) teacherUids.add((t as any).user_id)
        }
        for (const batch of chunk(subtreeIds)) {
          const { data } = await svc
            .from('user_tags').select('user_id')
            .eq('tag_type', 'group').eq('role_in_context', 'teacher').is('removed_at', null)
            .in('tag_value', batch.map((id) => `GROUP:${id}`))
          for (const t of data ?? []) teacherUids.add((t as any).user_id)
        }
        for (const uids of teachersByClass.values()) for (const uid of uids) teacherUids.add(uid)

        const classesByTeacher = new Map<string, { id: string; name: string; home: string | null }[]>()
        for (const c of classes) {
          for (const uid of teachersByClass.get(c.id) || []) {
            if (!classesByTeacher.has(uid)) classesByTeacher.set(uid, [])
            classesByTeacher.get(uid)!.push({ id: c.id, name: c.class_name, home: homeName(c) })
          }
        }
        const names = await namesForAuthUids(svc, [...teacherUids])
        lensPayload = {
          teachers: [...teacherUids].map((uid) => ({
            user_id: uid,
            name: names.get(uid) || 'Unnamed',
            classes: (classesByTeacher.get(uid) || []).sort((a, b) => a.name.localeCompare(b.name)),
          })).sort((a, b) => a.name.localeCompare(b.name)),
        }
      }
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      kind: 'node',
      node: withExtras(nodeRow),
      ancestors,
      siblings,
      children: childRows.map(withExtras),
      practiceHours: Math.round(practiceHours * 10) / 10,
      ...(lensPayload || {}),
    })
  } catch (error) {
    console.error('[Groups/Home] error:', error)
    res.status(500).json({ error: 'Internal server error', detail: String(error) })
  }
}
