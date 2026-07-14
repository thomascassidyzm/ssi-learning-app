import { describe, expect, it, vi } from 'vitest'
import type { EvidenceSink, MasteryEvidence } from '@ssi/core'
import { ENVELOPE_EXTRACTOR_CONSTANTS, type EnvelopeMetadata } from '@ssi/core'
import {
  computeEnvelopeDelta,
  recordEnvelopeEvidence,
  DEFAULT_ENVELOPE_DELTA_WEIGHTS,
  ENVELOPE_EVIDENCE_WEIGHT,
} from './useEnvelopeEvidence'
import type { EnvelopeMetadataCache, ModelEnvelopeRow } from './useEnvelopeMetadataCache'

const learnerEnvelope = (overrides: Partial<EnvelopeMetadata> = {}): EnvelopeMetadata => ({
  durationMs: 900,
  peakCount: 3,
  peakToMeanRatio: 2.0,
  meanPeakWidthMs: 120,
  sampleCount: 40,
  weight: 1,
  ...overrides,
})

const modelRow = (overrides: Partial<ModelEnvelopeRow> = {}): ModelEnvelopeRow => ({
  audioId: 'a1',
  durationMs: 900,
  peakCount: 3,
  peakToMeanRatio: 2.0,
  meanPeakWidthMs: 120,
  extractorVersion: ENVELOPE_EXTRACTOR_CONSTANTS.version,
  ...overrides,
})

function fakeCache(rows: Record<string, ModelEnvelopeRow | null>): EnvelopeMetadataCache {
  return {
    fetchBatch: vi.fn().mockResolvedValue(undefined),
    get: (audioId: string) => rows[audioId],
  }
}

function fakeSink(): EvidenceSink & { events: MasteryEvidence[] } {
  const events: MasteryEvidence[] = []
  return { events, record: (e) => events.push(e) }
}

describe('computeEnvelopeDelta', () => {
  it('is 0 when learner and model envelopes are identical', () => {
    const delta = computeEnvelopeDelta(learnerEnvelope(), modelRow())
    expect(delta.value).toBe(0)
    expect(delta.dDur).toBe(0)
    expect(delta.dPeaks).toBe(0)
    expect(delta.dShape).toBe(0)
  })

  it('weights duration most heavily — the paper\'s 2.5x-length example', () => {
    // Learner takes 2.5x as long as the model, everything else matches.
    const delta = computeEnvelopeDelta(learnerEnvelope({ durationMs: 2250 }), modelRow({ durationMs: 900 }))
    expect(delta.dDur).toBeCloseTo(1.5, 5) // |2250-900|/900
    expect(delta.value).toBeCloseTo(DEFAULT_ENVELOPE_DELTA_WEIGHTS.duration * 1.5, 5)
  })

  it('computes d_peaks as the normalized absolute peak-count difference', () => {
    const delta = computeEnvelopeDelta(learnerEnvelope({ peakCount: 1 }), modelRow({ peakCount: 3 }))
    expect(delta.dPeaks).toBeCloseTo(2 / 3, 5)
  })

  it('computes d_shape as the sum of two log-ratio terms', () => {
    const delta = computeEnvelopeDelta(
      learnerEnvelope({ peakToMeanRatio: 4, meanPeakWidthMs: 60 }),
      modelRow({ peakToMeanRatio: 2, meanPeakWidthMs: 120 }),
    )
    // |log(4/2)| + |log(60/120)| = log(2) + log(2)
    expect(delta.dShape).toBeCloseTo(2 * Math.log(2), 5)
  })

  it('guards the zero-peak degenerate case instead of producing Infinity/NaN', () => {
    const delta = computeEnvelopeDelta(
      learnerEnvelope({ peakCount: 0, peakToMeanRatio: 0, meanPeakWidthMs: 0 }),
      modelRow(),
    )
    expect(Number.isFinite(delta.value)).toBe(true)
    expect(Number.isNaN(delta.value)).toBe(false)
  })

  it('respects custom weights', () => {
    const delta = computeEnvelopeDelta(learnerEnvelope({ durationMs: 1800 }), modelRow(), {
      duration: 1,
      peaks: 0,
      shape: 0,
    })
    expect(delta.value).toBeCloseTo(delta.dDur, 5)
  })
})

describe('recordEnvelopeEvidence', () => {
  const baseArgs = {
    legoId: 'lego-1',
    audioId: 'a1',
    cycleId: 'cycle-1',
    occurredAtMs: 1000,
  }

  it('emits one MasteryEvidence(source:envelope) when both sides are present and comparable', () => {
    const sink = fakeSink()
    const cache = fakeCache({ a1: modelRow() })

    const evidence = recordEnvelopeEvidence({
      ...baseArgs,
      sink,
      cache,
      learnerEnvelope: learnerEnvelope(),
    })

    expect(evidence).not.toBeNull()
    expect(sink.events).toHaveLength(1)
    expect(sink.events[0]).toMatchObject({
      unitId: 'lego-1',
      unitKind: 'lego',
      source: 'envelope',
      weight: ENVELOPE_EVIDENCE_WEIGHT,
      cycleId: 'cycle-1',
      occurredAtMs: 1000,
    })
  })

  it('no-ops when there is no learner envelope (no mic, or capture never happened)', () => {
    const sink = fakeSink()
    const cache = fakeCache({ a1: modelRow() })

    const evidence = recordEnvelopeEvidence({ ...baseArgs, sink, cache, learnerEnvelope: undefined })

    expect(evidence).toBeNull()
    expect(sink.events).toHaveLength(0)
  })

  it('no-ops when the capture-quality gate discarded the cycle (weight 0)', () => {
    const sink = fakeSink()
    const cache = fakeCache({ a1: modelRow() })

    const evidence = recordEnvelopeEvidence({
      ...baseArgs,
      sink,
      cache,
      learnerEnvelope: learnerEnvelope({ weight: 0 }),
    })

    expect(evidence).toBeNull()
    expect(sink.events).toHaveLength(0)
  })

  it('no-ops when the course has no model row for this audio id yet (null)', () => {
    const sink = fakeSink()
    const cache = fakeCache({ a1: null })

    const evidence = recordEnvelopeEvidence({ ...baseArgs, sink, cache, learnerEnvelope: learnerEnvelope() })

    expect(evidence).toBeNull()
    expect(sink.events).toHaveLength(0)
  })

  it('no-ops when the model row has not been fetched yet (undefined)', () => {
    const sink = fakeSink()
    const cache = fakeCache({})

    const evidence = recordEnvelopeEvidence({ ...baseArgs, sink, cache, learnerEnvelope: learnerEnvelope() })

    expect(evidence).toBeNull()
    expect(sink.events).toHaveLength(0)
  })

  it('no-ops on extractor_version mismatch — sides used different pinned constants', () => {
    const sink = fakeSink()
    const cache = fakeCache({ a1: modelRow({ extractorVersion: ENVELOPE_EXTRACTOR_CONSTANTS.version + 1 }) })

    const evidence = recordEnvelopeEvidence({ ...baseArgs, sink, cache, learnerEnvelope: learnerEnvelope() })

    expect(evidence).toBeNull()
    expect(sink.events).toHaveLength(0)
  })
})
