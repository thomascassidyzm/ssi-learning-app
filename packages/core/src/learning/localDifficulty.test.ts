import { describe, it, expect } from 'vitest';
import {
  assessLocalDifficulty,
  rankLocalDifficulty,
  type UnitSeries,
} from './localDifficulty';

// A long quiet stretch (faint drift) then a sharp upward break = a developing
// struggle on a "higher = harder" metric.
const struggling = (id: string): UnitSeries => ({
  unitId: id,
  values: [...Array.from({ length: 16 }, (_, x) => 2.5 + 0.01 * x), 2.9, 3.6, 4.6, 6.0],
});

// Sharp break downward = a struggle easing.
const easing = (id: string): UnitSeries => ({
  unitId: id,
  values: [...Array.from({ length: 16 }, (_, x) => 6.0 - 0.01 * x), 5.6, 4.9, 3.9, 2.5],
});

// A steady (even if sloped) unit never flags.
const steady = (id: string): UnitSeries => ({
  unitId: id,
  values: Array.from({ length: 20 }, (_, x) => 2.0 + 0.05 * x),
});

describe('assessLocalDifficulty', () => {
  it('reads warming_up below the min-cycle gate', () => {
    const d = assessLocalDifficulty({ unitId: 'L1', values: [1, 2, 3] }, { minSamples: 5 });
    expect(d.state).toBe('warming_up');
    expect(d.curvature).toBeNull();
    expect(d.samples).toBe(0);
  });

  it('flags a developing struggle as struggling (positive acceleration)', () => {
    const d = assessLocalDifficulty(struggling('L1'), { window: 6, threshold: 2 });
    expect(d.state).toBe('struggling');
    expect(d.flagged).toBe(true);
    expect(d.curvature!.acceleration).toBeGreaterThan(0);
    expect(d.accelerationZ).not.toBeNull();
  });

  it('reads a resolving struggle as easing (negative acceleration)', () => {
    const d = assessLocalDifficulty(easing('L1'), { window: 6, threshold: 2 });
    expect(d.state).toBe('easing');
    expect(d.flagged).toBe(true);
    expect(d.curvature!.acceleration).toBeLessThan(0);
  });

  it('reads a steady (even if sloped) unit as steady, never flagged', () => {
    const d = assessLocalDifficulty(steady('L1'));
    expect(d.state).toBe('steady');
    expect(d.flagged).toBe(false);
  });

  it('passes through unitId and unitKind', () => {
    const d = assessLocalDifficulty({ unitId: 'b:L1|L2', unitKind: 'boundary', values: steady('x').values });
    expect(d.unitId).toBe('b:L1|L2');
    expect(d.unitKind).toBe('boundary');
  });

  it('honours explicit x spacing', () => {
    const values = steady('x').values;
    const xs = values.map((_, i) => i * 2); // uneven-but-monotone clock
    const d = assessLocalDifficulty({ unitId: 'L1', values, x: xs });
    expect(d.state).toBe('steady');
  });
});

describe('rankLocalDifficulty', () => {
  it('orders struggling units ahead of steady, and warming-up last', () => {
    const ranked = rankLocalDifficulty(
      [steady('calm'), { unitId: 'new', values: [1, 2, 3] }, struggling('hot')],
      { window: 6, threshold: 2, minSamples: 5 }
    );
    expect(ranked.map((r) => r.unitId)).toEqual(['hot', 'calm', 'new']);
    expect(ranked[0].state).toBe('struggling');
    expect(ranked[2].state).toBe('warming_up');
  });

  it('within struggling, the larger own-noise excursion comes first', () => {
    const mild: UnitSeries = {
      unitId: 'mild',
      values: [...Array.from({ length: 16 }, (_, x) => 2.5 + 0.01 * x), 2.7, 3.0, 3.3, 3.7],
    };
    const ranked = rankLocalDifficulty([mild, struggling('severe')], {
      window: 6,
      threshold: 2,
    });
    const struggles = ranked.filter((r) => r.state === 'struggling').map((r) => r.unitId);
    // Both flag; the sharper break ('severe') should sort first.
    expect(struggles[0]).toBe('severe');
  });

  it('does not mutate the caller array order semantics (returns a sorted copy)', () => {
    const input = [struggling('a'), steady('b')];
    const before = input.map((s) => s.unitId);
    rankLocalDifficulty(input, { window: 6 });
    expect(input.map((s) => s.unitId)).toEqual(before);
  });
});
