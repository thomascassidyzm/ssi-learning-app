/**
 * useBrainTimelapseData — data composable for the v2 brain view's *living
 * timelapse*. Loads everything the renderer needs to play back the learner's
 * brain growing from empty (t=0) to its current state.
 *
 * "Introduced" gate (the key design call):
 *
 *   course_enrollments.highest_completed_lego_id is the authoritative
 *   signal for *what the learner has met*. It's quietly maintained for
 *   every learner regardless of which telemetry pipelines are or aren't
 *   running, and it answers the question this composable needs: which
 *   words/phrases should appear in the brain?
 *
 *   learner_lego_metrics is the *adaptation engine's* mastery ladder
 *   (acquisition → consolidating → confident → mastered). It is event-
 *   driven and may be sparse or empty depending on how telemetry has
 *   been running. We treat it as optional refinement: if a row exists,
 *   it brightens the node beyond the default 'acquisition'; if not, the
 *   node still shows at base brightness.
 *
 * Composition:
 *   - course_enrollments         → introduced-up-to-seed gate + time window
 *   - course_legos               → node identity, text, type, belt, audio
 *   - course_lego_positions      → x/y for each node
 *   - learner_lego_metrics       → optional mastery_state refinement
 *   - learner_lego_pairings      → fire_count + first_fired_at + last_fired_at
 *   - courses                    → display_name for the header
 *
 * Events: one `node_introduced` per node, one `pairing_first_fired` per
 * pairing row. Sorted chronologically — the scrubber position is a
 * timestamp; the renderer plays back every event with `at <= position`.
 *
 * `pairing_strengthened` is reserved for a future iteration. v2 has no
 * per-fire timestamps, so re-firings show up as a higher `fire_count` on
 * the existing pairing row; the renderer derives synapse thickness from
 * log(fire_count + 1) at the current scrubber position. Decay deferred.
 *
 * Vocabulary rule (carried over from v1): never expose "lego/seed/round"
 * to the user. This composable returns the shared `BrainTimelapseData`
 * shape; UI work is downstream.
 */

import { ref, watch, inject, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BrainTimelapseData,
  BrainTimelapseEvent,
  BrainPairing,
  NetworkNode,
  MasteryState,
} from '../types/brainNetwork'
import { BELTS } from './useBeltProgress'

// ============================================================================
// HELPERS
// ============================================================================

/** Belt index (0-7) from seed_number. */
function beltIndexForSeed(seedNumber: number): number {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seedNumber >= BELTS[i].seedsRequired) return i
  }
  return 0
}

/** Map course_legos.type ('A' | 'M') to NetworkNode.type. */
function classifyType(legoType: unknown, targetText: string): 'atom' | 'molecule' {
  if (legoType === 'M') return 'molecule'
  if (legoType === 'A') return 'atom'
  const words = (targetText || '').trim().split(/\s+/).filter(Boolean)
  return words.length <= 1 ? 'atom' : 'molecule'
}

function normaliseMasteryState(raw: unknown): MasteryState {
  switch (raw) {
    case 'consolidating':
    case 'confident':
    case 'mastered':
      return raw
    default:
      return 'acquisition'
  }
}

/** Extract the seed number from a lego id like "S0300L02" → 300. */
function seedFromLegoId(legoId: string): number | null {
  const m = /^S(\d{4})L\d+$/.exec(legoId)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Linearly distribute synthesised introducedAt across the enrollment
 * window. Index `i` of `total` falls at `t0 + (i / (total - 1)) * (t1 - t0)`.
 * Returns ISO timestamp. Falls back to t1 if t0 is missing or the window
 * has zero width.
 */
function synthesizeIntroducedAt(i: number, total: number, t0: number, t1: number): string {
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0 || total <= 1) {
    return new Date(t1).toISOString()
  }
  const frac = i / (total - 1)
  return new Date(t0 + frac * (t1 - t0)).toISOString()
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export interface UseBrainTimelapseDataReturn {
  data: Ref<BrainTimelapseData | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
}

export function useBrainTimelapseData(
  courseCode: Ref<string | null>,
  learnerId: Ref<string | null>,
): UseBrainTimelapseDataReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const data = ref<BrainTimelapseData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Sentinel so we ignore the result of any superseded fetch.
  let activeFetch = 0

  function emptyResult(course: string, languageName: string): BrainTimelapseData {
    return { courseCode: course, languageName, nodes: [], pairings: [], events: [] }
  }

  async function fetchData(course: string, learner: string | null): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }

    // Guests / anonymous flows: nothing learner-scoped to load. Render an
    // empty timelapse — the screen shows an "introduce yourself first"
    // empty state.
    if (!learner || learner.startsWith('guest-')) {
      data.value = emptyResult(course, course)
      return
    }

    const myFetch = ++activeFetch
    isLoading.value = true
    error.value = null

    try {
      // ---- 1. enrollment gate ----
      // course_enrollments.highest_completed_lego_id is the authoritative
      // signal for what the learner has met. No enrollment → empty.
      const { data: enrollmentRow, error: enrollErr } = await supabase
        .from('course_enrollments')
        .select('highest_completed_lego_id, enrolled_at, last_practiced_at')
        .eq('learner_id', learner)
        .eq('course_id', course)
        .maybeSingle()

      if (enrollErr) throw new Error(`course_enrollments: ${enrollErr.message}`)
      if (myFetch !== activeFetch) return

      // ---- 2. course display name (in parallel with anything else heavy) ----
      const { data: courseRow, error: courseErr } = await supabase
        .from('courses')
        .select('display_name')
        .eq('course_code', course)
        .maybeSingle()
      if (courseErr) {
        console.warn('[useBrainTimelapseData] courses fetch failed:', courseErr.message)
      }
      if (myFetch !== activeFetch) return
      const languageName = courseRow?.display_name || course

      const highestLegoId = enrollmentRow?.highest_completed_lego_id as string | null
      const maxSeed = highestLegoId ? seedFromLegoId(highestLegoId) : null

      // No enrollment or no recorded progress → empty brain.
      if (!enrollmentRow || !highestLegoId || maxSeed === null) {
        data.value = emptyResult(course, languageName)
        return
      }

      const enrolledAt = enrollmentRow.enrolled_at
        ? Date.parse(enrollmentRow.enrolled_at)
        : Date.now()
      const lastPractisedAt = enrollmentRow.last_practiced_at
        ? Date.parse(enrollmentRow.last_practiced_at)
        : enrolledAt

      // ---- 3. fetch the introduced LEGOs, positions, optional metrics, pairings in parallel ----
      const [legoResult, posResult, metricsResult, pairingsResult] = await Promise.all([
        supabase
          .from('course_legos')
          .select('lego_id, seed_number, lego_index, type, target_text, known_text, target1_audio_id')
          .eq('course_code', course)
          .lte('seed_number', maxSeed)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true }),
        supabase
          .from('course_lego_positions')
          .select('lego_id, x, y')
          .eq('course_code', course),
        supabase
          .from('learner_lego_metrics')
          .select('lego_id, mastery_state, last_seen_at')
          .eq('learner_id', learner)
          .eq('course_code', course),
        supabase
          .from('learner_lego_pairings')
          .select('lego_a, lego_b, fire_count, first_fired_at, last_fired_at')
          .eq('learner_id', learner)
          .eq('course_code', course),
      ])

      if (legoResult.error) throw new Error(`course_legos: ${legoResult.error.message}`)
      if (myFetch !== activeFetch) return

      const legoRows = legoResult.data || []
      if (posResult.error) {
        console.warn('[useBrainTimelapseData] course_lego_positions fetch failed:', posResult.error.message)
      }
      if (metricsResult.error) {
        console.warn('[useBrainTimelapseData] learner_lego_metrics fetch failed:', metricsResult.error.message)
      }
      if (pairingsResult.error) {
        console.warn('[useBrainTimelapseData] learner_lego_pairings fetch failed:', pairingsResult.error.message)
      }

      // Position + metrics lookup tables.
      const positionByLegoId = new Map<string, { x: number; y: number }>()
      for (const row of posResult.data || []) {
        positionByLegoId.set(row.lego_id, { x: row.x, y: row.y })
      }
      const metricsByLegoId = new Map<string, { state: MasteryState; lastSeenAt: string | null }>()
      for (const row of metricsResult.data || []) {
        metricsByLegoId.set(row.lego_id, {
          state: normaliseMasteryState(row.mastery_state),
          lastSeenAt: row.last_seen_at || null,
        })
      }

      // ---- 4. assemble nodes ----
      // Every lego with seed_number ≤ maxSeed is "introduced". Mastery
      // comes from metrics if a row exists, defaults to 'acquisition'
      // otherwise. introducedAt comes from metrics.last_seen_at if
      // present, otherwise synthesised across the enrolment window so
      // the scrubber has a meaningful growth curve.
      const total = legoRows.length
      const nodes: NetworkNode[] = []
      for (let i = 0; i < total; i++) {
        const row = legoRows[i]
        const targetText = row.target_text || ''
        const seedNumber = row.seed_number as number
        const pos = positionByLegoId.get(row.lego_id) || { x: 0, y: 0 }
        const metric = metricsByLegoId.get(row.lego_id)
        const introducedAt =
          metric?.lastSeenAt ||
          synthesizeIntroducedAt(i, total, enrolledAt, lastPractisedAt)
        nodes.push({
          legoId: row.lego_id,
          type: classifyType(row.type, targetText),
          text: targetText,
          knownText: row.known_text || '',
          audioId: row.target1_audio_id || '',
          beltIndex: beltIndexForSeed(seedNumber),
          seedNumber,
          position: pos,
          isRevealed: true,
          masteryState: metric?.state || 'acquisition',
          introducedAt,
        })
      }

      // ---- 5. assemble pairings (scoped to introduced legos) ----
      const nodeIdSet = new Set(nodes.map((n) => n.legoId))
      const pairings: BrainPairing[] = []
      for (const row of pairingsResult.data || []) {
        if (!nodeIdSet.has(row.lego_a) || !nodeIdSet.has(row.lego_b)) continue
        pairings.push({
          legoA: row.lego_a,
          legoB: row.lego_b,
          fireCount: row.fire_count,
          firstFiredAt: row.first_fired_at,
          lastFiredAt: row.last_fired_at,
        })
      }

      // ---- 6. build chronological event stream ----
      const events: BrainTimelapseEvent[] = []
      for (const n of nodes) {
        if (!n.introducedAt) continue
        events.push({ type: 'node_introduced', at: n.introducedAt, legoId: n.legoId })
      }
      for (const p of pairings) {
        events.push({ type: 'pairing_first_fired', at: p.firstFiredAt, pair: [p.legoA, p.legoB] })
      }
      events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

      if (myFetch !== activeFetch) return
      data.value = { courseCode: course, languageName, nodes, pairings, events }
    } catch (err) {
      if (myFetch !== activeFetch) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useBrainTimelapseData] fetch failed:', msg)
      error.value = msg
    } finally {
      if (myFetch === activeFetch) {
        isLoading.value = false
      }
    }
  }

  watch(
    [courseCode, learnerId],
    ([course, learner]) => {
      if (!course) {
        data.value = null
        error.value = null
        isLoading.value = false
        return
      }
      void fetchData(course, learner)
    },
    { immediate: true },
  )

  return { data, isLoading, error }
}
