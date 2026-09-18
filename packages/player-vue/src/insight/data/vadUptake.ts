// ============================================================================
// vadUptake — the class/school-level VAD & prosody read (data layer).
//
// THE QUESTION: "of the learners in this school/class, how many actually have
// mic-derived data at all — and what does it say about the ones who do?"
//
// WHY A DIRECT READ, NOT analytics_*: a deliberate policy migration excludes
// every demo learner from the analytics aggregate tables/views, so anything
// built on analytics_* filters this telemetry straight back out (that is why
// the Difficulty-turns board shows none of it). This module therefore reads
// learner_lego_metrics DIRECTLY, exactly the way
// composables/admin/useAdminUserDetail.ts does for one learner. The exclusion
// policy is almost certainly right and is untouched here.
//
// PROSODY IS THE ONE EXCEPTION, and not by choice: player_events is own-row
// under RLS for everyone including admins, so a browser read of another
// learner's cycle_prosody returns zero rows. It comes through the admin-gated
// GET /api/admin/vad-prosody instead — the server-mediated door the RLS
// doctrine calls for. See the ProsodyAgg comment.
//
// THE IDENTITY TRAP (CLAUDE.md): player_events.user_id is uuid but holds
// learners.id, NOT the auth uid. Everything below keys prosody on learners.id.
//
// UPTAKE IS THE INSIGHT, NOT MISSING DATA. Roughly half the demo learners carry
// no row whatsoever in the VAD-fed tables — not zeros, nothing. So every
// aggregate here carries its own denominator (`withData`), and the shaping
// functions never silently average over the smaller set while implying the
// larger one. A scope with zero VAD learners returns a summary with
// withData === 0 and null aggregates — never NaN, never 0-as-a-value.
//
// Pure shaping functions are exported separately from the fetch so they can be
// tested with literal rows (see vadUptake.test.ts).
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
// THE SUMMARY ITSELF LIVES IN @ssi/core (job #32): the server answers the
// teacher's and leader's Insights pages with aggregates only, so it must take
// the same summary over rows the browser never sees. Re-exported here so every
// caller of this module is unchanged — one analysis, two doors.
export {
  median,
  summariseVad,
  type MetricRow,
  type ProsodyAgg,
  type MasteryCounts,
  type ProsodySummary,
  type LearnerVadRow,
  type VadSummary,
} from '@ssi/core'
import { summariseVad, type MetricRow, type ProsodyAgg } from '@ssi/core'

// ---- wire row shapes -------------------------------------------------------

export interface SchoolRow { id: string; school_name: string | null }
export interface ClassRow { id: string; class_name: string | null; school_id: string; course_code: string | null }
/** user_tags row: tag_value is 'CLASS:<class uuid>'; user_id is learners.user_id (auth uid, TEXT). */
export interface ClassTagRow { user_id: string; tag_value: string }
export interface LearnerRow { id: string; user_id: string; display_name: string | null }

export type MasteryState = 'acquisition' | 'consolidating' | 'confident' | 'mastered'

export interface ClassScope {
  classId: string
  className: string
  courseCode: string | null
  learnerIds: string[]
}
export interface SchoolScope {
  schoolId: string
  schoolName: string
  classes: ClassScope[]
  learnerIds: string[]                  // union across classes, deduped
}

const CLASS_TAG_PREFIX = 'CLASS:'

/**
 * Build the school → class → learner tree from the four roster tables.
 *
 * Membership is the same join the demo generator uses: user_tags(tag_type
 * 'class', tag_value 'CLASS:<id>') → learners on user_id. A learner tagged into
 * two classes of the same school is counted once at school level and in both
 * classes — classes are a view onto the roster, not a partition.
 */
export function buildScopes(
  schools: SchoolRow[],
  classes: ClassRow[],
  tags: ClassTagRow[],
  learners: LearnerRow[],
): SchoolScope[] {
  const learnerByAuthId = new Map(learners.map(l => [l.user_id, l]))
  const classById = new Map(classes.map(c => [c.id, c]))
  const schoolById = new Map(schools.map(s => [s.id, s]))

  const membersByClass = new Map<string, Set<string>>()
  for (const t of tags) {
    if (!t.tag_value?.startsWith(CLASS_TAG_PREFIX)) continue
    const classId = t.tag_value.slice(CLASS_TAG_PREFIX.length)
    if (!classById.has(classId)) continue
    const learner = learnerByAuthId.get(t.user_id)
    if (!learner) continue
    let set = membersByClass.get(classId)
    if (!set) { set = new Set(); membersByClass.set(classId, set) }
    set.add(learner.id)
  }

  const bySchool = new Map<string, ClassScope[]>()
  for (const c of classes) {
    const members = membersByClass.get(c.id)
    if (!members || members.size === 0) continue        // empty classes carry no read
    const list = bySchool.get(c.school_id) ?? []
    list.push({
      classId: c.id,
      className: c.class_name ?? 'Unnamed class',
      courseCode: c.course_code ?? null,
      learnerIds: [...members],
    })
    bySchool.set(c.school_id, list)
  }

  const out: SchoolScope[] = []
  for (const [schoolId, classScopes] of bySchool) {
    const union = new Set<string>()
    for (const cs of classScopes) for (const id of cs.learnerIds) union.add(id)
    classScopes.sort((a, b) => a.className.localeCompare(b.className))
    out.push({
      schoolId,
      schoolName: schoolById.get(schoolId)?.school_name ?? 'Unnamed school',
      classes: classScopes,
      learnerIds: [...union],
    })
  }
  out.sort((a, b) => a.schoolName.localeCompare(b.schoolName))
  return out
}

// ---- the summary -----------------------------------------------------------

export function latencyBins(values: number[], binCount = 8): { id: string; x0: number; x1: number; count: number }[] {
  if (values.length === 0) return []
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (!(hi > lo)) return [{ id: 'b0', x0: lo, x1: lo, count: values.length }]
  const width = (hi - lo) / binCount
  const bins = Array.from({ length: binCount }, (_, i) => ({
    id: `b${i}`,
    x0: lo + i * width,
    x1: lo + (i + 1) * width,
    count: 0,
  }))
  for (const v of values) {
    const idx = Math.min(binCount - 1, Math.floor((v - lo) / width))
    bins[idx].count++
  }
  return bins
}

// ---- the fetch -------------------------------------------------------------

export interface VadRosterPayload {
  scopes: SchoolScope[]
  names: Map<string, string>
  metricsByLearner: Map<string, MetricRow[]>
  prosodyByLearner: Map<string, ProsodyAgg>
  /** false when GET /api/admin/vad-prosody failed — the panel says so instead of showing dashes. */
  prosodyAvailable: boolean
}

const CHUNK = 150

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/**
 * One roster load for the whole board: schools, classes, class membership,
 * learners, then the two VAD-fed tables keyed on learners.id. Admin-gated
 * surface (rows name learners), so it inherits /admin's existing guard — no new
 * gate invented here.
 */
export async function fetchVadRoster(client: SupabaseClient, authToken?: string | null): Promise<VadRosterPayload> {
  const [schoolsRes, classesRes, tagsRes] = await Promise.all([
    client.from('schools').select('id, school_name'),
    client.from('classes').select('id, class_name, school_id, course_code').eq('is_active', true),
    client.from('user_tags').select('user_id, tag_value').eq('tag_type', 'class').eq('role_in_context', 'student').is('removed_at', null),
  ])
  if (schoolsRes.error) throw schoolsRes.error
  if (classesRes.error) throw classesRes.error
  if (tagsRes.error) throw tagsRes.error

  const tags = (tagsRes.data ?? []) as ClassTagRow[]
  const authIds = [...new Set(tags.map(t => t.user_id).filter(Boolean))]

  const learners: LearnerRow[] = []
  for (const part of chunk(authIds, CHUNK)) {
    const { data, error } = await client
      .from('learners')
      .select('id, user_id, display_name')
      .eq('educational_role', 'student')
      .in('user_id', part)
    if (error) throw error
    learners.push(...((data ?? []) as LearnerRow[]))
  }

  const scopes = buildScopes(
    (schoolsRes.data ?? []) as SchoolRow[],
    (classesRes.data ?? []) as ClassRow[],
    tags,
    learners,
  )

  const names = new Map(learners.map(l => [l.id, l.display_name ?? 'Unnamed learner']))
  const learnerIds = learners.map(l => l.id)

  const metricsByLearner = new Map<string, MetricRow[]>()
  for (const part of chunk(learnerIds, CHUNK)) {
    const { data, error } = await client
      .from('learner_lego_metrics')
      .select('learner_id, lego_id, course_code, mastery_state, mean_latency_ms, n_samples, last_seen_at')
      .in('learner_id', part)
    if (error) throw error
    for (const row of (data ?? []) as MetricRow[]) {
      const list = metricsByLearner.get(row.learner_id) ?? []
      list.push(row)
      metricsByLearner.set(row.learner_id, list)
    }
  }

  // Prosody comes from the admin endpoint, not the browser: player_events is
  // own-row under RLS for admins too, so a client read returns nothing. A
  // failure here degrades the panel to a stated gap, never to silent dashes.
  const prosodyByLearner = new Map<string, ProsodyAgg>()
  let prosodyAvailable = false
  try {
    const res = await fetch('/api/admin/vad-prosody', {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    })
    if (res.ok) {
      const body = (await res.json()) as { byLearner?: Record<string, ProsodyAgg> }
      for (const [learnerId, agg] of Object.entries(body.byLearner ?? {})) {
        prosodyByLearner.set(learnerId, agg)
      }
      prosodyAvailable = true
    } else {
      console.warn('[vadUptake] prosody endpoint returned', res.status)
    }
  } catch (e) {
    console.warn('[vadUptake] prosody endpoint unreachable', e)
  }

  return { scopes, names, metricsByLearner, prosodyByLearner, prosodyAvailable }
}
