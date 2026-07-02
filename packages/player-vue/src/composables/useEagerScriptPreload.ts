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
 * Seeds covered by the initial fast load. Seeds are the script generator's
 * query unit; the unit users experience is rounds (≈ 3 rounds per seed).
 * 10 seeds ≈ ~30 rounds — plenty of buffer for the near-edge watcher to
 * extend the loaded set before the player runs out.
 */
export const INITIAL_PRELOAD_SEEDS = 10

/**
 * When the player gets within this many rounds of the loaded edge, fetch
 * another chunk. 5 rounds at ~5 min each = 25 min of headroom, which is
 * more than enough for a Supabase round-trip + addRounds.
 */
export const LOOKAHEAD_TRIGGER_ROUNDS = 5

/**
 * Seeds per chunk when the near-edge watcher fires. ~3 rounds per seed,
 * so a 3-seed chunk is ~9 rounds — enough to clear the trigger threshold
 * with margin so the watcher doesn't re-fire immediately.
 */
export const LOOKAHEAD_CHUNK_SEEDS = 3

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
    // Single-flight per course: a walk for this course is already running or
    // resolved — every caller shares it via scriptPromise/scriptResult. Without
    // this, multiple triggers on one cold start each ran the WHOLE course-wide
    // walk concurrently, multiplying the phrase-table fetches right when the
    // instant bootstrap needs the network.
    if (code === courseCode.value && scriptPromise.value) return

    // Reset if switching courses
    if (code !== courseCode.value) {
      scriptResult.value = null
    }
    courseCode.value = code

    const start = Date.now()
    console.log(`[eagerScriptPreload] Loading full course script for ${code}...`)

    const promise = checkContentVersion(supabase, code)
      .catch(() => {}) // non-blocking: offline is fine
      .then(() => generateLearningScript(supabase, code))
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
