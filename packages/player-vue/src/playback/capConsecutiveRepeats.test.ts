import { describe, it, expect } from 'vitest'
import { capConsecutiveRepeats, findConsecutiveBreach } from './capConsecutiveRepeats'

const id = (s: string) => s

describe('capConsecutiveRepeats — Tom A-64: no prompt three times in a row', () => {
  it('leaves a lawful sequence untouched', () => {
    const input = ['A', 'A', 'B', 'C', 'C', 'A']
    const r = capConsecutiveRepeats(input, id)
    expect(r.items).toEqual(input)
    expect(r.dropped).toEqual([])
    expect(r.reordered).toBe(false)
  })

  it('allows exactly two in a row', () => {
    const r = capConsecutiveRepeats(['A', 'A'], id)
    expect(r.items).toEqual(['A', 'A'])
    expect(findConsecutiveBreach(r.items, id)).toBe(-1)
  })

  it('re-interleaves rather than dropping when there is something to interleave with', () => {
    const r = capConsecutiveRepeats(['A', 'A', 'A', 'B'], id)
    expect(findConsecutiveBreach(r.items, id)).toBe(-1)
    expect(r.items).toEqual(['A', 'A', 'B', 'A'])
    expect(r.dropped).toEqual([])
    expect(r.reordered).toBe(true)
  })

  it('preserves totals for the A-64 six-reps-of-one-phrase shape when a partner exists', () => {
    // Easy mode n1PhraseCount: 6 against a two-phrase USE pool would already
    // alternate; this is the harder case — six of A and two of B.
    const input = ['A', 'A', 'A', 'A', 'A', 'A', 'B', 'B']
    const r = capConsecutiveRepeats(input, id)
    expect(findConsecutiveBreach(r.items, id)).toBe(-1)
    expect(r.items.filter(x => x === 'A')).toHaveLength(6)
    expect(r.items.filter(x => x === 'B')).toHaveLength(2)
    expect(r.dropped).toEqual([])
  })

  it('drops only when nothing remains to interleave with', () => {
    // One separator can carry at most 4 copies of A (2 before, 2 after).
    const r = capConsecutiveRepeats(['A', 'A', 'A', 'A', 'A', 'B'], id)
    expect(findConsecutiveBreach(r.items, id)).toBe(-1)
    expect(r.items).toEqual(['A', 'A', 'B', 'A', 'A'])
    expect(r.dropped).toEqual(['A'])
  })

  it('reduces a single-identity pool to the cap', () => {
    const r = capConsecutiveRepeats(['A', 'A', 'A', 'A'], id)
    expect(r.items).toEqual(['A', 'A'])
    expect(r.dropped).toEqual(['A', 'A'])
  })

  it('holds the cap across a boundary via seed', () => {
    const first = capConsecutiveRepeats(['A', 'A'], id)
    expect(first.tail).toEqual(['A', 'A'])
    const second = capConsecutiveRepeats(['A', 'B', 'A'], id, { seed: first.tail })
    expect(findConsecutiveBreach([...first.items, ...second.items], id)).toBe(-1)
    expect(second.items).toEqual(['B', 'A', 'A'])
  })

  it('honours minKeep rather than emptying a degenerate sequence', () => {
    const r = capConsecutiveRepeats(['A', 'A'], id, { seed: ['A', 'A'], minKeep: 1 })
    expect(r.items).toEqual(['A'])
    expect(r.forcedKeeps).toBe(1)
    expect(r.dropped).toEqual(['A'])
  })

  it('respects a custom max', () => {
    const r = capConsecutiveRepeats(['A', 'A', 'A', 'B'], id, { max: 3 })
    expect(r.items).toEqual(['A', 'A', 'A', 'B'])
  })

  it('uses the supplied identity function, not object equality', () => {
    const items = [{ t: 'x', n: 1 }, { t: 'x', n: 2 }, { t: 'x', n: 3 }, { t: 'y', n: 4 }]
    const r = capConsecutiveRepeats(items, i => i.t)
    expect(r.items.map(i => i.n)).toEqual([1, 2, 4, 3])
  })
})

describe('capConsecutiveRepeats — property sweep', () => {
  // Deterministic pseudo-random so failures reproduce.
  const mulberry32 = (seed: number) => () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  it('never emits three in a row, and preserves the multiset whenever two identities exist in workable proportion', () => {
    for (let trial = 0; trial < 400; trial++) {
      const rng = mulberry32(trial + 1)
      const alphabet = ['A', 'B', 'C', 'D'].slice(0, 1 + Math.floor(rng() * 4))
      const len = 1 + Math.floor(rng() * 40)
      const input: string[] = []
      for (let i = 0; i < len; i++) {
        input.push(alphabet[Math.floor(rng() * alphabet.length)])
      }

      const r = capConsecutiveRepeats(input, id)

      // Law holds, always.
      expect(findConsecutiveBreach(r.items, id)).toBe(-1)
      // Nothing invented, nothing duplicated.
      expect(r.items.length + r.dropped.length).toBe(input.length)
      const count = (arr: string[], v: string) => arr.filter(x => x === v).length
      for (const letter of alphabet) {
        expect(count(r.items, letter) + count(r.dropped, letter)).toBe(count(input, letter))
      }

      // Totals must survive whenever the arithmetic allows it: the most
      // frequent identity must fit in the 2*(others + 1) slots available.
      const counts = alphabet.map(l => count(input, l))
      const top = Math.max(...counts)
      const others = input.length - top
      if (top <= 2 * (others + 1)) {
        expect(r.dropped).toEqual([])
        expect(r.items).toHaveLength(input.length)
      }
    }
  })
})

describe('findConsecutiveBreach', () => {
  it('reports the index of the offending third play', () => {
    expect(findConsecutiveBreach(['A', 'A', 'A'], id)).toBe(2)
    expect(findConsecutiveBreach(['A', 'B', 'A', 'A'], id)).toBe(-1)
  })
})
