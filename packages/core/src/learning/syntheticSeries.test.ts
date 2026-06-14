import { describe, it, expect } from 'vitest';
import { makeLatencySeries, type SyntheticSeriesKind } from './syntheticSeries';
import { assessLocalDifficulty, type LocalDifficultyState } from './localDifficulty';

/**
 * Regression guard for the canonical demo learning-curve calibration.
 *
 * For each archetype we generate MANY series via a seeded PRNG and run them
 * through the REAL sensor with its DEFAULT options — exactly the no-options call
 * the production Insight resolver (`difficultyTurns.ts`) makes. This fails loudly
 * if anyone perturbs the shapes in `syntheticSeries.ts` OR the sensor's defaults
 * (window 7 / minSamples 5 / noiseWindow 10 / threshold 2σ) drift.
 *
 * NOTE: `assessLocalDifficulty(series)` — NO options object — so we are testing
 * against production defaults, not the unit tests' window:6.
 */

// mulberry32 — deterministic, same family as the generator's PRNG.
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRIALS = 300;

function classifyRate(
  kind: SyntheticSeriesKind,
  expected: LocalDifficultyState
): { rate: number; counts: Record<string, number> } {
  let hits = 0;
  const counts: Record<string, number> = {};
  for (let i = 0; i < TRIALS; i++) {
    const rng = makeRng(1000 + i);
    const values = makeLatencySeries(kind, { rng });
    // DEFAULT options — what production uses.
    const d = assessLocalDifficulty({ unitId: 'x', unitKind: 'lego', values });
    counts[d.state] = (counts[d.state] ?? 0) + 1;
    if (d.state === expected) hits++;
  }
  return { rate: hits / TRIALS, counts };
}

describe('makeLatencySeries — calibration against the real sensor (default options)', () => {
  it('produces series of at least the minimum length', () => {
    const rng = makeRng(42);
    for (const kind of ['struggling', 'easing', 'steady'] as const) {
      const s = makeLatencySeries(kind, { rng });
      expect(s.length).toBeGreaterThanOrEqual(8);
      expect(s.every((v) => Number.isFinite(v))).toBe(true);
    }
  });

  it('respects an explicit length (clamped to the floor)', () => {
    const rng = makeRng(7);
    expect(makeLatencySeries('struggling', { rng, length: 14 })).toHaveLength(14);
    expect(makeLatencySeries('steady', { rng, length: 3 })).toHaveLength(8); // clamped
  });

  it('is deterministic for a given rng seed', () => {
    const a = makeLatencySeries('struggling', { rng: makeRng(99) });
    const b = makeLatencySeries('struggling', { rng: makeRng(99) });
    expect(a).toEqual(b);
  });

  it('classifies STRUGGLING at 100%', () => {
    const { rate, counts } = classifyRate('struggling', 'struggling');
    expect(rate, `states seen: ${JSON.stringify(counts)}`).toBe(1);
  });

  it('classifies EASING at 100%', () => {
    const { rate, counts } = classifyRate('easing', 'easing');
    expect(rate, `states seen: ${JSON.stringify(counts)}`).toBe(1);
  });

  // Steady is intrinsically borderline: a flat line carries ~zero acceleration
  // AND ~zero acceleration-noise, so the z-score denominator is tiny and a single
  // noise bump can momentarily exceed 2σ. Across seed bases the true classify rate
  // sits ~89–95% (measured), so the regression floor is 85% — comfortably below
  // the real distribution yet high enough to catch a genuine shape/sensor drift
  // (a perturbation that broke steady would crater this far past 85%). Struggling
  // and easing, by contrast, classify at a clean 100%.
  it('classifies STEADY at >= 85% (flat lines occasionally flag on own noise)', () => {
    const { rate, counts } = classifyRate('steady', 'steady');
    expect(rate, `states seen: ${JSON.stringify(counts)}`).toBeGreaterThanOrEqual(0.85);
  });
});
