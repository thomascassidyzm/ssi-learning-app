/**
 * modeCycleSelection — WHICH cycles the ACTIVE mode plays, decided in the
 * player, live, from the queue it already holds.
 *
 * Tom's architecture call, 2026-08-09, after two failed attempts at this bug:
 *
 *   "do NOT solve this by clearing/invalidating the audio-file cache or the
 *    per-round phrase-content cache — those should stay cached, that is
 *    correct and desired… The instructions for WHICH cycles get selected/
 *    played and HOW MANY TIMES belongs in the player logic, not the cached
 *    script data. Speed and pause-length are already correctly read live by
 *    the player (this part works). The cycle-selection/count logic is what is
 *    not reading the live mode correctly."
 *
 * That is the whole design. The script walk emits ONE generous, mode-neutral
 * set of cycles — content, cacheable, shared by both modes and never
 * invalidated on a toggle. Easy and Fast are then two different SELECTIONS
 * over that set, computed here and consulted by SimplePlayer's per-step
 * `shouldSkipCycle` hook, exactly where playback speed and pause length are
 * already read live and already work.
 *
 * WHY THIS IS THE ONLY SHAPE THAT CAN WORK. The four Easy levers
 * (maxPhraseLengthFraction, filterBuildPhrases, reviewMaxKnownSyllables,
 * useWordCapTiers) all used to run at GENERATION time, where they DROP items.
 * A dropped phrase is not recoverable from the queue by any amount of
 * reshaping, so a mid-session toggle could never restore it — which is exactly
 * what Tom heard: "switching the mode toggle mid-session does not correctly
 * change which phrases play — complete fail, not partial." Move the same rules
 * to play time, over a superset, and both directions become a pure filter.
 *
 * THE RULES ARE NOT REIMPLEMENTED HERE. Every measure and every threshold
 * comes from the same exported helpers the walk used — phraseTextLength,
 * countEnglishWords, useWordLimitForRound, makeKnownSyllableResolver — so
 * there is ONE definition of "Easy halves the longest phrase" and it is now
 * read at play time instead of build time.
 *
 * FLOORS ARE STRUCTURAL, NOT A SETTING. A filter that empties a round is worse
 * than a round of long phrases, and the methodology's per-LEGO minimums exist
 * precisely to stop that ("fewer phrases is a FAIL"). Every rule below is
 * applied per round and then backed off, shortest-first, until the floor holds.
 */

import type { Cycle, Round } from './SimplePlayer'
import {
  phraseTextLength,
  countEnglishWords,
  useWordLimitForRound,
  makeKnownSyllableResolver,
  MIN_BUILD_PHRASES_AFTER_CAP,
  MIN_USE_PHRASES_AFTER_CAP,
  type UseWordCap,
  type PhraseSyllableResolver,
} from '../composables/useAlgorithmConfig'

/**
 * Cycle types that are TEACHING, never practice: the round's intro and the
 * bare LEGO debut, the listening/pod/bookend lanes, and anything carrying at
 * most one audio track. A mode never removes these — dropping the intro would
 * change what the round IS, not how much of it the learner practises.
 */
const NEVER_SELECTED_OUT = new Set([
  'intro', 'debut', 'component_intro',
  'listening', 'listen_intro', 'listen_outro', 'pod',
])

/** The practice types a mode may thin, and the floor each must leave standing. */
const PRACTICE_FLOORS: Record<string, number> = {
  build: MIN_BUILD_PHRASES_AFTER_CAP,   // 4
  use: MIN_USE_PHRASES_AFTER_CAP,       // 5
  // A review slot is never left empty because the basket happens to be long
  // (the walk's shortest-in-basket fallback, restated at play time).
  spaced_rep: 1,
}

/** The active mode's selection rules, read live off its ModeConfig. */
export interface ModeSelectionConfig {
  /** Fraction of the course's longest phrase a phrase may be. 1 ⇒ no cap. */
  maxPhraseLengthFraction: number
  /** Does the length cap apply to BUILD phrases? Easy says no. */
  filterBuildPhrases: boolean
  /** Max KNOWN-side syllables for a review/consolidate cycle. 0 ⇒ off. */
  reviewMaxKnownSyllables: number
  /** Last round the review syllable filter applies on. */
  reviewSyllableFilterMaxRound: number
  /** Resolved sliding USE word cap, or null when it does not apply. */
  useWordCap: UseWordCap | null
}

/** Everything about the COURSE the rules measure against, resolved once. */
export interface ModeSelectionContext {
  /**
   * Character length of the longest phrase the learner can meet in this
   * course. The cap is a fraction OF this. Computed from the loaded queue —
   * see `courseMaxCycleLength` — because the player holds cycles, not pools.
   */
  courseMaxPhraseLength: number
  /** Counts a cycle's KNOWN side in the course's known language, or null. */
  knownSyllables: (cycle: Cycle) => number | null
}

/** True for a cycle no mode may ever select out. */
export const isTeachingCycle = (cycle: Cycle): boolean =>
  Boolean(cycle?.singleAudio) || NEVER_SELECTED_OUT.has(cycle?.type ?? '')

/**
 * The course's longest phrase, in characters of target text, measured across
 * every cycle the player has loaded.
 *
 * Deliberately measured from the QUEUE rather than from the phrase pools the
 * walk saw: the player has no pools, and this is the only "longest possible
 * phrase" it can honestly name. It is a lower bound on the walk's figure (the
 * queue is a selection from the pools), so the cap it produces is slightly
 * tighter — the same direction Easy is pulling, never looser.
 */
export function courseMaxCycleLength(rounds: readonly Round[]): number {
  let max = 0
  for (const round of rounds) {
    for (const cycle of round?.cycles ?? []) {
      if (isTeachingCycle(cycle)) continue
      const n = phraseTextLength(cycle?.target?.text)
      if (n > max) max = n
    }
  }
  return max
}

/** Build the context the rules measure against. */
export function makeModeSelectionContext(
  rounds: readonly Round[],
  courseCode: string,
  knownLang: string | null | undefined,
  needsSyllables: boolean,
): ModeSelectionContext {
  const resolver: PhraseSyllableResolver | null = needsSyllables
    ? makeKnownSyllableResolver(courseCode, knownLang)
    : null
  return {
    courseMaxPhraseLength: courseMaxCycleLength(rounds),
    knownSyllables: (cycle) =>
      resolver ? resolver.syllablesOf({ known_text: cycle?.known?.text }) : null,
  }
}

/** Would this rule-set change anything at all? Fast answers no on every count. */
export const selectionIsInert = (cfg: ModeSelectionConfig): boolean =>
  (!Number.isFinite(cfg.maxPhraseLengthFraction) || cfg.maxPhraseLengthFraction >= 1) &&
  !(cfg.reviewMaxKnownSyllables > 0) &&
  cfg.useWordCap === null

/**
 * Decide which of ONE round's cycles the active mode does NOT play.
 *
 * Returns the set of cycle ids to skip — never the cycles to keep — so a
 * caller that cannot find an id simply plays the cycle, which is the safe
 * direction for a filter nobody should notice going wrong.
 *
 * Pure: same round + same config + same context ⇒ same answer, so the caller
 * can memoise it per round and throw the memo away the instant the mode moves.
 */
export function selectCyclesOutForMode(
  round: Round | null | undefined,
  cfg: ModeSelectionConfig,
  ctx: ModeSelectionContext,
): Set<string> {
  const out = new Set<string>()
  const cycles = round?.cycles
  if (!cycles?.length || selectionIsInert(cfg)) return out

  const roundNumber = round?.roundNumber ?? 1
  const lengthLimit =
    Number.isFinite(cfg.maxPhraseLengthFraction) &&
    cfg.maxPhraseLengthFraction < 1 &&
    ctx.courseMaxPhraseLength > 0
      ? ctx.courseMaxPhraseLength * cfg.maxPhraseLengthFraction
      : Infinity
  const wordLimit = useWordLimitForRound(cfg.useWordCap, roundNumber)
  const syllableLimit =
    cfg.reviewMaxKnownSyllables > 0 && roundNumber <= cfg.reviewSyllableFilterMaxRound
      ? cfg.reviewMaxKnownSyllables
      : Infinity

  /** Does this practice cycle breach any rule the active mode applies? */
  const breaches = (cycle: Cycle): boolean => {
    const type = cycle?.type ?? ''
    // The length cap. Easy exempts BUILD entirely — "no filtering on BLD
    // phrases" (Tom, 2026-08-07) — which is what `filterBuildPhrases` says.
    if (Number.isFinite(lengthLimit) && (type !== 'build' || cfg.filterBuildPhrases)) {
      if (phraseTextLength(cycle?.target?.text) > lengthLimit) return true
    }
    // The KNOWN-side syllable filter on review / consolidate pulls. An
    // uncountable phrase passes, per the resolver's contract.
    if (type === 'spaced_rep' && Number.isFinite(syllableLimit)) {
      const n = ctx.knownSyllables(cycle)
      if (typeof n === 'number' && Number.isFinite(n) && n > syllableLimit) return true
    }
    // The sliding ENGLISH-side word cap on USE phrases. A phrase with nothing
    // countable passes, exactly as capUsePoolByWords lets it.
    if (type === 'use' && Number.isFinite(wordLimit)) {
      const side = cfg.useWordCap?.side === 'known' ? cycle?.known?.text : cycle?.target?.text
      const words = countEnglishWords(side)
      if (words > 0 && words > wordLimit) return true
    }
    return false
  }

  // Gather the candidates per practice type, so each type's floor is judged
  // against its own population rather than the round's total.
  const byType = new Map<string, Cycle[]>()
  for (const cycle of cycles) {
    if (isTeachingCycle(cycle)) continue
    const type = cycle?.type ?? ''
    if (!(type in PRACTICE_FLOORS)) continue
    const list = byType.get(type)
    if (list) list.push(cycle)
    else byType.set(type, [cycle])
  }

  for (const [type, list] of byType) {
    const doomed = list.filter(breaches)
    if (doomed.length === 0) continue
    const floor = Math.min(PRACTICE_FLOORS[type], list.length)
    const survivors = list.length - doomed.length
    if (survivors >= floor) {
      for (const cycle of doomed) if (cycle?.id) out.add(cycle.id)
      continue
    }
    // The floor bites: reprieve the SHORTEST of the doomed until it holds, so
    // a thinned round is still the gentlest one available rather than empty.
    // Shortest-first is the walk's own ordering rule, restated here.
    const reprieve = floor - survivors
    const ordered = [...doomed].sort(
      (a, b) => phraseTextLength(a?.target?.text) - phraseTextLength(b?.target?.text),
    )
    for (const cycle of ordered.slice(reprieve)) if (cycle?.id) out.add(cycle.id)
  }

  return out
}
