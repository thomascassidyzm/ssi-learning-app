/**
 * generateScript tests — cover both main-loop and INF PLAY paths against
 * a hand-built CourseBundle fixture.
 */

import { describe, it, expect } from 'vitest'
import { generateScript } from './generateScript'
import type {
  BundleAudioRef,
  BundleLego,
  BundlePhrase,
  BundleRoundMapEntry,
  CourseBundle,
} from '../types/courseBundle'

// ---------------------------------------------------------------------------
// Tiny seeded RNG so INF PLAY tests can be deterministic. Same algorithm as
// the docstring in the brief — mulberry32 returns a [0,1) float.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------
function audioRef(id: string, durationMs = 1500): BundleAudioRef {
  return { id, lifecycle: 'ephemeral', durationMs }
}

function persistentAudioRef(id: string, durationMs = 1500): BundleAudioRef {
  return { id, lifecycle: 'persistent', durationMs }
}

interface MakeLegoOpts {
  seedNumber: number
  legoIndex?: number
  type?: 'A' | 'M' | null
  knownText?: string
  targetText?: string
  targetTextNative?: string
  isNew?: boolean
  /** When false, omit a piece of ephemeral audio so we can exercise skip-policy. */
  withKnown?: boolean
  withTarget1?: boolean
  withTarget2?: boolean
  withPresentation?: boolean
  components?: Array<{ known: string; target: string }>
}

function makeLego(opts: MakeLegoOpts): BundleLego {
  const idx = opts.legoIndex ?? 1
  const legoId = `S${String(opts.seedNumber).padStart(4, '0')}L${String(idx).padStart(2, '0')}`
  return {
    legoId,
    seedNumber: opts.seedNumber,
    legoIndex: idx,
    seedId: `S${String(opts.seedNumber).padStart(4, '0')}`,
    type: opts.type ?? 'A',
    knownText: opts.knownText ?? `known-${legoId}`,
    targetText: opts.targetText ?? `target-${legoId}`,
    ...(opts.targetTextNative !== undefined ? { targetTextNative: opts.targetTextNative } : {}),
    ...(opts.components ? { components: opts.components } : {}),
    isNew: opts.isNew ?? true,
    ephemeralAudio: {
      ...(opts.withKnown !== false ? { known: audioRef(`${legoId}-known`, 1200) } : {}),
      ...(opts.withTarget1 !== false ? { target1: audioRef(`${legoId}-t1`, 1500) } : {}),
      ...(opts.withTarget2 !== false ? { target2: audioRef(`${legoId}-t2`, 1500) } : {}),
      ...(opts.withPresentation !== false
        ? { presentation: audioRef(`${legoId}-pres`, 2000) }
        : {}),
    },
  }
}

function makePhrase(
  legoId: string,
  role: 'build' | 'use',
  position: number,
  opts: { targetTextNative?: string; complete?: boolean } = {},
): BundlePhrase {
  const phraseId = `${legoId}_${role}_${String(position).padStart(2, '0')}`
  const complete = opts.complete !== false
  return {
    phraseId,
    legoId,
    position,
    role,
    knownText: `known-${phraseId}`,
    targetText: `target-${phraseId}`,
    ...(opts.targetTextNative !== undefined ? { targetTextNative: opts.targetTextNative } : {}),
    audio: {
      ...(complete ? { known: persistentAudioRef(`${phraseId}-known`, 1200) } : {}),
      ...(complete ? { target1: persistentAudioRef(`${phraseId}-t1`, 1500) } : {}),
      ...(complete ? { target2: persistentAudioRef(`${phraseId}-t2`, 1500) } : {}),
    },
  }
}

interface FixtureOpts {
  legoCount?: number
  buildsPerLego?: number
  usesPerLego?: number
}

function makeBundle(opts: FixtureOpts = {}): CourseBundle {
  const legoCount = opts.legoCount ?? 5
  const buildsPerLego = opts.buildsPerLego ?? 2
  const usesPerLego = opts.usesPerLego ?? 3

  const legos: BundleLego[] = []
  const phrases: BundlePhrase[] = []
  const roundMap: BundleRoundMapEntry[] = []

  for (let i = 1; i <= legoCount; i++) {
    // Mix A/M legos so we exercise the components branch.
    const isM = i % 2 === 0
    const lego = makeLego({
      seedNumber: i,
      legoIndex: 1,
      type: isM ? 'M' : 'A',
      ...(isM
        ? {
            components: [
              { known: `c1k-${i}`, target: `c1t-${i}` },
              { known: `c2k-${i}`, target: `c2t-${i}` },
            ],
          }
        : {}),
    })
    legos.push(lego)
    for (let b = 1; b <= buildsPerLego; b++) {
      phrases.push(makePhrase(lego.legoId, 'build', b))
    }
    for (let u = 1; u <= usesPerLego; u++) {
      phrases.push(makePhrase(lego.legoId, 'use', u))
    }
    roundMap.push({ roundIndex: i, legoId: lego.legoId, seedNumber: i })
  }

  return {
    courseCode: 'test_course',
    version: 1,
    mainLoopCount: legoCount,
    legos,
    phrases,
    seeds: legos.map((l) => ({ seedId: l.seedId, seedNumber: l.seedNumber })),
    roundMap,
    pods: [],
  }
}

// ===========================================================================
// MAIN MODE
// ===========================================================================
describe('generateScript — main mode', () => {
  it('happy path: emits intro + debut + builds + uses for each LEGO', () => {
    const bundle = makeBundle({ legoCount: 5, buildsPerLego: 2, usesPerLego: 3 })
    const { rounds, next } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })

    expect(rounds).toHaveLength(5)
    // Round 1: intro + debut + 2 builds + 3 uses = 7 (no spaced rep at round 1).
    const r1 = rounds[0]
    expect(r1.roundNumber).toBe(1)
    expect(r1.legoId).toBe('S0001L01')
    expect(r1.cycles).toHaveLength(7)
    expect(r1.cycles[0].type).toBe('intro')
    expect(r1.cycles[1].type).toBe('debut')
    expect(r1.cycles.slice(2, 4).every((c) => c.type === 'build')).toBe(true)
    expect(r1.cycles.slice(4, 7).every((c) => c.type === 'use')).toBe(true)

    // Cycle 1 (intro) has pauseDuration 0 + lingerMs 2000.
    expect(r1.cycles[0].pauseDuration).toBe(0)
    expect(r1.cycles[0].lingerMs).toBe(2000)
    // Debut + build/use have positive pauseDuration.
    expect(r1.cycles[1].pauseDuration).toBeGreaterThan(0)
    expect(r1.cycles[1].lingerMs).toBeUndefined()

    // next.legoId is null because we consumed the entire course.
    expect(next).toEqual({ mode: 'main', legoId: null })
  })

  it('pagination: next.legoId points to the round AFTER the last emitted', () => {
    const bundle = makeBundle({ legoCount: 20 })
    const { rounds, next } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
      // default roundLimit = 15
    })
    expect(rounds).toHaveLength(15)
    expect(next).toEqual({ mode: 'main', legoId: 'S0016L01' })
  })

  it('pagination: next.legoId null at course end', () => {
    const bundle = makeBundle({ legoCount: 3 })
    const { next } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })
    expect(next).toEqual({ mode: 'main', legoId: null })
  })

  it('throws when fromLegoId is not in the round map', () => {
    const bundle = makeBundle({ legoCount: 3 })
    expect(() =>
      generateScript({
        bundle,
        position: { mode: 'main', fromLegoId: 'S9999L99' },
      }),
    ).toThrowError(/legoId not in round map/)
  })

  it('skip-policy: a LEGO missing target audio yields no debut/intro but rest of the round continues', () => {
    const bundle = makeBundle({ legoCount: 3, buildsPerLego: 1, usesPerLego: 3 })
    // Strip target1/target2 from the second LEGO so intro AND debut are dropped.
    bundle.legos[1].ephemeralAudio.target1 = undefined
    bundle.legos[1].ephemeralAudio.target2 = undefined

    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })

    // Round 2 should have no intro / no debut, but builds + uses + spaced
    // rep still emit.
    const r2 = rounds[1]
    expect(r2.legoId).toBe('S0002L01')
    expect(r2.cycles.some((c) => c.type === 'intro')).toBe(false)
    expect(r2.cycles.some((c) => c.type === 'debut')).toBe(false)
    // Builds (1) + Uses (3) + spaced rep from round 1's lego (offset 1 → 3 phrases).
    // = 1 + 3 + 3 = 7
    expect(r2.cycles.filter((c) => c.type === 'build')).toHaveLength(1)
    expect(r2.cycles.filter((c) => c.type === 'use')).toHaveLength(3)
    expect(r2.cycles.filter((c) => c.type === 'review')).toHaveLength(3)
  })

  it('spaced rep: round 2 reviews round 1 lego; round 4 reviews rounds 1/2/3; N-1 emits 3 cycles', () => {
    const bundle = makeBundle({ legoCount: 6, buildsPerLego: 0, usesPerLego: 4 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })

    // Round 2 (index 1 in rounds[]) — offsets 1 is the only one that hits a
    // valid review round. N-1 fires 3 phrases for round 1's lego.
    const r2 = rounds[1]
    const r2reviews = r2.cycles.filter((c) => c.type === 'review')
    expect(r2reviews).toHaveLength(3)
    expect(r2reviews.every((c) => c.legoId === 'S0001L01')).toBe(true)

    // Round 4 (rounds[3]) — offsets 1 (→ R3), 2 (→ R2), 3 (→ R1) all valid.
    // N-1 = 3 reviews from S0003L01, plus 1 from S0002L01 + 1 from S0001L01.
    const r4 = rounds[3]
    const r4reviews = r4.cycles.filter((c) => c.type === 'review')
    expect(r4reviews).toHaveLength(5)
    const reviewsByLego = new Map<string, number>()
    for (const c of r4reviews) {
      reviewsByLego.set(c.legoId!, (reviewsByLego.get(c.legoId!) ?? 0) + 1)
    }
    expect(reviewsByLego.get('S0003L01')).toBe(3) // offset 1 = N-1
    expect(reviewsByLego.get('S0002L01')).toBe(1) // offset 2
    expect(reviewsByLego.get('S0001L01')).toBe(1) // offset 3
  })

  it('spaced rep dedup: when fib offsets land on the same lego, that lego is reviewed only once', () => {
    // With legoCount=9 and current round = 9: offsets 1, 2, 3, 5, 8 are all
    // in-range. Offset 1 hits R8, offset 8 hits R1; no overlap there. To
    // force a dedup collision we'd need offsets that resolve to the same
    // round, which the canonical fib list doesn't produce. So instead we
    // verify dedup by giving multiple round-map entries the same legoId
    // — practical safeguard against duplicate references — and confirming
    // only one set of reviews fires.
    const bundle = makeBundle({ legoCount: 4, buildsPerLego: 0, usesPerLego: 3 })
    // Point round 3's entry at the same LEGO as round 2.
    bundle.roundMap[2].legoId = bundle.roundMap[1].legoId
    bundle.roundMap[2].seedNumber = bundle.roundMap[1].seedNumber

    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })

    // Round 4 looks back at offsets 1 (→ R3 = S0002L01) and 2 (→ R2 = S0002L01)
    // and 3 (→ R1 = S0001L01). The duplicate S0002L01 should be deduped:
    // we expect 3 reviews from S0002L01 (the N-1 hit only) + 1 from S0001L01.
    const r4 = rounds[3]
    const r4reviews = r4.cycles.filter((c) => c.type === 'review')
    expect(r4reviews).toHaveLength(4)
    expect(r4reviews.filter((c) => c.legoId === 'S0002L01')).toHaveLength(3)
    expect(r4reviews.filter((c) => c.legoId === 'S0001L01')).toHaveLength(1)
  })

  it('passes through target_text_native when set on lego/phrase', () => {
    const bundle = makeBundle({ legoCount: 1, buildsPerLego: 0, usesPerLego: 1 })
    bundle.legos[0].targetTextNative = 'ニホンゴ'
    bundle.phrases[0].targetTextNative = 'ヒラガナ'

    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })
    const r1 = rounds[0]
    expect(r1.legoTargetTextNative).toBe('ニホンゴ')
    expect(r1.cycles[0].target.textNative).toBe('ニホンゴ') // intro
    expect(r1.cycles[1].target.textNative).toBe('ニホンゴ') // debut
    const useCycle = r1.cycles.find((c) => c.type === 'use')
    expect(useCycle?.target.textNative).toBe('ヒラガナ')
  })

  it('audio URL builder default produces /api/audio/<id>; override is respected', () => {
    const bundle = makeBundle({ legoCount: 1, buildsPerLego: 0, usesPerLego: 1 })

    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })
    const debut = rounds[0].cycles.find((c) => c.type === 'debut')!
    expect(debut.known.audioUrl).toBe('/api/audio/S0001L01-known')
    expect(debut.target.voice1Url).toBe('/api/audio/S0001L01-t1')
    expect(debut.target.voice2Url).toBe('/api/audio/S0001L01-t2')

    const custom = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
      audioUrl: (id) => `https://cdn.test/${id}.mp3`,
    })
    const debut2 = custom.rounds[0].cycles.find((c) => c.type === 'debut')!
    expect(debut2.known.audioUrl).toBe('https://cdn.test/S0001L01-known.mp3')
    expect(debut2.target.voice1Url).toBe('https://cdn.test/S0001L01-t1.mp3')
  })

  it('intro uses presentation audio for the prompt slot', () => {
    const bundle = makeBundle({ legoCount: 1, buildsPerLego: 0, usesPerLego: 0 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })
    const intro = rounds[0].cycles[0]
    expect(intro.type).toBe('intro')
    // First LEGO's presentation id is "S0001L01-pres" per the fixture builder.
    expect(intro.known.audioUrl).toBe('/api/audio/S0001L01-pres')
  })

  it('round shape: legoTargetText / legoKnownText / seedId reflect the lego', () => {
    const bundle = makeBundle({ legoCount: 1, buildsPerLego: 0, usesPerLego: 0 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })
    expect(rounds[0].seedId).toBe('S0001')
    expect(rounds[0].legoTargetText).toBe('target-S0001L01')
    expect(rounds[0].legoKnownText).toBe('known-S0001L01')
  })
})

// ===========================================================================
// INF PLAY MODE
// ===========================================================================
describe('generateScript — infplay mode', () => {
  it('emits ~22 cycles per round, mixing spaced rep + random USE', () => {
    const bundle = makeBundle({ legoCount: 30, buildsPerLego: 0, usesPerLego: 3 })
    const { rounds, next } = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 3,
      random: mulberry32(42),
    })

    expect(rounds).toHaveLength(3)
    for (const r of rounds) {
      // Spaced rep + random USE = 22 nominal; we never exceed it.
      expect(r.cycles.length).toBeLessThanOrEqual(TARGET_CYCLES_PER_ROUND)
      expect(r.cycles.length).toBeGreaterThanOrEqual(MIN_RANDOM_USE_PER_ROUND)
    }

    // Round 1's absolute round = 30 + 1 = 31. Spaced rep offsets that land
    // inside [1..30]: 1→30, 2→29, 3→28, 5→26, 8→23, 13→18, 21→10, but 34/55/89
    // are past start; 21 → 31-21 = 10 (valid). So 7 review entries; offset 1
    // gives 3 phrases, others 1 → 9 review cycles.
    const r1 = rounds[0]
    expect(r1.cycles.filter((c) => c.type === 'review').length).toBeGreaterThan(0)
    expect(r1.cycles.filter((c) => c.type === 'use').length).toBeGreaterThan(0)

    // Round numbers are mainLoopCount + infRound.
    expect(r1.roundNumber).toBe(31)
    expect(rounds[1].roundNumber).toBe(32)

    // Pagination advances by emitted-round count.
    expect(next).toEqual({ mode: 'infplay', infRound: 4 })
  })

  it('post-drain (fromInfRound past fib 89): zero spaced rep, all cycles are random USE', () => {
    const bundle = makeBundle({ legoCount: 30, buildsPerLego: 0, usesPerLego: 3 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 100 },
      roundLimit: 2,
      random: mulberry32(7),
    })
    expect(rounds).toHaveLength(2)
    for (const r of rounds) {
      expect(r.cycles.filter((c) => c.type === 'review')).toHaveLength(0)
      // Without spaced rep, target USE count = clamp(6, 22, 22-0) = 22.
      expect(r.cycles.length).toBe(TARGET_CYCLES_PER_ROUND)
      expect(r.cycles.every((c) => c.type === 'use')).toBe(true)
    }
  })

  it('deterministic RNG: same seed produces same output', () => {
    const bundle = makeBundle({ legoCount: 30, buildsPerLego: 0, usesPerLego: 3 })
    const a = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 3,
      random: mulberry32(123),
    })
    const b = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 3,
      random: mulberry32(123),
    })
    // Compare cycle id sequences round-by-round.
    expect(a.rounds.map((r) => r.cycles.map((c) => c.id))).toEqual(
      b.rounds.map((r) => r.cycles.map((c) => c.id)),
    )
    // And a different seed should differ in *some* way (random USE picks).
    const c = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 3,
      random: mulberry32(456),
    })
    expect(a.rounds.map((r) => r.cycles.map((c) => c.id))).not.toEqual(
      c.rounds.map((r) => r.cycles.map((c) => c.id)),
    )
  })

  it('infplay cycle ids follow the infsr / infuse pattern', () => {
    const bundle = makeBundle({ legoCount: 30, buildsPerLego: 0, usesPerLego: 3 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 1,
      random: mulberry32(1),
    })
    for (const c of rounds[0].cycles) {
      if (c.type === 'review') expect(c.id).toMatch(/_infsr_R1_\d+$/)
      if (c.type === 'use') expect(c.id).toMatch(/_infuse_R1_\d+$/)
    }
  })
})

// Local constants mirroring the impl — keep visible for assertion readability.
const TARGET_CYCLES_PER_ROUND = 22
const MIN_RANDOM_USE_PER_ROUND = 6
