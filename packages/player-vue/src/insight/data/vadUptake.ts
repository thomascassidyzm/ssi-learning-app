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
// learner_lego_metrics and player_events DIRECTLY, exactly the way
// composables/admin/useAdminUserDetail.ts does for one learner. The exclusion
// policy is almost certainly right and is untouched here.
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

// ---- wire row shapes -------------------------------------------------------

export interface SchoolRow { id: string; school_name: string | null }
export interface ClassRow { id: string; class_name: string | null; school_id: string; course_code: string | null }
/** user_tags row: tag_value is 'CLASS:<class uuid>'; user_id is learners.user_id (auth uid, TEXT). */
export interface ClassTagRow { user_id: string; tag_value: string }
export interface LearnerRow { id: string; user_id: string; display_name: string | null }

export type MasteryState = 'acquisition' | 'consolidating' | 'confident' | 'mastered'

export interface MetricRow {
  learner_id: string
  lego_id: string
  course_code: string | null
  mastery_state: MasteryState
  /**
   * MISNAMED COLUMN, kept honest here: the value is NORMALISED latency —
   * milliseconds per character of the target phrase (@ssi/core MetricsTracker
   * normalizeLatency), not raw milliseconds. Live values run ~0.6–183.
   * Everything user-facing must say "ms per character".
   */
  mean_latency_ms: number | null
  n_samples: number | null
  last_seen_at: string | null
}

/**
 * A cycle_prosody event, projected to scalars. The board deliberately does NOT
 * pull payload.envelope.contour (128 points per row) — only the derived scalars
 * the panel actually claims something about.
 */
export interface ProsodyRow {
  user_id: string                       // = learners.id (see identity trap above)
  peakEnergyDb: number | null
  averageEnergyDb: number | null
  startedDuringPrompt: boolean | null
  stillSpeakingAtVoice1: boolean | null
  peakCount: number | null
}

// ---- scope tree ------------------------------------------------------------

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

export interface MasteryCounts {
  acquisition: number
  consolidating: number
  confident: number
  mastered: number
}

export interface ProsodySummary {
  events: number
  learners: number
  meanPeakEnergyDb: number | null
  meanAverageEnergyDb: number | null
  meanPeakCount: number | null
  startedDuringPromptRate: number | null   // 0..1, over events that carry the flag
  startedDuringPromptBase: number
  stillSpeakingRate: number | null         // 0..1, over events that carry the flag
  stillSpeakingBase: number
}

export interface LearnerVadRow {
  learnerId: string
  name: string
  legos: number
  mastered: number
  meanLatency: number | null               // ms per character
  prosodyEvents: number
  lastSeenAt: string | null
}

export interface VadSummary {
  /** Every learner on the roster for this scope — the honest denominator. */
  total: number
  /** Learners carrying at least one learner_lego_metrics row. */
  withData: number
  /** Learners carrying at least one cycle_prosody event. */
  withProsody: number
  /** withData / total, 0..1. null when total === 0. */
  uptake: number | null
  mastery: MasteryCounts
  /** learner_lego_metrics rows behind the mastery counts. */
  legoSeries: number
  /** Per-LEARNER mean normalised latency (ms/char), over learners with data. */
  learnerLatencies: number[]
  medianLatency: number | null
  prosody: ProsodySummary
  learners: LearnerVadRow[]
}

const EMPTY_MASTERY = (): MasteryCounts => ({ acquisition: 0, consolidating: 0, confident: 0, mastered: 0 })

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Summarise one scope. `learnerIds` is the FULL roster; the metric/prosody maps
 * hold only the learners who have data. The gap between them is the insight.
 */
export function summariseVad(
  learnerIds: string[],
  names: Map<string, string>,
  metricsByLearner: Map<string, MetricRow[]>,
  prosodyByLearner: Map<string, ProsodyRow[]>,
): VadSummary {
  const mastery = EMPTY_MASTERY()
  const learnerLatencies: number[] = []
  const rows: LearnerVadRow[] = []
  let legoSeries = 0
  let withData = 0
  let withProsody = 0

  const peakDb: number[] = []
  const avgDb: number[] = []
  const peaks: number[] = []
  let promptStarts = 0, promptBase = 0
  let overruns = 0, overrunBase = 0
  let prosodyEvents = 0

  for (const learnerId of learnerIds) {
    const metrics = metricsByLearner.get(learnerId) ?? []
    const prosody = prosodyByLearner.get(learnerId) ?? []
    if (metrics.length > 0) withData++
    if (prosody.length > 0) withProsody++
    if (metrics.length === 0 && prosody.length === 0) continue   // no rows at all — not a zero

    legoSeries += metrics.length
    for (const m of metrics) {
      if (m.mastery_state in mastery) mastery[m.mastery_state]++
    }

    const latencies = metrics.map(m => m.mean_latency_ms).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const learnerMean = mean(latencies)
    if (learnerMean !== null) learnerLatencies.push(learnerMean)

    for (const p of prosody) {
      prosodyEvents++
      if (typeof p.peakEnergyDb === 'number' && Number.isFinite(p.peakEnergyDb)) peakDb.push(p.peakEnergyDb)
      if (typeof p.averageEnergyDb === 'number' && Number.isFinite(p.averageEnergyDb)) avgDb.push(p.averageEnergyDb)
      if (typeof p.peakCount === 'number' && Number.isFinite(p.peakCount)) peaks.push(p.peakCount)
      if (typeof p.startedDuringPrompt === 'boolean') { promptBase++; if (p.startedDuringPrompt) promptStarts++ }
      if (typeof p.stillSpeakingAtVoice1 === 'boolean') { overrunBase++; if (p.stillSpeakingAtVoice1) overruns++ }
    }

    const lastSeen = metrics
      .map(m => m.last_seen_at)
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? null

    rows.push({
      learnerId,
      name: names.get(learnerId) ?? 'Unnamed learner',
      legos: metrics.length,
      mastered: metrics.filter(m => m.mastery_state === 'mastered').length,
      meanLatency: learnerMean,
      prosodyEvents: prosody.length,
      lastSeenAt: lastSeen,
    })
  }

  rows.sort((a, b) => b.legos - a.legos || a.name.localeCompare(b.name))

  return {
    total: learnerIds.length,
    withData,
    withProsody,
    uptake: learnerIds.length > 0 ? withData / learnerIds.length : null,
    mastery,
    legoSeries,
    learnerLatencies,
    medianLatency: median(learnerLatencies),
    prosody: {
      events: prosodyEvents,
      learners: withProsody,
      meanPeakEnergyDb: mean(peakDb),
      meanAverageEnergyDb: mean(avgDb),
      meanPeakCount: mean(peaks),
      startedDuringPromptRate: promptBase > 0 ? promptStarts / promptBase : null,
      startedDuringPromptBase: promptBase,
      stillSpeakingRate: overrunBase > 0 ? overruns / overrunBase : null,
      stillSpeakingBase: overrunBase,
    },
    learners: rows,
  }
}

/**
 * Bin the per-learner mean latencies for the Distribution widget. Fixed-width
 * bins over the observed range; returns [] when there is nothing to bin (the
 * board renders its own empty state rather than an empty chart).
 */
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
  prosodyByLearner: Map<string, ProsodyRow[]>
}

const CHUNK = 150

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Coerce PostgREST's JSON-arrow projections (which come back as strings). */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
function bool(v: unknown): boolean | null {
  if (v === true || v === 'true') return true
  if (v === false || v === 'false') return false
  return null
}

/**
 * One roster load for the whole board: schools, classes, class membership,
 * learners, then the two VAD-fed tables keyed on learners.id. Admin-gated
 * surface (rows name learners), so it inherits /admin's existing guard — no new
 * gate invented here.
 */
export async function fetchVadRoster(client: SupabaseClient): Promise<VadRosterPayload> {
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

  const prosodyByLearner = new Map<string, ProsodyRow[]>()
  for (const part of chunk(learnerIds, CHUNK)) {
    // Scalar projections only — the 128-point envelope contour stays on the server.
    const { data, error } = await client
      .from('player_events')
      .select('user_id, payload->>peakEnergyDb, payload->>averageEnergyDb, payload->>startedDuringPrompt, payload->>stillSpeakingAtVoice1, payload->envelope->>peakCount')
      .eq('event_type', 'cycle_prosody')
      .in('user_id', part)
    if (error) throw error
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const row: ProsodyRow = {
        user_id: String(raw.user_id),
        peakEnergyDb: num(raw.peakEnergyDb),
        averageEnergyDb: num(raw.averageEnergyDb),
        startedDuringPrompt: bool(raw.startedDuringPrompt),
        stillSpeakingAtVoice1: bool(raw.stillSpeakingAtVoice1),
        peakCount: num(raw.peakCount),
      }
      const list = prosodyByLearner.get(row.user_id) ?? []
      list.push(row)
      prosodyByLearner.set(row.user_id, list)
    }
  }

  return { scopes, names, metricsByLearner, prosodyByLearner }
}
