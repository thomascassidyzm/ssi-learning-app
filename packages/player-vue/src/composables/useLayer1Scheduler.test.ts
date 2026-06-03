import { describe, it, expect } from 'vitest'
import {
  seededRng,
  sampleSeeded,
  computeSeedLastOrdinals,
  drainedSeedsAt,
  composeBucket,
  shouldFireAtRound,
  DEFAULT_LAYER1_CONFIG,
} from './useLayer1Scheduler'

// ----------------------------------------------------------------------------
// seededRng — deterministic, well-distributed enough
// ----------------------------------------------------------------------------
describe('seededRng', () => {
  it('is deterministic: same seed → identical stream', () => {
    const a = seededRng('course:learner:L1:150')
    const b = seededRng('course:learner:L1:150')
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })
  it('differs across seeds (round changes the stream)', () => {
    const r150 = Array.from({ length: 5 }, seededRng('c:l:L1:150'))
    const r200 = Array.from({ length: 5 }, seededRng('c:l:L1:200'))
    expect(r150).not.toEqual(r200)
  })
  it('stays in [0,1)', () => {
    const r = seededRng('x')
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

// ----------------------------------------------------------------------------
// sampleSeeded — no-replacement, deterministic, edge cases
// ----------------------------------------------------------------------------
describe('sampleSeeded', () => {
  const pool = Array.from({ length: 50 }, (_, i) => i + 1)
  it('returns exactly n distinct items from the pool', () => {
    const out = sampleSeeded(pool, 20, seededRng('s1'))
    expect(out).toHaveLength(20)
    expect(new Set(out).size).toBe(20) // no replacement
    expect(out.every((x) => pool.includes(x))).toBe(true)
  })
  it('is deterministic for a given rng seed', () => {
    expect(sampleSeeded(pool, 20, seededRng('s1'))).toEqual(sampleSeeded(pool, 20, seededRng('s1')))
  })
  it('different seeds → (almost surely) different samples', () => {
    expect(sampleSeeded(pool, 20, seededRng('s1'))).not.toEqual(sampleSeeded(pool, 20, seededRng('s2')))
  })
  it('n >= length returns a full copy; n <= 0 returns empty', () => {
    expect(sampleSeeded(pool, 999, seededRng('x'))).toHaveLength(50)
    expect(sampleSeeded(pool, 0, seededRng('x'))).toEqual([])
    expect(sampleSeeded(pool, -3, seededRng('x'))).toEqual([])
  })
  it('does not mutate the input', () => {
    const copy = [...pool]
    sampleSeeded(pool, 10, seededRng('x'))
    expect(pool).toEqual(copy)
  })
})

// ----------------------------------------------------------------------------
// computeSeedLastOrdinals — last LEGO per seed, absolute ordinal
// ----------------------------------------------------------------------------
describe('computeSeedLastOrdinals', () => {
  it("maps each seed to its highest-index LEGO's absolute ordinal", () => {
    // seed 1: legos 1,2,3 → ordinals 1,2,3 (last = 3)
    // seed 2: legos 1,2   → ordinals 4,5   (last = 5)
    // seed 3: lego 1      → ordinal 6      (last = 6)
    const cat = [
      { seed_number: 1, lego_index: 1 },
      { seed_number: 1, lego_index: 2 },
      { seed_number: 1, lego_index: 3 },
      { seed_number: 2, lego_index: 1 },
      { seed_number: 2, lego_index: 2 },
      { seed_number: 3, lego_index: 1 },
    ]
    const m = computeSeedLastOrdinals(cat)
    expect(m.get(1)).toBe(3)
    expect(m.get(2)).toBe(5)
    expect(m.get(3)).toBe(6)
  })
  it("matches Tom's example: seed 1 last LEGO = 5th overall", () => {
    // seed 1 has 5 legos → its last LEGO is ordinal 5
    const cat = Array.from({ length: 5 }, (_, i) => ({ seed_number: 1, lego_index: i + 1 }))
    expect(computeSeedLastOrdinals(cat).get(1)).toBe(5)
  })
})

// ----------------------------------------------------------------------------
// drainedSeedsAt — graduation at lastOrdinal + offset, graduation order
// ----------------------------------------------------------------------------
describe('drainedSeedsAt', () => {
  // seed 1 last @ 5, seed 2 last @ 12, seed 3 last @ 20
  const lastOrd = new Map([[1, 5], [2, 12], [3, 20]])
  const offset = 90

  it("Tom's example: seed 1 (last LEGO @ 5) drains at round 95, not 94", () => {
    expect(drainedSeedsAt(lastOrd, 94, offset)).toEqual([]) // 94 - 5 = 89 < 90
    expect(drainedSeedsAt(lastOrd, 95, offset)).toEqual([1]) // 95 - 5 = 90 >= 90
  })
  it('accumulates seeds as the course advances', () => {
    expect(drainedSeedsAt(lastOrd, 95, offset)).toEqual([1])
    expect(drainedSeedsAt(lastOrd, 102, offset)).toEqual([1, 2]) // 102-12=90
    expect(drainedSeedsAt(lastOrd, 110, offset)).toEqual([1, 2, 3]) // 110-20=90
  })
  it('returns graduation order (oldest-graduated first)', () => {
    // shuffle insertion order; output must still be by ascending lastOrd
    const shuffled = new Map([[3, 20], [1, 5], [2, 12]])
    expect(drainedSeedsAt(shuffled, 200, offset)).toEqual([1, 2, 3])
  })
  it('ignores seeds with ordinal 0 / not-yet-reached', () => {
    expect(drainedSeedsAt(lastOrd, 50, offset)).toEqual([])
  })
})

// ----------------------------------------------------------------------------
// composeBucket — the 80/20 cap, determinism, retirement rotation
// ----------------------------------------------------------------------------
describe('composeBucket', () => {
  const cfg = { bucketCap: 100, activeSize: 80 }
  // graduation order = seedNum here (oldest first); ordinals = seedNum for simplicity
  const drained = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
  const ords = (n: number) => new Map(drained(n).map((s) => [s, s]))

  it('≤ cap → returns the whole drained list unchanged', () => {
    expect(composeBucket(drained(1), cfg, seededRng('x'), ords(1))).toEqual([1])
    expect(composeBucket(drained(100), cfg, seededRng('x'), ords(100))).toEqual(drained(100))
  })

  it('> cap → exactly bucketCap seeds (80 active + 20 retired)', () => {
    const out = composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300))
    expect(out).toHaveLength(100)
    expect(new Set(out).size).toBe(100) // distinct
  })

  it('> cap → ALWAYS includes the 80 freshest (highest ordinals 221..300)', () => {
    const out = new Set(composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300)))
    for (let s = 221; s <= 300; s++) expect(out.has(s)).toBe(true) // freshest 80 always present
  })

  it('> cap → the other 20 come only from the retired pool (1..220)', () => {
    const active = new Set(Array.from({ length: 80 }, (_, i) => 221 + i))
    const out = composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300))
    const extras = out.filter((s) => !active.has(s))
    expect(extras).toHaveLength(20)
    expect(extras.every((s) => s >= 1 && s <= 220)).toBe(true)
  })

  it('is deterministic for the same (drained, seed)', () => {
    const a = composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300))
    const b = composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300))
    expect(a).toEqual(b)
  })

  it('rotates the retired sample across rounds (never forgotten)', () => {
    const r150 = composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300))
    const r200 = composeBucket(drained(300), cfg, seededRng('c:l:L1:200'), ords(300))
    const retired150 = new Set(r150.filter((s) => s <= 220))
    const retired200 = r200.filter((s) => s <= 220)
    // different draw → at least some retired seeds differ between sessions
    expect(retired200.some((s) => !retired150.has(s))).toBe(true)
  })

  it('output is in graduation order (ascending ordinal) for both passes to share', () => {
    const out = composeBucket(drained(300), cfg, seededRng('c:l:L1:150'), ords(300))
    const sorted = [...out].sort((a, b) => a - b)
    expect(out).toEqual(sorted)
  })

  it('caps a long course (300 seeds) at 100 → 200 plays ≈ ~10 min, never more', () => {
    for (const n of [101, 150, 300, 1000]) {
      expect(composeBucket(drained(n), cfg, seededRng(`r${n}`), ords(n))).toHaveLength(100)
    }
  })
})

// ----------------------------------------------------------------------------
// shouldFireAtRound — cadence gate
// ----------------------------------------------------------------------------
describe('shouldFireAtRound', () => {
  const cfg = { interval: 50, activationRound: 100 }
  it('does not fire before activation', () => {
    expect(shouldFireAtRound(99, cfg)).toBe(false)
    expect(shouldFireAtRound(50, cfg)).toBe(false)
  })
  it('fires at activation and every interval after', () => {
    expect(shouldFireAtRound(100, cfg)).toBe(true)
    expect(shouldFireAtRound(150, cfg)).toBe(true)
    expect(shouldFireAtRound(200, cfg)).toBe(true)
  })
  it('does not fire off-cadence', () => {
    expect(shouldFireAtRound(101, cfg)).toBe(false)
    expect(shouldFireAtRound(149, cfg)).toBe(false)
    expect(shouldFireAtRound(175, cfg)).toBe(false)
  })
})

// ----------------------------------------------------------------------------
// defaults sanity
// ----------------------------------------------------------------------------
describe('DEFAULT_LAYER1_CONFIG', () => {
  it('matches the agreed spec (offset 90, every 50 rounds, cap 100, 80 active)', () => {
    expect(DEFAULT_LAYER1_CONFIG).toMatchObject({
      offset: 90,
      interval: 50,
      activationRound: 100,
      bucketCap: 100,
      activeSize: 80,
    })
  })
})
