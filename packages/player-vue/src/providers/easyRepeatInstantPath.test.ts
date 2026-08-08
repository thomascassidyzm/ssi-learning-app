/**
 * EASY'S DOUBLING ON THE INSTANT-PLAYBACK PATH.
 *
 * `INSTANT_PLAYBACK_ALL` routes the START of every session down the server
 * `cycles` route → useInstantPlayback → backendCyclesToRounds → SimplePlayer.
 * That path never touches generateLearningScript and is otherwise deliberately
 * mode-blind, so a repeat living only in the script walk would leave an Easy
 * learner's FIRST rounds undoubled — with the doubling then appearing
 * mid-session out of nowhere as the full walk took over.
 *
 * Same setting, same rule, both entry points.
 */
import { describe, it, expect } from 'vitest'
import { backendCyclesToRounds } from './backendCyclesToRounds'
import { normalizePhraseRepeatCount, normalizeRepeatedCycleTypes } from '../composables/useAlgorithmConfig'
import { findConsecutiveBreach, cyclePromptIdentity } from '../playback/capConsecutiveRepeats'

const backendCycle = (over: Record<string, unknown> = {}) => ({
  lego_id: 'S0001L01',
  id: 'c-1',
  seed_number: 1,
  type: 'build',
  known_text: 'a build phrase',
  target_text: 'une phrase',
  audio: { known_id: 'k-1', target1_id: 't1-1', target2_id: 't2-1', presentation_id: 'p-1' },
  durations: { target1_ms: 1000, target2_ms: 1000 },
  ...over,
})

const ROUND_MAP = { rounds: [{ r: 1, legoId: 'S0001L01', seed: 1 }] } as any

const CYCLES = [
  backendCycle({ type: 'intro', id: 'i1', known_text: 'the word', target_text: 'le mot' }),
  backendCycle({ type: 'debut', id: 'd1', known_text: 'the word', target_text: 'le mot' }),
  backendCycle({ type: 'build', id: 'b1', known_text: 'build one', target_text: 'bati un' }),
  backendCycle({ type: 'build', id: 'b2', known_text: 'build two', target_text: 'bati deux' }),
  backendCycle({ type: 'use', id: 'u1', known_text: 'use one', target_text: 'usage un' }),
]

const easyRepeat = {
  count: normalizePhraseRepeatCount(2),
  types: normalizeRepeatedCycleTypes(undefined),
}

const build = (repeat?: typeof easyRepeat) =>
  backendCyclesToRounds(() => CYCLES as any, ROUND_MAP, () => true, {}, repeat)

describe('Easy doubling reaches the first rounds of a session', () => {
  it('doubles the practice cycles the instant path serves', () => {
    const rounds = build(easyRepeat)
    const knowns = rounds[0].cycles.map((c: any) => c.known.text)
    expect(knowns).toEqual([
      'the word',            // intro — once
      'the word',            // debut — once (same text, and that is two, not three)
      'build one', 'build one',
      'build two', 'build two',
      'use one', 'use one',
    ])
  })

  it('gives each copy its own id so progress tracking sees distinct cycles', () => {
    const ids = build(easyRepeat)[0].cycles.map((c: any) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('b1_x2')
  })

  it('still never plays the same prompt three times in a row', () => {
    const cycles = build(easyRepeat)[0].cycles
    expect(findConsecutiveBreach(cycles as any, cyclePromptIdentity)).toBe(-1)
  })

  it('FAST IS UNCHANGED — no repeat argument, and a count of 1, both leave it alone', () => {
    const plain = build()
    const explicitOnce = build({ count: 1, types: easyRepeat.types })
    const knowns = (r: any) => r[0].cycles.map((c: any) => c.known.text)
    expect(knowns(plain)).toEqual(['the word', 'the word', 'build one', 'build two', 'use one'])
    expect(knowns(explicitOnce)).toEqual(knowns(plain))
  })
})
