/**
 * Envelope delta producer (adaptation v2, workstream C — WP-8).
 *
 * Per cycle with BOTH a learner envelope capture and a model envelope row
 * present, computes the learner-vs-model delta vector (spec §5.3) and emits
 * one `MasteryEvidence` (`source:'envelope'`) into the evidence stream
 * (`@ssi/core` `learning/evidence.ts`, WP-0) — the same wire WP-1's
 * behavioural producer feeds. Per-LEGO cross-phrase correlation (owner
 * decision C, the second-differential fitness function) falls out of the
 * aggregator for free once every phrase sharing a LEGO emits to the same
 * `unitId`; this module's only job is one faithful per-cycle delta.
 *
 * `docs/adaptation/adaptation-v2-build-spec.md` §5.3 is the design authority;
 * all weights are PROPOSED (config-tunable later, same as WP-1's mapping
 * table).
 *
 * Like `useBehaviouralEvidence`, this module holds only the `EvidenceSink`
 * interface — it has no opinion on where the evidence ends up or when it's
 * called (WP-3's job: register a hook in the cycle-complete path next to
 * `recordCycle`). NOT wired into `useAdaptationEngine.ts` /
 * `LearningPlayer.vue` here — see the TODO at the bottom of this file.
 */

import type { EvidenceSink, MasteryEvidence } from '@ssi/core'
import { ENVELOPE_EXTRACTOR_CONSTANTS, type EnvelopeMetadata } from '@ssi/core'
import type { EnvelopeMetadataCache, ModelEnvelopeRow } from './useEnvelopeMetadataCache'

/** §5.3 PROPOSED weights: duration carries the most fluency signal (the paper's 2.5×-length example). */
export interface EnvelopeDeltaWeights {
  duration: number
  peaks: number
  shape: number
}

export const DEFAULT_ENVELOPE_DELTA_WEIGHTS: EnvelopeDeltaWeights = {
  duration: 0.5,
  peaks: 0.3,
  shape: 0.2,
}

/** §5.3 PROPOSED producer confidence for every envelope evidence event. */
export const ENVELOPE_EVIDENCE_WEIGHT = 0.8

export interface EnvelopeDelta {
  /** The combined, weighted MasteryEvidence value. */
  value: number
  dDur: number
  dPeaks: number
  dShape: number
}

/**
 * `log(a/b)`, guarded against the zero-peak case (a silent/undetected side
 * has `peakToMeanRatio`/`meanPeakWidthMs` of 0 — a genuine ratio there is
 * undefined, not "infinitely different"). Spec §5.3 doesn't address this
 * directly; treating it as "no shape signal from this term" rather than
 * ±Infinity keeps one degenerate side from swamping the whole delta.
 */
function safeLogRatio(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0
  return Math.abs(Math.log(a / b))
}

/** Pure delta math (spec §5.3, exact formula) — independently testable. */
export function computeEnvelopeDelta(
  learner: EnvelopeMetadata,
  model: ModelEnvelopeRow,
  weights: EnvelopeDeltaWeights = DEFAULT_ENVELOPE_DELTA_WEIGHTS,
): EnvelopeDelta {
  const dDur = model.durationMs > 0 ? Math.abs(learner.durationMs - model.durationMs) / model.durationMs : 0
  const dPeaks = Math.abs(learner.peakCount - model.peakCount) / Math.max(model.peakCount, 1)
  const dShape =
    safeLogRatio(learner.peakToMeanRatio, model.peakToMeanRatio) +
    safeLogRatio(learner.meanPeakWidthMs, model.meanPeakWidthMs)

  return {
    value: weights.duration * dDur + weights.peaks * dPeaks + weights.shape * dShape,
    dDur,
    dPeaks,
    dShape,
  }
}

export interface RecordEnvelopeEvidenceArgs {
  sink: EvidenceSink
  cache: EnvelopeMetadataCache
  /** The cycle's LEGO id — evidence attaches to the ownership axis, same as WP-1. */
  legoId: string
  /** The cycle's target1 audio id — the key `course_audio_envelope` is keyed on. */
  audioId: string
  /** `SpeechTimingResult.envelope` from the VAD (WP-6) — undefined/weight-0 means no usable capture. */
  learnerEnvelope: EnvelopeMetadata | undefined
  cycleId?: string
  occurredAtMs: number
  weights?: EnvelopeDeltaWeights
}

/**
 * Compute the delta and emit one `MasteryEvidence` into `sink`, or no-op
 * (returns `null`) when either side is unusable:
 *  - no learner capture, or the capture-quality gate discarded it (`weight 0`)
 *  - no model row yet for this audio id (course without envelope data, or the
 *    cache hasn't fetched/found it — `undefined`/`null` both no-op)
 *  - `extractor_version` mismatch — the two sides used different pinned
 *    constants, so the numbers aren't comparable; skip rather than compare
 *    apples to oranges.
 */
export function recordEnvelopeEvidence(args: RecordEnvelopeEvidenceArgs): MasteryEvidence | null {
  const { sink, cache, legoId, audioId, learnerEnvelope, cycleId, occurredAtMs, weights } = args

  if (!learnerEnvelope || learnerEnvelope.weight <= 0) return null

  const model = cache.get(audioId)
  if (!model) return null

  if (model.extractorVersion !== ENVELOPE_EXTRACTOR_CONSTANTS.version) return null

  const delta = computeEnvelopeDelta(learnerEnvelope, model, weights)

  const evidence: MasteryEvidence = {
    unitId: legoId,
    unitKind: 'lego',
    source: 'envelope',
    value: delta.value,
    weight: ENVELOPE_EVIDENCE_WEIGHT,
    cycleId,
    occurredAtMs,
  }
  sink.record(evidence)
  return evidence
}

// TODO(WP-3): register `recordEnvelopeEvidence` in the cycle-complete path
// next to `useAdaptationEngine.recordCycle`, once WP-3 exposes the aggregator
// as an `EvidenceSink` and `useEnvelopeMetadataCache.fetchBatch` is called
// with the round's target1 audio ids. Not touched here — WP-3 is a
// concurrent worker's file (see build-spec dependency table).
