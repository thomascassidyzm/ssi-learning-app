// ============================================================================
// vadScope.test.ts — the hierarchy-scoped VAD read, client side.
//
// The property under test is HIDE, DON'T ZERO surviving the wire. The server
// sends the FULL roster and only the metric rows that exist; a learner with no
// rows must arrive on the roster and in no map, so summariseVad still reports
// the honest N-of-M. A regression that filled the gap with zeros would show up
// here as withData === total.
//
// Also asserts the failure vocabulary: a 403 is a REAL answer (you are outside
// this scope) and must not be indistinguishable from a network gap.
// ============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import { adaptVadScopePayload, fetchVadScope } from './vadScope'
import { summariseVad } from './vadUptake'

const wire = {
  scope: {
    kind: 'group' as const,
    id: 'g-prog',
    label: 'IME Demo Programme',
    // THREE on the roster; only two have any data.
    learnerIds: ['L1', 'L2', 'L3'],
    classes: [
      { classId: 'c1', className: 'Class One', courseCode: 'cym_for_eng', learnerIds: ['L1', 'L2'] },
      { classId: 'c2', className: 'Class Two', courseCode: 'cym_for_eng', learnerIds: ['L3'] },
    ],
  },
  names: { L1: 'Asha', L2: 'Bina', L3: 'Chandra' },
  metrics: [
    { learner_id: 'L1', lego_id: 'S0001L01', course_code: 'cym_for_eng', mastery_state: 'mastered', mean_latency_ms: 12, n_samples: 4, last_seen_at: '2026-08-18T10:00:00Z' },
    { learner_id: 'L1', lego_id: 'S0001L02', course_code: 'cym_for_eng', mastery_state: 'confident', mean_latency_ms: 20, n_samples: 3, last_seen_at: '2026-08-19T10:00:00Z' },
    { learner_id: 'L3', lego_id: 'S0002L01', course_code: 'cym_for_eng', mastery_state: 'acquisition', mean_latency_ms: 40, n_samples: 2, last_seen_at: '2026-08-19T11:00:00Z' },
  ],
  prosody: {
    L1: {
      events: 5,
      peakEnergyDbSum: -50, peakEnergyDbBase: 5,
      averageEnergyDbSum: -300, averageEnergyDbBase: 5,
      peakCountSum: 40, peakCountBase: 5,
      startedDuringPrompt: 1, startedDuringPromptBase: 5,
      stillSpeakingAtVoice1: 2, stillSpeakingAtVoice1Base: 5,
    },
  },
  prosodyAvailable: true,
  truncated: false,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('adaptVadScopePayload', () => {
  it('keeps the full roster and maps only the rows that exist', () => {
    const p = adaptVadScopePayload(wire)
    expect(p.scope.learnerIds).toEqual(['L1', 'L2', 'L3'])
    expect([...p.metricsByLearner.keys()].sort()).toEqual(['L1', 'L3'])
    expect(p.metricsByLearner.has('L2')).toBe(false)      // absent, NOT an empty array
    expect(p.names.get('L2')).toBe('Bina')                 // still named on the roster
  })

  it('feeds summariseVad an honest denominator — 2 of 3, never 2 of 2', () => {
    const p = adaptVadScopePayload(wire)
    const s = summariseVad(p.scope.learnerIds, p.names, p.metricsByLearner, p.prosodyByLearner, p.prosodyAvailable)
    expect(s.total).toBe(3)
    expect(s.withData).toBe(2)
    expect(s.uptake).toBeCloseTo(2 / 3)
    // The learner with nothing produces no row and no phantom zero.
    expect(s.learners.map(l => l.learnerId).sort()).toEqual(['L1', 'L3'])
    expect(s.learnerLatencies).toHaveLength(2)
  })

  it('carries prosody bases through, so every mean states what it was taken over', () => {
    const p = adaptVadScopePayload(wire)
    const s = summariseVad(p.scope.learnerIds, p.names, p.metricsByLearner, p.prosodyByLearner)
    expect(s.withProsody).toBe(1)
    expect(s.prosody.events).toBe(5)
    expect(s.prosody.meanPeakEnergyDb).toBe(-10)
    expect(s.prosody.startedDuringPromptBase).toBe(5)
    expect(s.prosody.stillSpeakingRate).toBeCloseTo(0.4)
  })

  it('reports a scope with a roster and no data at all as 0 of N, with null aggregates', () => {
    const p = adaptVadScopePayload({ ...wire, metrics: [], prosody: {} })
    const s = summariseVad(p.scope.learnerIds, p.names, p.metricsByLearner, p.prosodyByLearner)
    expect(s.total).toBe(3)
    expect(s.withData).toBe(0)
    expect(s.medianLatency).toBeNull()                     // never NaN, never 0
    expect(s.prosody.meanPeakEnergyDb).toBeNull()
    expect(s.learners).toEqual([])
  })

  it('defaults a missing prosodyAvailable to true and a missing truncated to false', () => {
    const p = adaptVadScopePayload({ ...wire, prosodyAvailable: undefined as never, truncated: undefined as never })
    expect(p.prosodyAvailable).toBe(true)
    expect(p.truncated).toBe(false)
  })
})

describe('fetchVadScope', () => {
  it('asks for the right scope on the right query parameter', async () => {
    const seen: [string, { headers?: Record<string, string> }][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers?: Record<string, string> }) => {
      seen.push([url, init])
      return { ok: true, status: 200, json: async () => wire }
    }))
    await fetchVadScope({ groupId: 'g-prog' }, 'tok')
    expect(seen[0][0]).toBe('/api/org/vad?groupId=g-prog')
    expect(seen[0][1]).toMatchObject({ headers: { Authorization: 'Bearer tok' } })

    await fetchVadScope({ classId: 'c1' }, null)
    expect(seen[1][0]).toBe('/api/org/vad?classId=c1')
    await fetchVadScope({ learnerId: 'L1' }, null)
    expect(seen[2][0]).toBe('/api/org/vad?learnerId=L1')
  })

  it('turns a 403 into an out-of-scope message, distinct from a server failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'nope' }) })))
    await expect(fetchVadScope({ groupId: 'g-x' })).rejects.toThrow(/do not have access/i)

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })))
    await expect(fetchVadScope({ groupId: 'g-x' })).rejects.toThrow('boom')
  })
})
