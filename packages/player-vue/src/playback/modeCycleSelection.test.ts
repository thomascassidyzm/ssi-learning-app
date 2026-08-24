/**
 * The mode decides WHICH cycles play, in the player, at play time.
 *
 * Tom, 2026-08-09: "The instructions for WHICH cycles get selected/played and
 * HOW MANY TIMES belongs in the player logic, not the cached script data."
 * These pin that the same four Easy levers that used to run in the walk now
 * produce the same thinning as a pure filter over a mode-neutral queue — and,
 * critically, that flipping the config flips the answer with nothing else
 * changing, which is what a mid-session toggle actually needs.
 */
import { describe, it, expect } from 'vitest'
import {
  selectCyclesOutForMode,
  selectionIsInert,
  courseMaxCycleLength,
  isTeachingCycle,
  type ModeSelectionConfig,
  type ModeSelectionContext,
} from './modeCycleSelection'

const cycle = (id: string, type: string, target: string, known = '') =>
  ({ id, type, known: { text: known, audioUrl: '' }, target: { text: target, voice1Url: '', voice2Url: '' } }) as never

const round = (roundNumber: number, cycles: unknown[]) =>
  ({ roundNumber, legoId: 'S0001L01', seedId: 'S0001', cycles }) as never

const FAST: ModeSelectionConfig = {
  maxPhraseLengthFraction: 1,
  filterBuildPhrases: true,
  reviewMaxKnownSyllables: 0,
  reviewSyllableFilterMaxRound: 0,
  useWordCap: null,
}
const EASY: ModeSelectionConfig = {
  maxPhraseLengthFraction: 0.5,
  filterBuildPhrases: false,
  reviewMaxKnownSyllables: 15,
  reviewSyllableFilterMaxRound: 100,
  useWordCap: { side: 'known', tiers: [{ maxRound: 20, maxWords: 8 }, { maxRound: 100, maxWords: 10 }] },
}

const ctx = (max: number, syllables: (c: never) => number | null = () => null): ModeSelectionContext => ({
  courseMaxPhraseLength: max,
  knownSyllables: syllables as never,
})

describe('mode cycle selection', () => {
  it('Fast is provably inert — it never selects anything out', () => {
    expect(selectionIsInert(FAST)).toBe(true)
    const r = round(1, [
      cycle('a', 'use', 'x'.repeat(100)),
      cycle('b', 'spaced_rep', 'y'.repeat(100)),
      cycle('c', 'build', 'z'.repeat(100)),
    ])
    expect(selectCyclesOutForMode(r, FAST, ctx(100)).size).toBe(0)
  })

  it('Easy drops USE phrases past half the course longest, and the SAME round keeps them on Fast', () => {
    // Six USE phrases so the floor of 5 cannot mask the cap.
    const r = round(50, [
      cycle('u1', 'use', 'x'.repeat(10)),
      cycle('u2', 'use', 'x'.repeat(20)),
      cycle('u3', 'use', 'x'.repeat(30)),
      cycle('u4', 'use', 'x'.repeat(40)),
      cycle('u5', 'use', 'x'.repeat(45)),
      cycle('u6', 'use', 'x'.repeat(90)), // > 50 ⇒ over the cap
    ])
    const easy = selectCyclesOutForMode(r, { ...EASY, useWordCap: null }, ctx(100))
    expect([...easy]).toEqual(['u6'])
    // The toggle: same queue, same round, other mode ⇒ nothing removed.
    expect(selectCyclesOutForMode(r, FAST, ctx(100)).size).toBe(0)
  })

  it('Easy exempts BUILD from the length cap; Fast applies it', () => {
    const builds = Array.from({ length: 6 }, (_, i) => cycle(`b${i}`, 'build', 'x'.repeat(i === 5 ? 90 : 10)))
    const r = round(50, builds)
    expect(selectCyclesOutForMode(r, EASY, ctx(100)).size).toBe(0)
    expect([...selectCyclesOutForMode(r, { ...FAST, maxPhraseLengthFraction: 0.5 }, ctx(100))]).toEqual(['b5'])
  })

  it('the review syllable filter counts the KNOWN side, and lifts after its max round', () => {
    const long = (c: never) => ((c as { id: string }).id === 'r2' ? 30 : 5)
    const r = round(50, [
      cycle('r1', 'spaced_rep', 'short', 'a short one'),
      cycle('r2', 'spaced_rep', 'short', 'a very much longer known side'),
    ])
    expect([...selectCyclesOutForMode(r, { ...EASY, maxPhraseLengthFraction: 1 }, ctx(100, long))]).toEqual(['r2'])

    // Round 101 is past reviewSyllableFilterMaxRound ⇒ the basket opens fully.
    const late = round(101, (r as unknown as { cycles: never[] }).cycles)
    expect(selectCyclesOutForMode(late, { ...EASY, maxPhraseLengthFraction: 1 }, ctx(100, long)).size).toBe(0)
  })

  it('the USE word cap slides by round — 8 words to round 20, 10 to 100, off after', () => {
    const nine = 'one two three four five six seven eight nine'
    const cycles = [
      ...Array.from({ length: 5 }, (_, i) => cycle(`k${i}`, 'use', 'short', 'two words')),
      cycle('w', 'use', 'short', nine),
    ]
    const cfg = { ...EASY, maxPhraseLengthFraction: 1, reviewMaxKnownSyllables: 0 }
    expect([...selectCyclesOutForMode(round(5, cycles), cfg, ctx(100))]).toEqual(['w'])   // limit 8
    expect(selectCyclesOutForMode(round(50, cycles), cfg, ctx(100)).size).toBe(0)          // limit 10
    expect(selectCyclesOutForMode(round(200, cycles), cfg, ctx(100)).size).toBe(0)         // uncapped
  })

  it('never empties a round — the floor reprieves the shortest offenders', () => {
    // Every USE phrase breaches; the floor of 5 must keep the 5 shortest.
    const cycles = Array.from({ length: 8 }, (_, i) => cycle(`u${i}`, 'use', 'x'.repeat(60 + i)))
    const out = selectCyclesOutForMode(round(50, cycles), { ...EASY, useWordCap: null }, ctx(100))
    expect(out.size).toBe(3)
    // The three LONGEST go; the five shortest stay.
    expect([...out].sort()).toEqual(['u5', 'u6', 'u7'])
  })

  it('never removes the intro, the bare LEGO debut, or a single-audio cycle', () => {
    const r = round(1, [
      cycle('i', 'intro', 'x'.repeat(90)),
      cycle('d', 'debut', 'x'.repeat(90)),
      { ...(cycle('p', 'use', 'x'.repeat(90)) as object), singleAudio: true },
    ])
    expect(selectCyclesOutForMode(r, EASY, ctx(100)).size).toBe(0)
    expect(isTeachingCycle(cycle('i', 'intro', '') as never)).toBe(true)
    expect(isTeachingCycle(cycle('u', 'use', '') as never)).toBe(false)
  })

  it('measures the course ceiling from practice cycles only', () => {
    const rounds = [
      round(1, [cycle('i', 'intro', 'x'.repeat(500)), cycle('u', 'use', 'x'.repeat(40))]),
      round(2, [cycle('u2', 'use', 'x'.repeat(60))]),
    ]
    expect(courseMaxCycleLength(rounds as never)).toBe(60)
  })
})
