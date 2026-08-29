/**
 * Whole-course-from-the-bundle tests (cutover step 6).
 *
 * The end-to-end proof is `tools/bundle-cutover/parity-fullscript.mjs`, which
 * diffs this against the walk it retires over real courses. These pin the
 * invariants that harness cannot see, and that a future edit could quietly
 * break — above all the one the whole step rests on: the rounds this produces
 * for the whole course are the SAME rounds the learner's live queue is already
 * built from, because both go through `backendCyclesToRounds`.
 */
import { describe, it, expect } from 'vitest'
import type { CourseBundle } from '@ssi/core'
import { bundleFullScript } from './bundleFullScript'
import { bundleToCyclesResponse, bundleToRoundMap } from './bundleToBackendCycles'
import { backendCyclesToRounds } from './backendCyclesToRounds'

function audio(id: string, ms = 1500) {
  return { id, durationMs: ms, tier: 'ephemeral' as const }
}

function makeBundle(legoCount = 6, usesPerLego = 4, opts: { silentLego?: number } = {}): CourseBundle {
  const legos = []
  const phrases = []
  const roundMap = []
  for (let i = 1; i <= legoCount; i++) {
    const legoId = `S${String(i).padStart(4, '0')}L01`
    const silent = opts.silentLego === i
    legos.push({
      legoId,
      seedNumber: i,
      legoIndex: 1,
      seedId: `S${String(i).padStart(4, '0')}`,
      type: 'A' as const,
      knownText: `known-${legoId}`,
      targetText: `target-${legoId}`,
      isNew: true,
      ephemeralAudio: silent
        ? {}
        : {
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
        audio: silent
          ? {}
          : {
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

describe('bundleFullScript', () => {
  it('emits one round per round-map entry, in script order', () => {
    const bundle = makeBundle(6)
    const { rounds, mainLoopRoundCount } = bundleFullScript(bundle, { infinitePlayLookahead: 0 })
    expect(rounds.map((r) => r.legoId)).toEqual([
      'S0001L01', 'S0002L01', 'S0003L01', 'S0004L01', 'S0005L01', 'S0006L01',
    ])
    expect(rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3, 4, 5, 6])
    expect(mainLoopRoundCount).toBe(6)
  })

  it('produces the SAME rounds as the paged tier-3 path the learner already plays', () => {
    // This is the property the whole step rests on. If it ever fails, a
    // flagged course has two producers that disagree about the same round.
    const bundle = makeBundle(8)
    const full = bundleFullScript(bundle, { infinitePlayLookahead: 0 })

    const map = bundleToRoundMap(bundle)
    const buffered = new Map<string, ReturnType<typeof bundleToCyclesResponse>['cycles']>()
    let from: string | null = 'S0001L01'
    while (from) {
      const page: ReturnType<typeof bundleToCyclesResponse> = bundleToCyclesResponse(bundle, from, 25)
      for (const c of page.cycles) {
        const key = c.round_lego_id ?? c.lego_id
        const list = buffered.get(key)
        if (list) {
          if (!list.some((x) => x.id === c.id)) list.push(c)
        } else {
          buffered.set(key, [c])
        }
      }
      from = page.next_lego_id === from ? null : page.next_lego_id
    }
    const paged = backendCyclesToRounds((legoId) => buffered.get(legoId) ?? [], map)

    expect(full.rounds).toEqual(paged)
  })

  it('drops a LEGO with no audio and reports an audio-aware main-loop count', () => {
    // LEGO 1 is the clean case: its round holds nothing but its own cycles, so
    // silencing it empties the round outright. A silent LEGO further in still
    // gets a round, because reviews of EARLIER LEGOs play in it — which is the
    // live path's behaviour too, and the point of gating on emitted cycles
    // rather than on the round map.
    const bundle = makeBundle(6, 4, { silentLego: 1 })
    const { rounds, mainLoopRoundCount } = bundleFullScript(bundle, { infinitePlayLookahead: 0 })
    expect(rounds.some((r) => r.legoId === 'S0001L01')).toBe(false)
    expect(mainLoopRoundCount).toBe(5)
    // The round NUMBERS keep the hole — they are course_round_index positions,
    // not a re-sequenced count.
    expect(rounds.map((r) => r.roundNumber)).toEqual([2, 3, 4, 5, 6])
    // And nothing unplayable survives anywhere in the script.
    const silentIds = rounds.flatMap((r) => r.cycles).filter((c) => c.legoId === 'S0001L01')
    expect(silentIds).toEqual([])
  })

  it('numbers the revival tail past the LAST main-loop round, never the count', () => {
    // With a hole in the main loop, count (5) < last number (6): numbering the
    // tail from the count would collide with a real main-loop round.
    const bundle = makeBundle(6, 4, { silentLego: 1 })
    const { rounds, mainLoopRoundCount } = bundleFullScript(bundle, { infinitePlayLookahead: 3 })
    const main = rounds.filter((r) => r.roundNumber <= 6)
    const tail = rounds.filter((r) => r.roundNumber > 6)
    expect(mainLoopRoundCount).toBe(5)
    expect(main).toHaveLength(5)
    expect(tail.length).toBeGreaterThan(0)
    expect(Math.min(...tail.map((r) => r.roundNumber))).toBe(7)
    // No two rounds share a number.
    expect(new Set(rounds.map((r) => r.roundNumber)).size).toBe(rounds.length)
  })

  it('emits no revival tail from a preview bundle', () => {
    // /infplay-cycles hard-403s an unentitled caller, so generating a tail
    // locally from a 19-seed preview would hand out what the server refuses.
    const bundle = { ...makeBundle(6), previewOnly: true } as CourseBundle
    const { rounds, mainLoopRoundCount } = bundleFullScript(bundle, { infinitePlayLookahead: 5 })
    expect(rounds).toHaveLength(mainLoopRoundCount)
  })

  it('counts cycles across every emitted round', () => {
    const bundle = makeBundle(4)
    const { rounds, cycleCount, roundCount } = bundleFullScript(bundle, { infinitePlayLookahead: 0 })
    expect(roundCount).toBe(rounds.length)
    expect(cycleCount).toBe(rounds.reduce((n, r) => n + r.cycles.length, 0))
    expect(cycleCount).toBeGreaterThan(0)
  })

  it('survives an empty round map rather than throwing on the boot path', () => {
    const bundle = { ...makeBundle(2), roundMap: [] } as unknown as CourseBundle
    expect(bundleFullScript(bundle, { infinitePlayLookahead: 2 }).rounds).toEqual([])
  })
})
