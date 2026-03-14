import { describe, it, expect } from 'vitest'
import {
  trimSilence,
  countEnergyPeaks,
  normalizeEnvelope,
  envelopeSimilarity,
  compareProsody,
  getWeightsForLanguage,
  dtw,
  toSemitones,
  type PitchContour,
} from './PronunciationEngine'

// Helper to create a PitchContour with energy data
function makeContour(energy: number[], sampleRate = 44100): PitchContour {
  const frameSize = Math.round(sampleRate / 50)
  return {
    times: energy.map((_, i) => (i * frameSize) / sampleRate),
    frequencies: energy.map(() => 0),
    clarities: energy.map(e => e > 0.01 ? 0.95 : 0.1),
    sampleRate,
    energy,
  }
}

describe('trimSilence', () => {
  it('trims leading silence', () => {
    const energy = [0, 0, 0, 0.1, 0.5, 0.3, 0.1, 0, 0]
    const [start, end] = trimSilence(energy)
    expect(start).toBe(3)
    expect(end).toBe(7)
  })

  it('returns full range when no silence', () => {
    const energy = [0.3, 0.5, 0.4, 0.3]
    const [start, end] = trimSilence(energy)
    expect(start).toBe(0)
    expect(end).toBe(4)
  })

  it('handles all-silent input', () => {
    const energy = [0, 0, 0]
    const [start, end] = trimSilence(energy)
    expect(start).toBe(0)
    expect(end).toBe(3) // falls back to full range
  })

  it('handles empty input', () => {
    const [start, end] = trimSilence([])
    expect(start).toBe(0)
    expect(end).toBe(0)
  })
})

describe('countEnergyPeaks', () => {
  it('counts distinct peaks', () => {
    // Two clear peaks with a wide valley — need enough frames for smoothing + skip-ahead
    const energy = [
      0.05, 0.1, 0.2, 0.4, 0.6, 0.5, 0.3, 0.1,  // peak 1
      0.05, 0.05, 0.05, 0.05, 0.05,                // valley
      0.1, 0.2, 0.4, 0.7, 0.5, 0.3, 0.1, 0.05,    // peak 2
    ]
    const peaks = countEnergyPeaks(energy)
    expect(peaks).toBe(2)
  })

  it('returns 1 for a single bump', () => {
    const energy = [0.1, 0.3, 0.5, 0.3, 0.1]
    expect(countEnergyPeaks(energy)).toBe(1)
  })

  it('returns 1 for very short input', () => {
    expect(countEnergyPeaks([0.5])).toBe(1)
    expect(countEnergyPeaks([0.3, 0.5])).toBe(1)
  })

  it('returns 0 for empty input', () => {
    expect(countEnergyPeaks([])).toBe(0)
  })
})

describe('normalizeEnvelope', () => {
  it('returns normalized bins summing to ~1', () => {
    const energy = [0.1, 0.2, 0.5, 0.4, 0.1]
    const norm = normalizeEnvelope(energy, 5)
    const sum = norm.reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 3)
  })

  it('preserves shape — peak bin is largest', () => {
    const energy = [0.1, 0.1, 0.5, 0.1, 0.1]
    const norm = normalizeEnvelope(energy, 5)
    const maxIdx = norm.indexOf(Math.max(...norm))
    expect(maxIdx).toBe(2)
  })

  it('returns uniform for empty input', () => {
    const norm = normalizeEnvelope([], 4)
    expect(norm).toHaveLength(4)
    norm.forEach(v => expect(v).toBeCloseTo(0.25, 3))
  })
})

describe('envelopeSimilarity', () => {
  it('returns 100 for identical envelopes', () => {
    const a = [0.1, 0.3, 0.4, 0.2]
    expect(envelopeSimilarity(a, a)).toBeCloseTo(100, 0)
  })

  it('returns high score for similar envelopes', () => {
    const a = [0.1, 0.3, 0.4, 0.2]
    const b = [0.12, 0.28, 0.38, 0.22]
    expect(envelopeSimilarity(a, b)).toBeGreaterThan(90)
  })

  it('returns lower score for very different envelopes', () => {
    const a = [0.5, 0.1, 0.1, 0.1, 0.2]
    const b = [0.1, 0.1, 0.1, 0.5, 0.2]
    expect(envelopeSimilarity(a, b)).toBeLessThan(80)
  })
})

describe('compareProsody', () => {
  it('returns high score for identical contours', () => {
    const energy = [0.1, 0.3, 0.5, 0.6, 0.4, 0.2, 0.1, 0.3, 0.5, 0.3, 0.1]
    const contour = makeContour(energy)
    const result = compareProsody(contour, contour, 'eng')
    expect(result.score.overall).toBeGreaterThan(90)
    expect(result.score.duration).toBe(100)
    expect(result.score.peakCount).toBe(100)
  })

  it('gives decent score for slightly different duration', () => {
    const native = makeContour([0.1, 0.3, 0.5, 0.4, 0.2, 0.1])
    // Learner is ~30% longer (extra frames)
    const learner = makeContour([0.1, 0.2, 0.3, 0.5, 0.5, 0.4, 0.3, 0.1])
    const result = compareProsody(native, learner, 'eng')
    expect(result.score.duration).toBeGreaterThan(70)
  })

  it('penalizes very different duration', () => {
    const native = makeContour([0.1, 0.3, 0.5, 0.4, 0.3, 0.2, 0.1])
    // Learner is 3x longer
    const learner = makeContour(new Array(21).fill(0).map((_, i) =>
      0.1 + 0.3 * Math.sin(i / 3)))
    const result = compareProsody(native, learner, 'eng')
    expect(result.score.duration).toBeLessThan(50)
  })

  it('trims silence before comparing', () => {
    // Native: clean signal
    const native = makeContour([0.3, 0.5, 0.4, 0.3])
    // Learner: same signal but wrapped in silence (like MediaRecorder would give)
    const learner = makeContour([0, 0, 0, 0, 0.3, 0.5, 0.4, 0.3, 0, 0, 0])
    const result = compareProsody(native, learner, 'eng')
    // Duration should be close to 100 after trimming
    expect(result.score.duration).toBeGreaterThan(80)
  })
})

describe('getWeightsForLanguage', () => {
  it('returns syllable-timed weights for Spanish', () => {
    const w = getWeightsForLanguage('spa')
    expect(w.peakCount).toBe(0.4)
  })

  it('returns defaults for unknown language', () => {
    const w = getWeightsForLanguage('xxx')
    expect(w.duration).toBe(0.25)
    expect(w.peakCount).toBe(0.35)
    expect(w.envelope).toBe(0.4)
  })

  it('all weights sum to 1.0', () => {
    for (const lang of ['cmn', 'eng', 'spa', 'jpn', 'ara', 'cym', 'xxx']) {
      const w = getWeightsForLanguage(lang)
      expect(w.duration + w.peakCount + w.envelope).toBeCloseTo(1.0, 5)
    }
  })
})

// Legacy function tests (kept for backwards compat)
describe('dtw (legacy)', () => {
  it('returns 0 distance for identical sequences', () => {
    const result = dtw([1, 2, 3], [1, 2, 3])
    expect(result.distance).toBe(0)
  })

  it('returns Infinity for empty sequences', () => {
    expect(dtw([], [1, 2]).distance).toBe(Infinity)
  })
})

describe('toSemitones (legacy)', () => {
  it('returns empty array for all-unvoiced contour', () => {
    const contour: PitchContour = {
      times: [0, 0.02, 0.04],
      frequencies: [0, 0, 0],
      clarities: [0.1, 0.1, 0.1],
      sampleRate: 44100,
      energy: [0, 0, 0],
    }
    expect(toSemitones(contour)).toEqual([])
  })
})
