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
import {
  generateLearningScript,
  DEFAULT_LISTENING_CONFIG,
  DEFAULT_SCRIPT_SHAPE,
  type LearningScriptResult,
  type ListeningConfig,
  type ScriptShape,
} from '../providers/generateLearningScript'
import { easyOptionsForMode, maxPhraseLengthFractionForMode } from '../providers/modeScriptOptions'
import type { ModeConfig } from './useAlgorithmConfig'
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

/**
 * Everything the walk needs to produce the ACTIVE MODE's script rather than
 * the generator's bare defaults.
 *
 * This used to be omitted entirely — `generateLearningScript(supabase, code)`
 * and nothing else — so a preloaded script was always Fast's, whatever mode
 * the learner was in. It is a required argument now: a caller that doesn't
 * know the mode can't accidentally preload the wrong one.
 */
export interface PreloadScriptOptions {
  /** The active mode's config row (easyConfig / fastConfig). */
  modeConfig: Partial<ModeConfig> | null | undefined
  /** Live listening config, pod-activation pin already merged. */
  listening?: ListeningConfig
  /** The global script shape with the active mode's overlay applied. */
  scriptShape?: ScriptShape
  /** Revival rounds after the main loop. */
  infinitePlayLookahead?: number
  /** Pod-lap firing cadence — keeps the L1-outro merge in sync. */
  podRoundInterval?: number
}

export interface EagerScriptPreload {
  /** Resolves with seeds 1..INITIAL_PRELOAD_SEEDS */
  scriptPromise: Ref<Promise<LearningScriptResult> | null>
  /** Resolved result (null until preload resolves) */
  scriptResult: Ref<LearningScriptResult | null>
  /** The course code this preload is for */
  courseCode: Ref<string>
  /** Trigger a fresh preload (e.g. on course switch) */
  preload: (supabase: SupabaseClient, code: string, options: PreloadScriptOptions) => void
  /**
   * True only when the preloaded (or in-flight) script was generated with THIS
   * mode's levers. Consumers must check it before using the preload: the mode
   * can change between the preload firing and the script being consumed, and
   * an Easy learner served Fast's script is exactly the bug this file had.
   */
  matchesMode: (modeConfig: Partial<ModeConfig> | null | undefined) => boolean
}

/** Fingerprint of the mode levers that actually change the generated script. */
const modeKeyOf = (modeConfig: Partial<ModeConfig> | null | undefined): string =>
  JSON.stringify([easyOptionsForMode(modeConfig), maxPhraseLengthFractionForMode(modeConfig)])

export function useEagerScriptPreload(): EagerScriptPreload {
  const scriptPromise = ref<Promise<LearningScriptResult> | null>(null)
  const scriptResult = ref<LearningScriptResult | null>(null)
  const courseCode = ref('')

  // Course + mode-arguments fingerprint of the walk currently in flight.
  // Easy and Fast produce genuinely different scripts, so single-flight has to
  // key on the mode too — otherwise a mode switch is served the other mode's
  // walk, which is the same wrong-script bug by another route.
  let inFlightKey: string | null = null
  const walkModeKey = ref<string | null>(null)

  const preload = (supabase: SupabaseClient, code: string, options: PreloadScriptOptions) => {
    const {
      modeConfig,
      listening = DEFAULT_LISTENING_CONFIG,
      scriptShape = DEFAULT_SCRIPT_SHAPE,
      infinitePlayLookahead = 50,
      podRoundInterval = 5,
    } = options

    const easyOptions = easyOptionsForMode(modeConfig)
    const maxPhraseLengthFraction = maxPhraseLengthFractionForMode(modeConfig)
    const key = JSON.stringify([code, easyOptions, maxPhraseLengthFraction, scriptShape, listening, infinitePlayLookahead, podRoundInterval])

    // Single-flight per course+mode: a matching walk is already running or
    // resolved — every caller shares it via scriptPromise/scriptResult. Without
    // this, multiple triggers on one cold start each ran the WHOLE course-wide
    // walk concurrently, multiplying the phrase-table fetches right when the
    // instant bootstrap needs the network.
    if (key === inFlightKey && scriptPromise.value) return
    inFlightKey = key
    walkModeKey.value = modeKeyOf(modeConfig)

    // Reset if switching courses
    if (code !== courseCode.value) {
      scriptResult.value = null
    }
    courseCode.value = code

    const start = Date.now()
    console.log(`[eagerScriptPreload] Loading full course script for ${code}...`)

    const promise = checkContentVersion(supabase, code)
      .catch(() => {}) // non-blocking: offline is fine
      .then(() => generateLearningScript(
        supabase,
        code,
        infinitePlayLookahead,
        listening,
        scriptShape,
        maxPhraseLengthFraction,
        easyOptions,
        podRoundInterval,
      ))
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

  const matchesMode = (modeConfig: Partial<ModeConfig> | null | undefined): boolean =>
    walkModeKey.value !== null && walkModeKey.value === modeKeyOf(modeConfig)

  return { scriptPromise, scriptResult, courseCode, preload, matchesMode }
}
