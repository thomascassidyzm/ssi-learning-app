import { describe, it, expect } from 'vitest'
import {
  seededRng,
  shuffleSeeded,
  computeSeedLastOrdinals,
  buildIntroductionOrder,
  introducedCountAt,
  seedsPerCup,
  clusterSizeFor,
  cupIndexFor,
  isFrozenAt,
  fallbackCluster,
  composeCupSeeds,
  type Layer1Tier,
  DEFAULT_LAYER1_CONFIG,
} from './useLayer1Scheduler'

// ----------------------------------------------------------------------------
// seededRng — deterministic, well-distributed enough
// ----------------------------------------------------------------------------
describe('seededRng', () => {
  it('is deterministic: same seed → identical stream', () => {
    const a = seededRng('course:learner:L1:150')
    const b = seededRng('course:learner:L1:150')
    expect(Array.from({ length: 10 }, () => a())).toEqual(Array.from({ length: 10 }, () => b()))
  })
  it('differs across seeds', () => {
    const r1 = Array.from({ length: 5 }, seededRng('c:l:L1batch:1'))
    const r2 = Array.from({ length: 5 }, seededRng('c:l:L1batch:2'))
    expect(r1).not.toEqual(r2)
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
// shuffleSeeded — permutation, deterministic, non-mutating
// ----------------------------------------------------------------------------
describe('shuffleSeeded', () => {
  const pool = Array.from({ length: 30 }, (_, i) => i + 1)
  it('is a permutation (same multiset, no loss)', () => {
    const out = shuffleSeeded(pool, seededRng('s'))
    expect(out).toHaveLength(30)
    expect([...out].sort((a, b) => a - b)).toEqual(pool)
  })
  it('is deterministic for a given rng seed', () => {
    expect(shuffleSeeded(pool, seededRng('s'))).toEqual(shuffleSeeded(pool, seededRng('s')))
  })
  it('different seeds → (almost surely) different order', () => {
    expect(shuffleSeeded(pool, seededRng('s1'))).not.toEqual(shuffleSeeded(pool, seededRng('s2')))
  })
  it('does not mutate the input', () => {
    const copy = [...pool]
    shuffleSeeded(pool, seededRng('x'))
    expect(pool).toEqual(copy)
  })
})

// ----------------------------------------------------------------------------
// computeSeedLastOrdinals + buildIntroductionOrder
// ----------------------------------------------------------------------------
describe('computeSeedLastOrdinals', () => {
  it("maps each seed to its last LEGO's absolute ordinal", () => {
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
})

describe('buildIntroductionOrder', () => {
  it('sorts seeds by introduction (last-LEGO) ordinal, ties by seed number', () => {
    const m = new Map([[3, 20], [1, 5], [2, 12]])
    const { order, ordinals } = buildIntroductionOrder(m)
    expect(order).toEqual([1, 2, 3])
    expect(ordinals).toEqual([5, 12, 20])
  })
  it('drops seeds with ordinal ≤ 0', () => {
    const m = new Map([[1, 0], [2, 4]])
    expect(buildIntroductionOrder(m).order).toEqual([2])
  })
})

// ----------------------------------------------------------------------------
// introducedCountAt — count of last-ordinals ≤ round
// ----------------------------------------------------------------------------
describe('introducedCountAt', () => {
  const ords = [3, 5, 6, 12, 20]
  it('counts seeds fully introduced by the round', () => {
    expect(introducedCountAt(ords, 2)).toBe(0)
    expect(introducedCountAt(ords, 5)).toBe(2)
    expect(introducedCountAt(ords, 6)).toBe(3)
    expect(introducedCountAt(ords, 100)).toBe(5)
  })
})

// ----------------------------------------------------------------------------
// seedsPerCup — min(20, floor(count / 30)), 0 before activation
// ----------------------------------------------------------------------------
describe('seedsPerCup', () => {
  const cfg = { cups: 30, maxSeedsPerCup: 20 }
  it('is 0 until a full cup is available (30 introduced)', () => {
    expect(seedsPerCup(0, cfg)).toBe(0)
    expect(seedsPerCup(29, cfg)).toBe(0)
  })
  it('grows one per cup per 30-seed batch', () => {
    expect(seedsPerCup(30, cfg)).toBe(1)
    expect(seedsPerCup(59, cfg)).toBe(1)
    expect(seedsPerCup(60, cfg)).toBe(2)
    expect(seedsPerCup(150, cfg)).toBe(5)
    expect(seedsPerCup(300, cfg)).toBe(10)
  })
  it('caps at 20/cup (600 introduced)', () => {
    expect(seedsPerCup(600, cfg)).toBe(20)
    expect(seedsPerCup(630, cfg)).toBe(20)
    expect(seedsPerCup(5000, cfg)).toBe(20)
  })
})

// ----------------------------------------------------------------------------
// clusterSizeFor — largest multiple of 5 ≤ p
// ----------------------------------------------------------------------------
describe('clusterSizeFor', () => {
  it('is 0 below the first cluster step', () => {
    for (const p of [0, 1, 2, 3, 4]) expect(clusterSizeFor(p, 5)).toBe(0)
  })
  it('snaps down to the nearest multiple of the step', () => {
    expect(clusterSizeFor(5, 5)).toBe(5)
    expect(clusterSizeFor(9, 5)).toBe(5)
    expect(clusterSizeFor(10, 5)).toBe(10)
    expect(clusterSizeFor(14, 5)).toBe(10)
    expect(clusterSizeFor(20, 5)).toBe(20)
  })
})

// ----------------------------------------------------------------------------
// cupIndexFor — the 30-slot wheel
// ----------------------------------------------------------------------------
describe('cupIndexFor', () => {
  it('pours cup 0 at activation, advancing one per round, wrapping every 30', () => {
    expect(cupIndexFor(100, 100, 30)).toBe(0)
    expect(cupIndexFor(101, 100, 30)).toBe(1)
    expect(cupIndexFor(129, 100, 30)).toBe(29)
    expect(cupIndexFor(130, 100, 30)).toBe(0) // full turn
    expect(cupIndexFor(161, 100, 30)).toBe(1)
  })
})

// ----------------------------------------------------------------------------
// isFrozenAt — introductions exhausted → settle to floor & loop
// ----------------------------------------------------------------------------
describe('isFrozenAt', () => {
  const cfg = { cups: 30, maxSeedsPerCup: 20 } // cap = 600
  it('freezes when a SHORT course is fully introduced (its own end)', () => {
    const ords = Array.from({ length: 90 }, (_, i) => i + 1) // 90 seeds, intro rounds 1..90
    expect(isFrozenAt(ords, 89, cfg)).toBe(false)
    expect(isFrozenAt(ords, 90, cfg)).toBe(true) // all 90 introduced
  })
  it('freezes at the 600 cap on a LONG course', () => {
    const ords = Array.from({ length: 900 }, (_, i) => i + 1)
    expect(isFrozenAt(ords, 599, cfg)).toBe(false)
    expect(isFrozenAt(ords, 600, cfg)).toBe(true)
  })
})

// ----------------------------------------------------------------------------
// fallbackCluster — deterministic contiguous grouping (pre-Aran)
// ----------------------------------------------------------------------------
describe('fallbackCluster', () => {
  const intro = [10, 20, 30, 40, 50, 60]
  it('hands each cup a contiguous block of the introduction order', () => {
    expect(fallbackCluster(2, 0, intro)).toEqual([10, 20])
    expect(fallbackCluster(2, 1, intro)).toEqual([30, 40])
    expect(fallbackCluster(2, 2, intro)).toEqual([50, 60])
  })
})

// ----------------------------------------------------------------------------
// composeCupSeeds — the heart: cup membership + decay tiers
// ----------------------------------------------------------------------------
describe('composeCupSeeds', () => {
  const cfg = { clusterStep: 5 }
  // cluster seeds labelled 1000+ so they're distinguishable from loose;
  // loose seed for a batch == the batch number (so order/tier is legible).
  const clusterProvider = (size: number) => Array.from({ length: size }, (_, i) => 1000 + i)
  const looseProvider = (batch: number) => batch
  const compose = (p: number, frozen = false) =>
    composeCupSeeds({ seedsPerCup: p, cupIndex: 0, frozen, cfg, clusterProvider, looseProvider })
  const tiers = (p: number, frozen = false) => compose(p, frozen).map((x) => x.tier)
  const seedsOf = (p: number) => compose(p).map((x) => x.seed)

  it('p=1: a single debut', () => {
    expect(compose(1)).toEqual([{ seed: 1, tier: 'debut' }])
  })

  it('reproduces the filling-phase trace tiers (cup #7, 30→120)', () => {
    expect(compose(2)).toEqual([{ seed: 1, tier: 'mid' }, { seed: 2, tier: 'debut' }])
    expect(compose(3)).toEqual([
      { seed: 1, tier: 'floor' }, { seed: 2, tier: 'mid' }, { seed: 3, tier: 'debut' },
    ])
    expect(tiers(4)).toEqual(['floor', 'floor', 'mid', 'debut'])
  })

  it('p=5 (bare cluster milestone): the whole cluster at mid, NO debut', () => {
    const out = compose(5)
    expect(out).toHaveLength(5)
    expect(out.every((x) => x.tier === 'mid')).toBe(true)
    expect(out.map((x) => x.seed)).toEqual([1000, 1001, 1002, 1003, 1004]) // authored cluster
  })

  it('p=6: cluster drops to floor, the lone loose seed debuts', () => {
    const out = compose(6)
    expect(out.slice(0, 5).every((x) => x.tier === 'floor')).toBe(true) // the 5-cluster
    expect(out[5]).toEqual({ seed: 6, tier: 'debut' }) // loose batch-6 seed
  })

  it('p=7: cluster floor; loose newest=debut, 2nd-newest=mid', () => {
    const out = compose(7)
    expect(out.slice(0, 5).every((x) => x.tier === 'floor')).toBe(true)
    expect(out.slice(5)).toEqual([{ seed: 6, tier: 'mid' }, { seed: 7, tier: 'debut' }])
  })

  it('p=10 (re-cluster milestone): ten cluster seeds all at mid', () => {
    const out = compose(10)
    expect(out).toHaveLength(10)
    expect(out.every((x) => x.tier === 'mid')).toBe(true)
  })

  it('INVARIANT (non-frozen, non-milestone): exactly one debut + at most one mid', () => {
    for (let p = 1; p <= 20; p++) {
      const t = tiers(p)
      const debut = t.filter((x) => x === 'debut').length
      const mid = t.filter((x) => x === 'mid').length
      if (p % 5 === 0) {
        // bare milestone: whole cluster at mid, no debut
        expect(debut).toBe(0)
        expect(t.every((x) => x === 'mid')).toBe(true)
      } else {
        expect(debut).toBe(1)
        expect(mid).toBeLessThanOrEqual(1)
      }
    }
  })

  it('frozen: everything rests at the floor (forever loop)', () => {
    expect(tiers(5, true).every((x: Layer1Tier) => x === 'floor')).toBe(true)
    expect(tiers(7, true).every((x: Layer1Tier) => x === 'floor')).toBe(true)
    expect(tiers(20, true).every((x: Layer1Tier) => x === 'floor')).toBe(true)
  })

  it('seed count per cup equals p (cluster + loose, no overlap)', () => {
    for (const p of [1, 4, 5, 6, 9, 10, 15, 20]) expect(seedsOf(p)).toHaveLength(p)
  })
})

// ----------------------------------------------------------------------------
// defaults sanity
// ----------------------------------------------------------------------------
describe('DEFAULT_LAYER1_CONFIG', () => {
  it('matches the 30-cup spec (30 cups, activate at 30, cap 20/cup, cluster step 5)', () => {
    expect(DEFAULT_LAYER1_CONFIG).toMatchObject({
      cups: 30,
      activationCount: 30,
      maxSeedsPerCup: 20,
      clusterStep: 5,
    })
  })
})
