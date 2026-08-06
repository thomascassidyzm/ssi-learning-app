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
  buildSeedPlays,
  DEFAULT_LAYER1_CONFIG,
  useLayer1Scheduler,
} from './useLayer1Scheduler'

// ============================================================================
// Supabase mock — covers the three query shapes initialize() issues:
//   .from('course_seeds').select(...).eq(...).order(...).limit(...)
//   .from('course_legos').select(...).eq(...).order(...).order(...).limit(...)
//   .from('course_audio').select(...).eq(...).in(...)
// ============================================================================
function makeMockSupabase(state: { seeds: any[]; catalogue: any[]; bookends: any[] }) {
  const builder = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      then: (cb: any) => {
        if (table === 'course_seeds') return Promise.resolve({ data: state.seeds, error: null }).then(cb)
        if (table === 'course_legos') return Promise.resolve({ data: state.catalogue, error: null }).then(cb)
        if (table === 'course_audio') return Promise.resolve({ data: state.bookends, error: null }).then(cb)
        return Promise.resolve({ data: null, error: null }).then(cb)
      },
    }
    return chain
  }
  return { from: builder } as any
}

const l1Seed = (n: number, hasAudio = true) => ({
  seed_number: n,
  known_text: `K${n}`,
  target_text: `T${n}`,
  target_text_roman: null,
  known_audio_id: hasAudio ? `kn-${n}` : null,
  target1_audio_id: hasAudio ? `tgt1-${n}` : null,
  target2_audio_id: hasAudio ? `tgt2-${n}` : null,
})

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
// composeCupSeeds — cup membership + order (cluster first, then loose oldest→newest).
// No tiers/decay: every seed plays the same four-slot sandwich (see buildSeedPlays / nextLap).
// ----------------------------------------------------------------------------
describe('composeCupSeeds', () => {
  const cfg = { clusterStep: 5 }
  // cluster seeds labelled 1000+ so they're distinguishable from loose;
  // loose seed for a batch == the batch number (so order is legible).
  const clusterProvider = (size: number) => Array.from({ length: size }, (_, i) => 1000 + i)
  const looseProvider = (batch: number) => batch
  const compose = (p: number) =>
    composeCupSeeds({ seedsPerCup: p, cupIndex: 0, cfg, clusterProvider, looseProvider })

  it('p=1: a single loose seed', () => {
    expect(compose(1)).toEqual([1])
  })

  it('all-loose below the first cluster step, oldest→newest', () => {
    expect(compose(2)).toEqual([1, 2])
    expect(compose(3)).toEqual([1, 2, 3])
    expect(compose(4)).toEqual([1, 2, 3, 4])
  })

  it('p=5 (cluster milestone): the whole authored cluster, no loose', () => {
    expect(compose(5)).toEqual([1000, 1001, 1002, 1003, 1004])
  })

  it('cluster first (template order), then loose tail (oldest→newest)', () => {
    expect(compose(6)).toEqual([1000, 1001, 1002, 1003, 1004, 6])
    expect(compose(7)).toEqual([1000, 1001, 1002, 1003, 1004, 6, 7])
  })

  it('p=10 (re-cluster milestone): ten cluster seeds, no loose', () => {
    expect(compose(10)).toEqual(Array.from({ length: 10 }, (_, i) => 1000 + i))
  })

  it('seed count per cup equals p (cluster + loose, no overlap)', () => {
    for (const p of [1, 4, 5, 6, 9, 10, 15, 20]) expect(compose(p)).toHaveLength(p)
  })
})

// ----------------------------------------------------------------------------
// buildSeedPlays — the per-seed comprehensible-input sandwich (Tom + Aran,
// 2026-07-14): target @1× (v1) → known @1× → target @1× (v2) → target @1× (v1)
// ----------------------------------------------------------------------------
describe('buildSeedPlays', () => {
  const full = {
    seedNumber: 7,
    target1Id: 't1',
    target2Id: 't2',
    knownId: 'k',
    targetText: 'voglio imparare',
    knownText: 'I want to learn',
  }

  it('emits the 4-slot t·k·t·t sandwich, target slots belt-ramped', () => {
    const plays = buildSeedPlays(full)
    expect(plays.map((p) => p.role)).toEqual(['ps', 'trans', 'ps', 'ps'])
    // seedNumber 7 = white belt ⇒ 0.8× on the target slots; known stays 1.0×.
    expect(plays.map((p) => p.playbackSpeed)).toEqual([0.8, 1.0, 0.8, 0.8])
    expect(plays.map((p) => p.audioId)).toEqual(['t1', 'k', 't2', 't1'])
    expect(plays.every((p) => p.seedNumber === 7)).toBe(true)
  })

  it('shows known text only on the trans slot; target text on the rest', () => {
    const plays = buildSeedPlays(full)
    expect(plays.map((p) => p.text)).toEqual([
      'voglio imparare', 'I want to learn', 'voglio imparare', 'voglio imparare',
    ])
  })

  it('falls back to voice 1 for the second target when no voice 2', () => {
    const plays = buildSeedPlays({ ...full, target2Id: null })
    expect(plays.map((p) => p.audioId)).toEqual(['t1', 'k', 't1', 't1'])
  })

  it('drops (never silences) the trans slot when the seed has no known audio', () => {
    const plays = buildSeedPlays({ ...full, knownId: null })
    expect(plays.map((p) => p.role)).toEqual(['ps', 'ps', 'ps'])
    expect(plays.some((p) => p.role === 'trans')).toBe(false)
  })

  it('is pure/deterministic — same input, identical plays', () => {
    expect(buildSeedPlays(full)).toEqual(buildSeedPlays(full))
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

// ----------------------------------------------------------------------------
// nextLapPreviewFallback — ?l1=1 preview cheat
// ----------------------------------------------------------------------------
describe('useLayer1Scheduler — nextLapPreviewFallback (?l1=1 preview cheat)', () => {
  it('returns null before initialize()', () => {
    const s = useLayer1Scheduler({
      supabase: makeMockSupabase({ seeds: [], catalogue: [], bookends: [] }),
      courseCode: 'c',
      learnerId: 'u',
    })
    expect(s.nextLapPreviewFallback(1)).toBeNull()
  })

  it('returns null when the course has no seeds at all', async () => {
    const s = useLayer1Scheduler({
      supabase: makeMockSupabase({ seeds: [], catalogue: [], bookends: [] }),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    expect(s.nextLapPreviewFallback(1)).toBeNull()
  })

  it('sandwiches the first few course seeds even at round 1, before nextLap() has any content', async () => {
    // Default config activates at 30 introduced seeds — nextLap(1) is null
    // this early regardless of catalogue size. The fallback ignores
    // activation entirely and uses introductionOrder (computed once from the
    // static catalogue at init, independent of mainRound).
    const catalogue = Array.from({ length: 6 }, (_, i) => ({ seed_number: i + 1, lego_index: 1 }))
    const seeds = Array.from({ length: 6 }, (_, i) => l1Seed(i + 1))
    const s = useLayer1Scheduler({
      supabase: makeMockSupabase({ seeds, catalogue, bookends: [] }),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    expect(s.nextLap(1)).toBeNull() // confirms real nextLap genuinely has nothing yet
    const lap = s.nextLapPreviewFallback(1)
    expect(lap).not.toBeNull()
    expect(lap!.plays.length).toBeGreaterThan(0)
    const seedNums = new Set(lap!.plays.map(p => p.seedNumber))
    expect(seedNums.size).toBeGreaterThan(0)
    expect(Math.max(...seedNums)).toBeLessThanOrEqual(4) // "first few" — order.slice(0, 4)
  })

  it('skips seeds with no audio and still finds a playable one among the first few', async () => {
    const catalogue = Array.from({ length: 4 }, (_, i) => ({ seed_number: i + 1, lego_index: 1 }))
    const seeds = [l1Seed(1, false), l1Seed(2, false), l1Seed(3, true), l1Seed(4, false)]
    const s = useLayer1Scheduler({
      supabase: makeMockSupabase({ seeds, catalogue, bookends: [] }),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    const lap = s.nextLapPreviewFallback(1)
    expect(lap).not.toBeNull()
    expect(lap!.plays.every(p => p.seedNumber === 3)).toBe(true)
  })

  it('returns null when none of the first few seeds have audio', async () => {
    const catalogue = Array.from({ length: 4 }, (_, i) => ({ seed_number: i + 1, lego_index: 1 }))
    const seeds = Array.from({ length: 4 }, (_, i) => l1Seed(i + 1, false))
    const s = useLayer1Scheduler({
      supabase: makeMockSupabase({ seeds, catalogue, bookends: [] }),
      courseCode: 'c',
      learnerId: 'u',
    })
    await s.initialize()
    expect(s.nextLapPreviewFallback(1)).toBeNull()
  })
})
