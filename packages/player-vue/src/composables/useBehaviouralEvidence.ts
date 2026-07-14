/**
 * Behavioural evidence producer (adaptation v2, workstream C — WP-1).
 *
 * Maps the behavioural events already logged today (`logEvent` in
 * `LearningPlayer.vue` — `phase_skip`, `tap_skip`, `lego_skip`, `tap_pause`/
 * `tap_play`, `turbo_toggle`, `belt_skip`, `audio_retry`) into the evidence
 * stream (`@ssi/core` `learning/evidence.ts`, WP-0) at the emit site — no
 * round-trip through `player_events`; the DB copy stays the analytics record.
 *
 * `docs/adaptation/adaptation-v2-build-spec.md` §3 is the design authority for
 * the mapping table below; all values are PROPOSED (config-tunable later).
 *
 * This module holds only the `EvidenceSink` interface — it has no opinion on
 * where the evidence ends up (WP-3 decides whether that's a standalone
 * aggregator or the one `useAdaptationEngine` already owns).
 */

import type { EvidenceSink } from '@ssi/core'

/** The minimal cycle shape a call site can pass — whatever SimplePlayer's currentCycle exposes. */
export interface PlayerEventCycle {
  id?: string | null
  legoId?: string | null
}

export type PlayerEventPayload = Record<string, unknown>

/** One row of the mapping table (spec §3) — value/weight already in the [0..~3] struggle band. */
export interface BehaviouralReading {
  value: number
  weight: number
}

// ---------------------------------------------------------------------------
// Pure classifiers — one per event type, independently testable against the
// spec's mapping table. Returning `null` means "no evidence, event dropped or
// unrecognised shape" (distinct from the manual-dial events, which never even
// reach these — see MANUAL_DIAL_EVENT_TYPES below).
// ---------------------------------------------------------------------------

/** `phase_skip` forward is a confidence read; slow-forward is milder confidence; back/replay is uncertainty. */
export function classifyPhaseSkip(
  direction: unknown,
  elapsedInPhaseMs: unknown,
  pauseDurationMs: unknown,
): BehaviouralReading | null {
  if (direction === 'back' || direction === 'replay') {
    return { value: 1.8, weight: 0.8 }
  }
  if (direction === 'forward') {
    const elapsed = typeof elapsedInPhaseMs === 'number' ? elapsedInPhaseMs : Infinity
    const pauseDuration = typeof pauseDurationMs === 'number' ? pauseDurationMs : 0
    const fast = pauseDuration > 0 && elapsed < 0.4 * pauseDuration
    return fast ? { value: 0.3, weight: 0.6 } : { value: 0.6, weight: 0.4 }
  }
  return null
}

/** `tap_skip` (whole-cycle skip) mid-cycle only — the ambiguous avoidance/boredom read. */
export function classifyTapSkip(during: unknown): BehaviouralReading | null {
  return during === 'cycle' ? { value: 1.2, weight: 0.3 } : null
}

/** `lego_skip` back = struggle with the round's LEGO; forward = "got this / too easy". */
export function classifyLegoSkip(direction: unknown): BehaviouralReading | null {
  if (direction === 'back') return { value: 2.0, weight: 0.8 }
  if (direction === 'forward') return { value: 0.4, weight: 0.5 }
  return null
}

/** `tap_pause` mid-PAUSE followed by `tap_play` — processing time needed. */
export const TAP_PAUSE_THEN_PLAY_READING: BehaviouralReading = { value: 1.4, weight: 0.5 }

/** Manual controls (paper Principle 1) — the learner outranking the engine. Never enter a unit series. */
export const MANUAL_DIAL_EVENT_TYPES: ReadonlySet<string> = new Set(['turbo_toggle', 'belt_skip'])

/** Infrastructure, not learner evidence — logged for diagnostics, never evidence. */
export const DROPPED_EVENT_TYPES: ReadonlySet<string> = new Set(['audio_retry'])

// ---------------------------------------------------------------------------
// The stateful composable
// ---------------------------------------------------------------------------

export interface UseBehaviouralEvidenceReturn {
  /**
   * Call beside each `logEvent(type, payload)` site with the same payload
   * (or a superset carrying whatever extra field a mapping needs, e.g.
   * `phase` for `tap_pause`) plus the cycle in play, if any.
   */
  onPlayerEvent(type: string, payload: PlayerEventPayload, currentCycle?: PlayerEventCycle | null): void
  /** True once a manual-dial event has fired this session — widens the policy's dead-zone (§4.3). */
  isManualOverrideActive(): boolean
}

/**
 * @param sink Where evidence lands. This producer only ever holds the
 *   `EvidenceSink` interface — the caller decides which aggregator it is.
 * @param nowMs Injectable clock for tests; defaults to `performance.now()`.
 */
export function useBehaviouralEvidence(
  sink: EvidenceSink,
  nowMs: () => number = () => performance.now(),
): UseBehaviouralEvidenceReturn {
  let manualOverrideActive = false
  let pendingPause: { unitId: string; cycleId: string | undefined } | null = null

  function unitIdFor(payload: PlayerEventPayload, currentCycle?: PlayerEventCycle | null): string | null {
    const legoId = currentCycle?.legoId
      ?? (payload.legoId as string | null | undefined)
      ?? (payload.fromLegoId as string | null | undefined)
      ?? null
    return legoId ?? null
  }

  function emit(unitId: string | null, reading: BehaviouralReading, cycleId: string | undefined): void {
    if (!unitId) return
    sink.record({
      unitId,
      unitKind: 'lego',
      source: 'behaviour',
      value: reading.value,
      weight: reading.weight,
      cycleId,
      occurredAtMs: nowMs(),
    })
  }

  function onPlayerEvent(type: string, payload: PlayerEventPayload, currentCycle?: PlayerEventCycle | null): void {
    const unitId = unitIdFor(payload, currentCycle)
    const cycleId = currentCycle?.id ?? (payload.cycleId as string | undefined) ?? undefined

    switch (type) {
      case 'phase_skip': {
        const reading = classifyPhaseSkip(payload.direction, payload.elapsed_in_phase_ms, payload.pauseDuration)
        if (reading) emit(unitId, reading, cycleId)
        break
      }
      case 'tap_skip': {
        const reading = classifyTapSkip(payload.during)
        if (reading) emit(unitId, reading, cycleId)
        break
      }
      case 'lego_skip': {
        const reading = classifyLegoSkip(payload.direction)
        if (reading) emit(unitId, reading, cycleId)
        break
      }
      case 'tap_pause': {
        // Only a pause taken mid-PAUSE-phase is "processing time" evidence —
        // pausing during intro/welcome/pod-lap/commentary isn't learner struggle.
        pendingPause = payload.phase === 'speak' && unitId ? { unitId, cycleId } : null
        break
      }
      case 'tap_play': {
        if (pendingPause && pendingPause.unitId === unitId) {
          emit(pendingPause.unitId, TAP_PAUSE_THEN_PLAY_READING, pendingPause.cycleId)
        }
        pendingPause = null
        break
      }
      default: {
        if (MANUAL_DIAL_EVENT_TYPES.has(type)) {
          manualOverrideActive = true
        }
        // Everything else — 'audio_retry' (infrastructure) and any other
        // logged event type this producer doesn't (yet) read — is dropped.
        break
      }
    }
  }

  function isManualOverrideActive(): boolean {
    return manualOverrideActive
  }

  return { onPlayerEvent, isManualOverrideActive }
}
