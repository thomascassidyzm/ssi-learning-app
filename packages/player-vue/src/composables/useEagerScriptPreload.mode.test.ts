/**
 * The eager preload has to carry the ACTIVE MODE into the walk.
 *
 * It didn't: `generateLearningScript(supabase, code)` with no mode arguments
 * at all, so a preloaded script was Fast's — no doubling, no character cap,
 * no syllable filter — even for a learner in Easy. The course-switch path in
 * LearningPlayer consumes exactly that promise, so switching courses in Easy
 * silently downgraded the whole 2026-08-07 Easy redesign.
 *
 * These tests pin the two halves of the fix: the walk gets the mode's levers,
 * and a consumer can tell whether the preload it's holding is its own mode's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { generateSpy } = vi.hoisted(() => ({
  generateSpy: vi.fn(() => Promise.resolve({ items: [], roundCount: 0 })),
}))

vi.mock('../providers/generateLearningScript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../providers/generateLearningScript')>()
  return { ...actual, generateLearningScript: generateSpy }
})
vi.mock('./useScriptCache', () => ({ checkContentVersion: () => Promise.resolve() }))

import { useEagerScriptPreload } from './useEagerScriptPreload'
import { easyOptionsForMode, maxPhraseLengthFractionForMode } from '../providers/modeScriptOptions'
import { DEFAULT_EASY, DEFAULT_FAST } from './useAlgorithmConfig'

const sb = {} as SupabaseClient

/** Positional args of generateLearningScript that carry the mode. */
const modeArgsOfLastCall = () => {
  const args = generateSpy.mock.calls[generateSpy.mock.calls.length - 1] as any[]
  return { maxPhraseLengthFraction: args[5], easyOptions: args[6] }
}

describe('useEagerScriptPreload — the preloaded script is the active mode\'s', () => {
  beforeEach(() => generateSpy.mockClear())

  it('threads Easy\'s levers into the walk — doubling, char cap, syllable filter', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_EASY })
    await preload.scriptPromise.value

    const { maxPhraseLengthFraction, easyOptions } = modeArgsOfLastCall()
    expect(maxPhraseLengthFraction).toBe(0.5)                        // the character cap
    expect(easyOptions.phraseRepeatCount).toBe(2)                    // the doubling
    expect(easyOptions.filterBuildPhrases).toBe(false)               // BUILD exempt
    expect(easyOptions.reviewMaxKnownSyllables).toBe(15)             // known-side filter
    expect(easyOptions.reviewSyllableFilterMaxRound).toBe(100)
  })

  it('matches a fresh (non-preloaded) Easy generation argument-for-argument', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_EASY })
    await preload.scriptPromise.value

    // What LearningPlayer's own call sites pass for the same mode.
    expect(modeArgsOfLastCall()).toEqual({
      maxPhraseLengthFraction: maxPhraseLengthFractionForMode(DEFAULT_EASY),
      easyOptions: easyOptionsForMode(DEFAULT_EASY),
    })
  })

  it('leaves Fast provably unchanged — uncapped, undoubled, unfiltered', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_FAST })
    await preload.scriptPromise.value

    const { maxPhraseLengthFraction, easyOptions } = modeArgsOfLastCall()
    expect(maxPhraseLengthFraction).toBe(1)
    expect(easyOptions.phraseRepeatCount).toBe(1)
    expect(easyOptions.filterBuildPhrases).toBe(true)
    expect(easyOptions.reviewMaxKnownSyllables).toBe(0)
  })

  it('reports a mode mismatch so a consumer refuses the other mode\'s script', async () => {
    const preload = useEagerScriptPreload()
    expect(preload.matchesMode(DEFAULT_EASY)).toBe(false)  // nothing preloaded yet

    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_EASY })
    await preload.scriptPromise.value
    expect(preload.matchesMode(DEFAULT_EASY)).toBe(true)
    expect(preload.matchesMode(DEFAULT_FAST)).toBe(false)
  })

  it('re-walks on a mode switch instead of serving the in-flight other-mode walk', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_FAST })
    await preload.scriptPromise.value
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_EASY })
    await preload.scriptPromise.value

    expect(generateSpy).toHaveBeenCalledTimes(2)
    expect(modeArgsOfLastCall().easyOptions.phraseRepeatCount).toBe(2)
  })

  it('still single-flights a repeat request for the same course and mode', async () => {
    const preload = useEagerScriptPreload()
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_EASY })
    preload.preload(sb, 'cym_for_eng', { modeConfig: DEFAULT_EASY })
    await preload.scriptPromise.value

    expect(generateSpy).toHaveBeenCalledTimes(1)
  })
})
