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
import { watch, type Ref } from 'vue'
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
import { getSeedFromLegoId } from './useBeltProgress'

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
  /**
   * Supabase client — plain value OR a Ref, mirroring `BeltProgressSyncConfig`
   * (`useBeltProgress.ts`). MUST be a Ref for any caller where auth/client
   * resolution can still be in flight at construction time: a plain value is
   * captured ONCE and never re-read, so if it's still null/guest at that
   * instant every later `flush()` uses the same stale snapshot forever — the
   * root cause of `learner_lego_metrics` never getting written (2026-07-16
   * shadow verdict). `LearningPlayer.vue`'s child `onMounted` fires before
   * its parent `App.vue` even starts `auth.initialize()`, so this is not a
   * rare race — it is the FIRST read, every time.
   */
  supabase: Ref<SupabaseClient | null> | SupabaseClient | null
  /** Learner ID — same plain-or-Ref contract as `supabase` above, same reason. */
  learnerId: Ref<string | null> | string | null
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
  /**
   * Fires whenever a hydrate/flush write fails. The engine still degrades
   * gracefully (in-memory play continues), but the failure must never be
   * silent — the caller is expected to log it as a real telemetry event
   * (e.g. `logEvent('adaptation_persistence_error', ...)`), not just console
   * noise a soak review can miss.
   */
  onPersistenceError?: (stage: 'hydrate' | 'mastery' | 'series' | 'evidence', error: unknown) => void
}

function unwrapMaybeRef<T>(v: Ref<T> | T | null | undefined): T | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v !== null && 'value' in (v as object)) {
    return (v as Ref<T>).value
  }
  return v as T
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
  /**
   * Forward-reuse centrality percentile per LEGO id (0..1, 1 = biggest hub)
   * from `computeCentralityFromScript` — the PRIMARY criticality signal
   * (founder ruling 2026-07-31). Absent (map or entry) → the policy falls
   * back to introduction-order criticality.
   */
  unitCentralityPercentile?: Record<string, number>
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
  /** Flush dirty rows to Supabase. On failure, calls `config.onPersistenceError` (never silent) and retries next flush. */
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
  let pageHideHandler: (() => void) | null = null
  // The learnerId hydration last succeeded against — null until the FIRST
  // successful hydrate. Distinct from "initialize() was called": a guest/
  // not-yet-resolved learnerId at call time must NOT permanently mark this
  // engine as initialized, or a later-resolving auth (the common case — see
  // `supabase`/`learnerId` doc above) never gets its one-time hydration.
  let hydratedForLearnerId: string | null = null
  let hydrating = false

  const getSupabase = (): SupabaseClient | null => unwrapMaybeRef(config.supabase)
  const getLearnerId = (): string | null => unwrapMaybeRef(config.learnerId)

  const canSync = (): boolean => {
    const learnerId = getLearnerId()
    // 'demo-learner' is LearningPlayer's pre-auth/guest fallback id — not a
    // learners.id uuid, so an upsert with it can only fail (22P02). Skip it
    // like the guest- prefix; the watcher below re-hydrates when the real id
    // resolves.
    return !!(
      getSupabase() &&
      learnerId &&
      !learnerId.startsWith('guest-') &&
      learnerId !== 'demo-learner'
    )
  }

  const store = (): LegoMetricsStore | null => {
    const client = getSupabase()
    if (!canSync() || !client) return null
    return new LegoMetricsStore({ client })
  }

  const initialize = async (): Promise<void> => {
    const learnerId = getLearnerId()
    const s = store()
    if (!s || !learnerId) {
      // Guest, or auth/client not resolved yet — engine still works in
      // memory. `hydratedForLearnerId` stays unset, so a later resolve
      // (auth.initialize() finishing after this composable was constructed)
      // gets one real hydration attempt via the watcher below.
      registerPageHide()
      return
    }
    if (hydrating || hydratedForLearnerId === learnerId) return
    hydrating = true

    try {
      const rows = await s.loadAll(learnerId, config.courseCode)
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
      hydratedForLearnerId = learnerId
      console.log(
        `[useAdaptationEngine] Hydrated ${states.length} LEGO mastery states for course ${config.courseCode}`
      )
    } catch (err) {
      console.error('[useAdaptationEngine] Hydration failed:', err)
      config.onPersistenceError?.('hydrate', err)
    } finally {
      hydrating = false
    }

    registerPageHide()
  }

  // Re-attempt hydration once if the learnerId resolves AFTER construction
  // (the normal case: `initializeAdaptationEngine()` in LearningPlayer.vue
  // fires from a CHILD component's onMounted, which Vue runs before the
  // parent App.vue's onMounted even starts `auth.initialize()` — so the
  // first `initialize()` call above almost always runs pre-auth). A no-op
  // when `config.learnerId` isn't an actual Ref (the getter never changes).
  watch(getLearnerId, (id) => {
    if (id) void initialize()
  })

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
    // Every unit id IS a lego id (`S%04dL%02d`), so its ordinal is derivable
    // directly from the id — the same "seed number is the ordinal proxy"
    // convention the caller already uses for `roundLegoOrdinal`
    // (LearningPlayer.vue). Previously only the round's own LEGO carried an
    // ordinal, so every review-phase unit read "unknown -> not critical ->
    // deferrable" — including seed-1 LEGOs (2026-07-16 shadow verdict,
    // "criticality inversion"). Building the map from every read unit (not
    // just the round's own) closes that gap with no new plumbing.
    const unitOrdinals: Record<string, number> = { [input.roundLegoId]: input.roundLegoOrdinal }
    for (const read of difficulty) {
      if (unitOrdinals[read.unitId] !== undefined) continue
      const ordinal = getSeedFromLegoId(read.unitId)
      if (ordinal !== null) unitOrdinals[read.unitId] = ordinal
    }
    const plan = ratePolicy.planRound({
      roundLegoId: input.roundLegoId,
      roundLegoOrdinal: input.roundLegoOrdinal,
      courseLegoCount: input.courseLegoCount,
      difficulty,
      unitOrdinals,
      unitCentralityPercentile: input.unitCentralityPercentile,
      manualOverrideActive: input.manualOverrideActive,
      basePauseMultiplier: getPauseMultiplier,
    })
    return { plan, difficulty }
  }

  const flush = async (): Promise<void> => {
    if (dirty.size === 0) return
    const s = store()
    const learnerId = getLearnerId()
    if (!s || !learnerId || !canSync()) {
      // Can't sync yet (guest, or auth/client still resolving). KEEP the
      // dirty set — clearing it here silently discarded every cycle recorded
      // before auth resolved (the other half of the 2026-07-16 persistence
      // fix: live refs alone don't help if the pre-auth flush already threw
      // the data away). Bounded: at most one entry per lego in the course.
      cyclesSinceFlush = 0
      return
    }

    const now = new Date()
    const legoIds = [...dirty]
    const rows: LegoMetricsUpsert[] = legoIds.map((legoId) => {
      const state = mastery.getState(legoId)
      return {
        learner_id: learnerId,
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
      console.error('[useAdaptationEngine] Flush failed:', err)
      config.onPersistenceError?.('mastery', err)
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
            learner_id: learnerId,
            lego_id: legoId,
            course_code: config.courseCode,
            recent_latency_samples: samples,
            mean_latency_ms: mean,
          }
        })
        .filter((r) => r.recent_latency_samples.length > 0)
      await s.upsertSeries(seriesRows)
    } catch (err) {
      console.error('[useAdaptationEngine] Series flush failed (non-fatal):', err)
      config.onPersistenceError?.('series', err)
    }

    // Evidence-aggregator snapshot (WP-0/WP-4) — the merged behavioural+
    // latency series, isolated exactly like the B4 series write above: a
    // missing `evidence_series` column (pre-migration) degrades in isolation
    // and never regresses mastery or B4-series persistence.
    try {
      const evidenceRows: LegoEvidenceSeriesUpsert[] = legoIds
        .map((legoId) => ({
          learner_id: learnerId,
          lego_id: legoId,
          course_code: config.courseCode,
          evidence_series: aggregator.getSeries(legoId),
        }))
        .filter((r) => r.evidence_series.values.length > 0)
      await s.upsertEvidenceSeries(evidenceRows)
    } catch (err) {
      console.error('[useAdaptationEngine] Evidence-series flush failed (non-fatal):', err)
      config.onPersistenceError?.('evidence', err)
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
