/**
 * generateScript tests — cover both main-loop and INF PLAY paths against
 * a hand-built CourseBundle fixture.
 */

import { describe, it, expect } from 'vitest'
import { DEFAULT_SCRIPT_SHAPE, generateScript, GENERATOR_VERSION } from './generateScript'
import type {
  BundleAudioRef,
  BundleLego,
  BundlePhrase,
  BundleRoundMapEntry,
  BundleScriptShape,
  CourseBundle,
} from './courseBundle'

const FIXTURE_SCRIPT_SHAPE: BundleScriptShape = {
  spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584],
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

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
  glossSegments?: Array<{ span: number; known: string }>
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
    ...(opts.glossSegments ? { glossSegments: opts.glossSegments } : {}),
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
  /** Whether seeds carry complete audio+text (default true) — set false to
   *  exercise the SEED-PHASE review's fallback-to-use-phrase path. */
  seedAudio?: boolean
}

function makeBundle(opts: FixtureOpts = {}): CourseBundle {
  const legoCount = opts.legoCount ?? 5
  const buildsPerLego = opts.buildsPerLego ?? 2
  const usesPerLego = opts.usesPerLego ?? 3
  const seedAudio = opts.seedAudio !== false

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
    contentVersion: 1,
    scriptShape: FIXTURE_SCRIPT_SHAPE,
    scriptShapeVersion: 1,
    generatorVersion: GENERATOR_VERSION,
    mainLoopCount: legoCount,
    legos,
    phrases,
    seeds: legos.map((l) => ({
      seedId: l.seedId,
      seedNumber: l.seedNumber,
      ...(seedAudio
        ? {
            knownText: `known-seed-${l.seedId}`,
            targetText: `target-seed-${l.seedId}`,
            audio: {
              known: persistentAudioRef(`${l.seedId}-known`, 2000),
              target1: persistentAudioRef(`${l.seedId}-t1`, 2200),
              target2: persistentAudioRef(`${l.seedId}-t2`, 2200),
            },
          }
        : {}),
    })),
    roundMap,
    pods: [],
  }
}

// ===========================================================================
// MAIN MODE
// ===========================================================================
describe('generateScript — main mode', () => {
  it('happy path: intro + debut + BUILD (USE-filled) + CONSOLIDATE, per the round shape', () => {
    const bundle = makeBundle({ legoCount: 5, buildsPerLego: 2, usesPerLego: 3 })
    const { rounds, next } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
    })

    expect(rounds).toHaveLength(5)
    // Round 1 (no spaced rep yet): intro + debut + BUILD ×≤7 + CONSOLIDATE ×≤2.
    // The 2 build rows fill build slots first, then USE rows are PROMOTED into
    // the 5 remaining build slots ("BUILD priority > CONSOLIDATE… filling 7
    // BUILD is non-negotiable") — with only 3 uses that is 2 + 3 = 5 build
    // cycles. The consolidation tail then takes 2 USE phrases, reusing rows
    // the round already played rather than leaving the round short.
    // = 1 + 1 + 5 + 2 = 9.
    const r1 = rounds[0]
    expect(r1.roundNumber).toBe(1)
    expect(r1.legoId).toBe('S0001L01')
    expect(r1.cycles).toHaveLength(9)
    expect(r1.cycles[0].type).toBe('intro')
    expect(r1.cycles[1].type).toBe('debut')
    expect(r1.cycles.slice(2, 7).every((c) => c.type === 'build')).toBe(true)
    expect(r1.cycles.slice(7, 9).every((c) => c.type === 'use')).toBe(true)

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
    // 1 build row + 3 USE rows promoted into build slots = 4 `build` cycles;
    // spaced rep from round 1's lego (offset 1 → 3 phrases); then the
    // consolidation tail's reuse pass supplies 2 `use` cycles.
    expect(r2.cycles.filter((c) => c.type === 'build')).toHaveLength(4)
    expect(r2.cycles.filter((c) => c.type === 'review')).toHaveLength(3)
    expect(r2.cycles.filter((c) => c.type === 'use')).toHaveLength(2)
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

// ===========================================================================
// SEED-PHASE spaced-rep reviews (offsets ≥ 144) — parity item added in the
// bundle-cutover Phase 1 promotion (archive/docs-retired-2026-08-24/bundle-cutover-design.md §3).
// ===========================================================================
describe('generateScript — SEED-PHASE spaced-rep reviews (offset ≥ 144)', () => {
  it('main loop: offset 144 reviews the full parent seed sentence, not a use-phrase', () => {
    const bundle = makeBundle({ legoCount: 150, buildsPerLego: 0, usesPerLego: 1 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0145L01' },
      roundLimit: 1,
    })
    const round145 = rounds[0]
    expect(round145.roundNumber).toBe(145)

    const seedReview = round145.cycles.find((c) => c.id === 'S0001L01_seedrep')
    expect(seedReview).toBeDefined()
    expect(seedReview!.type).toBe('review')
    expect(seedReview!.known.text).toBe('known-seed-S0001')
    expect(seedReview!.target.text).toBe('target-seed-S0001')

    // The other 10 offsets below SEED_PHASE_START_OFFSET (1,2,3,5,8,13,21,34,55,89)
    // still resolve to ordinary use-phrase reviews (usesPerLego=1 → 1 cycle each).
    expect(round145.cycles.filter((c) => c.type === 'review')).toHaveLength(11)
  })

  it('main loop: falls back to a use-phrase review when the seed lacks audio', () => {
    const bundle = makeBundle({
      legoCount: 150,
      buildsPerLego: 0,
      usesPerLego: 1,
      seedAudio: false,
    })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0145L01' },
      roundLimit: 1,
    })
    const round145 = rounds[0]

    expect(round145.cycles.some((c) => c.id === 'S0001L01_seedrep')).toBe(false)
    const fallback = round145.cycles.find((c) => c.id.startsWith('S0001L01_use_01_'))
    expect(fallback).toBeDefined()
    expect(fallback!.type).toBe('review')
    expect(fallback!.known.text).toBe('known-S0001L01_use_01')
  })

  it('main loop: two LEGOs sharing a seed are reviewed only once per round', () => {
    // Hand-built, sparse round map: round 156 and round 67 both belong to
    // seed S0001 (different LEGOs); round 300 is where generation starts.
    // At round 300, offset 144 → round 156 (S0001L01) and offset 233 →
    // round 67 (S0001L02) both land in SEED-PHASE — same seed, one review.
    const legoA = makeLego({ seedNumber: 1, legoIndex: 1 })
    const legoB = makeLego({ seedNumber: 1, legoIndex: 2 })
    const startLego = makeLego({ seedNumber: 9999, legoIndex: 1 })

    // `Array.prototype.findIndex` (used by `generateMain` to locate the start
    // position) visits holes in a sparse array, unlike most array methods —
    // so every index needs a real (if unused) entry, not just the three we
    // care about.
    const roundMap: BundleRoundMapEntry[] = Array.from({ length: 300 }, (_, i) => ({
      roundIndex: i + 1,
      legoId: `SUNUSED${i}L01`,
      seedNumber: 10000 + i,
    }))
    roundMap[66] = { roundIndex: 67, legoId: legoB.legoId, seedNumber: 1 }
    roundMap[155] = { roundIndex: 156, legoId: legoA.legoId, seedNumber: 1 }
    roundMap[299] = { roundIndex: 300, legoId: startLego.legoId, seedNumber: 9999 }

    const bundle: CourseBundle = {
      courseCode: 'test_course',
      version: 1,
      contentVersion: 1,
      scriptShape: FIXTURE_SCRIPT_SHAPE,
      scriptShapeVersion: 1,
      generatorVersion: GENERATOR_VERSION,
      mainLoopCount: 300,
      legos: [legoA, legoB, startLego],
      phrases: [],
      seeds: [
        {
          seedId: 'S0001',
          seedNumber: 1,
          knownText: 'known-seed-S0001',
          targetText: 'target-seed-S0001',
          audio: {
            known: persistentAudioRef('S0001-known', 2000),
            target1: persistentAudioRef('S0001-t1', 2200),
            target2: persistentAudioRef('S0001-t2', 2200),
          },
        },
      ],
      roundMap,
      pods: [],
    }

    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: startLego.legoId },
      roundLimit: 1,
    })
    const round300 = rounds[0]
    const seedReviews = round300.cycles.filter((c) => c.id.endsWith('_seedrep'))
    expect(seedReviews).toHaveLength(1)
    // Dedup keeps whichever offset is walked first (offset 144, the smaller one).
    expect(seedReviews[0].id).toBe(`${legoA.legoId}_seedrep`)
  })

  it('infplay: offset 144 emits an infseedrep-tagged review of the full seed sentence', () => {
    const bundle = makeBundle({ legoCount: 150, buildsPerLego: 0, usesPerLego: 1 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 1,
      random: mulberry32(1),
    })
    const seedReview = rounds[0].cycles.find((c) => c.id.includes('_infseedrep_R1_'))
    expect(seedReview).toBeDefined()
    expect(seedReview!.type).toBe('review')
    // 10 offsets below SEED_PHASE_START_OFFSET (1..89) emit first (cycleSeq
    // 1-10, one use-phrase cycle each since usesPerLego=1), then offset 144.
    expect(seedReview!.id).toBe('S0007L01_infseedrep_R1_11')
    expect(seedReview!.known.text).toBe('known-seed-S0007')
  })
})

// Local constants mirroring the impl — keep visible for assertion readability.
const TARGET_CYCLES_PER_ROUND = 22
const MIN_RANDOM_USE_PER_ROUND = 6

// ===========================================================================
// ROUND SHAPE — script-shape injection, caps, and the bare-LEGO guard
// (bundle-cutover design §3 parity item 1; golden-mastered against the live
// /cycles endpoint by tools/bundle-cutover/parity-cycles.mjs)
// ===========================================================================
describe('generateScript — round shape', () => {
  it('takes the shape from the BUNDLE, not from generator constants', () => {
    const bundle = makeBundle({ legoCount: 4, buildsPerLego: 6, usesPerLego: 4 })
    bundle.scriptShape = { ...FIXTURE_SCRIPT_SHAPE, maxBuildPhrases: 2, useConsolidationCount: 1 }

    const { rounds } = generateScript({ bundle, position: { mode: 'main', fromLegoId: 'S0001L01' } })
    const r1 = rounds[0]
    expect(r1.cycles.filter((c) => c.type === 'build')).toHaveLength(2)
    expect(r1.cycles.filter((c) => c.type === 'use')).toHaveLength(1)
  })

  it('opts.shape overrides the bundle shape', () => {
    const bundle = makeBundle({ legoCount: 4, buildsPerLego: 6, usesPerLego: 4 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0001L01' },
      shape: { maxBuildPhrases: 1 },
    })
    expect(rounds[0].cycles.filter((c) => c.type === 'build')).toHaveLength(1)
  })

  it('falls back to DEFAULT_SCRIPT_SHAPE when the bundle predates shape enrichment', () => {
    const bundle = makeBundle({ legoCount: 4, buildsPerLego: 9, usesPerLego: 4 })
    delete (bundle as unknown as { scriptShape?: unknown }).scriptShape
    const { rounds } = generateScript({ bundle, position: { mode: 'main', fromLegoId: 'S0001L01' } })
    expect(rounds[0].cycles.filter((c) => c.type === 'build')).toHaveLength(
      DEFAULT_SCRIPT_SHAPE.maxBuildPhrases,
    )
  })

  it('never replays the bare LEGO: a build row equal to its own LEGO is skipped', () => {
    const bundle = makeBundle({ legoCount: 3, buildsPerLego: 2, usesPerLego: 3 })
    const lego = bundle.legos[0]
    const twin = bundle.phrases.find((p) => p.legoId === lego.legoId && p.role === 'build')!
    twin.knownText = lego.knownText
    twin.targetText = lego.targetText

    const { rounds } = generateScript({ bundle, position: { mode: 'main', fromLegoId: 'S0001L01' } })
    const played = rounds[0].cycles.filter((c) => c.type !== 'intro' && c.type !== 'debut')
    expect(played.some((c) => c.known.text === lego.knownText && c.target.text === lego.targetText)).toBe(false)
  })

  it('main-mode output is RNG-independent — reviews use the closed-form cursor', () => {
    const bundle = makeBundle({ legoCount: 8, buildsPerLego: 1, usesPerLego: 5 })
    const a = generateScript({ bundle, position: { mode: 'main', fromLegoId: 'S0001L01' }, random: () => 0 })
    const b = generateScript({ bundle, position: { mode: 'main', fromLegoId: 'S0001L01' }, random: () => 0.999 })
    expect(JSON.stringify(a.rounds)).toBe(JSON.stringify(b.rounds))
  })

  it('caps spaced rep at maxSpacedRepPhrases', () => {
    const bundle = makeBundle({ legoCount: 120, buildsPerLego: 0, usesPerLego: 5 })
    const { rounds } = generateScript({
      bundle,
      position: { mode: 'main', fromLegoId: 'S0100L01' },
      roundLimit: 1,
    })
    expect(rounds[0].cycles.filter((c) => c.type === 'review').length).toBeLessThanOrEqual(
      FIXTURE_SCRIPT_SHAPE.maxSpacedRepPhrases,
    )
  })
})

// ---------------------------------------------------------------------------
// Authored gloss segments (bundle-cutover step 5b)
// ---------------------------------------------------------------------------
// No course in the estate carries `known_gloss_segments` today (0 rows,
// 2026-08-29), so the live parity harness cannot see this field at all — it
// would pass whether or not the generator carried the mapping through. This
// test is the proof instead: the moment Popty authors the first mapping, a
// bundle-enabled course must ship it exactly where /cycles does, on the intro
// and the debut and nowhere else.
describe('generateScript — authored gloss segments', () => {
  const SEGMENTS = [
    { span: 1, known: 'word' },
    { span: 1, known: 'a' },
  ]

  function bundleWithSegments() {
    const bundle = makeBundle({ legoCount: 2, buildsPerLego: 1, usesPerLego: 2 })
    bundle.legos[0] = makeLego({
      seedNumber: 1,
      type: 'M',
      targetText: 'hitz bat',
      glossSegments: SEGMENTS,
    })
    return bundle
  }

  it('rides the intro and the debut of the LEGO that authored it', () => {
    const { rounds } = generateScript({
      bundle: bundleWithSegments(),
      position: { mode: 'main', fromLegoId: 'S0001L01' },
      roundLimit: 1,
    })
    const carrying = rounds[0].cycles.filter((c) => c.glossSegments)
    expect(carrying.map((c) => c.type).sort()).toEqual(['debut', 'intro'])
    expect(carrying.every((c) => c.legoId === 'S0001L01')).toBe(true)
    for (const c of carrying) expect(c.glossSegments).toEqual(SEGMENTS)
  })

  it('never leaks onto build or use phrases — those tile from decomposition', () => {
    const { rounds } = generateScript({
      bundle: bundleWithSegments(),
      position: { mode: 'main', fromLegoId: 'S0001L01' },
      roundLimit: 1,
    })
    const phraseCycles = rounds[0].cycles.filter((c) => c.type === 'build' || c.type === 'use')
    expect(phraseCycles.length).toBeGreaterThan(0)
    expect(phraseCycles.every((c) => c.glossSegments === undefined)).toBe(true)
  })

  it('is absent, not empty, on a LEGO with no authored mapping', () => {
    const { rounds } = generateScript({
      bundle: makeBundle({ legoCount: 2 }),
      position: { mode: 'main', fromLegoId: 'S0001L01' },
      roundLimit: 1,
    })
    expect(rounds[0].cycles.every((c) => c.glossSegments === undefined)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phrase pools carry only playable phrases (bundle-cutover step 5b)
// ---------------------------------------------------------------------------
describe('generateScript — a phrase missing audio never enters a pool', () => {
  /** One LEGO whose USE basket is mostly unplayable — zho_for_eng S0668L01 in
   *  miniature: 21 USE rows, 5 with audio. */
  function bundleWithPatchyAudio() {
    const bundle = makeBundle({ legoCount: 3, buildsPerLego: 0, usesPerLego: 0 })
    for (let i = 1; i <= 6; i++) {
      bundle.phrases.push({
        ...makePhrase('S0001L01', 'use', i),
        ...(i > 1 ? { audio: {} } : {}),
      })
    }
    return bundle
  }

  it('an unplayable USE row cannot be drawn, so the review always fires', () => {
    // Unfiltered, a random draw over six rows would emit a review one time in
    // six and silently drop it the other five.
    const bundle = bundleWithPatchyAudio()
    for (let run = 0; run < 20; run++) {
      const { rounds } = generateScript({
        bundle,
        position: { mode: 'infplay', fromInfRound: 1 },
        roundLimit: 1,
      })
      const reviews = rounds[0].cycles.filter((c) => c.type === 'review' && c.legoId === 'S0001L01')
      expect(reviews.length).toBeGreaterThan(0)
    }
  })

  it('never emits a cycle for a phrase with no audio', () => {
    const { rounds } = generateScript({
      bundle: bundleWithPatchyAudio(),
      position: { mode: 'infplay', fromInfRound: 1 },
      roundLimit: 3,
    })
    for (const r of rounds) {
      for (const c of r.cycles) {
        expect(c.target.voice1Url).not.toBe('')
        expect(c.target.voice2Url).not.toBe('')
      }
    }
  })
})

