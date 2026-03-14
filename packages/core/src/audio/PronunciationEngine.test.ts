import { describe, it, expect } from 'vitest'
import {
  toSemitones,
  dtw,
  compareProsody,
  getWeightsForLanguage,
  extractPitchContour,
  type PitchContour,
} from './PronunciationEngine'

// Helper to create a simple PitchContour
function makeContour(frequencies: number[], sampleRate = 44100): PitchContour {
  const frameSize = Math.round(sampleRate / 50)
  return {
    times: frequencies.map((_, i) => (i * frameSize) / sampleRate),
    frequencies,
    clarities: frequencies.map(f => f > 0 ? 0.95 : 0.1),
    sampleRate,
  }
}

describe('toSemitones', () => {
  it('returns empty array for all-unvoiced contour', () => {
    const contour = makeContour([0, 0, 0])
    expect(toSemitones(contour)).toEqual([])
  })

  it('centers around zero for uniform pitch', () => {
    const contour = makeContour([200, 200, 200])
    const semitones = toSemitones(contour)
    expect(semitones).toHaveLength(3)
    semitones.forEach(s => expect(Math.abs(s)).toBeLessThan(0.01))
  })

  it('one octave up = +12 semitones', () => {
    const contour = makeContour([100, 200]) // 200 is one octave above 100
    const semitones = toSemitones(contour)
    expect(semitones).toHaveLength(2)
    // Mean is geometric mean of 100 and 200 ≈ 141.4
    // 12 * log2(200/141.4) ≈ 6, 12 * log2(100/141.4) ≈ -6
    expect(semitones[1] - semitones[0]).toBeCloseTo(12, 1)
  })

  it('filters out unvoiced frames', () => {
    const contour = makeContour([200, 0, 200, 0, 200])
    const semitones = toSemitones(contour)
    expect(semitones).toHaveLength(3)
  })
})

describe('dtw', () => {
  it('returns 0 distance for identical sequences', () => {
    const result = dtw([1, 2, 3], [1, 2, 3])
    expect(result.distance).toBe(0)
    expect(result.path).toHaveLength(3)
  })

  it('returns Infinity for empty sequences', () => {
    expect(dtw([], [1, 2]).distance).toBe(Infinity)
    expect(dtw([1], []).distance).toBe(Infinity)
  })

  it('handles sequences of different length', () => {
    const result = dtw([0, 1, 2], [0, 0, 1, 2, 2])
    expect(result.distance).toBeGreaterThanOrEqual(0)
    expect(result.path.length).toBeGreaterThanOrEqual(3) // at least as long as shorter seq
  })

  it('similar sequences have lower distance than different ones', () => {
    const similar = dtw([0, 1, 2, 3], [0, 1.1, 2.1, 3.1])
    const different = dtw([0, 1, 2, 3], [5, 6, 7, 8])
    expect(similar.distance).toBeLessThan(different.distance)
  })
})

describe('getWeightsForLanguage', () => {
  it('returns tonal weights for Chinese', () => {
    const w = getWeightsForLanguage('cmn')
    expect(w.pitch).toBe(0.7)
    expect(w.pitch + w.rhythm + w.timing).toBeCloseTo(1.0)
  })

  it('returns stress-timed weights for English', () => {
    const w = getWeightsForLanguage('eng')
    expect(w.rhythm).toBe(0.45)
  })

  it('returns defaults for unknown language', () => {
    const w = getWeightsForLanguage('xxx')
    expect(w.pitch).toBe(0.35)
    expect(w.rhythm).toBe(0.35)
    expect(w.timing).toBe(0.3)
  })

  it('all weights sum to 1.0', () => {
    for (const lang of ['cmn', 'eng', 'spa', 'jpn', 'ara', 'cym', 'xxx']) {
      const w = getWeightsForLanguage(lang)
      expect(w.pitch + w.rhythm + w.timing).toBeCloseTo(1.0, 5)
    }
  })
})

describe('compareProsody', () => {
  it('returns perfect score for identical contours', () => {
    const contour = makeContour([200, 220, 240, 260, 280, 300, 280, 260])
    const result = compareProsody(contour, contour, 'eng')
    expect(result.score.pitch).toBe(100)
    expect(result.score.overall).toBeGreaterThan(70)
  })

  it('returns lower score for very different contours', () => {
    const native = makeContour([200, 220, 240, 260, 280, 300])
    const learner = makeContour([400, 350, 300, 250, 200, 150]) // opposite direction
    const result = compareProsody(native, learner, 'eng')
    expect(result.score.pitch).toBeLessThan(80)
  })

  it('returns neutral scores when contours have insufficient voiced frames', () => {
    const native = makeContour([200, 0])
    const learner = makeContour([0, 200])
    const result = compareProsody(native, learner, 'eng')
    // With < 3 voiced frames, should get default score of 50
    expect(result.score.pitch).toBe(50)
  })

  it('includes alignment path in result', () => {
    const native = makeContour([200, 220, 240, 260])
    const learner = makeContour([200, 220, 240, 260])
    const result = compareProsody(native, learner, 'eng')
    expect(result.alignmentPath.length).toBeGreaterThan(0)
  })

  it('uses language-specific weights', () => {
    const native = makeContour([200, 220, 240, 260, 280, 300])
    const learner = makeContour([200, 300, 200, 300, 200, 300]) // wildly different pitch

    const tonal = compareProsody(native, learner, 'cmn')
    const stressTimed = compareProsody(native, learner, 'eng')

    // Tonal language should penalize pitch errors more
    expect(tonal.score.overall).toBeLessThanOrEqual(stressTimed.score.overall)
  })
})
