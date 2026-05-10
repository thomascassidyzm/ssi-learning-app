/**
 * useEagerScriptPreload - Fire-and-forget full script preload
 *
 * Called from App.vue as soon as the course is known.
 * LearningPlayer awaits the promise (usually already resolved by mount time).
 */

import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, type LearningScriptResult } from '../providers/generateLearningScript'
import { checkContentVersion } from './useScriptCache'

export interface EagerScriptPreload {
  /** Resolves with the full script result (seeds 1-668) */
  scriptPromise: Ref<Promise<LearningScriptResult> | null>
  /** The resolved result (null until promise resolves) */
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

    const startTime = Date.now()
    console.log(`[eagerScriptPreload] Loading full script for ${code}...`)

    // Check content version before loading — clears stale audio cache if course was regenerated
    // Use a large upper bound — generateLearningScript filters out incomplete rounds
    const promise = checkContentVersion(supabase, code)
      .catch(() => {}) // non-blocking: offline is fine
      .then(() => generateLearningScript(supabase, code, 1, 9999, 1))
      .then(result => {
        console.log(`[eagerScriptPreload] Done: ${result.items.length} items, ${result.roundCount} rounds in ${Date.now() - startTime}ms`)
        scriptResult.value = result
        return result
      })
      .catch(err => {
        console.error('[eagerScriptPreload] Failed:', err)
        throw err
      })

    scriptPromise.value = promise
  }

  return { scriptPromise, scriptResult, courseCode, preload }
}
