/**
 * useAdaptationEngine - Per-LEGO adaptive pause timing
 *
 * Composes MetricsTracker + SpikeDetector + MasteryStateMachine from @ssi/core
 * into a Vue-friendly composable that:
 *   - Hydrates per-LEGO mastery state from Supabase on init
 *   - Records every cycle's latency, classifies smooth/spike, updates mastery
 *   - Exposes a per-LEGO pause multiplier driven by mastery state
 *   - Auto-persists every N cycles + on pagehide
 *
 * "No sessions" model: the engine lives for as long as the player is mounted.
 * Rolling stats persist in memory; mastery state persists in Supabase.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createMetricsTracker,
  createSpikeDetector,
  createMasteryStateMachine,
  LegoMetricsStore,
  DEFAULT_CONFIG,
  type LegoMetricsUpsert,
  type MasteryState,
  type LegoMasteryState,
} from '@ssi/core'

const FLUSH_EVERY_N_CYCLES = 10
const QUICK_RESPONSE_MS = 2000

// Mastery state → pause multiplier (the "ladder")
// Slightly slower for unfamiliar LEGOs, progressively shorter as the
// learner masters them. Differential, anchored to the baked pause.
const MASTERY_MULTIPLIER: Record<MasteryState, number> = {
  acquisition: 1.2,
  consolidating: 1.0,
  confident: 0.85,
  mastered: 0.7,
}

export interface UseAdaptationEngineConfig {
  supabase: SupabaseClient | null
  learnerId: string | null
  courseCode: string
}

export interface UseAdaptationEngineReturn {
  /** Hydrate from Supabase. Safe to call when guest / no client; becomes no-op. */
  initialize(): Promise<void>
  /** Record one completed cycle. Updates mastery state, marks dirty for flush. */
  recordCycle(
    legoId: string,
    responseLatencyMs: number,
    phraseLength: number
  ): void
  /** Pause multiplier for the given LEGO (1.0 if unknown). */
  getPauseMultiplier(legoId: string): number
  /** Flush dirty rows to Supabase. Returns silently on failure. */
  flush(): Promise<void>
  /** Cleanup: remove pagehide listener, final flush. */
  dispose(): void
}

export function useAdaptationEngine(
  config: UseAdaptationEngineConfig
): UseAdaptationEngineReturn {
  const metrics = createMetricsTracker({ spike: DEFAULT_CONFIG.spike })
  const detector = createSpikeDetector({ spike: DEFAULT_CONFIG.spike }, metrics)
  const mastery = createMasteryStateMachine()

  const dirty = new Set<string>()
  let cyclesSinceFlush = 0
  let initialized = false
  let pageHideHandler: (() => void) | null = null

  const canSync = (): boolean => {
    return !!(
      config.supabase &&
      config.learnerId &&
      !config.learnerId.startsWith('guest-')
    )
  }

  const store = (): LegoMetricsStore | null => {
    if (!canSync() || !config.supabase) return null
    return new LegoMetricsStore({ client: config.supabase })
  }

  const initialize = async (): Promise<void> => {
    if (initialized) return
    initialized = true

    const s = store()
    if (!s || !config.learnerId) {
      // Guest or no client — engine still works in memory, just no persistence
      registerPageHide()
      return
    }

    try {
      const rows = await s.loadAll(config.learnerId, config.courseCode)
      const states: LegoMasteryState[] = rows.map((r) => ({
        lego_id: r.lego_id,
        current_state: r.mastery_state,
        consecutive_smooth: r.consecutive_smooth,
        consecutive_fast: r.consecutive_fast,
        discontinuity_count: 0, // Not persisted — derived runtime only
        last_discontinuity_at: null,
        created_at: r.last_seen_at,
        updated_at: r.last_seen_at,
      }))
      mastery.loadStates(states)
      console.log(
        `[useAdaptationEngine] Hydrated ${states.length} LEGO mastery states for course ${config.courseCode}`
      )
    } catch (err) {
      console.warn('[useAdaptationEngine] Hydration failed:', err)
    }

    registerPageHide()
  }

  const registerPageHide = () => {
    if (typeof window === 'undefined' || pageHideHandler) return
    pageHideHandler = () => {
      void flush()
    }
    window.addEventListener('pagehide', pageHideHandler)
  }

  const recordCycle = (
    legoId: string,
    responseLatencyMs: number,
    phraseLength: number
  ): void => {
    // 1. Record the metric (updates rolling stats). threadId/mode are required
    // by the API but unused for pause adaptation — we don't run triple-helix
    // here and we treat every cycle uniformly.
    const metric = metrics.recordResponse(
      legoId,
      responseLatencyMs,
      phraseLength,
      0,
      'practice'
    )

    // 2. Detect spike against rolling baseline
    const detection = detector.detectSpike(metric.normalized_latency)

    // 3. Update mastery state
    if (detection.is_spike && detection.severity !== 'none') {
      mastery.recordDiscontinuity(legoId, detection.severity)
    } else {
      const wasFast = responseLatencyMs < QUICK_RESPONSE_MS
      mastery.recordSmooth(legoId, wasFast)
    }

    dirty.add(legoId)
    cyclesSinceFlush++

    if (cyclesSinceFlush >= FLUSH_EVERY_N_CYCLES) {
      void flush()
    }
  }

  const getPauseMultiplier = (legoId: string): number => {
    const state = mastery.getState(legoId)
    return MASTERY_MULTIPLIER[state.current_state] ?? 1.0
  }

  const flush = async (): Promise<void> => {
    if (dirty.size === 0) return
    const s = store()
    if (!s || !config.learnerId) {
      dirty.clear()
      cyclesSinceFlush = 0
      return
    }

    const now = new Date()
    const rows: LegoMetricsUpsert[] = []
    for (const legoId of dirty) {
      const state = mastery.getState(legoId)
      rows.push({
        learner_id: config.learnerId,
        lego_id: legoId,
        course_code: config.courseCode,
        mastery_state: state.current_state,
        consecutive_smooth: state.consecutive_smooth,
        consecutive_fast: state.consecutive_fast,
        n_samples: 0, // Not tracked in MasteryStateMachine; reserved for future
        last_seen_at: now,
      })
    }

    // Clear before await so concurrent recordCycle calls accumulate cleanly
    dirty.clear()
    cyclesSinceFlush = 0

    try {
      await s.upsertMany(rows)
    } catch (err) {
      console.warn('[useAdaptationEngine] Flush failed:', err)
      // Re-mark as dirty so next flush retries
      for (const r of rows) dirty.add(r.lego_id)
    }
  }

  const dispose = (): void => {
    if (pageHideHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', pageHideHandler)
      pageHideHandler = null
    }
    void flush()
  }

  return {
    initialize,
    recordCycle,
    getPauseMultiplier,
    flush,
    dispose,
  }
}
