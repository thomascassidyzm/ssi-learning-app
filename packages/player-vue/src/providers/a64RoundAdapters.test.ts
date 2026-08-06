/**
 * A-64 coverage for the ROUND ADAPTERS — the last point before SimplePlayer.
 *
 * `INSTANT_PLAYBACK_ALL = true` (LearningPlayer.vue) routes every course down
 * the instant-playback path: the server `cycles` route → useInstantPlayback →
 * backendCyclesToRounds → SimplePlayer. That path never touches
 * generateLearningScript, so a cap living only in the generator would protect
 * nobody on the live default path. These tests pin the adapters instead.
 */
import { describe, it, expect } from 'vitest'
import { backendCyclesToRounds, infPlayCyclesToRounds } from './backendCyclesToRounds'
import { toSimpleRounds } from './toSimpleRounds'
import { findConsecutiveBreach, cyclePromptIdentity } from '../playback/capConsecutiveRepeats'

const backendCycle = (over: Record<string, unknown> = {}) => ({
  lego_id: 'S0001L01',
  seed_number: 1,
  type: 'build',
  known_text: 'the same prompt',
  target_text: 'le meme prompt',
  audio: { known_id: 'k-1', target1_id: 't1-1', target2_id: 't2-1', presentation_id: 'p-1' },
  durations: { target1_ms: 1000, target2_ms: 1000 },
  ...over,
})

const flatCycles = (rounds: Array<{ cycles: unknown[] }>) => rounds.flatMap(r => r.cycles) as any[]

describe('backendCyclesToRounds — A-64 floor on the instant-playback path', () => {
  it('never emits the same prompt three times in a row within a round', () => {
    // The construction the server route makes possible: intro and debut carry
    // identical known+target text, and the first build phrase duplicates them.
    const cycles = [
      backendCycle({ type: 'intro' }),
      backendCycle({ type: 'debut' }),
      backendCycle({ type: 'build' }),
      backendCycle({ type: 'build', known_text: 'something else', target_text: 'autre chose' }),
    ]
    const rounds = backendCyclesToRounds(
      () => cycles as any,
      { rounds: [{ r: 1, legoId: 'S0001L01', seed: 1 }] } as any,
    )
    expect(rounds).toHaveLength(1)
    expect(rounds[0].cycles.length).toBe(4) // re-interleaved, not deleted
    expect(findConsecutiveBreach(flatCycles(rounds), cyclePromptIdentity)).toBe(-1)
  })

  it('holds across the round seam', () => {
    const dup = [backendCycle({ type: 'intro' }), backendCycle({ type: 'debut' })]
    const rounds = backendCyclesToRounds(
      () => dup as any,
      { rounds: [{ r: 1, legoId: 'S0001L01', seed: 1 }, { r: 2, legoId: 'S0001L01', seed: 1 }] } as any,
    )
    expect(findConsecutiveBreach(flatCycles(rounds), cyclePromptIdentity)).toBe(-1)
  })

  it('leaves a lawful round untouched', () => {
    const cycles = [
      backendCycle({ type: 'intro', known_text: 'a', target_text: 'a-t' }),
      backendCycle({ type: 'build', known_text: 'b', target_text: 'b-t' }),
      backendCycle({ type: 'build', known_text: 'c', target_text: 'c-t' }),
    ]
    const rounds = backendCyclesToRounds(
      () => cycles as any,
      { rounds: [{ r: 1, legoId: 'S0001L01', seed: 1 }] } as any,
    )
    expect(rounds[0].cycles.map((c: any) => c.known.text)).toEqual(['a', 'b', 'c'])
  })
})

describe('infPlayCyclesToRounds — A-64 floor on the INF PLAY wire path', () => {
  it('never emits the same prompt three times in a row', () => {
    const cycles = [
      backendCycle({ inf_round: 1 }),
      backendCycle({ inf_round: 1 }),
      backendCycle({ inf_round: 1 }),
      backendCycle({ inf_round: 1, known_text: 'other', target_text: 'autre' }),
    ]
    const rounds = infPlayCyclesToRounds(cycles as any, 10)
    expect(findConsecutiveBreach(flatCycles(rounds), cyclePromptIdentity)).toBe(-1)
    expect(rounds[0].cycles).toHaveLength(4)
  })
})

describe('toSimpleRounds — A-64 floor on the legacy generator path', () => {
  const scriptItem = (over: Record<string, unknown> = {}) => ({
    uuid: `u${Math.round(Number(over.cycleNum ?? 1))}`,
    cycleNum: 1,
    roundNumber: 1,
    seedId: 'S0001',
    legoKey: 'S0001L01',
    seedCode: 'S0001',
    legoCode: 'L01',
    type: 'build',
    knownText: 'same',
    targetText: 'pareil',
    knownAudioId: 'k-1',
    target1Id: 't1-1',
    target2Id: 't2-1',
    target1DurationMs: 1000,
    target2DurationMs: 1000,
    isNew: false,
    ...over,
  })

  it('closes an adjacency the missing-audio filter could create', () => {
    // A, B, A where B is dropped for missing audio would leave A, A — still
    // lawful. Push it to three A's to prove the cap is actually running here.
    const items = [
      scriptItem({ cycleNum: 1 }),
      scriptItem({ cycleNum: 2 }),
      scriptItem({ cycleNum: 3 }),
      scriptItem({ cycleNum: 4, knownText: 'different', targetText: 'different-t' }),
    ]
    const rounds = toSimpleRounds(items as any)
    expect(findConsecutiveBreach(flatCycles(rounds), cyclePromptIdentity)).toBe(-1)
  })
})
