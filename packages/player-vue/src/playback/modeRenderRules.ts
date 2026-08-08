/**
 * modeRenderRules — Easy and Fast are ONE script, rendered under different
 * play-time rules.
 *
 * THE RULING (Tom, 2026-08-08), which this module exists to enforce:
 *   "what we should really have is exactly the same script, but with different
 *    rules, so that if we toggle between easy and fast, you'll instantly get
 *    the correct audio... When I was going to Fast, having been in Easy, it was
 *    still playing double everything. And I had to clear the cache, and then
 *    restart the course, restart the player."
 *
 * WHY IT USED TO BE WRONG. The doubling and the phrase-length filters were
 * applied while GENERATING the script, and the generated script is cached. So
 * flipping the toggle flipped a flag over a queue of already-doubled items:
 * Easy→Fast kept doubling until the cache was cleared, and Fast→Easy never
 * started. The mode was a property of the bytes, when it is a property of the
 * moment.
 *
 * WHAT THE MODES ACTUALLY DIFFER BY, in the speaking loop, and nothing else:
 *   1. REPEAT — Easy plays each eligible practice cycle twice, back to back.
 *   2. SKIP   — Easy passes over a practice cycle whose KNOWN side runs longer
 *               than `maxKnownSyllables` (Tom: "certain phrases - the longest
 *               ones are skipped in easy mode. Anything greater than x
 *               syllables. Set as default 15 but it could change in admin
 *               configs").
 * Pause / thinking time and the listening speed ramp already went through the
 * runtime overrides and already switched live — they are untouched here.
 *
 * The two functions below are pure and take a `Cycle` — the play-time unit —
 * so both rules are consulted at the cycle boundary and a mode flip lands on
 * the NEXT cycle with no regeneration, no cache clear and no reload.
 *
 * The basket is IDENTICAL in both modes. Nothing in here may ever move into
 * the generator, into a cache key, or into a cached round.
 */

import type { Cycle } from '@ssi/core'

/**
 * The four practice types Tom named — the DEFAULT for
 * `ModeConfig.repeatedCycleTypes`, not a hardcoded rule.
 *   build      = BLD
 *   spaced_rep = REVIEW
 *   use        = USE and CONSOLIDATE (consolidate cycles are use phrases)
 * The INTRO and the bare LEGO are absent by his ruling: "of course not - the
 * intro LEGO and not the LEGO alone".
 */
export const DEFAULT_REPEATED_CYCLE_TYPES: string[] = ['build', 'spaced_rep', 'use']

/**
 * The hard ceiling on repeats, from Tom's rule rather than from config: "we do
 * NOT ever want to repeat exactly the same phrase more than 2x - a phrase
 * repeated 3x would drive people nuts, but doubled up is perfect". No DB row
 * may exceed it.
 */
export const MAX_PHRASE_REPEAT_COUNT = 2

/**
 * Cycle types the Easy length skip is allowed to touch: REVIEW and
 * USE/CONSOLIDATE. BUILD is deliberately absent — "no filtering on BLD
 * phrases" (Tom, 2026-08-07), because the debut round exists to be generous
 * and those fragments are short anyway — and so are intro, the bare LEGO,
 * listening, pod and bookend cycles, which are not practice at all.
 */
export const LENGTH_SKIPPABLE_CYCLE_TYPES: ReadonlySet<string> = new Set(['spaced_rep', 'use'])

/** The live, mode-dependent render rules, resolved fresh at every cycle. */
export interface ModeRenderRules {
  /** Times each eligible practice cycle plays. 1 = Fast = off. */
  repeatCount: number
  /** Cycle types the repeat applies to. */
  repeatedTypes: ReadonlySet<string>
  /** Max KNOWN-side syllables for a practice cycle. Infinity = Fast = off. */
  maxKnownSyllables: number
}

/**
 * How many times this cycle plays back to back, under the live rules.
 *
 * SEED-PHASE production reviews are never repeated whatever config says: the
 * drained t→k→t→t sandwich is already several cycles of one sentence, so
 * repeating it would give four hearings and breach the never-more-than-twice
 * rule. Structural, not a setting. Those sub-cycles — along with listening,
 * pod and bookend cycles — are exactly the ones carrying `singleAudio`, which
 * is the play-time shape of the script's `reviewItemKind: 'seed'` flag.
 */
export function cyclePlayCountFor(cycle: Cycle, rules: ModeRenderRules): number {
  const count = Math.min(Math.floor(rules.repeatCount), MAX_PHRASE_REPEAT_COUNT)
  if (!Number.isFinite(count) || count <= 1) return 1
  if (!cycle.type || !rules.repeatedTypes.has(cycle.type)) return 1
  if (cycle.singleAudio) return 1
  return count
}

/**
 * Should Easy pass over this cycle because its KNOWN side is too long?
 *
 * `syllablesOf` returns null when the course's known language has no
 * registered counter — the inert path, in which nothing is ever skipped. A
 * cycle the rule cannot measure always plays: a length rule must never be able
 * to silence a lesson it cannot read.
 */
export function shouldSkipForLength(
  cycle: Cycle,
  rules: ModeRenderRules,
  syllablesOf: (text: string) => number | null,
): boolean {
  if (!Number.isFinite(rules.maxKnownSyllables)) return false
  if (!cycle.type || !LENGTH_SKIPPABLE_CYCLE_TYPES.has(cycle.type)) return false
  if (cycle.singleAudio) return false
  const text = cycle.known?.text
  if (!text) return false
  const syllables = syllablesOf(text)
  if (syllables == null) return false
  return syllables > rules.maxKnownSyllables
}
