/**
 * useBrainNetwork — data composable for the "Your brain on Italian" view.
 *
 * Joins four tables into a single BrainViewData payload:
 *   - course_legos            → node identity, text, type, belt, audio
 *   - course_lego_positions   → (x, y) precomputed by precompute-lego-positions.cjs
 *   - learner_lego_metrics    → isRevealed (any row exists for this learner+lego)
 *   - courses                 → languageName (display_name)
 *
 * Edges are computed in-process via @ssi/core's `buildBrainNetwork`.
 *
 * Vocabulary rule (from the type contract): never expose "lego/seed/round" to
 * the user. This composable returns the shared `BrainViewData` shape exactly;
 * any UI work is downstream.
 */

import { ref, watch, inject, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildBrainNetwork,
  type NetworkLego,
  type NetworkPhrase,
} from '@ssi/core'
import type {
  BrainViewData,
  NetworkNode,
  NetworkEdge,
} from '../types/brainNetwork'
import { BELTS } from './useBeltProgress'

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Compute belt index (0-7) from seed_number using the BELTS thresholds from
 * useBeltProgress. Same algorithm as useBeltProgress.getBeltIndexForSeed.
 */
function beltIndexForSeed(seedNumber: number): number {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seedNumber >= BELTS[i].seedsRequired) return i
  }
  return 0
}

/** Type-guard / normaliser for course_legos.type: enum is 'A' | 'M'. */
function classifyType(legoType: unknown, targetText: string): 'atom' | 'molecule' {
  if (legoType === 'M') return 'molecule'
  if (legoType === 'A') return 'atom'
  // Fallback by word count (per brain-view type contract).
  const words = (targetText || '').trim().split(/\s+/).filter(Boolean)
  return words.length <= 1 ? 'atom' : 'molecule'
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useBrainNetwork(
  courseCode: Ref<string | null>,
  learnerId: Ref<string | null>,
) {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const data = ref<BrainViewData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Sentinel so we ignore the result of any superseded fetch (e.g. user
  // switches course mid-load).
  let activeFetch = 0

  async function fetchData(course: string, learner: string | null): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }

    const myFetch = ++activeFetch
    isLoading.value = true
    error.value = null

    try {
      // ---- 1. LEGOs ----
      const { data: legoRows, error: legoErr } = await supabase
        .from('course_legos')
        .select('lego_id, seed_number, lego_index, type, target_text, known_text, target1_audio_id, components')
        .eq('course_code', course)
        .not('lego_id', 'is', null)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })

      if (legoErr) throw new Error(`course_legos: ${legoErr.message}`)
      if (myFetch !== activeFetch) return // superseded
      if (!legoRows || legoRows.length === 0) {
        data.value = {
          courseCode: course,
          languageName: course,
          nodes: [],
          edges: [],
        }
        return
      }

      // ---- 2. positions ----
      const { data: posRows, error: posErr } = await supabase
        .from('course_lego_positions')
        .select('lego_id, x, y')
        .eq('course_code', course)

      if (posErr) throw new Error(`course_lego_positions: ${posErr.message}`)
      if (myFetch !== activeFetch) return

      const positionByLegoId = new Map<string, { x: number; y: number }>()
      for (const row of posRows || []) {
        positionByLegoId.set(row.lego_id, { x: row.x, y: row.y })
      }

      // ---- 3. revealed set + mastery state (learner-scoped) ----
      // v2 also reads mastery_state + last_seen_at for the 4-tier brightness
      // ladder and the introducedAt timestamp. The v1 brain view ignores both
      // but the shared NetworkNode contract now requires them.
      const revealedSet = new Set<string>()
      const masteryByLegoId = new Map<string, {
        state: 'acquisition' | 'consolidating' | 'confident' | 'mastered'
        lastSeenAt: string
      }>()
      if (learner && !learner.startsWith('guest-')) {
        const { data: metricRows, error: metricErr } = await supabase
          .from('learner_lego_metrics')
          .select('lego_id, mastery_state, last_seen_at')
          .eq('learner_id', learner)
          .eq('course_code', course)

        if (metricErr) {
          // Soft-fail: revealed defaults to false for everyone, but log it.
          console.warn('[useBrainNetwork] learner_lego_metrics fetch failed:', metricErr.message)
        } else if (myFetch !== activeFetch) {
          return
        } else {
          for (const row of metricRows || []) {
            revealedSet.add(row.lego_id)
            const state = (row.mastery_state || 'acquisition') as
              'acquisition' | 'consolidating' | 'confident' | 'mastered'
            masteryByLegoId.set(row.lego_id, {
              state,
              lastSeenAt: row.last_seen_at,
            })
          }
        }
      }

      // ---- 4. course display name ----
      const { data: courseRow, error: courseErr } = await supabase
        .from('courses')
        .select('display_name')
        .eq('course_code', course)
        .maybeSingle()

      if (courseErr) {
        console.warn('[useBrainNetwork] courses fetch failed:', courseErr.message)
      }
      if (myFetch !== activeFetch) return

      const languageName = courseRow?.display_name || course

      // ---- 5. practice phrases (for context edges) ----
      // We only need target_text. Pull in pages defensively in case the row
      // count is huge — Supabase default cap is 1000.
      const phrases: NetworkPhrase[] = []
      {
        let from = 0
        const pageSize = 1000
        while (true) {
          const { data: phraseRows, error: phraseErr } = await supabase
            .from('course_practice_phrases')
            .select('target_text')
            .eq('course_code', course)
            .range(from, from + pageSize - 1)
          if (phraseErr) {
            console.warn('[useBrainNetwork] course_practice_phrases fetch failed:', phraseErr.message)
            break
          }
          if (myFetch !== activeFetch) return
          if (!phraseRows || phraseRows.length === 0) break
          for (const row of phraseRows) {
            if (row.target_text) phrases.push({ targetText: row.target_text })
          }
          if (phraseRows.length < pageSize) break
          from += pageSize
        }
      }

      // ---- 6. assemble nodes ----
      const nodes: NetworkNode[] = legoRows.map((row: any) => {
        const seedNumber = row.seed_number as number
        const targetText = row.target_text || ''
        const pos = positionByLegoId.get(row.lego_id) || { x: 0, y: 0 }
        const mastery = masteryByLegoId.get(row.lego_id)
        return {
          legoId: row.lego_id,
          type: classifyType(row.type, targetText),
          text: targetText,
          knownText: row.known_text || '',
          audioId: row.target1_audio_id || '',
          beltIndex: beltIndexForSeed(seedNumber),
          seedNumber,
          position: pos,
          isRevealed: revealedSet.has(row.lego_id),
          masteryState: mastery?.state ?? 'acquisition',
          introducedAt: mastery?.lastSeenAt ?? null,
        }
      })

      // ---- 7. edges via @ssi/core ----
      const engineLegos: NetworkLego[] = legoRows.map((row: any) => ({
        legoId: row.lego_id,
        seedNumber: row.seed_number,
        type: (row.type === 'M' ? 'M' : 'A') as 'A' | 'M',
        targetText: row.target_text || '',
        components: Array.isArray(row.components) ? row.components : null,
      }))
      const network = buildBrainNetwork(engineLegos, phrases)

      const edges: NetworkEdge[] = [
        ...network.structural.map(e => ({
          source: e.source,
          target: e.target,
          type: 'structural' as const,
          strength: 1,
        })),
        ...network.context.map(e => ({
          source: e.source,
          target: e.target,
          type: 'context' as const,
          strength: e.strength,
        })),
      ]

      if (myFetch !== activeFetch) return
      data.value = {
        courseCode: course,
        languageName,
        nodes,
        edges,
      }
    } catch (err) {
      if (myFetch !== activeFetch) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useBrainNetwork] fetch failed:', msg)
      error.value = msg
    } finally {
      if (myFetch === activeFetch) {
        isLoading.value = false
      }
    }
  }

  // Refetch whenever course or learner identity changes.
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
