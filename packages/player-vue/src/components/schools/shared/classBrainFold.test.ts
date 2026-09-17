/**
 * The fold, pinned.
 *
 * The one that matters: at 300 chunks the old drawing could only fit the axis
 * by throwing 240 chunks away (MAX_AXIS = 60 on the server) — chunk 3 was not
 * on the picture at all, and with the truncation removed the linear mapping
 * put chunk 3 and chunk 290 0.6 units apart, which is the blue smear. Both
 * must now stand on one screen with the frontier still at full scale.
 */
import { describe, it, expect } from 'vitest'
import {
  foldAxis, foldLambda, unfoldedAxis, clothBands, isLineArc,
  FULL_SCALE_CHUNKS, CLOTH_MIN_PITCH, LABEL_MIN_PITCH,
} from './classBrainFold'

const SPAN = 516

describe('the log fold', () => {
  it('puts chunk 3 and chunk 290 of a 300-chunk class both on the drawn width, at readable distance', () => {
    const axis = foldAxis(300, SPAN)
    const x3 = axis.x(3)
    const x290 = axis.x(290)
    // Both inside the drawn width, in order.
    expect(x3).toBeGreaterThanOrEqual(0)
    expect(x290).toBeLessThanOrEqual(SPAN)
    expect(x290).toBeGreaterThan(x3)
    // And far enough apart to be two different places on the card, which is
    // what the linear mapping could not do: it gave them 494 units, then the
    // truncation gave chunk 3 no place at all.
    expect(x290 - x3).toBeGreaterThan(SPAN * 0.5)
    // The frontier keeps the spacing a sixty-chunk course gets.
    expect(axis.pitch(299)).toBeGreaterThan((SPAN / FULL_SCALE_CHUNKS) * 0.9)
    // The most recent thirty chunks take roughly the outer third.
    const outer = (SPAN - axis.x(299 - 30)) / SPAN
    expect(outer).toBeGreaterThan(0.25)
    expect(outer).toBeLessThan(0.42)
  })

  it('leaves a short axis dead straight — a first-term class is shown no curve', () => {
    expect(foldLambda(40)).toBeNull()
    const axis = foldAxis(40, SPAN)
    expect(axis.x(0)).toBe(0)
    expect(axis.x(39)).toBeCloseTo(SPAN, 6)
    expect(axis.pitch(20)).toBeCloseTo(axis.pitch(5), 6)
    expect(axis.legibleFrom).toBe(0)
  })

  it('is monotone and spans exactly, at every length', () => {
    for (const n of [2, 12, 61, 120, 300, 900, 2000]) {
      const axis = foldAxis(n, SPAN)
      expect(axis.x(0)).toBeCloseTo(0, 6)
      expect(axis.x(n - 1)).toBeCloseTo(SPAN, 6)
      for (let i = 1; i < n; i++) expect(axis.pitch(i)).toBeGreaterThan(0)
    }
  })

  it('compresses the past and not the frontier', () => {
    const axis = foldAxis(300, SPAN)
    expect(axis.pitch(10)).toBeLessThan(axis.pitch(200))
    expect(axis.pitch(200)).toBeLessThan(axis.pitch(299))
    expect(axis.legibleFrom).toBeGreaterThan(0)
    expect(axis.pitch(axis.legibleFrom + 1)).toBeGreaterThanOrEqual(CLOTH_MIN_PITCH)
  })

  it('offers no label it cannot fit', () => {
    const long = foldAxis(300, SPAN)
    expect(long.labelFrom).toBe(300)
    const short = foldAxis(18, SPAN)
    expect(short.labelFrom).toBe(0)
    expect(short.pitch(1)).toBeGreaterThanOrEqual(LABEL_MIN_PITCH)
  })
})

describe('the cloth', () => {
  const axis = foldAxis(300, SPAN)

  it('keeps an arc reaching from the deep past to the frontier as a LINE', () => {
    expect(isLineArc(3, 299, axis)).toBe(true)
    expect(isLineArc(290, 296, axis)).toBe(true)
    expect(isLineArc(4, 40, axis)).toBe(false)
  })

  it('weaves the old arcs into a band whose weight is the recombination under it', () => {
    const arcs = [
      { a: 2, b: 30, n: 2 },
      { a: 4, b: 30, n: 40 },
      { a: 120, b: 140, n: 2 },
    ]
    const bands = clothBands(arcs, axis)
    expect(bands.length).toBeGreaterThan(4)
    for (const b of bands) {
      expect(b.h).toBeGreaterThan(0)
      expect(b.o).toBeGreaterThan(0)
      expect(b.o).toBeLessThanOrEqual(0.62)
      expect(b.x).toBeGreaterThanOrEqual(axis.x(0) - 1)
      expect(b.x).toBeLessThanOrEqual(axis.x(axis.legibleFrom) + 1)
    }
    // The heavily practised stretch is the heavier weave.
    const near = bands.filter((b) => b.x < axis.x(30))
    const far = bands.filter((b) => b.x >= axis.x(120) && b.x <= axis.x(140))
    expect(Math.max(...near.map((b) => b.o))).toBeGreaterThan(Math.max(...far.map((b) => b.o)))
  })

  it('draws nothing when nothing is old enough', () => {
    expect(clothBands([], axis)).toEqual([])
    expect(clothBands([{ a: 0, b: 1, n: 2 }], foldAxis(20, SPAN))).toEqual([])
  })
})

describe('the unfolded line the expand scrolls', () => {
  it('is true spacing, wide, and labelled', () => {
    const axis = unfoldedAxis(300)
    expect(axis.pitch(1)).toBe(axis.pitch(299))
    expect(axis.span).toBeGreaterThan(SPAN * 10)
    expect(axis.labelFrom).toBe(0)
    expect(axis.legibleFrom).toBe(0)
  })
})
