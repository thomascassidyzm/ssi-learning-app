/**
 * Real "Rate compare" data for a class — GET /api/school/rate-compare
 *   ?class_id=<uuid>&compare_to=school|group|global&days=90
 *
 * The class-as-learner coverage lane (docs/methodology/tutor-insights.md §2-3)
 * made real for schools roles: rate of progress (LEGOs/week) for one class,
 * against an aggregate average — never another named entity (sovereignty,
 * insight-engine.md §7). This is the schools-facing sibling of the admin-only
 * /admin/stats "Coverage" board: same session->ordinal math, but scoped to a
 * caller-visible class instead of admin-wide.
 *
 * Auth required. `class_id` MUST be inside the caller's resolveVisibleScope
 * (teacher/school_admin/govt_admin) — the entity is always a single class, so
 * course_code stays constant and the average is a fair like-for-like
 * comparison. The comparison COHORT (the classes averaged over) is resolved
 * server-side from the entity's own school/group — never from client input —
 * and only ever returned as an aggregate: no other class's identity, name, or
 * row is ever included in the response.
 *
 * PRIVACY FLOOR: if the cohort (excluding the entity) has fewer than K_FLOOR
 * classes with any activity in the window, responds with insufficientData
 * instead of an average computed from too small a group.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { resolveVisibleScope } from '../_utils/schoolScope'
import {
  windowPaceForClass,
  weeklyTrendForClass,
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

type CompareTo = 'school' | 'group' | 'global'

interface ClassMeta {
  id: string
  class_name: string | null
  course_code: string
  school_id: string | null
}

async function loadClassMeta(svc: SupabaseClient, classId: string): Promise<ClassMeta | null> {
  const { data } = await svc
    .from('classes')
    .select('id, class_name, course_code, school_id')
    .eq('id', classId)
    .maybeSingle()
  if (!data || !(data as any).course_code) return null
  return data as ClassMeta
}

/** Cohort class ids for the chosen comparison, excluding the entity itself. Never returned to the client — aggregate only. */
async function cohortClassIds(
  svc: SupabaseClient,
  entity: ClassMeta,
  compareTo: CompareTo,
): Promise<{ ids: string[]; error?: string }> {
  if (compareTo === 'school') {
    if (!entity.school_id) return { ids: [], error: 'This class has no school to compare within.' }
    const { data } = await svc
      .from('classes')
      .select('id')
      .eq('school_id', entity.school_id)
      .eq('course_code', entity.course_code)
      .eq('is_active', true)
      .neq('id', entity.id)
      .limit(MAX_COHORT_IDS)
    return { ids: (data ?? []).map((c: any) => c.id) }
  }

  if (compareTo === 'group') {
    if (!entity.school_id) return { ids: [], error: 'This class has no school, so there is no group to compare within.' }
    const { data: school } = await svc.from('schools').select('group_id').eq('id', entity.school_id).maybeSingle()
    const groupId = (school as any)?.group_id as string | undefined
    if (!groupId) return { ids: [], error: 'This class’s school is not part of a group yet.' }
    const { data: group } = await svc.from('groups').select('path').eq('id', groupId).maybeSingle()
    const path = (group as any)?.path as string | undefined
    if (!path) return { ids: [], error: 'This class’s group has no resolvable scope yet.' }
    const { data: subtreeGroups } = await svc.from('groups').select('id').like('path', `${path}%`)
    const groupIds = (subtreeGroups ?? []).map((g: any) => g.id).filter(Boolean)
    if (groupIds.length === 0) return { ids: [] }
    const { data: schools } = await svc.from('schools').select('id').in('group_id', groupIds)
    const schoolIds = (schools ?? []).map((s: any) => s.id).filter(Boolean)
    if (schoolIds.length === 0) return { ids: [] }
    const { data } = await svc
      .from('classes')
      .select('id')
      .in('school_id', schoolIds)
      .eq('course_code', entity.course_code)
      .eq('is_active', true)
      .neq('id', entity.id)
      .limit(MAX_COHORT_IDS)
    return { ids: (data ?? []).map((c: any) => c.id) }
  }

  // 'global' — every class on the same course, any school (including null-school ACT classes).
  const { data } = await svc
    .from('classes')
    .select('id')
    .eq('course_code', entity.course_code)
    .eq('is_active', true)
    .neq('id', entity.id)
    .limit(MAX_COHORT_IDS)
  return { ids: (data ?? []).map((c: any) => c.id) }
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

  const classId = String(req.query.class_id || '').trim()
  const compareTo = (String(req.query.compare_to || 'school').trim() as CompareTo)
  const days = Math.min(180, Math.max(7, parseInt(String(req.query.days || '90'), 10) || 90))
  if (!classId) {
    res.status(400).json({ error: 'class_id is required' })
    return
  }
  if (!['school', 'group', 'global'].includes(compareTo)) {
    res.status(400).json({ error: 'compare_to must be school, group, or global' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(svc, auth.userId)
    if (!scope.classIds.includes(classId)) {
      res.status(403).json({ error: 'That class is outside your visible scope' })
      return
    }

    const entity = await loadClassMeta(svc, classId)
    if (!entity) {
      res.status(404).json({ error: 'Class not found' })
      return
    }

    const { ids: cohortIds, error: cohortError } = await cohortClassIds(svc, entity, compareTo)
    if (cohortError) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ insufficientData: true, cohortSize: 0, kFloor: K_FLOOR, reason: cohortError })
      return
    }

    // Fetch enough history for the 8-week trend (needs one extra baseline week)
    // as well as the requested window, whichever is larger.
    const fetchDays = Math.max(days, (TREND_WEEKS + 1) * 7)
    const { data: rawRows, error: rpcError } = await svc.rpc('analytics_class_sessions_scoped', {
      p_class_ids: [classId, ...cohortIds],
      p_days: fetchDays,
    })
    if (rpcError) {
      console.error('[rate-compare] analytics_class_sessions_scoped error:', rpcError.message)
      res.status(500).json({ error: 'Failed to load rate data' })
      return
    }
    const rows = (rawRows as ScopedSessionRow[]) || []
    const now = new Date()

    const entityWindow = windowPaceForClass(rows, classId, days, now)
    const entityTrend = weeklyTrendForClass(rows, classId, TREND_WEEKS, now)

    const cohortActive = cohortIds.filter((id) => rows.some((r) => r.class_id === id))
    if (cohortActive.length < K_FLOOR) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({
        insufficientData: true,
        cohortSize: cohortActive.length,
        kFloor: K_FLOOR,
        reason: 'Not enough data to compare fairly yet.',
      })
      return
    }

    const cohortWindows = cohortActive.map((id) => windowPaceForClass(rows, id, days, now))
    const cohortValues = cohortWindows.map((w) => w.pace)
    const cohortTrends = cohortActive.map((id) => weeklyTrendForClass(rows, id, TREND_WEEKS, now))
    const averageTrend = meanTrend(cohortTrends)
    const averageValue = cohortValues.length ? Math.round((cohortValues.reduce((a, b) => a + b, 0) / cohortValues.length) * 10) / 10 : 0

    const dist = distributionStats(cohortValues)
    const compareLabel = compareTo === 'school' ? 'School average' : compareTo === 'group' ? 'Group average' : 'Global average'

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      insufficientData: false,
      metricLabel: 'Rate of progress',
      unit: 'LEGOs',
      per: 'week',
      entity: {
        label: entity.class_name || 'Your class',
        value: entityWindow.pace,
        trend: entityTrend,
      },
      average: {
        label: compareLabel,
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
      cohortSize: cohortActive.length,
    })
  } catch (err) {
    console.error('[rate-compare] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
