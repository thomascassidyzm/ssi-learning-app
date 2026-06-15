import { describe, it, expect } from 'vitest';
import {
  computeCurvature,
  curvatureSeries,
  accelerationAlarm,
} from './curvature';

describe('computeCurvature', () => {
  it('returns null below the min-cycle gate (a single cycle has no curvature)', () => {
    expect(computeCurvature([1, 2], { minSamples: 5 })).toBeNull();
    expect(computeCurvature([1, 2, 3, 4], { minSamples: 5 })).toBeNull();
    expect(computeCurvature([1, 2, 3, 4, 5], { minSamples: 5 })).not.toBeNull();
  });

  it('a constant series has zero velocity and zero acceleration', () => {
    const pt = computeCurvature([5, 5, 5, 5, 5, 5, 5])!;
    expect(pt.level).toBeCloseTo(5, 10);
    expect(pt.velocity).toBeCloseTo(0, 10);
    expect(pt.acceleration).toBeCloseTo(0, 10);
  });

  it('a steady slope reads zero acceleration (baseline-free — the headline property)', () => {
    // y = 2 + 3x. A learner improving at an even pace must NOT raise an alarm.
    const values = [0, 1, 2, 3, 4, 5, 6].map((x) => 2 + 3 * x);
    const pt = computeCurvature(values)!;
    expect(pt.velocity).toBeCloseTo(3, 8);
    expect(pt.acceleration).toBeCloseTo(0, 8);
    // Level is the fit at the most recent sample (x = 6) => 2 + 18 = 20.
    expect(pt.level).toBeCloseTo(20, 8);
  });

  it('recovers a known quadratic exactly (acceleration = 2·leading coeff)', () => {
    // y = x²: f''(x) = 2 everywhere; f'(x) = 2x, evaluated at the last sample.
    const xs = [0, 1, 2, 3, 4, 5, 6];
    const values = xs.map((x) => x * x);
    const pt = computeCurvature(values)!;
    expect(pt.acceleration).toBeCloseTo(2, 6);
    expect(pt.velocity).toBeCloseTo(2 * 6, 6); // 2·x_last
    expect(pt.level).toBeCloseTo(36, 6);
  });

  it('a negative-curvature (decelerating) trend reads negative acceleration', () => {
    // y = -x²: f'' = -2.
    const values = [0, 1, 2, 3, 4, 5, 6].map((x) => -(x * x));
    const pt = computeCurvature(values)!;
    expect(pt.acceleration).toBeCloseTo(-2, 6);
  });

  it('detects a turn: flat then ramping up gives positive acceleration', () => {
    // The §4 worked example — stable, then drifts. Acceleration should be > 0.
    const flat = computeCurvature([2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5])!;
    expect(flat.acceleration).toBeCloseTo(0, 8);
    const turning = computeCurvature([2.5, 2.5, 2.5, 2.6, 2.9, 3.4, 4.0])!;
    expect(turning.acceleration).toBeGreaterThan(0.05);
  });

  it('smooths before differentiating: near-zero acceleration on a noisy straight line', () => {
    // Linear trend + small deterministic zig-zag. A raw second difference would
    // be dominated by the noise; the local quadratic fit suppresses it.
    const noise = [0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1, -0.1, 0.1];
    const values = noise.map((e, x) => 1 + 0.5 * x + e);
    const pt = computeCurvature(values, { window: 11 })!;
    expect(pt.velocity).toBeCloseTo(0.5, 1);
    expect(Math.abs(pt.acceleration)).toBeLessThan(0.05);
  });

  it('only uses the trailing window, so old history does not bias the read', () => {
    // Long flat tail; an early bump outside the window must not affect the fit.
    const values = [99, 99, 99, 5, 5, 5, 5, 5, 5, 5];
    const pt = computeCurvature(values, { window: 5 })!;
    expect(pt.samples).toBe(5);
    expect(pt.level).toBeCloseTo(5, 8);
    expect(pt.acceleration).toBeCloseTo(0, 8);
  });

  it('honours explicit (non-uniform) x spacing', () => {
    // y = x² sampled at uneven x; acceleration is still 2.
    const xs = [0, 1, 3, 4, 7, 9, 10];
    const values = xs.map((x) => x * x);
    const pt = computeCurvature(values, { x: xs })!;
    expect(pt.acceleration).toBeCloseTo(2, 4);
    expect(pt.velocity).toBeCloseTo(2 * 10, 4);
  });

  it('returns null for a degenerate window (duplicate x has no determined quadratic)', () => {
    const xs = [0, 0, 0, 0, 0];
    expect(computeCurvature([1, 2, 3, 4, 5], { x: xs })).toBeNull();
  });

  it('throws when x length does not match values', () => {
    expect(() => computeCurvature([1, 2, 3, 4, 5], { x: [0, 1, 2] })).toThrow();
  });
});

describe('curvatureSeries', () => {
  it('is null while warming up, then yields a point per sample', () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7];
    const series = curvatureSeries(values, { minSamples: 5 });
    expect(series.length).toBe(values.length);
    expect(series.slice(0, 4).every((p) => p === null)).toBe(true);
    expect(series.slice(4).every((p) => p !== null)).toBe(true);
  });

  it('tracks a sign change in acceleration through an inflection', () => {
    // Accelerate up, then roll over and come back down (a cap-shaped curve).
    const values = [0, 1, 2.5, 4.5, 7, 9, 10.5, 11, 10.5, 9, 7];
    const series = curvatureSeries(values, { window: 5, minSamples: 5 });
    const accels = series.filter((p): p is NonNullable<typeof p> => p !== null).map((p) => p.acceleration);
    // The trailing fit reads concave-down (negative) once the cap is in view.
    expect(accels[accels.length - 1]).toBeLessThan(0);
  });
});

describe('accelerationAlarm', () => {
  it('does not flag a steady slope (zero acceleration, zero own-noise)', () => {
    const values = Array.from({ length: 20 }, (_, x) => 1 + 2 * x);
    const alarms = accelerationAlarm(values);
    expect(alarms.some((a) => a.flagged)).toBe(false);
  });

  it('does not flag a constant series', () => {
    const values = Array.from({ length: 20 }, () => 3.3);
    const alarms = accelerationAlarm(values);
    expect(alarms.some((a) => a.flagged)).toBe(false);
  });

  it('flags a sudden turn against an otherwise quiet background', () => {
    // Long quiet stretch (a faint linear drift), then a sharp upward break.
    const quiet = Array.from({ length: 16 }, (_, x) => 2.5 + 0.01 * x);
    const values = [...quiet, 2.9, 3.6, 4.6, 6.0];
    const alarms = accelerationAlarm(values, { window: 6, threshold: 2 });
    expect(alarms.some((a) => a.flagged)).toBe(true);
    // The flags land at the break, not in the quiet stretch.
    const flaggedIdx = alarms.filter((a) => a.flagged).map((a) => a.index);
    expect(Math.min(...flaggedIdx)).toBeGreaterThanOrEqual(16);
  });

  it('reports null z until a noise baseline exists, then numbers', () => {
    const values = Array.from({ length: 12 }, (_, x) => x * 1.0);
    const alarms = accelerationAlarm(values, { minSamples: 5 });
    // Warming-up entries carry null acceleration and null z.
    expect(alarms[0].acceleration).toBeNull();
    expect(alarms[0].z).toBeNull();
    // Once enough ready points have accrued, z is a number.
    expect(alarms.some((a) => typeof a.z === 'number')).toBe(true);
  });
});
