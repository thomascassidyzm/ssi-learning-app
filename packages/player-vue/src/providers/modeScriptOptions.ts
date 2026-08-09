/**
 * modeScriptOptions — the ONE place a mode's config row becomes the script
 * generator's mode arguments.
 *
 * generateLearningScript takes the Easy levers as a bare positional object.
 * That object was being built by hand at each call site, so a call site that
 * forgot it (useEagerScriptPreload did, from the day it was written) silently
 * generated FAST's script while the learner was in Easy — no doubling, no
 * character cap, no syllable filter. Nothing about the call looked wrong.
 *
 * So the mapping lives here, once. New Easy levers get added in this file and
 * every call site picks them up; a call site can no longer be half-right.
 */

import type { EasyModeOptions } from './generateLearningScript'
import type { ModeConfig } from '../composables/useAlgorithmConfig'

/**
 * The active mode's Easy levers (Tom, 2026-08-07): every practice cycle
 * doubled, BUILD phrases exempt from the length cap, and a known-side
 * syllable filter on review/consolidate pulls for the first N rounds.
 * Fast's row carries them all off, so Fast is provably unchanged.
 */
export const easyOptionsForMode = (mode: Partial<ModeConfig> | null | undefined): EasyModeOptions => ({
  phraseRepeatCount: mode?.phraseRepeatCount ?? 1,
  repeatedCycleTypes: mode?.repeatedCycleTypes,
  filterBuildPhrases: mode?.filterBuildPhrases !== false,
  reviewMaxKnownSyllables: mode?.reviewMaxKnownSyllables ?? 0,
  reviewSyllableFilterMaxRound: mode?.reviewSyllableFilterMaxRound,
})

/**
 * Phrase-length CAP for the active mode — a fraction of the longest phrase in
 * the whole course. Fast is uncapped (1.0); Easy ships 0.5.
 */
export const maxPhraseLengthFractionForMode = (mode: Partial<ModeConfig> | null | undefined): number =>
  mode?.maxPhraseLengthFraction ?? 1
