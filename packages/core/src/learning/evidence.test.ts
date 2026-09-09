import { describe, it, expect } from 'vitest';
import { createEvidenceAggregator, EVIDENCE_SERIES_RING_CAP, type MasteryEvidence } from './evidence';

const ev = (overrides: Partial<MasteryEvidence> = {}): MasteryEvidence => ({
  unitId: 'S0001L01',
  unitKind: 'lego',
  source: 'latency',
  value: 1,
  weight: 1,
  occurredAtMs: 0,
  ...overrides,
});

describe('EvidenceAggregator', () => {
  it('starts empty for an unknown unit', () => {
    const agg = createEvidenceAggregator();
    expect(agg.getSeries('nope')).toEqual({ values: [], x: [] });
    expect(agg.readyUnits(1)).toEqual([]);
  });

  it('appends across-cycle evidence in time order', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ value: 1, cycleId: 'c1', occurredAtMs: 100 }));
    agg.record(ev({ value: 2, cycleId: 'c2', occurredAtMs: 200 }));
    agg.record(ev({ value: 3, cycleId: 'c3', occurredAtMs: 300 }));

    expect(agg.getSeries('S0001L01')).toEqual({ values: [1, 2, 3], x: [100, 200, 300] });
  });

  it('collapses same-cycle evidence to one weighted-merge sample', () => {
    const agg = createEvidenceAggregator();
    // Two observations in the same cycle: value=0.3/weight=0.6, value=1.8/weight=0.8.
    agg.record(ev({ value: 0.3, weight: 0.6, cycleId: 'c1', occurredAtMs: 100 }));
    agg.record(ev({ value: 1.8, weight: 0.8, cycleId: 'c1', occurredAtMs: 110 }));

    const expected = (0.3 * 0.6 + 1.8 * 0.8) / (0.6 + 0.8);
    const series = agg.getSeries('S0001L01');
    expect(series.values).toHaveLength(1);
    expect(series.values[0]).toBeCloseTo(expected, 10);
    // Collapsed sample carries the latest occurrence in the cycle.
    expect(series.x[0]).toBe(110);
  });

  it('collapses three-way same-cycle evidence correctly (weighted merge is associative)', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ value: 1, weight: 1, cycleId: 'c1', occurredAtMs: 0 }));
    agg.record(ev({ value: 2, weight: 1, cycleId: 'c1', occurredAtMs: 1 }));
    agg.record(ev({ value: 3, weight: 2, cycleId: 'c1', occurredAtMs: 2 }));

    const expected = (1 * 1 + 2 * 1 + 3 * 2) / (1 + 1 + 2);
    expect(agg.getSeries('S0001L01').values[0]).toBeCloseTo(expected, 10);
  });

  it('does not collapse evidence with no cycleId, even back to back', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ value: 1, cycleId: undefined, occurredAtMs: 0 }));
    agg.record(ev({ value: 2, cycleId: undefined, occurredAtMs: 1 }));

    expect(agg.getSeries('S0001L01').values).toEqual([1, 2]);
  });

  it('keeps separate units independent', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ unitId: 'A', value: 1, cycleId: 'c1', occurredAtMs: 0 }));
    agg.record(ev({ unitId: 'B', value: 9, cycleId: 'c1', occurredAtMs: 0 }));

    expect(agg.getSeries('A').values).toEqual([1]);
    expect(agg.getSeries('B').values).toEqual([9]);
  });

  it('caps each unit series at the ring size, dropping the oldest', () => {
    const agg = createEvidenceAggregator();
    const total = EVIDENCE_SERIES_RING_CAP + 5;
    for (let i = 0; i < total; i++) {
      agg.record(ev({ value: i, cycleId: `c${i}`, occurredAtMs: i }));
    }

    const series = agg.getSeries('S0001L01');
    expect(series.values).toHaveLength(EVIDENCE_SERIES_RING_CAP);
    // Oldest 5 (0..4) dropped; series starts at 5.
    expect(series.values[0]).toBe(5);
    expect(series.values[series.values.length - 1]).toBe(total - 1);
  });

  it('reports readyUnits at the requested minSamples threshold', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ unitId: 'A', cycleId: 'c1', occurredAtMs: 0 }));
    agg.record(ev({ unitId: 'A', cycleId: 'c2', occurredAtMs: 1 }));
    agg.record(ev({ unitId: 'B', cycleId: 'c1', occurredAtMs: 0 }));

    expect(agg.readyUnits(2)).toEqual(['A']);
    expect(agg.readyUnits(1).sort()).toEqual(['A', 'B']);
    expect(agg.readyUnits(3)).toEqual([]);
  });

  it('round-trips through snapshot/hydrate', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ unitId: 'A', value: 1, cycleId: 'c1', occurredAtMs: 0 }));
    agg.record(ev({ unitId: 'A', value: 2, cycleId: 'c2', occurredAtMs: 1 }));
    agg.record(ev({ unitId: 'B', value: 5, cycleId: 'c1', occurredAtMs: 0 }));

    const snap = agg.snapshot();

    const rehydrated = createEvidenceAggregator();
    rehydrated.hydrate(snap);

    expect(rehydrated.getSeries('A')).toEqual(agg.getSeries('A'));
    expect(rehydrated.getSeries('B')).toEqual(agg.getSeries('B'));
  });

  it('hydrate seeds a series that further evidence appends onto', () => {
    const agg = createEvidenceAggregator();
    agg.hydrate(new Map([['A', { values: [1, 2], x: [0, 1] }]]));
    agg.record(ev({ unitId: 'A', value: 3, cycleId: 'c3', occurredAtMs: 2 }));

    expect(agg.getSeries('A')).toEqual({ values: [1, 2, 3], x: [0, 1, 2] });
  });

  it('snapshot returns a defensive copy — mutating it does not affect the aggregator', () => {
    const agg = createEvidenceAggregator();
    agg.record(ev({ value: 1, cycleId: 'c1', occurredAtMs: 0 }));

    const snap = agg.snapshot();
    snap.get('S0001L01')!.values.push(999);

    expect(agg.getSeries('S0001L01').values).toEqual([1]);
  });
});

describe('acceptance test — a second producer plugs in with zero scheduler changes', () => {
  // Simulates WP-1 (behavioural) and a stand-in for WP-8 (envelope) as two
  // independent producers writing through the SAME EvidenceSink interface.
  // The "scheduler" here is just readyUnits/getSeries — it never branches on
  // `source`, proving the wire is genuinely producer-agnostic.
  it('mixes behaviour and envelope evidence into one merged series the scheduler reads uniformly', () => {
    const agg = createEvidenceAggregator();

    // Stage-1 style producer.
    agg.record({
      unitId: 'S0010L02',
      unitKind: 'lego',
      source: 'behaviour',
      value: 1.8,
      weight: 0.8,
      cycleId: 'c1',
      occurredAtMs: 1000,
    });

    // Stage-2 style producer plugging into the identical sink, no code changes
    // to EvidenceAggregator or its interface required.
    agg.record({
      unitId: 'S0010L02',
      unitKind: 'lego',
      source: 'envelope',
      value: 0.9,
      weight: 0.8,
      cycleId: 'c2',
      occurredAtMs: 2000,
    });

    expect(agg.readyUnits(2)).toContain('S0010L02');
    const series = agg.getSeries('S0010L02');
    expect(series.values).toEqual([1.8, 0.9]);
    expect(series.x).toEqual([1000, 2000]);
  });
});
