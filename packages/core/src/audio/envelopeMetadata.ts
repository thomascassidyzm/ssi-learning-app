/**
 * Client-side volume-envelope extractor (adaptation v2, workstream C — WP-6).
 *
 * Consumes the VAD's own timestamped RMS-dB sample array — no second
 * AnalyserNode, no new audio path, no recording. Raw samples are consumed
 * here and never returned; only the five derived `EnvelopeMetadata` numbers
 * leave this module (the privacy invariant, spec §6.6).
 *
 * MUST mirror the dashboard repo's offline extractor
 * (`ssi-dashboard-v7-clean/services/audio-envelope.cjs`) exactly, on the same
 * pinned constants (`envelope-extractor-v1.json`, copied verbatim into this
 * repo), so learner and model numbers are directly comparable. The one
 * deliberate divergence: the dashboard extractor decodes a mastered clip at a
 * fixed PCM sample rate (uniform grid already), while the client's rAF loop
 * produces irregular, display-locked timestamps — so the client grids via
 * linear interpolation over `{t, db}` pairs (spec §5.1 step 2) where the
 * server just windows fixed-rate PCM. Once both are on the 20ms grid, every
 * downstream step (smoothing, scipy-style prominence peak-finding, width) is
 * identical arithmetic.
 *
 * `docs/adaptation/adaptation-v2-build-spec.md` §5.1 is the design authority.
 */

import CONSTANTS from './envelope-extractor-v1.json';

export interface EnvelopeExtractorConstants {
  version: number;
  gridMs: number;
  smoothingTaps: number;
  smoothingWindowMs: number;
  peakProminenceRatio: number;
  peakMinSeparationMs: number;
  minSampleCount: number;
}

/** The pinned v1 constants both repos read — shared source of truth for comparability. */
export const ENVELOPE_EXTRACTOR_CONSTANTS: EnvelopeExtractorConstants = CONSTANTS;

/** One timestamped energy sample from the VAD's rAF loop. */
export interface TimedEnergySample {
  /** `performance.now()`-relative ms. */
  t: number;
  /** RMS energy in dB, as returned by `getCurrentEnergy()`. */
  db: number;
}

export interface EnvelopeMetadata {
  /** learner_duration_ms — carried through unchanged from the VAD's own timing. */
  durationMs: number;
  /** Syllable-scale energy peaks (integer). */
  peakCount: number;
  /** Max linear RMS / mean linear RMS over the speech region. */
  peakToMeanRatio: number;
  /** Mean full-width-at-half-prominence of the peaks, ms. */
  meanPeakWidthMs: number;
  /** Grid points after resampling — the capture-quality guard. */
  sampleCount: number;
  /** Extraction confidence — 0 means "discard the cycle" (spec §5.1 step 7). */
  weight: number;
  /**
   * Compact prosody contour (founder steer 2026-07-28): the smoothed linear
   * envelope, peak-normalized to 0–100 integers, ≤ CONTOUR_MAX_POINTS points
   * (longer utterances are bucket-averaged down). This is the INTERMEDIATE
   * feature the derived scalars above are computed from — stored so any
   * future prosody metric (DTW-style contour similarity, variance bands) can
   * be recomputed over historical cycles without re-capturing. Still only
   * energy shape on a ≥20ms grid — no spectral/phonetic content, so the
   * raw-audio-never-leaves-the-device invariant is unchanged.
   * Absent when the capture was too sparse to grid (weight 0).
   */
  contour?: number[];
  /** Effective ms per contour point (= gridMs when the utterance fits uncapped). */
  contourGridMs?: number;
}

/** Telemetry-size cap for the contour: 128 points keeps native 20ms resolution up to ~2.6s. */
export const CONTOUR_MAX_POINTS = 128;

/** Peak-normalize and bucket-average the smoothed envelope down to ≤ maxPoints 0–100 ints. */
function compactContour(
  envelope: Float64Array,
  gridMs: number,
  maxPoints: number = CONTOUR_MAX_POINTS,
): { contour: number[]; contourGridMs: number } {
  const n = envelope.length;
  const points = Math.min(n, maxPoints);
  const contourGridMs = (n * gridMs) / points;
  const max = Math.max(...envelope);
  const contour = new Array<number>(points).fill(0);
  if (max <= 0) return { contour, contourGridMs };
  for (let p = 0; p < points; p++) {
    const start = Math.floor((p * n) / points);
    const end = Math.max(start + 1, Math.floor(((p + 1) * n) / points));
    let sum = 0;
    for (let i = start; i < end; i++) sum += envelope[i];
    contour[p] = Math.round((sum / (end - start) / max) * 100);
  }
  return { contour, contourGridMs };
}

const emptyMetadata = (durationMs: number, sampleCount: number): EnvelopeMetadata => ({
  durationMs,
  peakCount: 0,
  peakToMeanRatio: 0,
  meanPeakWidthMs: 0,
  sampleCount,
  weight: 0,
});

/** Resample timestamped dB samples onto a fixed grid via linear interpolation, dB→linear en route. */
function resampleToGrid(samples: TimedEnergySample[], gridMs: number): Float64Array {
  if (samples.length === 0) return new Float64Array(0);
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const start = sorted[0].t;
  const end = sorted[sorted.length - 1].t;
  const numPoints = Math.max(1, Math.floor((end - start) / gridMs) + 1);
  const out = new Float64Array(numPoints);

  let lo = 0;
  for (let g = 0; g < numPoints; g++) {
    const t = start + g * gridMs;
    while (lo < sorted.length - 2 && sorted[lo + 1].t < t) lo++;
    const a = sorted[lo];
    const b = sorted[Math.min(lo + 1, sorted.length - 1)];
    const dB = a.t === b.t ? a.db : a.db + ((b.db - a.db) * (t - a.t)) / (b.t - a.t);
    out[g] = Math.pow(10, dB / 20); // dB → linear
  }
  return out;
}

/** Simple moving average over `taps` grid points (odd taps → centered). Mirrors the server's `movingAverage`. */
function movingAverage(series: Float64Array, taps: number): Float64Array {
  const half = Math.floor(taps / 2);
  const out = new Float64Array(series.length);
  for (let i = 0; i < series.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -half; k <= half; k++) {
      const j = i + k;
      if (j >= 0 && j < series.length) {
        sum += series[j];
        count++;
      }
    }
    out[i] = sum / count;
  }
  return out;
}

/** scipy-style peak_prominences: for local maximum at i, prominence = height - max(leftMin, rightMin). */
function prominenceOf(series: Float64Array, i: number): number {
  const v = series[i];
  let leftMin = v;
  for (let j = i - 1; j >= 0; j--) {
    if (series[j] > v) break;
    if (series[j] < leftMin) leftMin = series[j];
  }
  let rightMin = v;
  for (let j = i + 1; j < series.length; j++) {
    if (series[j] > v) break;
    if (series[j] < rightMin) rightMin = series[j];
  }
  return v - Math.max(leftMin, rightMin);
}

/** Width (in grid steps) of the span around peak i where the series stays >= threshold. */
function widthAt(series: Float64Array, i: number, threshold: number): number {
  let left = i;
  while (left > 0 && series[left - 1] >= threshold) left--;
  let right = i;
  while (right < series.length - 1 && series[right + 1] >= threshold) right++;
  return right - left;
}

function findLocalMaxima(series: Float64Array): number[] {
  const maxima: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const prev = i === 0 ? -Infinity : series[i - 1];
    const next = i === series.length - 1 ? -Infinity : series[i + 1];
    if (series[i] >= prev && series[i] >= next && (series[i] > prev || series[i] > next)) {
      maxima.push(i);
    }
  }
  return maxima;
}

/**
 * Pure function over the VAD's timed speech-region sample array. `durationMs`
 * is the VAD's own `learner_duration_ms` (already computed from confirmed
 * speech start/end) — carried through, not re-derived here.
 *
 * Never returns the raw samples; the caller (`VoiceActivityDetector`) must
 * discard `samples` immediately after this call.
 */
export function extractEnvelopeMetadata(
  samples: TimedEnergySample[],
  durationMs: number,
  constants: EnvelopeExtractorConstants = ENVELOPE_EXTRACTOR_CONSTANTS,
): EnvelopeMetadata {
  const { gridMs, smoothingTaps, peakProminenceRatio, peakMinSeparationMs, minSampleCount } = constants;

  const rawEnvelope = resampleToGrid(samples, gridMs);
  const sampleCount = rawEnvelope.length;

  if (sampleCount < minSampleCount) {
    return emptyMetadata(durationMs, sampleCount);
  }

  const envelope = movingAverage(rawEnvelope, smoothingTaps);

  const max = Math.max(...envelope);
  const mean = envelope.reduce((a, b) => a + b, 0) / envelope.length;
  const peakToMeanRatio = mean > 0 ? max / mean : 0;
  const prominenceThreshold = peakProminenceRatio * (max - mean);

  // Flat/silent capture: no meaningful dynamic range, so any "local maximum"
  // is float noise on an otherwise constant signal, not a syllable peak.
  const candidates = prominenceThreshold <= 0
    ? []
    : findLocalMaxima(envelope)
      .map((i) => ({ i, prominence: prominenceOf(envelope, i) }))
      .filter((c) => c.prominence >= prominenceThreshold)
      .sort((a, b) => envelope[b.i] - envelope[a.i]);

  const minSeparationSteps = peakMinSeparationMs / gridMs;
  const accepted: Array<{ i: number; prominence: number }> = [];
  for (const c of candidates) {
    if (accepted.every((a) => Math.abs(a.i - c.i) >= minSeparationSteps)) accepted.push(c);
  }
  accepted.sort((a, b) => a.i - b.i);

  const widths = accepted.map((c) => widthAt(envelope, c.i, envelope[c.i] - c.prominence / 2) * gridMs);
  const meanPeakWidthMs = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 0;

  const { contour, contourGridMs } = compactContour(envelope, gridMs);

  return {
    durationMs,
    peakCount: accepted.length,
    peakToMeanRatio,
    meanPeakWidthMs,
    sampleCount,
    weight: 1,
    contour,
    contourGridMs,
  };
}
