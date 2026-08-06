/**
 * GET /api/groups/:id/rate-compare — THE LENS: the Insight Engine scoped to
 * ONE NODE of the org tree (docs/THE-VIEW.md's analytics sibling).
 *
 *   ?course_code=<code>   optional — defaults to the subtree's busiest course
 *                          BY RECENT PRACTICE (founder rule 2026-07-20: never
 *                          by class count — that seeded "opens on a course
 *                          with no learners here"), preferring one whose
 *                          default compare cohort clears the k-floor
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
import { descendantIds } from '../../_utils/groupSubtree'
import {
  aggregateWindowPace,
  distributionStats,
  deltaPct,
  meanTrend,
  computeMeasureForClassIds,
  K_FLOOR,
  type ScopedSessionRow,
  type MeasureId,
} from '../../_utils/rateCompare'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const MAX_COHORT_IDS = 2000

// ─── Windows (docs/the-lens/windows-measures-REPORT.md contract; labels
// re-ruled 2026-07-19: ROLLING day-unit windows anchored to now — Today /
// Last 7 days / Last 30 days / All time. No calendar definitions ("this
// week" / "this term" were ambiguous). ───
interface WindowConfig {
  value: string
  label: string
  days: number       // headline period length; 'all' uses a practical-unbounded value
  periods: number     // trend series point count
  periodDays: number  // trend granularity in days (fractional = sub-day buckets)
  trendLabel: string  // honest chart caption
  perDay?: boolean    // per-week rate measures present in per-day form (a per-week rate over one day would lie)
}
const WINDOWS: WindowConfig[] = [
  { value: 'today', label: 'Today', days: 1, periods: 24, periodDays: 1 / 24, trendLabel: 'Hourly · last 24 hours', perDay: true },
  { value: '7d', label: 'Last 7 days', days: 7, periods: 7, periodDays: 1, trendLabel: 'Daily · last 7 days' },
  { value: '30d', label: 'Last 30 days', days: 30, periods: 30, periodDays: 1, trendLabel: 'Daily · last 30 days' },
  { value: 'all', label: 'All time', days: 3650, periods: 12, periodDays: 30, trendLabel: 'Monthly · last 12 months' },
]
const DEFAULT_WINDOW = '30d'
// Old chip values live in bookmarks/deep links — map them onto the nearest
// rolling window rather than 404ing to the default.
const WINDOW_ALIASES: Record<string, string> = { week: '7d', '4w': '30d', term: '30d' }
const WINDOW_OPTIONS = WINDOWS.map((w) => ({ value: w.value, label: w.label }))
// Legacy trend shape (unchanged) for callers that pass ?days= without ?window=.
const LEGACY_TREND_WEEKS = 8

// ─── Measures (same contract) ───
interface MeasureConfig {
  value: MeasureId
  label: string
  unit: string
  per: string
  desc: string
  classLevelExcluded?: boolean
}
const MEASURES: MeasureConfig[] = [
  { value: 'rate', label: 'Rate of progress', unit: 'LEGOs', per: 'week', desc: 'How fast new LEGOs are being learned, per week.' },
  { value: 'minutes_per_class', label: 'Practice minutes per class', unit: 'min', per: 'week', desc: 'How many minutes each class practises, per week on average.' },
  { value: 'hours_total', label: 'Practice hours', unit: 'hours', per: '', desc: 'Total hours of practice in the selected period.' },
  { value: 'active_classes', label: 'Active classes share', unit: '%', per: '', desc: 'The share of classes that practised at least once in the selected period.', classLevelExcluded: true },
]
const DEFAULT_MEASURE: MeasureId = 'rate'

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

interface SchoolRef { id: string; node_group_id: string | null; group_id: string | null }

/** Schools attached to a subtree (node bridge ∪ legacy parent attachment — the home.ts union). */
async function subtreeSchools(svc: SupabaseClient, subtreeGroupIds: string[]): Promise<SchoolRef[]> {
  const out: SchoolRef[] = []
  const seen = new Set<string>()
  const add = (rows: any[] | null) => {
    for (const s of rows ?? []) {
      const id = (s as any).id as string
      if (id && !seen.has(id)) {
        seen.add(id)
        out.push({ id, node_group_id: (s as any).node_group_id ?? null, group_id: (s as any).group_id ?? null })
      }
    }
  }
  await Promise.all(chunk(subtreeGroupIds).flatMap((batch) => [
    svc.from('schools').select('id, node_group_id, group_id').in('node_group_id', batch).then(({ data }) => add(data)),
    svc.from('schools').select('id, node_group_id, group_id').in('group_id', batch).then(({ data }) => add(data)),
  ]))
  return out
}

interface SubtreeClass { id: string; course_code: string | null; school_id: string | null; group_id: string | null }

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
      if (c.id && !seen.has(c.id)) {
        seen.add(c.id)
        out.push({ id: c.id, course_code: c.course_code ?? null, school_id: c.school_id ?? null, group_id: c.group_id ?? null })
      }
    }
  }
  const forBatch = (col: 'group_id' | 'school_id', batch: string[]) => {
    let q = svc.from('classes').select('id, course_code, school_id, group_id').in(col, batch).eq('is_active', true)
    if (courseCode) q = q.eq('course_code', courseCode)
    return q.limit(MAX_COHORT_IDS).then(({ data }) => add(data))
  }
  await Promise.all([
    ...chunk(subtreeGroupIds).map((batch) => forBatch('group_id', batch)),
    ...chunk(schoolIds).map((batch) => forBatch('school_id', batch)),
  ])
  return out
}

/**
 * Restrict a set of candidate peer school ids to the entity's OWN world —
 * demo peers for a demo entity, real peers for a real one, NEVER mixed
 * (insight-engine doctrine: analytics are real or absent; a demo org's cohort
 * IS the demo world — that's its real data — and a real org's average is never
 * diluted by seeded demo rows). The RPC's p_include_demo already zeroes the
 * wrong-world SESSIONS, but cohort MEMBERSHIP must match too: otherwise a
 * global / global_all_courses pool (which spans other subtrees and every
 * course) can seat a real school beside a demo entity, producing the nonsense
 * "demo 3.7 vs real 13.8" comparison the founder hit on the IME programme.
 */
async function schoolIdsInWorld(svc: SupabaseClient, schoolIds: string[], wantDemo: boolean): Promise<Set<string>> {
  const out = new Set<string>()
  if (schoolIds.length === 0) return out
  const { data } = await svc.from('schools').select('id, is_demo').in('id', schoolIds).limit(MAX_COHORT_IDS)
  for (const s of data ?? []) if (Boolean((s as any).is_demo) === wantDemo) out.add((s as any).id)
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

  const rawId = String(req.query.id || '')
  const requestedCourse = String(req.query.course_code || '').trim() || null
  const requestedCompare = String(req.query.compare_to || '').trim() || null

  // ─── Window: ?window= wins (old chip values alias forward); ?days= alone
  // is the legacy path (still honoured, byte-identical trend shape); neither
  // present -> default '30d'. window is never inferred from days. ───
  const requestedWindowRaw = String(req.query.window || '').trim()
  const requestedWindow = WINDOW_ALIASES[requestedWindowRaw] ?? requestedWindowRaw
  const requestedDaysRaw = req.query.days !== undefined ? String(req.query.days) : null
  let windowConfig: WindowConfig
  let appliedWindowValue: string | null
  if (requestedWindow && WINDOWS.some((w) => w.value === requestedWindow)) {
    windowConfig = WINDOWS.find((w) => w.value === requestedWindow)!
    appliedWindowValue = windowConfig.value
  } else if (requestedDaysRaw !== null) {
    const legacyDays = Math.min(180, Math.max(7, parseInt(requestedDaysRaw, 10) || 90))
    windowConfig = {
      value: 'custom', label: `Last ${legacyDays} days`, days: legacyDays,
      periods: LEGACY_TREND_WEEKS, periodDays: 7, trendLabel: `Weekly · last ${LEGACY_TREND_WEEKS} weeks`,
    }
    appliedWindowValue = null
  } else {
    windowConfig = WINDOWS.find((w) => w.value === DEFAULT_WINDOW)!
    appliedWindowValue = DEFAULT_WINDOW
  }
  const days = windowConfig.days
  // Ceil: periodDays can be fractional (hourly buckets) and the RPC takes whole days.
  const fetchDays = Math.ceil(Math.max(days, (windowConfig.periods + 1) * windowConfig.periodDays))
  const now = new Date()

  try {
    // ─── One opening wave: auth + every :id interpretation + the forest map.
    // (The serial version paid one Atlantic round trip per await; the only
    // true dependency below is subtree→sessions.) ───
    const [adminResult, { data: asGroup }, { data: asSchool }, { data: asClass }, { data: allGroupsData }] = await Promise.all([
      verifyAdmin(req),
      svc.from('groups').select('id').eq('id', rawId).maybeSingle(),
      svc.from('schools').select('id, school_name, group_id, node_group_id, is_demo, is_test').eq('id', rawId).maybeSingle(),
      svc.from('classes').select('id, class_name, course_code, school_id, group_id').eq('id', rawId).maybeSingle(),
      svc.from('groups').select('id, name, type, parent_id, path, is_demo'),
    ])

    // ─── Auth: admin door first, then the visible-scope door. verifyAdmin's
    // 403 carries the verified uid, so no second token verification. ───
    let isAdmin = false
    let authUid: string | null = null
    if (!('error' in adminResult)) {
      isAdmin = true
      authUid = adminResult.userId
    } else if (adminResult.userId) {
      authUid = adminResult.userId
    } else {
      const authResult = await verifyAuthToken(req)
      if (!authResult.valid || !authResult.userId) {
        res.status(401).json({ error: authResult.error || 'Unauthorized' })
        return
      }
      authUid = authResult.userId
    }

    // ─── Resolve :id → node / class (same precedence as home.ts). ───
    let nodeId: string | null = null
    let classRow: { id: string; class_name: string; course_code: string | null; school_id: string | null; group_id: string | null } | null = null

    if (asGroup) {
      nodeId = rawId
    } else if (asSchool) {
      nodeId = (asSchool as any).node_group_id
        || (await ensureSchoolNode(svc, asSchool as any, { is_demo: (asSchool as any).is_demo, is_test: (asSchool as any).is_test }))
    } else if (asClass) {
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
    if (!nodeId && !classRow) {
      res.status(404).json({ error: 'Not found' })
      return
    }

    const allGroups = (allGroupsData ?? []) as GroupRow[]
    const groupPathById = new Map(allGroups.map((g) => [g.id, g.path]))

    // ─── Authz (non-admin): class membership / own school / governed subtree. ───
    if (!isAdmin) {
      const [scope, ownSchool] = await Promise.all([
        resolveVisibleScope(svc, authUid!),
        classRow ? Promise.resolve(null) : ownSchoolIdForNode(svc, nodeId!),
      ])
      let authorized = false
      if (classRow) {
        authorized = scope.classIds.includes(classRow.id)
      } else if (nodeId) {
        if (ownSchool && scope.schoolIds.includes(ownSchool)) authorized = true
        else if (scope.groupId) {
          if (scope.groupId === nodeId) authorized = true
          else {
            // Strict-descendant check from the forest already in hand; the
            // helper query only when a path is missing.
            const ownPath = groupPathById.get(scope.groupId)
            const nodePath = groupPathById.get(nodeId)
            authorized = ownPath && nodePath
              ? nodePath === ownPath || nodePath.startsWith(ownPath + '/')
              : await isStrictDescendantGroup(svc, scope.groupId, nodeId)
          }
        }
      }
      if (!authorized) {
        res.status(403).json({ error: 'That entity is outside your visible scope' })
        return
      }
      // Coverage gate (non-admin callers only — admins may inspect expired schools).
      const gateSchoolId = classRow?.school_id ?? ownSchool
      if (await isEntityCoverageExpired(svc, gateSchoolId)) {
        res.status(403).json({ error: 'coverage_expired', message: 'This school’s platform coverage has expired.' })
        return
      }
    }
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
    // `let`, not `const`: a root node whose default this-course global cohort
    // is empty auto-widens to all-courses below (never a blank landing).
    let compareTo = requestedCompare && compareOptions.some((o) => o.value === requestedCompare)
      ? requestedCompare
      : compareOptions[0].value

    // ─── Entity subtree + cohort scope: ONE schools wave + ONE classes wave
    // over the WIDEST scope needed (an ancestor's subtree contains the
    // entity's), then split entity vs peers in memory — instead of fetching
    // the entity's subtree and the compare scope's subtree separately. ───
    const entitySubtreeGroupIds = classRow
      ? []
      : descendantIds(allGroups, nodeId!)
    const entityGroupIdSet = new Set(entitySubtreeGroupIds)
    const isGlobalCompare = compareTo === 'global' || compareTo === 'global_all_courses'
    const compareAnc = isGlobalCompare ? undefined : byId.get(compareTo)
    const scopeGroupIds = compareAnc
      ? descendantIds(allGroups, compareAnc.id)
      : entitySubtreeGroupIds

    const scopeSchools = await subtreeSchools(svc, scopeGroupIds)
    const entitySchoolIds = new Set(scopeSchools
      .filter((s) => (s.node_group_id && entityGroupIdSet.has(s.node_group_id)) || (s.group_id && entityGroupIdSet.has(s.group_id)))
      .map((s) => s.id))
    const scopeClasses = await subtreeClasses(svc, scopeGroupIds, scopeSchools.map((s) => s.id), null)
    const entityAllClasses = classRow
      ? [{ id: classRow.id, course_code: classRow.course_code, school_id: classRow.school_id, group_id: classRow.group_id }]
      : scopeClasses.filter((c) =>
          (c.group_id && entityGroupIdSet.has(c.group_id)) || (c.school_id && entitySchoolIds.has(c.school_id)))

    const courseCounts = new Map<string, number>()
    for (const c of entityAllClasses) {
      if (c.course_code) courseCounts.set(c.course_code, (courseCounts.get(c.course_code) || 0) + 1)
    }

    // ─── Course census: THE NODE'S OWN practice per course (founder rule
    // 2026-07-20 — one rule at every node, every mount). The default course is
    // the busiest by RECENT ACTIVITY (tie: alphabetical), never by class count
    // — class count is how a Telugu/Tamil region opened on "English for Hindi
    // speakers" with zero data. `recent` (last 30 days, window-independent so
    // switching windows never re-defaults) ranks; `ever` (last year — an
    // insights lens, not an archive) marks dropdown courses with no practice
    // at this node so a human picking manually can't fall in the same hole. ───
    const entityIsDemo = Boolean(nodeRow?.is_demo)
    const CENSUS_RANK_DAYS = 30
    const CENSUS_EVER_DAYS = 365
    const censusIds = entityAllClasses.map((c) => c.id).slice(0, MAX_COHORT_IDS)
    let censusRows: ScopedSessionRow[] = []
    if (censusIds.length > 0) {
      const { data: censusData, error: censusError } = await svc.rpc('analytics_class_sessions_scoped', {
        p_class_ids: censusIds,
        p_days: CENSUS_EVER_DAYS,
        p_include_demo: entityIsDemo,
      })
      if (censusError) console.error('[node-rate-compare] course census error:', censusError.message)
      censusRows = (censusData as ScopedSessionRow[]) || []
    }
    // Privacy floor: K_FLOOR protects REAL peers from inference. A DEMO
    // entity's cohort is demo-only by construction (schoolIdsInWorld), i.e.
    // seeded fictional schools — the floor would blank every demo leader
    // surface (a demo world has ~3-4 peer schools) while protecting nothing,
    // the same rationale as the admin floor of 1.
    const effectiveFloor = isAdmin || entityIsDemo ? 1 : K_FLOOR
    const courseByClass = new Map(entityAllClasses.map((c) => [c.id, c.course_code]))
    const rankCutoffMs = now.getTime() - CENSUS_RANK_DAYS * 86_400_000
    const courseActivity = new Map<string, { recent: number; ever: number }>()
    for (const r of censusRows) {
      const code = courseByClass.get(r.class_id)
      if (!code) continue
      const a = courseActivity.get(code) ?? { recent: 0, ever: 0 }
      a.ever += 1
      if (new Date(r.started_at).getTime() >= rankCutoffMs) a.recent += 1
      courseActivity.set(code, a)
    }
    const rankedCourses = [...courseCounts.entries()].map(([code, classCount]) => {
      const a = courseActivity.get(code)
      return { code, classCount, hasData: (a?.ever ?? 0) > 0, recent: a?.recent ?? 0, ever: a?.ever ?? 0 }
    }).sort((x, y) =>
      Number(y.hasData) - Number(x.hasData)
      || y.recent - x.recent
      || y.ever - x.ever
      || x.code.localeCompare(y.code))
    const courseOptions = rankedCourses.map(({ code, classCount, hasData }) => ({ code, classCount, hasData }))
    let courseCode = requestedCourse && courseCounts.has(requestedCourse)
      ? requestedCourse
      : (courseOptions[0]?.code ?? null)

    const nodeMeta = classRow
      ? { id: classRow.id, name: classRow.class_name, label: 'class', kind: 'class' as const }
      : { id: nodeId!, name: nodeRow!.name, label: nodeRow!.type, kind: 'node' as const }

    // ─── Measure: options omit active_classes at class level (degenerate
    // 0/100 — a class either ran or didn't). An unavailable/unknown request
    // falls back to the default rather than erroring. ───
    const availableMeasures = MEASURES.filter((m) => !(nodeMeta.kind === 'class' && m.classLevelExcluded))
    const requestedMeasure = String(req.query.measure || '').trim()
    const measureConfig = availableMeasures.find((m) => m.value === requestedMeasure)
      ?? availableMeasures.find((m) => m.value === DEFAULT_MEASURE)!

    const baseBody = {
      node: nodeMeta,
      options: {
        courses: courseOptions,
        compares: compareOptions,
        windows: WINDOW_OPTIONS,
        measures: availableMeasures.map((m) => ({ value: m.value, label: m.label, desc: m.desc })),
      },
      applied: { course_code: courseCode, compare_to: compareTo, days, window: appliedWindowValue, measure: measureConfig.value },
      windowLabel: windowConfig.label,
      trendLabel: windowConfig.trendLabel,
      trendPeriodDays: windowConfig.periodDays,
      kFloor: effectiveFloor,
    }
    const insufficient = (reason: string, cohortSize = 0): void => {
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ ...baseBody, insufficientData: true, cohortSize, reason })
    }

    if (!courseCode) {
      insufficient(classRow ? 'This class has no course set yet.' : 'No classes below this yet.')
      return
    }

    // ─── Genuinely dark node: classes exist but NO course below has any
    // practice — say WHY, never the generic compare message. (Any course pick
    // would land equally empty; the dropdown already marks every option.) ───
    if (rankedCourses.length > 0 && rankedCourses.every((c) => !c.hasData)) {
      insufficient(classRow ? 'No practice recorded in this class yet.' : 'No practice recorded below this level yet.')
      return
    }

    // ─── K-floor preference (the school fix, generalised up the tree): when
    // DEFAULTING the course at a node whose compare scope is an ancestor,
    // prefer the highest-ranked active course whose peer cohort actually
    // clears the floor — never land on an honest-but-empty screen when a
    // comparable course exists one slot down. One scope-wide RPC; its rows
    // are reused for the final comparison (no extra round trip on the
    // ancestor path). Root nodes keep the global auto-widen fallback below. ───
    let scopeRows: ScopedSessionRow[] | null = null
    const activeCourses = rankedCourses.filter((c) => c.hasData)
    if (!(requestedCourse && courseCounts.has(requestedCourse)) && !classRow && compareAnc?.path) {
      const scopeIds = scopeClasses.map((c) => c.id).slice(0, MAX_COHORT_IDS)
      const { data: scopeData, error: scopeError } = await svc.rpc('analytics_class_sessions_scoped', {
        p_class_ids: scopeIds,
        p_days: fetchDays,
        p_include_demo: Boolean(nodeRow?.is_demo),
      })
      if (scopeError) {
        console.error('[node-rate-compare] scope census error:', scopeError.message)
      } else {
        scopeRows = (scopeData as ScopedSessionRow[]) || []
        const scopeSchoolIdSet = new Set(scopeSchools.map((s) => s.id))
        const activePeersFor = (code: string): number => {
          const bySchool = new Map<string, string[]>()
          for (const c of scopeClasses) {
            if (!c.school_id || !scopeSchoolIdSet.has(c.school_id) || entitySchoolIds.has(c.school_id)) continue
            if (c.course_code !== code) continue
            const arr = bySchool.get(c.school_id) ?? []
            arr.push(c.id)
            bySchool.set(c.school_id, arr)
          }
          let n = 0
          for (const ids of bySchool.values()) if (aggregateWindowPace(scopeRows!, ids, days, now).hasData) n++
          return n
        }
        const preferred = activeCourses.find((c) => activePeersFor(c.code) >= effectiveFloor)
        if (preferred && preferred.code !== courseCode) {
          courseCode = preferred.code
          baseBody.applied.course_code = preferred.code
        }
      }
    }

    const entityClassIds = entityAllClasses.filter((c) => c.course_code === courseCode).map((c) => c.id)
    if (entityClassIds.length === 0) {
      insufficient('No classes running this course yet.')
      return
    }

    // ─── Cohort: peers-like-me within the chosen scope. ───
    // A DEMO node reads its own demo sessions (demo orgs are self-contained
    // subtrees, so its ancestor cohorts are demo peers); a real node keeps the
    // RPC's demo exclusion. The same flag decides the cohort's WORLD below —
    // demo entities draw demo peers, real entities draw real peers, never
    // mixed (schoolIdsInWorld). entityIsDemo is set above, at the course census.
    let cohortCourse = compareTo === 'global_all_courses' ? null : courseCode

    // Peer resolution reads the current compareTo/cohortCourse, so it can be
    // re-run by the compare ladder below (which may move an ANCESTOR default
    // onto a global rung — hence compareTo is re-read here, never the
    // request-time isGlobalCompare). Returns an error string only for the
    // unresolvable-ancestor case (globals never error here).
    const resolveMembers = async (): Promise<{ members: { id: string; classIds: string[] }[]; error?: string }> => {
      if (compareTo === 'global' || compareTo === 'global_all_courses') {
        if (classRow) {
          let q = svc.from('classes').select('id, school_id').eq('is_active', true).neq('id', classRow.id)
          if (cohortCourse) q = q.eq('course_code', cohortCourse)
          const { data } = await q.limit(MAX_COHORT_IDS)
          const rows = (data ?? []) as { id: string; school_id: string | null }[]
          // Same world only: a school-less (ACT) class is real; a demo class
          // never seats a real peer, and vice-versa.
          const world = await schoolIdsInWorld(
            svc, [...new Set(rows.map((r) => r.school_id).filter(Boolean))] as string[], entityIsDemo)
          return {
            members: rows
              .filter((r) => (r.school_id ? world.has(r.school_id) : !entityIsDemo))
              .map((r) => ({ id: r.id, classIds: [r.id] })),
          }
        }
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
        const world = await schoolIdsInWorld(svc, [...bySchool.keys()], entityIsDemo)
        return { members: [...bySchool.entries()].filter(([id]) => world.has(id)).map(([id, classIds]) => ({ id, classIds })) }
      }
      // an ancestor group id — its subtree is exactly the scope already fetched
      if (!compareAnc || !compareAnc.path) {
        return { members: [], error: 'That comparison scope has no resolvable data yet.' }
      }
      if (classRow) {
        return {
          members: scopeClasses
            .filter((c) => c.id !== classRow!.id && (!cohortCourse || c.course_code === cohortCourse))
            .map((c) => ({ id: c.id, classIds: [c.id] })),
        }
      }
      // Peer schools only: classes attached directly to groups with no school
      // stay out of the cohort (counted in entity values only — header note).
      const scopeSchoolIdSet = new Set(scopeSchools.map((s) => s.id))
      const bySchool = new Map<string, string[]>()
      for (const c of scopeClasses) {
        if (!c.school_id || !scopeSchoolIdSet.has(c.school_id) || entitySchoolIds.has(c.school_id)) continue
        if (cohortCourse && c.course_code !== cohortCourse) continue
        const arr = bySchool.get(c.school_id) ?? []
        arr.push(c.id)
        bySchool.set(c.school_id, arr)
      }
      return { members: [...bySchool.entries()].map(([id, classIds]) => ({ id, classIds })) }
    }

    // ─── Sessions + math (shared primitives). Gating (K_FLOOR / "does this
    // peer have any data") is always decided by RATE activity — the same
    // cohort, regardless of which measure is displayed. `preRows`: the k-floor
    // preference pass already fetched the whole ancestor scope's rows (a
    // superset of entity + members) — reuse them instead of re-fetching. ───
    const loadActive = async (
      members: { id: string; classIds: string[] }[],
      preRows: ScopedSessionRow[] | null = null,
    ): Promise<{ rows: ScopedSessionRow[]; active: { member: { id: string; classIds: string[] }; rateWindow: ReturnType<typeof aggregateWindowPace> }[] } | { rpcError: string }> => {
      let rows: ScopedSessionRow[]
      if (preRows) {
        rows = preRows
      } else {
        const allClassIds = [...new Set([...entityClassIds, ...members.flatMap((m) => m.classIds)])].slice(0, MAX_COHORT_IDS)
        const { data: rawRows, error } = await svc.rpc('analytics_class_sessions_scoped', {
          p_class_ids: allClassIds,
          p_days: fetchDays,
          p_include_demo: entityIsDemo,
        })
        if (error) return { rpcError: error.message }
        rows = (rawRows as ScopedSessionRow[]) || []
      }
      const active = members
        .map((m) => ({ member: m, rateWindow: aggregateWindowPace(rows, m.classIds, days, now) }))
        .filter((x) => x.rateWindow.hasData)
      return { rows, active }
    }

    const firstMembers = await resolveMembers()
    if (firstMembers.error) {
      insufficient(firstMembers.error)
      return
    }
    let loaded = await loadActive(firstMembers.members, isGlobalCompare ? null : scopeRows)
    if ('rpcError' in loaded) {
      console.error('[node-rate-compare] analytics_class_sessions_scoped error:', loaded.rpcError)
      res.status(500).json({ error: 'Failed to load rate data' })
      return
    }

    // ─── Compare LADDER on the untouched DEFAULT (generalises the old
    // root-only all-courses fallback, 2026-07-20): when the default
    // comparison's cohort misses the floor, widen — global · this course,
    // then global · all courses — so a node whose peers simply don't share
    // its courses (Metro International under a programme of eng_for_* schools)
    // still opens on a real comparison. Intermediate ancestors are skipped
    // deliberately: any ancestor's this-course cohort is a subset of the
    // global this-course cohort, so if global fails they all fail. Only on
    // the DEFAULT — an explicit empty pick keeps its named empty-state
    // (below), and every narrower option stays selectable. On total failure
    // the last rung's state stands (honest all-courses reason). ───
    if (!requestedCompare) {
      for (const rung of ['global', 'global_all_courses'] as const) {
        if (loaded.active.length >= effectiveFloor) break
        if (compareTo === rung) continue // already tried as the default
        compareTo = rung
        cohortCourse = rung === 'global_all_courses' ? null : courseCode
        baseBody.applied.compare_to = rung
        const wm = await resolveMembers()
        const wl = await loadActive(wm.members)
        if ('rpcError' in wl) {
          console.error('[node-rate-compare] analytics_class_sessions_scoped error:', wl.rpcError)
          res.status(500).json({ error: 'Failed to load rate data' })
          return
        }
        loaded = wl
      }
    }

    const rows = loaded.rows
    const active = loaded.active
    const entityRateWindow = aggregateWindowPace(rows, entityClassIds, days, now)
    if (active.length < effectiveFloor) {
      // Name the actual gate rather than a vague "not enough data" (founder ask
      // 2026-07-20): which peer unit, how many are needed, over what window. On
      // a widened root this still fires only when all-courses is ALSO empty.
      const unit = classRow ? 'classes' : 'schools'
      const worldNote = entityIsDemo ? 'demo ' : ''
      const scopeNote = cohortCourse ? 'on this course ' : ''
      const reason = active.length === 0
        ? `No other ${worldNote}${unit} ${scopeNote}have practised in the selected period (${windowConfig.label}) — a fair comparison needs at least ${effectiveFloor}.`
        : `Only ${active.length} other ${worldNote}${unit} ${scopeNote}${active.length === 1 ? 'has' : 'have'} practised in the selected period (${windowConfig.label}) — a fair comparison needs at least ${effectiveFloor}.`
      insufficient(reason, active.length)
      return
    }

    // ─── The displayed measure — entity + each active cohort member, via
    // the SAME dispatch function so every measure follows one grammar. ───
    const entityMeasureRaw = computeMeasureForClassIds(
      measureConfig.value, rows, entityClassIds, days, windowConfig.periods, windowConfig.periodDays, now)
    const memberMeasuresRaw = active.map((x) =>
      computeMeasureForClassIds(measureConfig.value, rows, x.member.classIds, days, windowConfig.periods, windowConfig.periodDays, now))

    // Under 'Today' a per-week rate would be a 7x extrapolation of one day —
    // present per-week measures in their natural per-day form instead (the
    // headline AND every cohort value scale together; delta/percentile are
    // scale-invariant). Trend points stay raw per-bucket — trendLabel names
    // the bucket, same as the daily-bucket windows under a per-week headline.
    const perDay = Boolean(windowConfig.perDay) && measureConfig.per === 'week'
    const scaleValue = (v: number): number => (perDay ? Math.round((v / 7) * 10) / 10 : v)
    const measurePer = perDay ? 'day' : measureConfig.per
    const entityMeasure = { value: scaleValue(entityMeasureRaw.value), trend: entityMeasureRaw.trend }
    const memberMeasures = memberMeasuresRaw.map((m) => ({ value: scaleValue(m.value), trend: m.trend }))

    const cohortValues = memberMeasures.map((m) => m.value)
    const averageTrend = meanTrend(memberMeasures.map((m) => m.trend))
    const averageValue = Math.round((cohortValues.reduce((a, b) => a + b, 0) / cohortValues.length) * 10) / 10
    const dist = distributionStats(cohortValues)
    const compareLabel = compareOptions.find((o) => o.value === compareTo)?.label ?? 'Average'

    // ─── Voice: the card speaks AS this node (founder ruling 2026-07-19) —
    // never "You" (the entity here is never the viewer's own learner identity). ───
    const levelNoun = nodeMeta.kind === 'class' ? 'class' : (nodeMeta.label || 'group')
    const cohortUnit = classRow ? 'classes' : 'schools'
    // compareTo may have moved onto a global rung via the ladder — label from
    // its FINAL value, not the request-time isGlobalCompare.
    const cohortLabel = compareTo === 'global' || compareTo === 'global_all_courses'
      ? (compareTo === 'global_all_courses' ? `all ${cohortUnit} · all courses` : `all ${cohortUnit} on this course`)
      : `${cohortUnit} in ${compareAnc?.name ?? 'this scope'}`

    // ─── Position context: the furthest LEGO's own CONTENT (position-is-LEGO
    // ruling — render what the LEGO says, never raw S/L ids; no content
    // resolved → no line at all). Rides ONLY on the rate measure. ───
    let contextLine: string | undefined
    if (measureConfig.value === 'rate' && entityRateWindow.furthestLegoId) {
      const { data: lego } = await svc
        .from('course_legos')
        .select('target_text, target_text_roman, known_text')
        .eq('course_code', courseCode)
        .eq('lego_id', entityRateWindow.furthestLegoId)
        .maybeSingle()
      const target = (lego as any)?.target_text_roman || (lego as any)?.target_text
      const known = (lego as any)?.known_text
      if (target && known) contextLine = `Furthest LEGO · "${target}" — "${known}"`
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({
      ...baseBody,
      insufficientData: false,
      metricLabel: measureConfig.label,
      unit: measureConfig.unit,
      per: measurePer,
      entity: { label: nodeMeta.name, value: entityMeasure.value, trend: entityMeasure.trend },
      average: { label: compareLabel, value: averageValue, trend: averageTrend },
      deltaPct: deltaPct(entityMeasure.value, averageValue),
      percentile: dist.percentileOf(entityMeasure.value),
      contextLine,
      subject: nodeMeta.name,
      subjectIsViewer: false,
      levelNoun,
      cohortLabel,
      distribution: {
        values: dist.values,
        min: dist.min,
        q1: dist.q1,
        median: dist.median,
        q3: dist.q3,
        max: dist.max,
        entityValue: entityMeasure.value,
        averageValue,
        percentile: dist.percentileOf(entityMeasure.value),
      },
      cohortSize: active.length,
    })
  } catch (error) {
    console.error('[node-rate-compare] error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
