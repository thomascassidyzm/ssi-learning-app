/**
 * Tests for WP-1: behavioural evidence producers.
 *
 * Asserts the mapping table in `docs/adaptation/adaptation-v2-build-spec.md`
 * §3 against a fake EvidenceSink — one event in, one (or zero) evidence
 * records out, exact value/weight.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { EvidenceSink, MasteryEvidence } from '@ssi/core'
import {
  useBehaviouralEvidence,
  classifyPhaseSkip,
  classifyTapSkip,
  classifyLegoSkip,
  TAP_PAUSE_THEN_PLAY_READING,
  MANUAL_DIAL_EVENT_TYPES,
  DROPPED_EVENT_TYPES,
} from './useBehaviouralEvidence'

function fakeSink(): { sink: EvidenceSink; recorded: MasteryEvidence[] } {
  const recorded: MasteryEvidence[] = []
  return { sink: { record: (e) => recorded.push(e) }, recorded }
}

const CYCLE = { id: 'cyc-1', legoId: 'S0010L02' }

describe('pure classifiers', () => {
  it('phase_skip forward + fast (<40% of pause) reads as confident', () => {
    expect(classifyPhaseSkip('forward', 400, 2000)).toEqual({ value: 0.3, weight: 0.6 })
  })

  it('phase_skip forward + slow (>=40% of pause) reads as mild confidence', () => {
    expect(classifyPhaseSkip('forward', 1200, 2000)).toEqual({ value: 0.6, weight: 0.4 })
  })

  it('phase_skip back reads as uncertainty', () => {
    expect(classifyPhaseSkip('back', 100, 2000)).toEqual({ value: 1.8, weight: 0.8 })
  })

  it('phase_skip replay reads as uncertainty', () => {
    expect(classifyPhaseSkip('replay', 100, 2000)).toEqual({ value: 1.8, weight: 0.8 })
  })

  it('tap_skip mid-cycle is the ambiguous avoidance/boredom read', () => {
    expect(classifyTapSkip('cycle')).toEqual({ value: 1.2, weight: 0.3 })
  })

  it('tap_skip during intro/pod_lap/commentary/welcome is not evidence', () => {
    expect(classifyTapSkip('intro')).toBeNull()
    expect(classifyTapSkip('pod_lap')).toBeNull()
    expect(classifyTapSkip('commentary')).toBeNull()
    expect(classifyTapSkip('welcome')).toBeNull()
    expect(classifyTapSkip('l1_cluster')).toBeNull()
  })

  it('lego_skip back is struggle with the round', () => {
    expect(classifyLegoSkip('back')).toEqual({ value: 2.0, weight: 0.8 })
  })

  it('lego_skip forward is "got this / too easy"', () => {
    expect(classifyLegoSkip('forward')).toEqual({ value: 0.4, weight: 0.5 })
  })
})

describe('useBehaviouralEvidence — event → evidence mapping', () => {
  let clock: number
  const nowMs = () => clock

  beforeEach(() => { clock = 1000 })

  it('phase_skip emits one evidence record attached to the cycle legoId', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('phase_skip', { direction: 'back', elapsed_in_phase_ms: 500, pauseDuration: 2000 }, CYCLE)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      unitId: 'S0010L02',
      unitKind: 'lego',
      source: 'behaviour',
      value: 1.8,
      weight: 0.8,
      cycleId: 'cyc-1',
      occurredAtMs: 1000,
    })
  })

  it('tap_skip during a cycle emits; during intro does not', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_skip', { during: 'cycle' }, CYCLE)
    be.onPlayerEvent('tap_skip', { during: 'intro' }, CYCLE)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ value: 1.2, weight: 0.3 })
  })

  it('lego_skip forward/back both emit, keyed off fromLegoId when no current cycle', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('lego_skip', { direction: 'back', fromLegoId: 'S0009L01' }, null)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ unitId: 'S0009L01', value: 2.0, weight: 0.8 })
  })

  it('tap_pause mid-PAUSE then tap_play emits "processing time needed"', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_pause', { phase: 'speak' }, CYCLE)
    be.onPlayerEvent('tap_play', {}, CYCLE)
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({
      unitId: 'S0010L02',
      value: TAP_PAUSE_THEN_PLAY_READING.value,
      weight: TAP_PAUSE_THEN_PLAY_READING.weight,
    })
  })

  it('tap_pause outside PAUSE phase (e.g. intro) followed by tap_play emits nothing', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_pause', { phase: 'prompt' }, CYCLE)
    be.onPlayerEvent('tap_play', {}, CYCLE)
    expect(recorded).toHaveLength(0)
  })

  it('tap_play with no preceding tap_pause emits nothing', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_play', {}, CYCLE)
    expect(recorded).toHaveLength(0)
  })

  it('a tap_pause/tap_play pair on a different LEGO than it was raised on does not correlate', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_pause', { phase: 'speak' }, CYCLE)
    be.onPlayerEvent('tap_play', {}, { id: 'cyc-2', legoId: 'S0011L01' })
    expect(recorded).toHaveLength(0)
  })

  it('a second tap_pause supersedes a stale pending one', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_pause', { phase: 'speak' }, CYCLE)
    be.onPlayerEvent('tap_pause', { phase: 'prompt' }, CYCLE) // overwrites — not mid-PAUSE
    be.onPlayerEvent('tap_play', {}, CYCLE)
    expect(recorded).toHaveLength(0)
  })

  it('dropped event types (audio_retry) never emit evidence', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    for (const type of DROPPED_EVENT_TYPES) {
      be.onPlayerEvent(type, { reason: 'play-error' }, CYCLE)
    }
    expect(recorded).toHaveLength(0)
  })

  it('manual-dial events (mode_toggle, belt_skip) never enter a unit series but set the override flag', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    expect(be.isManualOverrideActive()).toBe(false)
    for (const type of MANUAL_DIAL_EVENT_TYPES) {
      be.onPlayerEvent(type, { enabled: true }, CYCLE)
    }
    expect(recorded).toHaveLength(0)
    expect(be.isManualOverrideActive()).toBe(true)
  })

  it('unrecognised event types are silently ignored', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('cold_start', {}, CYCLE)
    be.onPlayerEvent('round_complete', {}, CYCLE)
    expect(recorded).toHaveLength(0)
  })

  it('no unitId resolvable (no cycle, no legoId in payload) drops the event', () => {
    const { sink, recorded } = fakeSink()
    const be = useBehaviouralEvidence(sink, nowMs)
    be.onPlayerEvent('tap_skip', { during: 'cycle' }, null)
    expect(recorded).toHaveLength(0)
  })
})
