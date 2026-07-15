import { describe, it, expect } from 'vitest';
import { extractEnvelopeMetadata, ENVELOPE_EXTRACTOR_CONSTANTS, type TimedEnergySample } from './envelopeMetadata';

const dbFromLinear = (linear: number): number => (linear <= 0 ? -100 : 20 * Math.log10(linear));

/** Build a synthetic envelope: sum of gaussian bumps (in linear amplitude) sampled at `stepMs`,
 *  converted to dB, with optional per-sample jitter on the timestamp (cadence-independence). */
function gaussianBumps(
  bumpCentersMs: number[],
  opts: { totalMs: number; stepMs?: number; sigmaMs?: number; floor?: number; jitterMs?: number } = { totalMs: 1000 }
): TimedEnergySample[] {
  const { totalMs, stepMs = 16.7, sigmaMs = 40, floor = 0.02, jitterMs = 0 } = opts;
  const samples: TimedEnergySample[] = [];
  for (let t = 0; t <= totalMs; t += stepMs) {
    let linear = floor;
    for (const c of bumpCentersMs) {
      linear += Math.exp(-((t - c) ** 2) / (2 * sigmaMs ** 2));
    }
    const jitter = jitterMs > 0 ? (Math.random() - 0.5) * 2 * jitterMs : 0;
    samples.push({ t: t + jitter, db: dbFromLinear(linear) });
  }
  return samples;
}

describe('extractEnvelopeMetadata', () => {
  it('counts 3 peaks on a synthetic 3-gaussian-bump envelope', () => {
    const samples = gaussianBumps([150, 450, 750], { totalMs: 900 });
    const result = extractEnvelopeMetadata(samples, 900);

    expect(result.peakCount).toBe(3);
    expect(result.weight).toBe(1);
    expect(result.peakToMeanRatio).toBeGreaterThan(1);
    expect(result.meanPeakWidthMs).toBeGreaterThan(0);
    expect(result.durationMs).toBe(900);
  });

  it('is cadence-independent — jittered timestamps yield the same peak count as the clean grid', () => {
    const clean = gaussianBumps([150, 450, 750], { totalMs: 900 });
    const jittered = gaussianBumps([150, 450, 750], { totalMs: 900, jitterMs: 5 });

    const cleanResult = extractEnvelopeMetadata(clean, 900);
    const jitteredResult = extractEnvelopeMetadata(jittered, 900);

    expect(jitteredResult.peakCount).toBe(cleanResult.peakCount);
  });

  it('is cadence-independent — a sparser (throttled) sample rate yields the same peak count', () => {
    const fine = gaussianBumps([150, 450, 750], { totalMs: 900, stepMs: 16.7 });
    const throttled = gaussianBumps([150, 450, 750], { totalMs: 900, stepMs: 50 });

    const fineResult = extractEnvelopeMetadata(fine, 900);
    const throttledResult = extractEnvelopeMetadata(throttled, 900);

    expect(throttledResult.peakCount).toBe(fineResult.peakCount);
  });

  it('reports 0 peaks on a flat/silent envelope (no dynamic range)', () => {
    const samples = gaussianBumps([], { totalMs: 500, floor: 0.05 });
    const result = extractEnvelopeMetadata(samples, 500);

    expect(result.peakCount).toBe(0);
    expect(result.weight).toBe(1); // flat capture still has enough samples — just no peaks
  });

  it('merges two close peaks separated by less than peakMinSeparationMs into one', () => {
    // Two bumps 60ms apart — well under the 120ms minimum separation.
    const samples = gaussianBumps([400, 460], { totalMs: 900, sigmaMs: 25 });
    const result = extractEnvelopeMetadata(samples, 900);

    expect(result.peakCount).toBe(1);
  });

  it('counts a mumbled/merged-syllable envelope (wide, low-prominence bumps) as fewer, wider peaks', () => {
    const crisp = gaussianBumps([200, 500, 800], { totalMs: 1000, sigmaMs: 20 });
    const mumbled = gaussianBumps([200, 500, 800], { totalMs: 1000, sigmaMs: 90 });

    const crispResult = extractEnvelopeMetadata(crisp, 1000);
    const mumbledResult = extractEnvelopeMetadata(mumbled, 1000);

    expect(mumbledResult.meanPeakWidthMs).toBeGreaterThan(crispResult.meanPeakWidthMs);
  });

  it('applies the capture-quality gate: fewer than minSampleCount grid points → weight 0, discard', () => {
    const tinySamples: TimedEnergySample[] = [
      { t: 0, db: -20 },
      { t: 5, db: -18 },
      { t: 10, db: -19 },
    ];
    const result = extractEnvelopeMetadata(tinySamples, 10);

    expect(result.sampleCount).toBeLessThan(ENVELOPE_EXTRACTOR_CONSTANTS.minSampleCount);
    expect(result.weight).toBe(0);
    expect(result.peakCount).toBe(0);
  });

  it('handles an empty sample array without throwing', () => {
    const result = extractEnvelopeMetadata([], 0);

    expect(result.weight).toBe(0);
    expect(result.sampleCount).toBe(0);
    expect(result.peakCount).toBe(0);
  });

  it('handles out-of-order timestamps by sorting before gridding', () => {
    const inOrder = gaussianBumps([150, 450, 750], { totalMs: 900 });
    const shuffled = [...inOrder].reverse();

    const inOrderResult = extractEnvelopeMetadata(inOrder, 900);
    const shuffledResult = extractEnvelopeMetadata(shuffled, 900);

    expect(shuffledResult.peakCount).toBe(inOrderResult.peakCount);
  });

  it('does not mutate or retain the input sample array (raw-array containment)', () => {
    const samples = gaussianBumps([150, 450, 750], { totalMs: 900 });
    const snapshot = samples.map((s) => ({ ...s }));

    const result = extractEnvelopeMetadata(samples, 900);

    expect(samples).toEqual(snapshot); // caller's array untouched
    // The result object carries only the 6 derived scalar fields — no sample array.
    expect(Object.keys(result).sort()).toEqual(
      ['durationMs', 'meanPeakWidthMs', 'peakCount', 'peakToMeanRatio', 'sampleCount', 'weight'].sort()
    );
  });
});
