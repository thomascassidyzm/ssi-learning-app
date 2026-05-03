/**
 * useEagerScriptPreload - Two-phase preload for fast cold start
 *
 * Called from App.vue as soon as the course is known.
 *
 * Phase 1 (scriptPromise): seeds 1..INITIAL_PRELOAD_SEEDS only — gives the
 *   player enough rounds to start playing immediately.
 * Phase 2 (extensionPromise): seeds 1..EXTENSION_PRELOAD_SEEDS — covers the
 *   typical learner journey without slamming the DB. When it resolves
 *   LearningPlayer appends the new rounds via simplePlayer.addRounds.
 *
 * For returning users beyond the extension window (rare — past seed
 * EXTENSION_PRELOAD_SEEDS), LearningPlayer awaits the extension before
 * jumping to their resume position. They'll be just past the loaded edge;
 * an on-demand top-up is a separate concern (see PriorityRoundLoader).
 *
 * History: Phase 2 used to fetch (1, 9999) — i.e. the whole course. For
 * busy courses (~6K phrases plus an audio-fallback table scan) this hit
 * Postgres' statement timeout. Bounding the range fixes that without
 * paginating; the 95% case is well-covered.
 */

import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, type LearningScriptResult } from '../providers/generateLearningScript'
import { checkContentVersion } from './useScriptCache'

/**
 * Seeds covered by the initial fast load. The script generator's main loop
 * introduces every LEGO in this range (≈ 3 LEGOs per seed), so cost scales
 * roughly linearly with this number — keep it small. 10 seeds ≈ 30 LEGOs ≈
 * well over an hour of practice content, which is plenty of buffer for phase
 * 2 to finish loading the rest of the course in the background.
 */
export const INITIAL_PRELOAD_SEEDS = 10

/**
 * Seeds covered by the background extension load. Bounded (rather than the
 * old 9999 sentinel) so the query stays under Postgres' statement timeout
 * for busy courses. 100 seeds covers the majority of learner journeys; users
 * past this point are an edge case to handle via on-demand top-up.
 */
export const EXTENSION_PRELOAD_SEEDS = 100

export interface EagerScriptPreload {
  /** Phase 1: resolves quickly with seeds 1-INITIAL_PRELOAD_SEEDS */
  scriptPromise: Ref<Promise<LearningScriptResult> | null>
  /** Phase 1 resolved result (null until phase 1 resolves) */
  scriptResult: Ref<LearningScriptResult | null>
  /** Phase 2: resolves later with the full course (seeds 1-9999) */
  extensionPromise: Ref<Promise<LearningScriptResult> | null>
  /** Phase 2 resolved result (null until phase 2 resolves) */
  extensionResult: Ref<LearningScriptResult | null>
  /** The course code this preload is for */
  courseCode: Ref<string>
  /** Trigger a fresh preload (e.g. on course switch) */
  preload: (supabase: SupabaseClient, code: string) => void
}

export function useEagerScriptPreload(): EagerScriptPreload {
  const scriptPromise = ref<Promise<LearningScriptResult> | null>(null)
  const scriptResult = ref<LearningScriptResult | null>(null)
  const extensionPromise = ref<Promise<LearningScriptResult> | null>(null)
  const extensionResult = ref<LearningScriptResult | null>(null)
  const courseCode = ref('')

  const preload = (supabase: SupabaseClient, code: string) => {
    // Reset if switching courses
    if (code !== courseCode.value) {
      scriptResult.value = null
      extensionResult.value = null
    }
    courseCode.value = code

    const initialStart = Date.now()
    console.log(`[eagerScriptPreload] Loading initial ${INITIAL_PRELOAD_SEEDS} seeds for ${code}...`)

    // Phase 1: small fast load — gives the player a playable script ASAP
    const initialPromise = checkContentVersion(supabase, code)
      .catch(() => {}) // non-blocking: offline is fine
      .then(() => generateLearningScript(supabase, code, 1, INITIAL_PRELOAD_SEEDS, 1))
      .then(result => {
        console.log(`[eagerScriptPreload] Initial done: ${result.items.length} items, ${result.roundCount} rounds in ${Date.now() - initialStart}ms`)
        scriptResult.value = result
        return result
      })
      .catch(err => {
        console.error('[eagerScriptPreload] Initial load failed:', err)
        throw err
      })

    scriptPromise.value = initialPromise

    // Phase 2: bounded extension in the background, after initial resolves so
    // we don't compete with the player's first audio fetches.
    const extPromise = initialPromise
      .then(() => {
        const extensionStart = Date.now()
        console.log(`[eagerScriptPreload] Starting extension preload for ${code} (1..${EXTENSION_PRELOAD_SEEDS})...`)
        return generateLearningScript(supabase, code, 1, EXTENSION_PRELOAD_SEEDS, 1).then(result => {
          console.log(`[eagerScriptPreload] Extension done: ${result.items.length} items, ${result.roundCount} rounds in ${Date.now() - extensionStart}ms`)
          // Discard if user switched courses while we were loading
          if (courseCode.value !== code) return result
          extensionResult.value = result
          return result
        })
      })
      .catch(err => {
        console.warn('[eagerScriptPreload] Extension load failed (non-fatal):', err)
        throw err
      })

    extensionPromise.value = extPromise
  }

  return { scriptPromise, scriptResult, extensionPromise, extensionResult, courseCode, preload }
}
