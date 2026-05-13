/**
 * useBrainTimelapseData — data composable for the v2 brain view's *living
 * timelapse*. Loads everything the renderer needs to play back the learner's
 * brain growing from empty (t=0) to its current state.
 *
 * Composition:
 *   - course_legos               → node identity, text, type, belt, audio
 *   - course_lego_positions      → x/y for each node
 *   - learner_lego_metrics       → mastery_state + last_seen_at (introducedAt)
 *   - learner_lego_pairings      → fire_count + first_fired_at + last_fired_at
 *   - courses                    → display_name for the header
 *
 * Filter: only nodes with `introducedAt != null` make it in. No ghost
 * nodes — empty at t=0, dense at brown belt is the whole point.
 *
 * Events: one `node_introduced` per node, one `pairing_first_fired` per
 * pairing row. Sorted chronologically — the scrubber position is a
 * timestamp; the renderer plays back every event with `at <= position`.
 *
 * `pairing_strengthened` is reserved for a future iteration. v2 has no
 * per-fire timestamps, so re-firings show up as a higher `fire_count` on
 * the existing pairing row rather than as additional events; the renderer
 * derives synapse thickness from log(fire_count + 1) at the *current*
 * scrubber position (cumulative). Decay is deferred.
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

/** Belt index (0-7) from seed_number. Same algorithm as useBrainNetwork. */
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
  // Fallback by word count (mirrors v1 useBrainNetwork).
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

  async function fetchData(course: string, learner: string | null): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }

    // Guests / anonymous flows: there's nothing learner-scoped to load.
    // Return an empty timelapse rather than erroring — the screen can
    // render an "intro yourself first" empty state.
    if (!learner || learner.startsWith('guest-')) {
      data.value = {
        courseCode: course,
        languageName: course,
        nodes: [],
        pairings: [],
        events: [],
      }
      return
    }

    const myFetch = ++activeFetch
    isLoading.value = true
    error.value = null

    try {
      // ---- 1. metrics (introducedAt + mastery_state). This is the gate ----
      // No row here = node not introduced = doesn't appear. So load first
      // and use the result to scope every later query to only the LEGOs
      // we'll actually show.
      const { data: metricRows, error: metricErr } = await supabase
        .from('learner_lego_metrics')
        .select('lego_id, mastery_state, last_seen_at')
        .eq('learner_id', learner)
        .eq('course_code', course)

      if (metricErr) throw new Error(`learner_lego_metrics: ${metricErr.message}`)
      if (myFetch !== activeFetch) return

      const masteryByLegoId = new Map<string, { state: MasteryState; introducedAt: string }>()
      const introducedLegoIds: string[] = []
      for (const row of metricRows || []) {
        masteryByLegoId.set(row.lego_id, {
          state: normaliseMasteryState(row.mastery_state),
          introducedAt: row.last_seen_at,
        })
        introducedLegoIds.push(row.lego_id)
      }

      // ---- 2. course display name (cheap, fetch in parallel-shaped block) ----
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

      // Short-circuit: nothing introduced yet — empty timelapse.
      if (introducedLegoIds.length === 0) {
        data.value = {
          courseCode: course,
          languageName,
          nodes: [],
          pairings: [],
          events: [],
        }
        return
      }

      // ---- 3. LEGOs (only the introduced ones — scope by lego_id) ----
      // Supabase's .in() caps at ~1000 elements per call which is well
      // above any realistic per-learner introduced count (~400 at black
      // belt). One call is fine.
      const { data: legoRows, error: legoErr } = await supabase
        .from('course_legos')
        .select('lego_id, seed_number, lego_index, type, target_text, known_text, target1_audio_id, components')
        .eq('course_code', course)
        .in('lego_id', introducedLegoIds)

      if (legoErr) throw new Error(`course_legos: ${legoErr.message}`)
      if (myFetch !== activeFetch) return

      // ---- 4. positions (same scope) ----
      const { data: posRows, error: posErr } = await supabase
        .from('course_lego_positions')
        .select('lego_id, x, y')
        .eq('course_code', course)
        .in('lego_id', introducedLegoIds)
      if (posErr) {
        console.warn('[useBrainTimelapseData] course_lego_positions fetch failed:', posErr.message)
      }
      if (myFetch !== activeFetch) return

      const positionByLegoId = new Map<string, { x: number; y: number }>()
      for (const row of posRows || []) {
        positionByLegoId.set(row.lego_id, { x: row.x, y: row.y })
      }

      // ---- 5. pairings (forward-only co-firing rows) ----
      const { data: pairingRows, error: pairingErr } = await supabase
        .from('learner_lego_pairings')
        .select('lego_a, lego_b, fire_count, first_fired_at, last_fired_at')
        .eq('learner_id', learner)
        .eq('course_code', course)

      if (pairingErr) {
        console.warn('[useBrainTimelapseData] learner_lego_pairings fetch failed:', pairingErr.message)
      }
      if (myFetch !== activeFetch) return

      // ---- 6. assemble nodes ----
      // We iterate metrics so the order is stable (in metricRows order from
      // the DB), and skip any introduced lego_id that no longer has a row
      // in course_legos (deleted content, defensive).
      const legoRowById = new Map<string, any>()
      for (const row of legoRows || []) {
        legoRowById.set(row.lego_id, row)
      }

      const nodes: NetworkNode[] = []
      for (const legoId of introducedLegoIds) {
        const row = legoRowById.get(legoId)
        if (!row) continue
        const mastery = masteryByLegoId.get(legoId)!
        const seedNumber = row.seed_number as number
        const targetText = row.target_text || ''
        const pos = positionByLegoId.get(legoId) || { x: 0, y: 0 }
        nodes.push({
          legoId,
          type: classifyType(row.type, targetText),
          text: targetText,
          knownText: row.known_text || '',
          audioId: row.target1_audio_id || '',
          beltIndex: beltIndexForSeed(seedNumber),
          seedNumber,
          position: pos,
          isRevealed: true, // by definition — we filtered on introducedAt
          masteryState: mastery.state,
          introducedAt: mastery.introducedAt,
        })
      }

      // ---- 7. assemble pairings (scoped to introduced legos) ----
      // The pairings table can in theory contain rows for legos that don't
      // appear in our `nodes` set (e.g. content edits, partial restores).
      // Filter defensively so the renderer never gets dangling refs.
      const nodeIdSet = new Set(nodes.map((n) => n.legoId))
      const pairings: BrainPairing[] = []
      for (const row of pairingRows || []) {
        if (!nodeIdSet.has(row.lego_a) || !nodeIdSet.has(row.lego_b)) continue
        pairings.push({
          legoA: row.lego_a,
          legoB: row.lego_b,
          fireCount: row.fire_count,
          firstFiredAt: row.first_fired_at,
          lastFiredAt: row.last_fired_at,
        })
      }

      // ---- 8. build chronological event stream ----
      // node_introduced: one per node, at introducedAt.
      // pairing_first_fired: one per pairing, at firstFiredAt.
      // (pairing_strengthened reserved for future — no per-fire ts in v2.)
      const events: BrainTimelapseEvent[] = []
      for (const n of nodes) {
        if (!n.introducedAt) continue
        events.push({
          type: 'node_introduced',
          at: n.introducedAt,
          legoId: n.legoId,
        })
      }
      for (const p of pairings) {
        events.push({
          type: 'pairing_first_fired',
          at: p.firstFiredAt,
          pair: [p.legoA, p.legoB],
        })
      }
      events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

      if (myFetch !== activeFetch) return
      data.value = {
        courseCode: course,
        languageName,
        nodes,
        pairings,
        events,
      }
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
