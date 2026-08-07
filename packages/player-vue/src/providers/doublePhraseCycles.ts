/**
 * doublePhraseCycles — Easy mode plays every practice phrase twice.
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
 * WHY HERE, AND NOT INSIDE THE ROUND BUILDER. The cycle is the atomic unit —
 * prompt, gap, voice 1, voice 2 — so doubling is a duplication of whole script
 * items, never a replay inside a cycle. Running it as one pass over the
 * finished item list means every emitter (main loop, revival tail, and
 * anything added later) is doubled by the same rule, and the rule itself is a
 * pure function that a test can read end to end.
 *
 * ORDER MATTERS. This runs AFTER the generator's consecutive-duplicate removal
 * — which would otherwise strip the second copy on sight — and BEFORE the A-64
 * consecutive-repeat floor, which allows at most two in a row and so stands
 * downstream as the guarantee that "twice" can never become three times.
 *
 * NOT doubled, deliberately:
 *   - intro and debut: Tom's ruling above;
 *   - SEED-PHASE production reviews (`reviewItemKind: 'seed'`): the drained
 *     t→k→t→t sandwich is already several cycles of one sentence, so doubling
 *     it would give four hearings of the same sentence and breach the
 *     never-more-than-twice rule;
 *   - listening, pod and bookend cycles: Tom named BLD, USE, REVIEW and
 *     CONSOLIDATE, and said "of course not" to the teaching cycles. These are
 *     neither, so they stay as they are until he says otherwise.
 */

import type { ScriptItem } from './generateLearningScript'

/** The four practice types Tom named. Everything else plays once. */
export const DOUBLED_TYPES: ReadonlySet<ScriptItem['type']> = new Set<ScriptItem['type']>([
  'build',        // BLD
  'spaced_rep',   // REVIEW
  'use',          // USE and CONSOLIDATE — consolidate cycles are use phrases
])

/** Is this the kind of cycle Easy plays twice? */
export function isDoubledCycle(item: ScriptItem): boolean {
  if (!DOUBLED_TYPES.has(item.type)) return false
  // Seed-phase production review is already a multi-cycle sandwich.
  if (item.reviewItemKind === 'seed') return false
  return true
}

/**
 * Return a new item list in which every practice cycle appears exactly twice,
 * consecutively. `cycleNum` is renumbered sequentially within each round so
 * the pairs are correctly ordered, and each duplicate carries its own uuid
 * (`<original>_x2`) so downstream de-duplication and progress tracking still
 * see two distinct cycles.
 */
export function doublePhraseCycles(items: ScriptItem[]): ScriptItem[] {
  const out: ScriptItem[] = []
  let currentRound: number | null = null
  let cycleNum = 0

  for (const item of items) {
    if (item.roundNumber !== currentRound) {
      currentRound = item.roundNumber
      cycleNum = 0
    }
    out.push({ ...item, cycleNum: ++cycleNum })
    if (isDoubledCycle(item)) {
      out.push({ ...item, cycleNum: ++cycleNum, uuid: `${item.uuid}_x2` })
    }
  }

  return out
}
