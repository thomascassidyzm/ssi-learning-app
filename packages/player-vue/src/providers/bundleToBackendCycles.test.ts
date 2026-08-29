/**
 * Wire-shape adapter tests for the bootstrap cutover.
 *
 * The end-to-end proof is `tools/bundle-cutover/parity-cycles.mjs --wire`,
 * which diffs this adapter against the LIVE /cycles endpoint over real
 * courses. These unit tests pin the invariants that harness can only observe
 * indirectly, and that a future edit could quietly break.
 */
import { describe, it, expect } from 'vitest'
import type { CourseBundle } from '@ssi/core'
import {
  bundleToCyclesResponse,
  bundleToInfPlayCyclesResponse,
  bundleToRoundMap,
} from './bundleToBackendCycles'

function audio(id: string, ms = 1500) {
  return { id, durationMs: ms, tier: 'ephemeral' as const }
}

function makeBundle(legoCount = 4, usesPerLego = 4): CourseBundle {
  const legos = []
  const phrases = []
  const roundMap = []
  for (let i = 1; i <= legoCount; i++) {
    const legoId = `S${String(i).padStart(4, '0')}L01`
    legos.push({
      legoId,
      seedNumber: i,
      legoIndex: 1,
      seedId: `S${String(i).padStart(4, '0')}`,
      type: 'A' as const,
      knownText: `known-${legoId}`,
      targetText: `target-${legoId}`,
      isNew: true,
      ephemeralAudio: {
        known: audio(`${legoId}-known`),
        target1: audio(`${legoId}-t1`, 2000),
        target2: audio(`${legoId}-t2`, 2100),
        presentation: audio(`${legoId}-pres`),
      },
    })
    for (let u = 1; u <= usesPerLego; u++) {
      const phraseId = `${legoId}_use_0${u}`
      phrases.push({
        phraseId,
        legoId,
        position: u,
        role: 'use' as const,
        knownText: `known-${phraseId}`,
        targetText: `target-${phraseId}`,
        audio: {
          known: audio(`${phraseId}-known`),
          target1: audio(`${phraseId}-t1`),
          target2: audio(`${phraseId}-t2`),
        },
      })
    }
    roundMap.push({ roundIndex: i, legoId, seedNumber: i })
  }
  return {
    courseCode: 'tst_for_eng',
    version: 7,
    contentVersion: 7,
    scriptShape: {
      spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144],
      maxBuildPhrases: 7,
      useConsolidationCount: 2,
      maxSpacedRepPhrases: 12,
      n1PhraseCount: 3,
    },
    scriptShapeVersion: 1,
    generatorVersion: 1,
    mainLoopCount: legoCount,
    legos,
    phrases,
    seeds: [],
    roundMap,
    pods: [],
  } as unknown as CourseBundle
}

describe('bundleToRoundMap', () => {
  it('projects the bundle round map onto the wire shape the caches expect', () => {
    const map = bundleToRoundMap(makeBundle(3))
    expect(map.course_code).toBe('tst_for_eng')
    expect(map.version).toBe(7)
    expect(map.rounds).toEqual([
      { r: 1, legoId: 'S0001L01', seed: 1 },
      { r: 2, legoId: 'S0002L01', seed: 2 },
      { r: 3, legoId: 'S0003L01', seed: 3 },
    ])
  })
})

describe('bundleToCyclesResponse', () => {
  it('carries raw audio IDS, not /api/audio URLs', () => {
    const { cycles } = bundleToCyclesResponse(makeBundle(), 'S0001L01', 25)
    const debut = cycles.find((c) => c.type === 'debut')!
    expect(debut.audio.known_id).toBe('S0001L01-known')
    expect(debut.audio.target1_id).toBe('S0001L01-t1')
    expect(debut.durations).toEqual({ target1_ms: 2000, target2_ms: 2100 })
  })

  it('puts the presentation narration in the intro prompt slot', () => {
    const { cycles } = bundleToCyclesResponse(makeBundle(), 'S0001L01', 25)
    const intro = cycles.find((c) => c.type === 'intro')!
    expect(intro.audio.presentation_id).toBe('S0001L01-pres')
    expect(intro.audio.known_id).toBeUndefined()
  })

  it('sets round_lego_id + review_of on cross-LEGO spaced review only', () => {
    const { cycles } = bundleToCyclesResponse(makeBundle(), 'S0001L01', 200)
    const review = cycles.find((c) => c.type === 'spaced_rep')!
    expect(review.lego_id).toBe('S0001L01')
    expect(review.round_lego_id).toBe('S0002L01')
    expect(review.review_of).toBe(1)
    expect(cycles.filter((c) => c.type !== 'spaced_rep').every((c) => c.round_lego_id === undefined)).toBe(true)
  })

  it('cycle ids are unique within a round — a USE row promoted into a build slot must not collide with the consolidation tail', () => {
    const { cycles } = bundleToCyclesResponse(makeBundle(), 'S0001L01', 200)
    const byRound = new Map<string, Set<string>>()
    for (const c of cycles) {
      const owner = c.round_lego_id ?? c.lego_id
      const set = byRound.get(owner) ?? new Set<string>()
      expect(set.has(c.id)).toBe(false)
      set.add(c.id)
      byRound.set(owner, set)
    }
  })

  it('truncates at the cycle limit and points next_lego_id at the LEGO it stopped inside', () => {
    const bundle = makeBundle(6)
    const page = bundleToCyclesResponse(bundle, 'S0001L01', 10)
    expect(page.cycles.length).toBeLessThanOrEqual(10)
    expect(page.next_lego_id).toBeTruthy()
    // The next page replays that LEGO's round from its start, exactly as the
    // endpoint does — the caller de-dupes by cycle id.
    const next = bundleToCyclesResponse(bundle, page.next_lego_id!, 10)
    expect(next.cycles[0].lego_id).toBe(page.next_lego_id)
  })

  it('walks to the end of the course and stops', () => {
    const bundle = makeBundle(3, 1)
    const page = bundleToCyclesResponse(bundle, 'S0001L01', 500)
    expect(page.next_lego_id).toBeNull()
    expect(page.cycles.some((c) => c.lego_id === 'S0003L01')).toBe(true)
  })
})

describe('authored gloss segments on the wire', () => {
  it('reaches the client as gloss_segments, the name /cycles uses', () => {
    const bundle = makeBundle(2)
    ;(bundle.legos[0] as { glossSegments?: unknown }).glossSegments = [
      { span: 1, known: 'word' },
      { span: 1, known: 'a' },
    ]
    const { cycles } = bundleToCyclesResponse(bundle, 'S0001L01', 50)
    const carrying = cycles.filter((c) => c.gloss_segments)
    expect(carrying.map((c) => c.type).sort()).toEqual(['debut', 'intro'])
    expect(carrying[0].gloss_segments).toEqual([
      { span: 1, known: 'word' },
      { span: 1, known: 'a' },
    ])
  })

  it('omits the key entirely when nothing is authored', () => {
    const { cycles } = bundleToCyclesResponse(makeBundle(2), 'S0001L01', 50)
    expect(cycles.every((c) => c.gloss_segments === undefined)).toBe(true)
  })
})

describe('bundleToInfPlayCyclesResponse', () => {
  it('stamps every cycle with its INF PLAY round, counted past the main loop', () => {
    const bundle = makeBundle(40)
    const res = bundleToInfPlayCyclesResponse(bundle, 1, 3)
    expect(res.main_loop_count).toBe(40)
    expect(res.next_inf_round).toBe(4)
    const rounds = [...new Set(res.cycles.map((c) => c.inf_round))]
    expect(rounds).toEqual([1, 2, 3])
    // The generator numbers rounds absolutely; the wire is infplay-relative,
    // and bootstrapInfPlay adds main_loop_count back to build its round map.
    expect(res.cycles.every((c) => typeof c.inf_round === 'number')).toBe(true)
  })

  it('carries no main-loop round pointers — an infplay review reaches back by offset', () => {
    const res = bundleToInfPlayCyclesResponse(makeBundle(40), 1, 2)
    expect(res.cycles.some((c) => c.type === 'spaced_rep')).toBe(true)
    expect(res.cycles.every((c) => c.review_of === undefined && c.round_lego_id === undefined)).toBe(true)
  })

  it('starts where it is asked to, not at round 1', () => {
    const res = bundleToInfPlayCyclesResponse(makeBundle(40), 95, 2)
    expect([...new Set(res.cycles.map((c) => c.inf_round))]).toEqual([95, 96])
    expect(res.next_inf_round).toBe(97)
  })
})

