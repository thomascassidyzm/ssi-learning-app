/**
 * GET /api/groups/:id/rate-compare — THE LENS: the Insight Engine scoped to
 * ONE NODE of the org tree (docs/THE-VIEW.md's analytics sibling).
 *
 *   ?course_code=<code>   optional — defaults to the subtree's busiest course
 *   &compare_to=<groupId|global|global_all_courses>   optional — defaults to
 *                          the nearest ancestor (the parent's average)
 *   &days=90              optional window
 *
 * `:id` resolves exactly like /api/groups/:id/home: a group node, a school id
 * (bridged via schools.node_group_id), or a class id. The ENTITY is that node
 * — its subtree's classes on the chosen course (a class is a set of one) —
 * and the COMPARE-TO chain IS the map rail's ancestor path: each ancestor is
 * offered as "<name> average" (its subtree minus the entity), then the global
 * cohorts. One response carries the picker OPTIONS (courses present below the
 * node, the ancestor chain) AND the resolved comparison, so the engine page
 * is one round trip and every state is deep-linkable.
 *
 * Rate math is the shared api/_utils/rateCompare.ts primitives over
 * analytics_class_sessions_scoped — the same numbers the schools rate-compare
 * lane tells. Cohorts leave the server ONLY as aggregates + an anonymised
 * distribution (spec.ts sovereignty) — never another entity's name.
 *
 * AUTHZ — three doors, most-powerful first:
 *   · ssi_admin/god (verifyAdmin): any node. The K_FLOOR privacy floor is a
 *     protection against outside inference; admins already hold row-level
 *     access to every entity, so their floor is 1 active peer (the tool would
 *     otherwise be blank at current scale while protecting nothing).
 *   · leaders/school admins/teachers (resolveVisibleScope): class → their
 *     classIds; school node → its own school in their schoolIds; group node →
 *     their governed group or a strict descendant. K_FLOOR held in full.
 *
 * Cohort member unit: peers-like-me — classes when the entity is a class,
 * schools when the entity is a school node or an interior group (school
 * spread is the meaningful, k-clearable unit above class level; sibling-group
 * cohorts are structurally too sparse). Classes attached directly to groups
 * with no school are counted in ENTITY values but not as cohort members.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../../_utils/auth'
import { resolveVisibleScope, ownSchoolIdForNode, isStrictDescendantGroup, chunk } from '../../_utils/schoolScope'
import { ensureSchoolNode } from '../../_utils/schoolNode'
import { isEntityCoverageExpired } from '../../_utils/schoolCoverageGate'
import {
  aggregateWindowPace,
  aggregateWeeklyTrend,
  distributionStats,
  deltaPct,
  meanTrend,
  coverageLabel,
  K_FLOOR,
  type ScopedSessionRow,
} from '../../_utils/rateCompare'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const TREND_WEEKS = 8
const MAX_COHORT_IDS = 2000

interface GroupRow {
  id: string
  name: string
  type: string
  parent_id: string | null
  path: string | null
  is_demo: boolean
}

interface CompareOption {
  value: string // ancestor group id | 'global' | 'global_all_courses'
  label: string
  word: string // ancestor's label word ('school', 'programme'…) or 'global'
}

interface SchoolRef { id: string; node_group_id: string | null }

function inSubtree(path: string | null | undefined, rootPath: string): boolean {
  return typeof path === 'string' && (path === rootPath || path.startsWith(rootPath + '/'))
}

/** Schools attached to a subtree (node bridge ∪ legacy parent attachment — the home.ts union). */
async function subtreeSchools(svc: SupabaseClient, subtreeGroupIds: string[]): Promise<SchoolRef[]> {
  const out: SchoolRef[] = []
  const seen = new Set<string>()
  for (const batch of chunk(subtreeGroupIds)) {
    const [{ data: byNode }, { data: byParent }] = await Promise.all([
      svc.from('schools').select('id, node_group_id').in('node_group_id', batch),
      svc.from('schools').select('id, node_group_id').in('group_id', batch),
    ])
    for (const s of [...(byNode ?? []), ...(byParent ?? [])]) {
      const id = (s as any).id as string
      if (id && !seen.has(id)) { seen.add(id); out.push({ id, node_group_id: (s as any).node_group_id ?? null }) }
    }
  }
  return out
}

interface SubtreeClass { id: string; course_code: string | null; school_id: string | null }

/** Active classes in a subtree: node-attached (group_id) ∪ school-attached — the home.ts union. */
async function subtreeClasses(
  svc: SupabaseClient,
  subtreeGroupIds: string[],
  schoolIds: string[],
  courseCode: string | null,
): Promise<SubtreeClass[]> {
  const out: SubtreeClass[] = []
  const seen = new Set<string>()
  const add = (rows: any[] | null) => {
    for (const c of rows ?? []) {
      if (c.id && !seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, course_code: c.course_code ?? null, school_id: c.school_id ?? null }) }
    }
  }
  for (const batch of chunk(subtreeGroupIds)) {
    let q = svc.from('classes').select('id, course_code, school_id').in('group_id', batch).eq('is_active', true)
    if (courseCode) q = q.eq('course_code', courseCode)
    const { data } = await q.limit(MAX_COHORT_IDS)
    add(data)
  }
  for (const batch of chunk(schoolIds)) {
    let q = svc.from('classes').select('id, course_code, school_id').in('school_id', batch).eq('is_active', true)
    if (courseCode) q = q.eq('course_code', courseCode)
    const { data } = await q.limit(MAX_COHORT_IDS)
    add(data)
  }
  return out
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

  // ─── Auth: admin door first, then the visible-scope door. ───
  let isAdmin = false
  let authUid: string | null = null
  const adminResult = await verifyAdmin(req)
  if (!('error' in adminResult)) {
    isAdmin = true
    authUid = adminResult.userId
  } else {
    const authResult = await verifyAuthToken(req)
    if (!authResult.valid || !authResult.userId) {
      res.status(401).json({ error: authResult.error || 'Unauthorized' })
      return
    }
    authUid = authResult.userId
  }

  const rawId = String(req.query.id || '')
  const requestedCourse = String(req.query.course_code || '').trim() || null
  const requestedCompare = String(req.query.compare_to || '').trim() || null
  const days = Math.min(180, Math.max(7, parseInt(String(req.query.days || '90'), 10) || 90))

  try {
    // ─── Resolve :id → node / class (same order as home.ts). ───
    let nodeId: string | null = null
    let classRow: { id: string; class_name: string; course_code: string | null; school_id: string | null; group_id: string | null } | null = null

    const { data: asGroup } = await svc.from('groups').select('id').eq('id', rawId).maybeSingle()
    if (asGroup) {
      nodeId = rawId
    } else {
      const { data: asSchool } = await svc
        .from('schools').select('id, school_name, group_id, node_group_id, is_demo, is_test')
        .eq('id', rawId).maybeSingle()
      if (asSchool) {
        nodeId = (asSchool as any).node_group_id
          || (await ensureSchoolNode(svc, asSchool as any, { is_demo: (asSchool as any).is_demo, is_test: (asSchool as any).is_test }))
      } else {
        const { data: asClass } = await svc
          .from('classes').select('id, class_name, course_code, school_id, group_id')
          .eq('id', rawId).maybeSingle()
        if (asClass) {
          classRow = asClass as any
          if (classRow!.school_id) {
            const { data: sch } = await svc
              .from('schools').select('id, school_name, group_id, node_group_id, is_demo, is_test')
              .eq('id', classRow!.school_id).maybeSingle()
            if (sch) {
              nodeId = (sch as any).node_group_id
                || (await ensureSchoolNode(svc, sch as any, { is_demo: (sch as any).is_demo, is_test: (sch as any).is_test }))
            }
          }
          if (!nodeId && classRow!.group_id) nodeId = classRow!.group_id
        }
      }
    }
    if (!nodeId && !classRow) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // ─── Authz (non-admin): class membership / own school / governed subtree. ───
    if (!isAdmin) {
      const scope = await resolveVisibleScope(svc, authUid!)
      let authorized = false
      if (classRow) {
        authorized = scope.classIds.includes(classRow.id)
      } else if (nodeId) {
        const ownSchool = await ownSchoolIdForNode(svc, nodeId)
        if (ownSchool && scope.schoolIds.includes(ownSchool)) authorized = true
        else if (scope.groupId && (scope.groupId === nodeId || (await isStrictDescendantGroup(svc, scope.groupId, nodeId)))) authorized = true
      }
      if (!authorized) {
        res.status(403).json({ error: 'That entity is outside your visible scope' })
        return
      }
      // Coverage gate (non-admin callers only — admins may inspect expired schools).
      const gateSchoolId = classRow?.school_id ?? (nodeId ? await ownSchoolIdForNode(svc, nodeId) : null)
      if (await isEntityCoverageExpired(svc, gateSchoolId)) {
        res.status(403).json({ error: 'coverage_expired', message: 'This school’s platform coverage has expired.' })
        return
      }
    }

    // ─── Forest map (one fetch — the home.ts pattern). ───
    const { data: allGroupsData } = await svc.from('groups').select('id, name, type, parent_id, path, is_demo')
    const allGroups = (allGroupsData ?? []) as GroupRow[]
    const byId = new Map(allGroups.map((g) => [g.id, g]))
    const nodeRow = nodeId ? byId.get(nodeId) : undefined
    if (nodeId && !nodeRow) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    // ─── Ancestor chain, NEAREST first. For a class the chain starts at its
    // own node (school/group) — class → school avg → … → global. ───
    const ancestors: GroupRow[] = []
    let cursor = classRow ? nodeRow : (nodeRow?.parent_id ? byId.get(nodeRow.parent_id) : undefined)
    while (cursor) {
      ancestors.push(cursor)
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined
    }

    const compareOptions: CompareOption[] = [
      ...ancestors.map((a) => ({ value: a.id, label: `${a.name} average`, word: a.type })),
      { value: 'global', label: 'Global average · this course', word: 'global' },
      { value: 'global_all_courses', label: 'Global average · all courses', word: 'global' },
    ]
    const compareTo = requestedCompare && compareOptions.some((o) => o.value === requestedCompare)
      ? requestedCompare
      : compareOptions[0].value

    // ─── Entity subtree + course options. ───
    const entitySubtreeGroupIds = classRow
      ? []
      : (nodeRow!.path ? allGroups.filter((g) => inSubtree(g.path, nodeRow!.path!)).map((g) => g.id) : [nodeId!])
    const entitySchools = classRow ? [] : await subtreeSchools(svc, entitySubtreeGroupIds)
    const entitySchoolIds = new Set(entitySchools.map((s) => s.id))
    const entityAllClasses = classRow
      ? [{ id: classRow.id, course_code: classRow.course_code, school_id: classRow.school_id }]
      : await subtreeClasses(svc, entitySubtreeGroupIds, [...entitySchoolIds], null)

    const courseCounts = new Map<string, number>()
    for (const c of entityAllClasses) {
      if (c.course_code) courseCounts.set(c.course_code, (courseCounts.get(c.course_code) || 0) + 1)
    }
    const courseOptions = [...courseCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, classCount]) => ({ code, classCount }))
    const courseCode = requestedCourse && courseCounts.has(requestedCourse)
      ? requestedCourse
      : (courseOptions[0]?.code ?? null)

    const nodeMeta = classRow
      ? { id: classRow.id, name: classRow.class_name, label: 'class', kind: 'class' as const }
      : { id: nodeId!, name: nodeRow!.name, label: nodeRow!.type, kind: 'node' as const }

    const baseBody = {
      node: nodeMeta,
      options: { courses: courseOptions, compares: compareOptions },
      applied: { course_code: courseCode, compare_to: compareTo, days },
      kFloor: isAdmin ? 1 : K_FLOOR,
    }
    const insufficient = (reason: string, cohortSize = 0): void => {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ ...baseBody, insufficientData: true, cohortSize, reason })
    }

    if (!courseCode) {
      insufficient(classRow ? 'This class has no course set yet.' : 'No classes below this yet.')
      return
    }

    const entityClassIds = entityAllClasses.filter((c) => c.course_code === courseCode).map((c) => c.id)
    if (entityClassIds.length === 0) {
      insufficient('No classes running this course yet.')
      return
    }

    // ─── Cohort: peers-like-me within the chosen scope. ───
    const cohortCourse = compareTo === 'global_all_courses' ? null : courseCode
    let members: { id: string; classIds: string[] }[] = []

    if (compareTo === 'global' || compareTo === 'global_all_courses') {
      if (classRow) {
        let q = svc.from('classes').select('id').eq('is_active', true).neq('id', classRow.id)
        if (cohortCourse) q = q.eq('course_code', cohortCourse)
        const { data } = await q.limit(MAX_COHORT_IDS)
        members = (data ?? []).map((c: any) => ({ id: c.id, classIds: [c.id] }))
      } else {
        let q = svc.from('classes').select('id, school_id').eq('is_active', true).not('school_id', 'is', null)
        if (cohortCourse) q = q.eq('course_code', cohortCourse)
        const { data } = await q.limit(MAX_COHORT_IDS)
        const bySchool = new Map<string, string[]>()
        for (const c of data ?? []) {
          const sid = (c as any).school_id as string
          const cid = (c as any).id as string
          if (!sid || !cid || entitySchoolIds.has(sid)) continue
          const arr = bySchool.get(sid) ?? []
          arr.push(cid)
          bySchool.set(sid, arr)
        }
        members = [...bySchool.entries()].map(([id, classIds]) => ({ id, classIds }))
      }
    } else {
      // an ancestor group id
      const anc = byId.get(compareTo)
      if (!anc || !anc.path) {
        insufficient('That comparison scope has no resolvable data yet.')
        return
      }
      const ancGroupIds = allGroups.filter((g) => inSubtree(g.path, anc.path!)).map((g) => g.id)
      const ancSchools = await subtreeSchools(svc, ancGroupIds)
      if (classRow) {
        const ancClasses = await subtreeClasses(svc, ancGroupIds, ancSchools.map((s) => s.id), cohortCourse)
        members = ancClasses.filter((c) => c.id !== classRow!.id).map((c) => ({ id: c.id, classIds: [c.id] }))
      } else {
        const peerSchools = ancSchools.filter((s) => !entitySchoolIds.has(s.id))
        const peerClasses = await subtreeClasses(svc, [], peerSchools.map((s) => s.id), cohortCourse)
        const bySchool = new Map<string, string[]>()
        for (const c of peerClasses) {
          if (!c.school_id) continue
          const arr = bySchool.get(c.school_id) ?? []
          arr.push(c.id)
          bySchool.set(c.school_id, arr)
        }
        members = [...bySchool.entries()].map(([id, classIds]) => ({ id, classIds }))
      }
    }

    // ─── Sessions + math (shared primitives). ───
    const fetchDays = Math.max(days, (TREND_WEEKS + 1) * 7)
    const allClassIds = [...new Set([...entityClassIds, ...members.flatMap((m) => m.classIds)])].slice(0, MAX_COHORT_IDS)
    // A DEMO node reads its own demo sessions (demo orgs are self-contained
    // subtrees, so its ancestor cohorts are demo peers); a real node keeps the
    // RPC's demo exclusion — a real cohort never gains a demo row.
    const entityIsDemo = Boolean(nodeRow?.is_demo)
    const { data: rawRows, error: rpcError } = await svc.rpc('analytics_class_sessions_scoped', {
      p_class_ids: allClassIds,
      p_days: fetchDays,
      p_include_demo: entityIsDemo,
    })
    if (rpcError) {
      console.error('[node-rate-compare] analytics_class_sessions_scoped error:', rpcError.message)
      res.status(500).json({ error: 'Failed to load rate data' })
      return
    }
    const rows = (rawRows as ScopedSessionRow[]) || []
    const now = new Date()

    const entityWindow = aggregateWindowPace(rows, entityClassIds, days, now)
    const entityTrend = aggregateWeeklyTrend(rows, entityClassIds, TREND_WEEKS, now)

    const memberResults = members.map((m) => ({
      window: aggregateWindowPace(rows, m.classIds, days, now),
      trend: aggregateWeeklyTrend(rows, m.classIds, TREND_WEEKS, now),
    }))
    const active = memberResults.filter((m) => m.window.hasData)
    const effectiveFloor = isAdmin ? 1 : K_FLOOR
    if (active.length < effectiveFloor) {
      insufficient('Not enough data to compare fairly yet.', active.length)
      return
    }

    const cohortValues = active.map((m) => m.window.pace)
    const averageTrend = meanTrend(active.map((m) => m.trend))
    const averageValue = Math.round((cohortValues.reduce((a, b) => a + b, 0) / cohortValues.length) * 10) / 10
    const dist = distributionStats(cohortValues)
    const compareLabel = compareOptions.find((o) => o.value === compareTo)?.label ?? 'Average'

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      ...baseBody,
      insufficientData: false,
      metricLabel: 'Rate of progress',
      unit: 'LEGOs',
      per: 'week',
      entity: { label: nodeMeta.name, value: entityWindow.pace, trend: entityTrend },
      average: { label: compareLabel, value: averageValue, trend: averageTrend },
      deltaPct: deltaPct(entityWindow.pace, averageValue),
      percentile: dist.percentileOf(entityWindow.pace),
      contextLine: entityWindow.furthestLegoId ? `Furthest LEGO · ${coverageLabel(entityWindow.furthestLegoId)}` : undefined,
      distribution: {
        values: dist.values,
        min: dist.min,
        q1: dist.q1,
        median: dist.median,
        q3: dist.q3,
        max: dist.max,
        entityValue: entityWindow.pace,
        averageValue,
        percentile: dist.percentileOf(entityWindow.pace),
      },
      cohortSize: active.length,
    })
  } catch (error) {
    console.error('[node-rate-compare] error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
