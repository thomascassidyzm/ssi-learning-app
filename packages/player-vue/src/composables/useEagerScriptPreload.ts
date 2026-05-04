/**
 * useEagerScriptPreload - Single-phase windowed preload for fast cold start
 *
 * Called from App.vue as soon as the course is known. Loads a small initial
 * window (seeds 1..INITIAL_PRELOAD_SEEDS) and parks. New users at round 1
 * get this immediately.
 *
 * Returning users past the initial window do their own load in
 * LearningPlayer (centred on their resume position, includes correct
 * pod-activation pin) — they can't use this preload's content anyway.
 *
 * As the player advances, a near-edge watcher in LearningPlayer extends the
 * loaded set seed-by-seed via `loadSeedIfNeeded` — the same path belt-skip
 * already uses. There's no longer a "phase 2 covers the whole course"
 * preload; loading is purely on-demand from the initial window forward.
 *
 * The architectural simplification removes a class of bugs around
 * addRounds-while-playing races between phase 1 and phase 2.
 */

import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, type LearningScriptResult } from '../providers/generateLearningScript'
import { checkContentVersion } from './useScriptCache'

/**
 * Seeds covered by the initial fast load. The script generator's main loop
 * introduces every LEGO in this range, so cost scales roughly linearly —
 * keep this small. 10 seeds ≈ ~30 rounds ≈ ~2.5 hours of practice content,
 * giving the near-edge watcher plenty of headroom to load more chunks
 * before the player runs out.
 */
export const INITIAL_PRELOAD_SEEDS = 10

/**
 * Seeds to fetch per chunk when the near-edge watcher fires. Smaller than
 * INITIAL_PRELOAD_SEEDS because subsequent chunks are pure additions.
 */
export const LOOKAHEAD_CHUNK_SEEDS = 5

export interface EagerScriptPreload {
  /** Resolves with seeds 1..INITIAL_PRELOAD_SEEDS */
  scriptPromise: Ref<Promise<LearningScriptResult> | null>
  /** Resolved result (null until preload resolves) */
  scriptResult: Ref<LearningScriptResult | null>
  /** The course code this preload is for */
  courseCode: Ref<string>
  /** Trigger a fresh preload (e.g. on course switch) */
  preload: (supabase: SupabaseClient, code: string) => void
}

export function useEagerScriptPreload(): EagerScriptPreload {
  const scriptPromise = ref<Promise<LearningScriptResult> | null>(null)
  const scriptResult = ref<LearningScriptResult | null>(null)
  const courseCode = ref('')

  const preload = (supabase: SupabaseClient, code: string) => {
    // Reset if switching courses
    if (code !== courseCode.value) {
      scriptResult.value = null
    }
    courseCode.value = code

    const start = Date.now()
    console.log(`[eagerScriptPreload] Loading initial ${INITIAL_PRELOAD_SEEDS} seeds for ${code}...`)

    const promise = checkContentVersion(supabase, code)
      .catch(() => {}) // non-blocking: offline is fine
      .then(() => generateLearningScript(supabase, code, 1, INITIAL_PRELOAD_SEEDS, 1))
      .then(result => {
        console.log(`[eagerScriptPreload] Done: ${result.items.length} items, ${result.roundCount} rounds in ${Date.now() - start}ms`)
        if (courseCode.value !== code) return result // course switched mid-load
        scriptResult.value = result
        return result
      })
      .catch(err => {
        console.error('[eagerScriptPreload] Load failed:', err)
        throw err
      })

    scriptPromise.value = promise
  }

  return { scriptPromise, scriptResult, courseCode, preload }
}
