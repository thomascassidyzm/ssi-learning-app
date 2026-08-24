/**
 * THE SELECTION MEMO MUST BE BUILT FROM THE ENGINE'S QUEUE, NOT FROM A MIRROR.
 *
 * Tom, 2026-08-09: toggling Easy/Fast mid-session "does not correctly change
 * playback — a complete fail". The repeat lever (how many times a cycle sounds)
 * worked, because it answers from config. The SELECTION lever (which phrases
 * play at all) was inert, because it answers by matching a cycle's ID against a
 * memo — and the memo was built from `cachedRounds`, a text/progress mirror
 * that the instant path swaps to the whole-course walk while the engine keeps
 * playing the bootstrap's backend-built rounds.
 *
 * The two builders mint ids in DIFFERENT NAMESPACES, which is what makes this
 * fatal rather than merely untidy:
 *   - the walk (generateLearningScript) numbers every cycle from one
 *     script-global counter that also counted the intro and the debut:
 *     `S0009L01_build_147`;
 *   - the /cycles endpoint numbers per type, per LEGO, from 1:
 *     `S0009L01_build_2`.
 * They diverge from the very first round and never re-converge.
 *
 * These tests pin the two properties the wiring needs. They deliberately do NOT
 * mount LearningPlayer — they pin the pure facts the wiring depends on, which
 * is what the old tests were missing: every existing mode test built its memo
 * and its queue from the SAME fixture, so the namespace shear could not appear.
 */
import { describe, it, expect } from 'vitest'
import {
  selectCyclesOutForMode,
  makeModeSelectionContext,
  type ModeSelectionConfig,
} from './modeCycleSelection'

const cycle = (id: string, type: string, target: string, known = '') =>
  ({ id, type, known: { text: known, audioUrl: '' }, target: { text: target, voice1Url: '', voice2Url: '' } }) as never

const round = (roundNumber: number, cycles: unknown[]) =>
  ({ roundNumber, legoId: 'S0009L01', seedId: 'S0009', cycles }) as never

const EASY: ModeSelectionConfig = {
  maxPhraseLengthFraction: 0.5,
  filterBuildPhrases: false,
  reviewMaxKnownSyllables: 0,
  reviewSyllableFilterMaxRound: 0,
  useWordCap: null,
}

/** Six USE phrases so the floor of 5 cannot mask the cap. Same phrases, same
 *  order, same round — only the id namespace differs. */
const USES: Array<[string, string]> = [
  ['1', 'short one'],
  ['2', 'short two'],
  ['3', 'short three'],
  ['4', 'short four'],
  ['5', 'short five'],
  ['6', 'a considerably longer phrase than any of the others in this round'],
]

/** How the /cycles endpoint ids them: per type, per LEGO, from 1. */
const backendRound = () =>
  round(9, USES.map(([n, text]) => cycle(`S0009L01_use_${n}`, 'use', text)))

/** How the walk ids them: one script-global counter, already in the hundreds. */
const walkRound = () =>
  round(9, USES.map(([n, text]) => cycle(`S0009L01_use_${140 + Number(n)}`, 'use', text)))

describe('the mode-selection memo and the queue must share an id namespace', () => {
  it('the walk and the backend genuinely id the same phrases differently', () => {
    const backendIds = (backendRound() as never as { cycles: { id: string }[] }).cycles.map((c) => c.id)
    const walkIds = (walkRound() as never as { cycles: { id: string }[] }).cycles.map((c) => c.id)
    // No overlap at all — so a memo from one cannot match a cycle from the other.
    expect(backendIds.some((id) => walkIds.includes(id))).toBe(false)
  })

  it('a memo built from the MIRROR selects nothing out of the ENGINE queue — the bug', () => {
    const ctx = makeModeSelectionContext([walkRound()], 'cym_for_eng', 'en', false)
    const memo = selectCyclesOutForMode(walkRound(), EASY, ctx)
    // The memo is not empty: Easy really does want to drop the long phrase.
    expect(memo.size).toBeGreaterThan(0)
    // But asked about the cycles the engine is actually playing, it matches none.
    const engineCycles = (backendRound() as never as { cycles: { id: string }[] }).cycles
    expect(engineCycles.filter((c) => memo.has(c.id))).toHaveLength(0)
  })

  it('a memo built from the ENGINE queue drops exactly the phrase Easy means to drop', () => {
    const ctx = makeModeSelectionContext([backendRound()], 'cym_for_eng', 'en', false)
    const memo = selectCyclesOutForMode(backendRound(), EASY, ctx)
    const engineCycles = (backendRound() as never as { cycles: { id: string }[] }).cycles
    expect(engineCycles.filter((c) => memo.has(c.id)).map((c) => c.id)).toEqual(['S0009L01_use_6'])
  })
})

describe('the length cap does not breathe with the loaded window', () => {
  const longest = 'x'.repeat(120)
  const wholeCourse = [round(9, [cycle('a', 'use', longest), cycle('b', 'use', 'x'.repeat(20))])]
  const smallWindow = [round(9, [cycle('b', 'use', 'x'.repeat(20))])]

  it('measured off a small window alone, the cap collapses', () => {
    expect(makeModeSelectionContext(smallWindow, 'c', 'en', false).courseMaxPhraseLength).toBe(20)
  })

  it('a high-water minimum holds the cap at the course figure', () => {
    const seen = makeModeSelectionContext(wholeCourse, 'c', 'en', false).courseMaxPhraseLength
    expect(seen).toBe(120)
    // The window shrinks; the answer must not.
    expect(makeModeSelectionContext(smallWindow, 'c', 'en', false, seen).courseMaxPhraseLength).toBe(120)
  })

  it('the minimum is a floor, never a ceiling — a longer phrase still raises it', () => {
    expect(makeModeSelectionContext(wholeCourse, 'c', 'en', false, 50).courseMaxPhraseLength).toBe(120)
  })
})
