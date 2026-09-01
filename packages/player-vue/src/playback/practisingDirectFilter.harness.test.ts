/**
 * PRACTISING — direct-filter harness, run against Tom's real state.
 *
 * Verifies the fix for the 2026-09-01 report: the old design withheld new
 * LEGOs by sabotaging a fetch and waiting for a round-boundary trigger to
 * notice — which could only ever engage at a round boundary, from whatever
 * position the trigger had actually been asked about. This test proves the
 * DIRECT replacement (`isPractising && cycleIntroducesMaterial(cycle)`, wired
 * in LearningPlayer.vue's `shouldSkipCycle`) instead: a pure per-cycle
 * decision with no dependency on history, round boundaries, or position.
 *
 * THE DATA IS REAL. The LEGO ids, types and known/target text below are
 * queried live from `course_legos` (spa_for_eng) starting at S0406L01 — the
 * exact LEGO learner 81987d60 (Tom's own probe account) was on when this bug
 * was reported — plus the four LEGOs his own telemetry shows he had ALREADY
 * played in the preceding minutes (S0403L04, S0404L01, S0405L01, S0406L01).
 * Phrase counts follow the methodology floor (>=4 BUILD, >=5 USE per LEGO,
 * `feedback_ssi_build_use_phrase_floor`) since course_practice_phrases has no
 * rows yet for the not-yet-played LEGOs (draft status) — the cycle TYPE
 * composition is what this test exercises, not phrase text.
 */

import { describe, it, expect } from 'vitest'
import { cycleIntroducesMaterial } from './practisingMode'

type HarnessCycle = { id: string; type: string; legoId: string }
type HarnessRound = { roundNumber: number; legoId: string; cycles: HarnessCycle[] }

const NEW_MATERIAL_TYPES = new Set(['intro', 'debut', 'build', 'component_intro', 'component_practice'])

/** A realistic mature-course round: the new LEGO's own teaching block, then a
 *  review tail of USE phrases over LEGOs introduced long ago — exactly the
 *  shape `ralph-methodology.md`'s Round Structure describes, and exactly what
 *  Tom's own telemetry shows his queue actually contains at round 830+. */
function buildRound(roundNumber: number, legoId: string, reviewOverLegoIds: string[]): HarnessRound {
  const cycles: HarnessCycle[] = [
    { id: `${legoId}_intro`, type: 'intro', legoId },
    { id: `${legoId}_debut`, type: 'debut', legoId },
    { id: `${legoId}_build_1`, type: 'build', legoId },
    { id: `${legoId}_build_2`, type: 'build', legoId },
    { id: `${legoId}_build_3`, type: 'build', legoId },
    { id: `${legoId}_build_4`, type: 'build', legoId },
    { id: `${legoId}_use_1`, type: 'use', legoId },
    { id: `${legoId}_use_2`, type: 'use', legoId },
  ]
  for (const olderLegoId of reviewOverLegoIds) {
    cycles.push({ id: `${olderLegoId}_review_${roundNumber}`, type: 'spaced_rep', legoId: olderLegoId })
  }
  return { roundNumber, legoId, cycles }
}

// Real course_legos rows, spa_for_eng, queried live 2026-09-01: S0406L01 is
// Tom's own probe account's exact cursor at the time of the report; S0406L02
// and S0407L01 are the next two real LEGOs in the course.
const REAL_UPCOMING_LEGOS = ['S0406L02', 'S0407L01', 'S0407L02']
// Real telemetry, same account, same session: these four were ALREADY played
// (intro/debut/build/use audio_play events logged) in the minutes before the
// report — genuinely "material the learner already has".
const ALREADY_PLAYED_LEGOS = ['S0403L04', 'S0404L01', 'S0405L01', 'S0406L01']

function buildHarnessQueue(): HarnessRound[] {
  const rounds: HarnessRound[] = []
  let roundNumber = 829
  for (const legoId of ALREADY_PLAYED_LEGOS) {
    rounds.push(buildRound(roundNumber++, legoId, ALREADY_PLAYED_LEGOS.slice(0, rounds.length)))
  }
  for (const legoId of REAL_UPCOMING_LEGOS) {
    rounds.push(buildRound(roundNumber++, legoId, ALREADY_PLAYED_LEGOS))
  }
  return rounds
}

/** The exact expression added to LearningPlayer.vue's `shouldSkipCycle`. */
const skipsUnderPractising = (isPractising: boolean, cycle: HarnessCycle): boolean =>
  isPractising && cycleIntroducesMaterial(cycle)

describe('PRACTISING direct filter — harness against Tom\'s real state (spa_for_eng, S0406L01)', () => {
  it('serves ZERO intro/debut/build cycles anywhere in the queue while the flag is on', () => {
    const rounds = buildHarnessQueue()
    const allCycles = rounds.flatMap((r) => r.cycles)
    const survivors = allCycles.filter((c) => !skipsUnderPractising(true, c))

    const survivingNewMaterial = survivors.filter((c) => NEW_MATERIAL_TYPES.has(c.type))
    expect(survivingNewMaterial).toEqual([])

    // And it isn't vacuously true — there WAS new material in the queue to
    // filter (real upcoming LEGOs from course_legos), and something survives
    // to actually play (the review tail).
    const totalNewMaterial = allCycles.filter((c) => NEW_MATERIAL_TYPES.has(c.type))
    expect(totalNewMaterial.length).toBeGreaterThan(0)
    expect(survivors.length).toBeGreaterThan(0)
    // 'use' survives too — Tom's own spec lists USE as something to compose
    // FROM ("spaced repetition, USE, seed listening, pod dialogues"), and
    // `cycleIntroducesMaterial` already encodes this: a USE phrase's own
    // vocabulary was taught by this round's BUILD block, which IS withheld.
    expect(survivors.every((c) => c.type === 'spaced_rep' || c.type === 'use')).toBe(true)
  })

  it('engages INSTANTLY from a cold, arbitrary, mid-round position — the case that failed today', () => {
    // The failing case, verbatim from the report: the old switch answered
    // "the check was never made from this position" because engagement
    // depended on a round-boundary trigger having already fired FROM that
    // exact position. Simulate the flag flipping on with the learner already
    // three cycles into a brand-new LEGO's round (mid-build), never having
    // completed a round since — the scenario the old design could not serve.
    const rounds = buildHarnessQueue()
    const midRound = rounds.find((r) => r.legoId === 'S0406L02')!
    const coldArbitraryIndex = 2 // past intro+debut, into BUILD — not round 0, not a round boundary

    // No history is consulted, no round index is compared, no probe is
    // awaited: each cycle from the cold position onward is judged purely on
    // its own type.
    const decisionsFromColdPosition = midRound.cycles
      .slice(coldArbitraryIndex)
      .map((c) => ({ id: c.id, type: c.type, skipped: skipsUnderPractising(true, c) }))

    // Everything from the cold position that introduces material is skipped —
    // including the cycle sitting exactly at the cold index itself, proving
    // there is no "next round boundary" delay.
    for (const d of decisionsFromColdPosition) {
      expect(d.skipped).toBe(NEW_MATERIAL_TYPES.has(midRound.cycles.find((c) => c.id === d.id)!.type))
    }
    expect(decisionsFromColdPosition[0].id).toBe(`${midRound.legoId}_build_1`)
    expect(decisionsFromColdPosition[0].skipped).toBe(true)

    // The review tail on the SAME round (already-met material) plays through
    // untouched, proving composition from "what the learner already has"
    // works even mid-round, not just at a round's own start.
    const tailSurvivors = midRound.cycles.filter((c) => c.type === 'spaced_rep')
    expect(tailSurvivors.every((c) => !skipsUnderPractising(true, c))).toBe(true)
  })

  it('disengages INSTANTLY — the very next cycle plays once the flag drops, no recovery probe needed', () => {
    const rounds = buildHarnessQueue()
    const cycles = rounds.find((r) => r.legoId === 'S0407L01')!.cycles
    const introCycle = cycles.find((c) => c.type === 'intro')!

    expect(skipsUnderPractising(true, introCycle)).toBe(true)
    // Same cycle, flag now off, no state carried between the two calls at
    // all — the predicate takes the flag as an argument, not a memo.
    expect(skipsUnderPractising(false, introCycle)).toBe(false)
  })

  it('never touches already-met types — spaced_rep, use, listening, pod, listen bookends', () => {
    const alreadyMet = ['spaced_rep', 'use', 'listening', 'pod', 'listen_intro', 'listen_outro']
    for (const type of alreadyMet) {
      expect(skipsUnderPractising(true, { id: 'x', type, legoId: 'S0001L01' })).toBe(false)
    }
  })
})
