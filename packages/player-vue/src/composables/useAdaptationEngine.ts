/**
 * useAdaptationEngine - Per-LEGO adaptive pause timing + adaptation v2 (WP-3)
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
 *
 * Adaptation v2 (`docs/adaptation/adaptation-v2-build-spec.md` §2/§4, WP-3):
 * this composable also owns the ONE shared `EvidenceAggregator` — the
 * latency producer below feeds it alongside the untouched v1 metrics flow,
 * and `useBehaviouralEvidence`'s behavioural producer feeds the SAME
 * instance (the caller passes it in via `config.aggregator` so both
 * producers share one wire; see `LearningPlayer.vue`). `planRound` wraps
 * `RatePolicyEngine` + `assessLocalDifficulty` into one per-round-boundary
 * call — pure decision, the caller (WP-3's player wiring) decides whether
 * and how to apply the resulting `RoundPlan`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createMetricsTracker,
  createSpikeDetector,
  createMasteryStateMachine,
  createEvidenceAggregator,
  createRatePolicyEngine,
  assessLocalDifficulty,
  LegoMetricsStore,
  DEFAULT_CONFIG,
  type LegoMetricsUpsert,
  type LegoSeriesUpsert,
  type LegoEvidenceSeriesUpsert,
  type MasteryState,
  type LegoMasteryState,
  type EvidenceAggregator,
  type RatePolicyConfig,
  type RoundPlan,
  type LocalDifficulty,
} from '@ssi/core'

const FLUSH_EVERY_N_CYCLES = 10
const QUICK_RESPONSE_MS = 2000
// Bound on the per-lego difficulty series persisted for B4 — enough for the
// curvature window (default 7) plus its own-noise baseline (default 10).
const SERIES_CAP = 20
// Mirrors curvature.ts's own DEFAULT_MIN_SAMPLES (not exported — a unit's
// series needs at least this many samples before its curvature read is
// anything but "warming up", so there is no point asking the policy about it
// sooner).
const EVIDENCE_MIN_SAMPLES_FOR_DIFFICULTY = 5

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
  /**
   * The ONE shared evidence aggregator (WP-0). Pass the SAME instance given
   * to `useBehaviouralEvidence` so latency + behavioural evidence merge into
   * one per-LEGO series. Defaults to a fresh (unshared) aggregator so
   * existing callers/tests are unaffected.
   */
  aggregator?: EvidenceAggregator
  /** Rate-policy tuning (WP-2) — `algorithm_config.adaptation_v2.bounds`/config. Defaults to DEFAULT_RATE_POLICY_CONFIG. */
  ratePolicyConfig?: Partial<RatePolicyConfig>
}

/** Input to `planRound` — one round boundary. See `RoundBoundaryInput` (ratePolicy.ts) for the full shape this builds. */
export interface PlanRoundInput {
  /** LEGO id of the round about to play. */
  roundLegoId: string
  /** Introduction ordinal of `roundLegoId` (criticality guard — see ratePolicy.ts §04). */
  roundLegoOrdinal: number
  /** Total LEGOs in the course — the criticality-fraction denominator. */
  courseLegoCount: number
  /** True once the learner has exercised a manual dial (belt_skip/turbo_toggle) this session. */
  manualOverrideActive: boolean
}

export interface PlanRoundResult {
  plan: RoundPlan
  /** The local-difficulty reads that fed the plan — for shadow-log transparency. */
  difficulty: LocalDifficulty[]
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
  /**
   * Adaptation v2 (WP-2/WP-3): decide the next round's lever positions from
   * the shared evidence aggregator's current state. Pure decision — does NOT
   * touch playback; the caller decides whether/how to apply the `RoundPlan`
   * (shadow mode: log only, never apply).
   */
  planRound(input: PlanRoundInput): PlanRoundResult
  /** Flush dirty rows to Supabase. Returns silently on failure. */
  flush(): Promise<void>
  /** Cleanup: remove pagehide listener, final flush. */
  dispose(): void
}

export function useAdaptationEngine(
  config: UseAdaptationEngineConfig,
  nowMs: () => number = () => performance.now()
): UseAdaptationEngineReturn {
  const metrics = createMetricsTracker({ spike: DEFAULT_CONFIG.spike })
  const detector = createSpikeDetector({ spike: DEFAULT_CONFIG.spike }, metrics)
  const mastery = createMasteryStateMachine()
  const aggregator: EvidenceAggregator = config.aggregator ?? createEvidenceAggregator()
  const ratePolicy = createRatePolicyEngine(config.ratePolicyConfig)

  const dirty = new Set<string>()
  // Bounded normalized-latency ring per lego — the difficulty series B4 reads.
  const seriesByLego = new Map<string, number[]>()
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
      // Seed the per-lego difficulty ring so the curvature series (B4) carries
      // across sessions, not just within one.
      for (const r of rows) {
        if (r.recent_latency_samples?.length) {
          seriesByLego.set(r.lego_id, r.recent_latency_samples.slice(-SERIES_CAP))
        }
      }
      // Hydrate the shared evidence aggregator (WP-0/WP-4) so the merged
      // behavioural+latency series also carries across sessions. Isolated
      // from the mastery hydrate above: a row with no evidence_series
      // (pre-migration, or never written) simply contributes nothing.
      const evidenceSnapshot = new Map<string, { values: number[]; x: number[] }>()
      for (const r of rows) {
        if (r.evidence_series?.values?.length) {
          evidenceSnapshot.set(r.lego_id, r.evidence_series)
        }
      }
      if (evidenceSnapshot.size > 0) {
        aggregator.hydrate(evidenceSnapshot)
      }
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

    // 1b. Accumulate the bounded difficulty series for this lego — the
    // time-ordered normalized-latency samples B1 curvature / B4 difficulty read
    // (persisted on flush).
    const ring = seriesByLego.get(legoId) ?? []
    ring.push(metric.normalized_latency)
    if (ring.length > SERIES_CAP) ring.splice(0, ring.length - SERIES_CAP)
    seriesByLego.set(legoId, ring)

    // 1c. Latency producer #1 on the shared evidence stream (adaptation v2,
    // build spec §2): normalized_latency is already in the "higher = more
    // struggle" convention the aggregator expects, verbatim, no rescaling.
    // Runs unconditionally alongside the untouched v1 flow above — the pause
    // ladder keeps working even if v2 is killed. The `adaptation_v2.enabled`
    // kill switch is enforced by the CALLER (LearningPlayer.vue) not calling
    // `planRound`/applying its output — recording here is cheap and keeps the
    // series warm for whenever v2 is flipped on.
    aggregator.record({
      unitId: legoId,
      unitKind: 'lego',
      source: 'latency',
      value: metric.normalized_latency,
      weight: 1.0,
      occurredAtMs: nowMs(),
    })

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

  const planRound = (input: PlanRoundInput): PlanRoundResult => {
    const readyUnitIds = aggregator.readyUnits(EVIDENCE_MIN_SAMPLES_FOR_DIFFICULTY)
    const difficulty: LocalDifficulty[] = readyUnitIds.map((unitId) =>
      assessLocalDifficulty({ unitId, unitKind: 'lego', ...aggregator.getSeries(unitId) })
    )
    // Only the round's own (possibly-new) LEGO has a known ordinal here —
    // every other unit falls through the criticality guard's safe default
    // (unknown ordinal never resists deferral by accident, ratePolicy.ts
    // `isCritical`). Earn a fuller ordinal map only if pilot data shows this
    // under-protects other early-course units.
    const unitOrdinals: Record<string, number> = { [input.roundLegoId]: input.roundLegoOrdinal }
    const plan = ratePolicy.planRound({
      roundLegoId: input.roundLegoId,
      roundLegoOrdinal: input.roundLegoOrdinal,
      courseLegoCount: input.courseLegoCount,
      difficulty,
      unitOrdinals,
      manualOverrideActive: input.manualOverrideActive,
      basePauseMultiplier: getPauseMultiplier,
    })
    return { plan, difficulty }
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
    const legoIds = [...dirty]
    const rows: LegoMetricsUpsert[] = legoIds.map((legoId) => {
      const state = mastery.getState(legoId)
      return {
        learner_id: config.learnerId!,
        lego_id: legoId,
        course_code: config.courseCode,
        mastery_state: state.current_state,
        consecutive_smooth: state.consecutive_smooth,
        consecutive_fast: state.consecutive_fast,
        n_samples: 0, // Not tracked in MasteryStateMachine; reserved for future
        last_seen_at: now,
      }
    })

    // Clear before await so concurrent recordCycle calls accumulate cleanly
    dirty.clear()
    cyclesSinceFlush = 0

    try {
      await s.upsertMany(rows)
    } catch (err) {
      console.warn('[useAdaptationEngine] Flush failed:', err)
      // Re-mark as dirty so next flush retries; skip the series write (the row
      // may not exist yet, and we don't want to mask the mastery failure).
      for (const id of legoIds) dirty.add(id)
      return
    }

    // B4 difficulty series — a SEPARATE upsert (runs after the mastery row
    // exists) so a missing `recent_latency_samples` column pre-migration
    // degrades in isolation and never regresses mastery persistence above.
    try {
      const seriesRows: LegoSeriesUpsert[] = legoIds
        .map((legoId) => {
          const samples = seriesByLego.get(legoId) ?? []
          const mean = samples.length
            ? samples.reduce((a, b) => a + b, 0) / samples.length
            : null
          return {
            learner_id: config.learnerId!,
            lego_id: legoId,
            course_code: config.courseCode,
            recent_latency_samples: samples,
            mean_latency_ms: mean,
          }
        })
        .filter((r) => r.recent_latency_samples.length > 0)
      await s.upsertSeries(seriesRows)
    } catch (err) {
      console.warn('[useAdaptationEngine] Series flush failed (non-fatal):', err)
    }

    // Evidence-aggregator snapshot (WP-0/WP-4) — the merged behavioural+
    // latency series, isolated exactly like the B4 series write above: a
    // missing `evidence_series` column (pre-migration) degrades in isolation
    // and never regresses mastery or B4-series persistence.
    try {
      const evidenceRows: LegoEvidenceSeriesUpsert[] = legoIds
        .map((legoId) => ({
          learner_id: config.learnerId!,
          lego_id: legoId,
          course_code: config.courseCode,
          evidence_series: aggregator.getSeries(legoId),
        }))
        .filter((r) => r.evidence_series.values.length > 0)
      await s.upsertEvidenceSeries(evidenceRows)
    } catch (err) {
      console.warn('[useAdaptationEngine] Evidence-series flush failed (non-fatal):', err)
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
    planRound,
    flush,
    dispose,
  }
}
