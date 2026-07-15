/**
 * Real "Rate compare" data, course-first, full entity ladder —
 * GET /api/school/rate-compare
 *   ?course_code=<code>&entity_level=class|school|group&entity_id=<uuid>
 *   &compare_to=school|group|region|global|global_all_courses&days=90
 *
 * The class-as-learner coverage lane (docs/methodology/tutor-insights.md §2-3)
 * made real for schools roles: rate of progress (LEGOs/week) for an entity —
 * a class, a whole school, or a whole group — against an aggregate average,
 * never another named entity (sovereignty, insight-engine.md §7).
 *
 * COURSE IS THE NORMALISING KEY (owner's ruling): the course is chosen FIRST
 * and every SAME-COURSE aggregate is computed over that course only, so a
 * school or group average is never diluted across unrelated courses.
 *
 * ENTITY LADDER (each entity is really just "a set of classes" — a class is
 * a set of one, a school is its classes, a group is its subtree's classes —
 * so one RPC + one aggregation primitive (aggregateWindowPace/
 * aggregateWeeklyTrend, api/_utils/rateCompare.ts) serves every level):
 *   class  -> school avg | group avg | global avg (this course) | global avg (all courses)
 *   school -> group avg  | global avg (this course) | global avg (all courses)
 *   group  -> region avg (sibling groups sharing the same parent) | global avg (this course) | global avg (all courses)
 * "region" degrades honestly to insufficientData when the entity's group has
 * no parent group yet (region has no data-bearing definition beyond the
 * group itself) — never fabricated.
 *
 * "ALL COURSES" GLOBAL (owner's ruling, follow-up): relatedness determines
 * the STRENGTH of a comparison, not its permission — a course-agnostic
 * "every SSi learner, every course" average is offered ALONGSIDE the
 * same-course cohorts at every level, never replacing them, always labelled
 * distinctly ("this course" vs "all courses") so the weaker basis is visible
 * at a glance. The ENTITY's own value stays anchored to the selected course
 * (course-first still governs what's being measured); only the cohort widens
 * — each peer class already carries its own course's ordinal system, so
 * mixing courses in the average pool is the same "self-computed rate, then
 * averaged" pattern already used for same-course cohorts, just over a wider
 * pool. Same K_FLOOR applies.
 *
 * Auth required. `entity_id` MUST be inside the caller's resolveVisibleScope:
 *   class  -> scope.classIds
 *   school -> scope.schoolIds (school_admin: their school; govt_admin: every
 *             school in their group subtree)
 *   group  -> scope.groupId (govt_admin's own group only)
 * The comparison COHORT is always resolved server-side from the entity's own
 * school/group/parent-group (or, for the all-courses global, the whole
 * ecosystem) — never from client input — and only ever returned as an
 * aggregate: no other entity's identity, name, or row is ever included in
 * the response.
 *
 * PRIVACY FLOOR: if the cohort (excluding the entity) has fewer than K_FLOOR
 * peer entities with any activity in the window, responds with
 * insufficientData instead of an average computed from too small a group —
 * held at EVERY aggregate level (classes, schools, AND groups) and both
 * global variants.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope } from '../_utils/schoolScope'
import { isEntityCoverageExpired } from '../_utils/schoolCoverageGate'
import {
  aggregateWindowPace,
  aggregateWeeklyTrend,
  distributionStats,
  deltaPct,
  meanTrend,
  coverageLabel,
  K_FLOOR,
  type ScopedSessionRow,
} from '../_utils/rateCompare'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const TREND_WEEKS = 8
const MAX_COHORT_IDS = 2000 // safety cap; schools scale is nowhere near this yet

type EntityLevel = 'class' | 'school' | 'group'
type CompareTo = 'school' | 'group' | 'region' | 'global' | 'global_all_courses'

// 'global_all_courses' is offered ALONGSIDE every level's same-course options
// (owner's ruling — relatedness is strength, not permission), never in place
// of them.
const COMPARE_OPTIONS_BY_LEVEL: Record<EntityLevel, CompareTo[]> = {
  class: ['school', 'group', 'global', 'global_all_courses'],
  school: ['group', 'global', 'global_all_courses'],
  group: ['region', 'global', 'global_all_courses'],
}
const COMPARE_LABEL: Record<CompareTo, string> = {
  school: 'School average',
  group: 'Group average',
  region: 'Regional average',
  global: 'Global average · this course',
  global_all_courses: 'Global average · all courses',
}

interface EntityMeta {
  id: string
  label: string
  classIds: string[]        // this entity's active classes on the chosen course
  ownSchoolId: string | null   // class/school entities: their school (for compare_to=school/group)
  schoolGroupId: string | null // class/school entities: their school's group (for compare_to=group)
  path: string | null          // group entities: their own group.path (for compare_to=region/global)
  parentGroupId: string | null // group entities: their group.parent_id (for compare_to=region)
}

interface CohortMember {
  id: string
  classIds: string[]
}

/**
 * All active class ids in a group's subtree (this group + every descendant).
 * `courseCode` null means the "all courses" ecosystem-wide pool — the ONLY
 * caller allowed to omit it is the global_all_courses cohort resolution.
 */
async function subtreeClassIdsForGroupPath(svc: SupabaseClient, path: string, courseCode: string | null): Promise<string[]> {
  const { data: subtreeGroups } = await svc.from('groups').select('id').like('path', `${path}%`)
  const groupIds = (subtreeGroups ?? []).map((g: any) => g.id).filter(Boolean)
  if (groupIds.length === 0) return []
  const { data: schools } = await svc.from('schools').select('id').in('group_id', groupIds).limit(MAX_COHORT_IDS)
  const schoolIds = (schools ?? []).map((s: any) => s.id).filter(Boolean)
  if (schoolIds.length === 0) return []
  let query = svc.from('classes').select('id').in('school_id', schoolIds).eq('is_active', true)
  if (courseCode) query = query.eq('course_code', courseCode)
  const { data: classesRows } = await query.limit(MAX_COHORT_IDS)
  return (classesRows ?? []).map((c: any) => c.id).filter(Boolean)
}

/**
 * classes(active) for a set of schools, grouped by school_id — one round
 * trip. `courseCode` null = every course (the "all courses" cohort pool).
 */
async function classIdsBySchool(svc: SupabaseClient, schoolIds: string[], courseCode: string | null): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (schoolIds.length === 0) return out
  let query = svc.from('classes').select('id, school_id').in('school_id', schoolIds).eq('is_active', true)
  if (courseCode) query = query.eq('course_code', courseCode)
  const { data } = await query.limit(MAX_COHORT_IDS)
  for (const c of data ?? []) {
    const sid = (c as any).school_id as string
    if (!sid) continue
    const arr = out.get(sid) ?? []
    arr.push((c as any).id)
    out.set(sid, arr)
  }
  return out
}

async function loadEntityMeta(svc: SupabaseClient, level: EntityLevel, entityId: string, courseCode: string): Promise<EntityMeta | null> {
  if (level === 'class') {
    const { data } = await svc.from('classes').select('id, class_name, course_code, school_id').eq('id', entityId).maybeSingle()
    if (!data || (data as any).course_code !== courseCode) return null
    const schoolId = (data as any).school_id as string | null
    let groupId: string | null = null
    if (schoolId) {
      const { data: school } = await svc.from('schools').select('group_id').eq('id', schoolId).maybeSingle()
      groupId = (school as any)?.group_id ?? null
    }
    return {
      id: entityId, label: (data as any).class_name || 'Your class', classIds: [entityId],
      ownSchoolId: schoolId, schoolGroupId: groupId, path: null, parentGroupId: null,
    }
  }

  if (level === 'school') {
    const { data: school } = await svc.from('schools').select('id, school_name, group_id').eq('id', entityId).maybeSingle()
    if (!school) return null
    const byCourse = await classIdsBySchool(svc, [entityId], courseCode)
    return {
      id: entityId, label: (school as any).school_name || 'Your school', classIds: byCourse.get(entityId) ?? [],
      ownSchoolId: entityId, schoolGroupId: (school as any).group_id ?? null, path: null, parentGroupId: null,
    }
  }

  // 'group'
  const { data: group } = await svc.from('groups').select('id, name, path, parent_id').eq('id', entityId).maybeSingle()
  if (!group || !(group as any).path) return null
  const classIds = await subtreeClassIdsForGroupPath(svc, (group as any).path, courseCode)
  return {
    id: entityId, label: (group as any).name || 'Your group', classIds,
    ownSchoolId: null, schoolGroupId: null, path: (group as any).path, parentGroupId: (group as any).parent_id ?? null,
  }
}

/** Peer entities for the chosen comparison, excluding the entity itself. Never returned to the client — aggregate only. */
async function resolveCohort(
  svc: SupabaseClient,
  level: EntityLevel,
  compareTo: CompareTo,
  entity: EntityMeta,
  courseCode: string,
): Promise<{ members: CohortMember[]; error?: string }> {
  if (level === 'class') {
    if (compareTo === 'school') {
      if (!entity.ownSchoolId) return { members: [], error: 'This class has no school to compare within.' }
      const { data } = await svc
        .from('classes').select('id').eq('school_id', entity.ownSchoolId).eq('course_code', courseCode)
        .eq('is_active', true).neq('id', entity.id).limit(MAX_COHORT_IDS)
      return { members: (data ?? []).map((c: any) => ({ id: c.id, classIds: [c.id] })) }
    }
    if (compareTo === 'group') {
      if (!entity.ownSchoolId) return { members: [], error: 'This class has no school, so there is no group to compare within.' }
      if (!entity.schoolGroupId) return { members: [], error: 'This class’s school is not part of a group yet.' }
      const { data: group } = await svc.from('groups').select('path').eq('id', entity.schoolGroupId).maybeSingle()
      const path = (group as any)?.path as string | undefined
      if (!path) return { members: [], error: 'This class’s group has no resolvable scope yet.' }
      const ids = (await subtreeClassIdsForGroupPath(svc, path, courseCode)).filter((id) => id !== entity.id)
      return { members: ids.map((id) => ({ id, classIds: [id] })) }
    }
    if (compareTo === 'global') {
      const { data } = await svc
        .from('classes').select('id').eq('course_code', courseCode).eq('is_active', true)
        .neq('id', entity.id).limit(MAX_COHORT_IDS)
      return { members: (data ?? []).map((c: any) => ({ id: c.id, classIds: [c.id] })) }
    }
    // 'global_all_courses' — every active class, any course, ecosystem-wide.
    const { data } = await svc
      .from('classes').select('id').eq('is_active', true).neq('id', entity.id).limit(MAX_COHORT_IDS)
    return { members: (data ?? []).map((c: any) => ({ id: c.id, classIds: [c.id] })) }
  }

  if (level === 'school') {
    if (compareTo === 'group') {
      if (!entity.schoolGroupId) return { members: [], error: 'This school is not part of a group yet.' }
      const { data: group } = await svc.from('groups').select('path').eq('id', entity.schoolGroupId).maybeSingle()
      const path = (group as any)?.path as string | undefined
      if (!path) return { members: [], error: 'This school’s group has no resolvable scope yet.' }
      const { data: subtreeGroups } = await svc.from('groups').select('id').like('path', `${path}%`)
      const groupIds = (subtreeGroups ?? []).map((g: any) => g.id).filter(Boolean)
      if (groupIds.length === 0) return { members: [] }
      const { data: schools } = await svc.from('schools').select('id').in('group_id', groupIds).neq('id', entity.id).limit(MAX_COHORT_IDS)
      const peerSchoolIds = (schools ?? []).map((s: any) => s.id).filter(Boolean)
      const byCourse = await classIdsBySchool(svc, peerSchoolIds, courseCode)
      return { members: peerSchoolIds.map((id) => ({ id, classIds: byCourse.get(id) ?? [] })) }
    }
    if (compareTo === 'global') {
      // every school on this course, any group.
      const { data } = await svc
        .from('classes').select('school_id').eq('course_code', courseCode).eq('is_active', true)
        .not('school_id', 'is', null).neq('school_id', entity.id).limit(MAX_COHORT_IDS)
      const peerSchoolIds = [...new Set((data ?? []).map((c: any) => c.school_id).filter(Boolean))] as string[]
      const byCourse = await classIdsBySchool(svc, peerSchoolIds, courseCode)
      return { members: peerSchoolIds.map((id) => ({ id, classIds: byCourse.get(id) ?? [] })) }
    }
    // 'global_all_courses' — every school, any course, ecosystem-wide. Each
    // peer school's own classIds are ALSO unfiltered by course (the whole
    // point: this pool trades relatedness for reach).
    const { data } = await svc
      .from('classes').select('school_id').eq('is_active', true)
      .not('school_id', 'is', null).neq('school_id', entity.id).limit(MAX_COHORT_IDS)
    const peerSchoolIds = [...new Set((data ?? []).map((c: any) => c.school_id).filter(Boolean))] as string[]
    const byAnyCourse = await classIdsBySchool(svc, peerSchoolIds, null)
    return { members: peerSchoolIds.map((id) => ({ id, classIds: byAnyCourse.get(id) ?? [] })) }
  }

  // level === 'group'
  if (compareTo === 'region') {
    if (!entity.parentGroupId) return { members: [], error: 'This group has no broader region to compare within yet.' }
    const { data: siblings } = await svc
      .from('groups').select('id, path').eq('parent_id', entity.parentGroupId).neq('id', entity.id)
    const rows = (siblings ?? []) as { id: string; path: string | null }[]
    const members: CohortMember[] = []
    for (const s of rows) {
      if (!s.path) continue
      members.push({ id: s.id, classIds: await subtreeClassIdsForGroupPath(svc, s.path, courseCode) })
    }
    return { members }
  }
  // 'global' / 'global_all_courses' — every other group whose subtree doesn't
  // overlap the entity's own (not an ancestor/descendant); the all-courses
  // variant just drops the course filter when pulling each peer's classIds.
  const { data: allGroups } = await svc.from('groups').select('id, path').limit(MAX_COHORT_IDS)
  const rows = (allGroups ?? []) as { id: string; path: string | null }[]
  const entityPath = entity.path as string
  const peerCourseCode = compareTo === 'global' ? courseCode : null
  const members: CohortMember[] = []
  for (const g of rows) {
    if (!g.path || g.id === entity.id) continue
    if (entityPath.startsWith(g.path) || g.path.startsWith(entityPath)) continue // ancestor/descendant overlap
    members.push({ id: g.id, classIds: await subtreeClassIdsForGroupPath(svc, g.path, peerCourseCode) })
  }
  return { members }
}

function respondInsufficientData(res: VercelResponse, reason: string, cohortSize = 0): void {
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ insufficientData: true, cohortSize, kFloor: K_FLOOR, reason })
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const courseCode = String(req.query.course_code || '').trim()
  const entityLevel = String(req.query.entity_level || 'class').trim() as EntityLevel
  const entityId = String(req.query.entity_id || '').trim()
  const compareTo = String(req.query.compare_to || '').trim() as CompareTo
  const days = Math.min(180, Math.max(7, parseInt(String(req.query.days || '90'), 10) || 90))

  if (!courseCode) { res.status(400).json({ error: 'course_code is required' }); return }
  if (!entityId) { res.status(400).json({ error: 'entity_id is required' }); return }
  if (!['class', 'school', 'group'].includes(entityLevel)) {
    res.status(400).json({ error: 'entity_level must be class, school, or group' })
    return
  }
  if (!COMPARE_OPTIONS_BY_LEVEL[entityLevel].includes(compareTo)) {
    res.status(400).json({ error: `compare_to must be one of: ${COMPARE_OPTIONS_BY_LEVEL[entityLevel].join(', ')}` })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(svc, auth.userId)
    const authorized =
      entityLevel === 'class' ? scope.classIds.includes(entityId) :
      entityLevel === 'school' ? scope.schoolIds.includes(entityId) :
      scope.groupId !== null && scope.groupId === entityId
    if (!authorized) {
      res.status(403).json({ error: 'That entity is outside your visible scope' })
      return
    }

    const entity = await loadEntityMeta(svc, entityLevel, entityId, courseCode)
    if (!entity) {
      res.status(404).json({ error: 'Entity not found for that course' })
      return
    }

    // Coverage gate: a class/school drill-down for an expired school goes
    // dark, same rule as the client-side platformActive gate. entity.ownSchoolId
    // is null at entity_level='group' — group rollups are exempt (owner's
    // ruling, schoolCoverageGate.ts).
    if (await isEntityCoverageExpired(svc, entity.ownSchoolId)) {
      res.status(403).json({ error: 'coverage_expired', message: 'This school’s platform coverage has expired.' })
      return
    }

    if (entity.classIds.length === 0) {
      respondInsufficientData(res, 'No classes running this course yet.')
      return
    }

    const cohort = await resolveCohort(svc, entityLevel, compareTo, entity, courseCode)
    if (cohort.error) {
      respondInsufficientData(res, cohort.error)
      return
    }

    const fetchDays = Math.max(days, (TREND_WEEKS + 1) * 7)
    const allClassIds = [...new Set([...entity.classIds, ...cohort.members.flatMap((m) => m.classIds)])].slice(0, MAX_COHORT_IDS)
    const { data: rawRows, error: rpcError } = await svc.rpc('analytics_class_sessions_scoped', {
      p_class_ids: allClassIds,
      p_days: fetchDays,
    })
    if (rpcError) {
      console.error('[rate-compare] analytics_class_sessions_scoped error:', rpcError.message)
      res.status(500).json({ error: 'Failed to load rate data' })
      return
    }
    const rows = (rawRows as ScopedSessionRow[]) || []
    const now = new Date()

    const entityWindow = aggregateWindowPace(rows, entity.classIds, days, now)
    const entityTrend = aggregateWeeklyTrend(rows, entity.classIds, TREND_WEEKS, now)

    const memberResults = cohort.members.map((m) => ({
      id: m.id,
      window: aggregateWindowPace(rows, m.classIds, days, now),
      trend: aggregateWeeklyTrend(rows, m.classIds, TREND_WEEKS, now),
    }))
    const active = memberResults.filter((m) => m.window.hasData)
    if (active.length < K_FLOOR) {
      respondInsufficientData(res, 'Not enough data to compare fairly yet.', active.length)
      return
    }

    const cohortValues = active.map((m) => m.window.pace)
    const averageTrend = meanTrend(active.map((m) => m.trend))
    const averageValue = Math.round((cohortValues.reduce((a, b) => a + b, 0) / cohortValues.length) * 10) / 10

    const dist = distributionStats(cohortValues)

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      insufficientData: false,
      metricLabel: 'Rate of progress',
      unit: 'LEGOs',
      per: 'week',
      entity: {
        label: entity.label,
        value: entityWindow.pace,
        trend: entityTrend,
      },
      average: {
        label: COMPARE_LABEL[compareTo],
        value: averageValue,
        trend: averageTrend,
      },
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
  } catch (err) {
    console.error('[rate-compare] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
