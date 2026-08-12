// ============================================================================
// vadUptake.test.ts — the shaping the Voice & pause board depends on.
//
// The load-bearing property under test is HONESTY: learners with no row at all
// in the VAD-fed tables must be counted in the denominator and excluded from
// every average — never averaged in as zeros, never quietly dropped from the
// total. Half the demo estate is exactly that case.
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  buildScopes,
  summariseVad,
  latencyBins,
  median,
  type MetricRow,
  type ProsodyRow,
} from './vadUptake'

const metric = (learnerId: string, over: Partial<MetricRow> = {}): MetricRow => ({
  learner_id: learnerId,
  lego_id: 'S0001L01',
  course_code: 'gle_for_eng',
  mastery_state: 'confident',
  mean_latency_ms: 10,
  n_samples: 14,
  last_seen_at: '2026-08-04T03:22:31.489+00:00',
  ...over,
})

const prosody = (userId: string, over: Partial<ProsodyRow> = {}): ProsodyRow => ({
  user_id: userId,
  peakEnergyDb: -14,
  averageEnergyDb: -60,
  startedDuringPrompt: false,
  stillSpeakingAtVoice1: false,
  peakCount: 10,
  ...over,
})

describe('buildScopes — school → class → learner from the roster tables', () => {
  const schools = [
    { id: 'sch-1', school_name: 'Gaelscoil na Mara' },
    { id: 'sch-2', school_name: 'Empty School' },
  ]
  const classes = [
    { id: 'cls-a', class_name: 'Rang a Trí', school_id: 'sch-1', course_code: 'gle_for_eng' },
    { id: 'cls-b', class_name: 'Rang a Ceathair', school_id: 'sch-1', course_code: 'gle_for_eng' },
    { id: 'cls-empty', class_name: 'Nobody', school_id: 'sch-2', course_code: null },
  ]
  const learners = [
    { id: 'L1', user_id: 'auth-1', display_name: 'Saoirse' },
    { id: 'L2', user_id: 'auth-2', display_name: 'Lorcán' },
    { id: 'L3', user_id: 'auth-3', display_name: 'Niamh' },
  ]

  it('resolves CLASS: tags through learners.user_id to learners.id', () => {
    const scopes = buildScopes(schools, classes, [
      { user_id: 'auth-1', tag_value: 'CLASS:cls-a' },
      { user_id: 'auth-2', tag_value: 'CLASS:cls-a' },
      { user_id: 'auth-3', tag_value: 'CLASS:cls-b' },
    ], learners)

    expect(scopes).toHaveLength(1)                       // the empty school drops out
    expect(scopes[0].schoolName).toBe('Gaelscoil na Mara')
    expect(scopes[0].learnerIds.sort()).toEqual(['L1', 'L2', 'L3'])
    expect(scopes[0].classes.map(c => c.className)).toEqual(['Rang a Ceathair', 'Rang a Trí'])
  })

  it('counts a learner in two classes once at school level, twice at class level', () => {
    const scopes = buildScopes(schools, classes, [
      { user_id: 'auth-1', tag_value: 'CLASS:cls-a' },
      { user_id: 'auth-1', tag_value: 'CLASS:cls-b' },
    ], learners)
    expect(scopes[0].learnerIds).toEqual(['L1'])
    expect(scopes[0].classes).toHaveLength(2)
  })

  it('ignores tags pointing at unknown classes or unknown learners', () => {
    const scopes = buildScopes(schools, classes, [
      { user_id: 'auth-1', tag_value: 'CLASS:cls-gone' },
      { user_id: 'auth-ghost', tag_value: 'CLASS:cls-a' },
      { user_id: 'auth-2', tag_value: 'SCHOOL:sch-1' },
    ], learners)
    expect(scopes).toHaveLength(0)
  })
})

describe('summariseVad — uptake is the insight, not missing data', () => {
  const names = new Map([['L1', 'Saoirse'], ['L2', 'Lorcán'], ['L3', 'Niamh'], ['L4', 'Cara']])

  it('keeps the full roster as the denominator while averaging only over those with data', () => {
    const metrics = new Map<string, MetricRow[]>([
      ['L1', [metric('L1', { mean_latency_ms: 10 }), metric('L1', { mean_latency_ms: 20, mastery_state: 'mastered' })]],
      ['L2', [metric('L2', { mean_latency_ms: 30, mastery_state: 'acquisition' })]],
    ])
    const s = summariseVad(['L1', 'L2', 'L3', 'L4'], names, metrics, new Map())

    expect(s.total).toBe(4)
    expect(s.withData).toBe(2)
    expect(s.uptake).toBe(0.5)
    // L3/L4 contribute NOTHING — not a zero latency, not a mastery state, not a row.
    expect(s.learnerLatencies).toEqual([15, 30])
    expect(s.medianLatency).toBe(22.5)
    expect(s.mastery).toEqual({ acquisition: 1, consolidating: 0, confident: 1, mastered: 1 })
    expect(s.legoSeries).toBe(3)
    expect(s.learners.map(l => l.learnerId)).toEqual(['L1', 'L2'])
  })

  it('returns nulls, never NaN or 0, for a scope where nobody has data', () => {
    const s = summariseVad(['L3', 'L4'], names, new Map(), new Map())
    expect(s.total).toBe(2)
    expect(s.withData).toBe(0)
    expect(s.uptake).toBe(0)
    expect(s.medianLatency).toBeNull()
    expect(s.prosody.meanPeakEnergyDb).toBeNull()
    expect(s.prosody.startedDuringPromptRate).toBeNull()
    expect(s.learners).toEqual([])
  })

  it('returns a null uptake, not a divide-by-zero, for an empty roster', () => {
    const s = summariseVad([], names, new Map(), new Map())
    expect(s.uptake).toBeNull()
    expect(Number.isNaN(s.uptake as number)).toBe(false)
  })

  it('rates the prosody flags over the events that actually carry them', () => {
    const pros = new Map<string, ProsodyRow[]>([
      ['L1', [
        prosody('L1', { startedDuringPrompt: true, stillSpeakingAtVoice1: null }),
        prosody('L1', { startedDuringPrompt: false, stillSpeakingAtVoice1: true }),
        prosody('L1', { startedDuringPrompt: null, stillSpeakingAtVoice1: false }),
      ]],
    ])
    const s = summariseVad(['L1', 'L2'], names, new Map(), pros)
    expect(s.prosody.events).toBe(3)
    expect(s.prosody.startedDuringPromptBase).toBe(2)
    expect(s.prosody.startedDuringPromptRate).toBe(0.5)
    expect(s.prosody.stillSpeakingBase).toBe(2)
    expect(s.prosody.stillSpeakingRate).toBe(0.5)
    expect(s.withProsody).toBe(1)
  })

  it('drops null latencies rather than reading them as zero', () => {
    const metrics = new Map<string, MetricRow[]>([
      ['L1', [metric('L1', { mean_latency_ms: null }), metric('L1', { mean_latency_ms: 8 })]],
      ['L2', [metric('L2', { mean_latency_ms: null })]],
    ])
    const s = summariseVad(['L1', 'L2'], names, metrics, new Map())
    expect(s.learnerLatencies).toEqual([8])          // L2 has data but no usable latency
    expect(s.withData).toBe(2)
    expect(s.learners.find(l => l.learnerId === 'L2')?.meanLatency).toBeNull()
  })

  it('takes each learner\'s last_seen_at as the latest across their LEGOs', () => {
    const metrics = new Map<string, MetricRow[]>([
      ['L1', [
        metric('L1', { last_seen_at: '2026-08-01T00:00:00.000+00:00' }),
        metric('L1', { last_seen_at: '2026-08-05T00:00:00.000+00:00' }),
      ]],
    ])
    const s = summariseVad(['L1'], names, metrics, new Map())
    expect(s.learners[0].lastSeenAt).toBe('2026-08-05T00:00:00.000+00:00')
  })
})

describe('latencyBins / median', () => {
  it('returns no bins at all for an empty set, so the board can show its own empty state', () => {
    expect(latencyBins([])).toEqual([])
  })

  it('collapses a single-valued set into one bin rather than dividing by a zero range', () => {
    const bins = latencyBins([7, 7, 7])
    expect(bins).toHaveLength(1)
    expect(bins[0].count).toBe(3)
  })

  it('puts the maximum in the last bin, not off the end', () => {
    const bins = latencyBins([0, 1, 2, 3, 4, 5, 6, 7, 8], 4)
    expect(bins).toHaveLength(4)
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(9)
    expect(bins[3].count).toBeGreaterThan(0)
  })

  it('medians an even and an odd set', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})
