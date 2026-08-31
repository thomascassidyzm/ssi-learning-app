/**
 * THE ONE TRIGGER. Tom's ruling, 2026-08-31.
 *
 *   "we should just keep playing as always, whether network is good or bad,
 *    UNTIL we can't fetch the next NEW LEGO, the LEGO whose turn it is. At
 *    THAT point we go into practising mode."
 *
 * These tests pin the two halves of that sentence. The first half — network
 * quality is not a trigger — shows up here as an ABSENCE: there is no online,
 * offline, degraded or signal-strength input to this function, and the only
 * outcomes that move the mode are the two that describe the fetch itself.
 */

import { describe, it, expect } from 'vitest'
import { nextPractisingState, choosePractisedPosition, cycleIntroducesMaterial, type NextLegoFetchOutcome } from './practisingMode'

describe('practising mode — the next-new-LEGO trigger', () => {
  it('enters when the next new LEGO cannot be fetched', () => {
    expect(nextPractisingState(false, 'failed')).toBe(true)
  })

  it('leaves when the next new LEGO can be fetched again', () => {
    expect(nextPractisingState(true, 'fetched')).toBe(false)
  })

  it('stays out while the fetch keeps working', () => {
    expect(nextPractisingState(false, 'fetched')).toBe(false)
  })

  it('stays in while the fetch keeps failing — and raises no second alarm', () => {
    expect(nextPractisingState(true, 'failed')).toBe(true)
  })

  it('does NOT enter at the end of the course — that is not a failure', () => {
    // No round after this one is a fact about the CONTENT. Infinite play owns
    // that case; treating it as a connection problem would put the banner up
    // for every learner who finishes a course.
    expect(nextPractisingState(false, 'no-next')).toBe(false)
    expect(nextPractisingState(true, 'no-next')).toBe(true)
  })

  it('does NOT move on a fetch we never made or cancelled ourselves', () => {
    // An abort is our own teardown or budget, not the connection. A skipped
    // prefetch says nothing at all. Neither may enter the mode, and — just as
    // important — neither may silently END it and unfreeze the cursor.
    expect(nextPractisingState(false, 'skipped')).toBe(false)
    expect(nextPractisingState(true, 'skipped')).toBe(true)
  })

  it('recovers cleanly across a whole bad stretch', () => {
    const stretch: NextLegoFetchOutcome[] = [
      'fetched', 'fetched', 'failed', 'skipped', 'failed', 'failed', 'fetched',
    ]
    const seen = stretch.reduce<boolean[]>((acc, o) => {
      acc.push(nextPractisingState(acc[acc.length - 1] ?? false, o))
      return acc
    }, [])
    expect(seen).toEqual([false, false, true, true, true, true, false])
  })
})

describe('choosePractisedPosition — where the playhead goes instead of a new LEGO', () => {
  // The shape every ordinary main-loop round has, and the shape that broke the
  // first version of this: intro, debut, builds, THEN the practised tail.
  const mainLoop = (n: number) => ({
    n,
    cycles: [
      { type: 'intro' }, { type: 'debut' }, { type: 'build' }, { type: 'build' },
      { type: 'spaced_rep' }, { type: 'spaced_rep' }, { type: 'use' },
    ],
  })
  // Ten of them, which is what a real learner's history looks like. Under the
  // old round-shaped predicate this history offered NOTHING and the mode served
  // a brand-new LEGO — the bug this file now pins shut.
  const rounds = Array.from({ length: 10 }, (_, i) => mainLoop(i))

  it('lands on practised material even when EVERY round behind introduces a LEGO', () => {
    // The regression test, in one line: Tom's own history is all main-loop
    // rounds, and the answer must not be null.
    const pos = choosePractisedPosition(rounds, 9, 0)
    expect(pos).toEqual({ roundIndex: 8, cycleIndex: 4 })
  })

  it('never lands on anything that introduces material', () => {
    // Walk every step a long hold would take and assert the cycle it lands on,
    // and every cycle after it in that round, is review.
    for (let step = 0; step < 30; step++) {
      const pos = choosePractisedPosition(rounds, 9, step)!
      expect(pos).not.toBeNull()
      const tail = rounds[pos.roundIndex].cycles.slice(pos.cycleIndex)
      expect(tail.length).toBeGreaterThan(0)
      expect(tail.some((c) => cycleIntroducesMaterial(c))).toBe(false)
    }
  })

  it('rotates newest-first and wraps, so the hold is not one round on a loop', () => {
    const seen = [0, 1, 2, 3].map((step) => choosePractisedPosition(rounds, 9, step)!.roundIndex)
    expect(seen).toEqual([8, 7, 6, 5])
    // nine rounds behind, so step 9 comes back to the newest
    expect(choosePractisedPosition(rounds, 9, 9)!.roundIndex).toBe(8)
  })

  it('counts the component cycles as new material, not as practice', () => {
    // They belong to the LEGO being introduced. A hold that landed on one
    // would be serving exactly what the mode exists to withhold.
    expect(cycleIntroducesMaterial({ type: 'component_intro' })).toBe(true)
    expect(cycleIntroducesMaterial({ type: 'component_practice' })).toBe(true)
    expect(cycleIntroducesMaterial({ type: 'spaced_rep' })).toBe(false)
    expect(cycleIntroducesMaterial({ type: 'use' })).toBe(false)
    expect(cycleIntroducesMaterial({ type: 'listening' })).toBe(false)
    expect(cycleIntroducesMaterial({ type: 'pod' })).toBe(false)
  })

  it('skips a round whose tail is not clean to the end', () => {
    // Defensive: a round ordered review-then-build must not be entered at the
    // review, because we play from there onwards and would reach the build.
    const dirty = [
      { cycles: [{ type: 'spaced_rep' }, { type: 'build' }] },
      { cycles: [{ type: 'intro' }, { type: 'use' }] },
    ]
    expect(choosePractisedPosition(dirty, 2, 0)).toEqual({ roundIndex: 1, cycleIndex: 1 })
  })

  it('cannot run dry: replays the last completed round when nothing has a clean tail', () => {
    // One round into a brand-new course. There is no practised tail anywhere,
    // and the answer is still not "serve a new LEGO" — it is the round the
    // learner has just done, whose LEGO they have already met.
    const allNew = [{ cycles: [{ type: 'intro' }, { type: 'debut' }, { type: 'build' }] }]
    expect(choosePractisedPosition(allNew, 1, 0)).toEqual({ roundIndex: 0, cycleIndex: 0 })
  })

  it('says null only when nothing at all has been completed', () => {
    expect(choosePractisedPosition(rounds, 0, 0)).toBeNull()
    expect(choosePractisedPosition([], 5, 0)).toBeNull()
  })

  it('never names a round the engine does not have', () => {
    // fromIndex past the end (a queue that shrank under us) must still be safe.
    const pos = choosePractisedPosition(rounds, 999, 0)
    expect(pos).not.toBeNull()
    expect(pos!.roundIndex).toBeLessThan(rounds.length)
    expect(pos!.roundIndex).toBeGreaterThanOrEqual(0)
  })
})
