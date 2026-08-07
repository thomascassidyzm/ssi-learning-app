/**
 * repeatPhraseCycles — Easy mode plays every practice phrase twice.
 *
 * Tom, 2026-08-07, verbatim:
 *   "no filtering on BLD phrases - and also a HARD requirement - we want more
 *    repetitions in each ROUND for a LEGO
 *    but we do NOT ever want to repeat exactly the same phrase more than 2x -
 *    a phrase repeated 3x would drive people nuts, but doubled up is perfect
 *    so, the easiest thing might be - in EASY mode, double up every phrase,
 *    every BLD, every USE, every REVIEW, every CONSOLIDATE (these are just USE
 *    phrases)"
 *
 * And, asked directly whether the INTRO and the bare LEGO should be doubled
 * too: "of course not - the intro LEGO and not the LEGO alone". So the round's
 * two teaching cycles play ONCE and everything the learner practises plays
 * TWICE, back to back.
 *
 * EVERYTHING IS A SETTING (Tom, 2026-08-07): the repeat COUNT and the set of
 * cycle TYPES it applies to are both config, read from the mode row, never
 * hardcoded here. The one thing config cannot override is the ceiling of 2 —
 * that is Tom's rule, not a preference, so a row asking for 3 is clamped to 2
 * and says so.
 *
 * WHY A PASS OVER THE FINISHED LIST, AND NOT INSIDE THE ROUND BUILDER. The
 * cycle is the atomic unit — prompt, gap, voice 1, voice 2 — so repetition is a
 * duplication of whole script items, never a replay inside a cycle. One pass
 * over the finished item list means every emitter (main loop, revival tail, and
 * anything added later) obeys the same rule, and the rule itself is a pure
 * function a test can read end to end.
 *
 * ORDER MATTERS. This runs AFTER the generator's consecutive-duplicate removal
 * — which would otherwise strip the extra copy on sight — and BEFORE the A-64
 * consecutive-repeat floor, which allows at most two in a row and so stands
 * downstream as the guarantee that "twice" can never become three times.
 *
 * NOT repeated, deliberately:
 *   - intro and debut: Tom's ruling above (they are absent from the default
 *     type list, and a config row could add them — his call, not the code's);
 *   - SEED-PHASE production reviews (`reviewItemKind: 'seed'`): the drained
 *     t→k→t→t sandwich is already several cycles of one sentence, so repeating
 *     it would give four hearings and breach the never-more-than-twice rule.
 *     This one is structural, not a setting;
 *   - listening, pod and bookend cycles: Tom named BLD, USE, REVIEW and
 *     CONSOLIDATE, so those four are the default set.
 */

import type { ScriptItem } from './generateLearningScript'

/**
 * The four practice types Tom named — the DEFAULT for
 * `ModeConfig.repeatedCycleTypes`, not a hardcoded rule.
 *   build      = BLD
 *   spaced_rep = REVIEW
 *   use        = USE and CONSOLIDATE (consolidate cycles are use phrases)
 */
export const DEFAULT_REPEATED_CYCLE_TYPES: ScriptItem['type'][] = ['build', 'spaced_rep', 'use']

/**
 * The hard ceiling on repeats, from Tom's rule rather than from config: "we do
 * NOT ever want to repeat exactly the same phrase more than 2x". No DB row may
 * exceed it.
 */
export const MAX_PHRASE_REPEAT_COUNT = 2

export interface RepeatPhraseCyclesOptions {
  /** Times each eligible cycle plays. 1 = off. Clamped to MAX_PHRASE_REPEAT_COUNT. */
  count: number
  /** Cycle types the repeat applies to. */
  types: ReadonlySet<string>
}

/** Is this a cycle the active config repeats? */
export function isRepeatedCycle(item: ScriptItem, types: ReadonlySet<string>): boolean {
  if (!types.has(item.type)) return false
  // Seed-phase production review is already a multi-cycle sandwich — structural,
  // never a setting.
  if (item.reviewItemKind === 'seed') return false
  return true
}

/**
 * Return a new item list in which every eligible practice cycle appears
 * `count` times, consecutively. `cycleNum` is renumbered sequentially within
 * each round so the copies are correctly ordered, and each copy carries its own
 * uuid (`<original>_x2`, `_x3`, …) so downstream de-duplication and progress
 * tracking still see distinct cycles.
 *
 * `count` of 1 or less returns the input array untouched — which is what makes
 * Fast provably unchanged.
 */
export function repeatPhraseCycles(
  items: ScriptItem[],
  options: RepeatPhraseCyclesOptions,
): ScriptItem[] {
  const count = Math.min(Math.floor(options.count), MAX_PHRASE_REPEAT_COUNT)
  if (!Number.isFinite(count) || count <= 1) return items

  const out: ScriptItem[] = []
  let currentRound: number | null = null
  let cycleNum = 0

  for (const item of items) {
    if (item.roundNumber !== currentRound) {
      currentRound = item.roundNumber
      cycleNum = 0
    }
    const plays = isRepeatedCycle(item, options.types) ? count : 1
    for (let n = 1; n <= plays; n++) {
      out.push({
        ...item,
        cycleNum: ++cycleNum,
        ...(n > 1 ? { uuid: `${item.uuid}_x${n}` } : {}),
      })
    }
  }

  return out
}
