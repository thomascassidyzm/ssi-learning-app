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
import { nextPractisingState, chooseHeldRoundIndex, type NextLegoFetchOutcome } from './practisingMode'

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

describe('chooseHeldRoundIndex — where the playhead goes instead of a new LEGO', () => {
  // A round "introduces material" if it carries an intro/debut/build cycle.
  const introduces = (r: { new?: boolean }) => r.new === true
  // 0..9, where every third round is a new-LEGO round.
  const rounds = Array.from({ length: 10 }, (_, i) => ({ i, new: i % 3 === 0 }))

  it('holds on the most recent review round behind the playhead', () => {
    // From 7: 6 is new, 5 is review. 5 is the answer.
    expect(chooseHeldRoundIndex(rounds, 7, 0, 40, introduces)).toBe(5)
  })

  it('steps further back each time, so the hold is a rotation not a loop', () => {
    const seen = [0, 1, 2, 3].map((step) => chooseHeldRoundIndex(rounds, 7, step, 40, introduces))
    expect(seen).toEqual([5, 4, 2, 1])
    // and it wraps rather than running off the end
    expect(chooseHeldRoundIndex(rounds, 7, 4, 40, introduces)).toBe(5)
  })

  it('never reaches further back than the window', () => {
    expect(chooseHeldRoundIndex(rounds, 9, 0, 2, introduces)).toBe(8)
    // window of 1 from index 9 leaves only round 8, which is review
    expect(chooseHeldRoundIndex(rounds, 9, 1, 1, introduces)).toBe(8)
  })

  it('says null when there is nothing practised behind the playhead', () => {
    // The learner is three rounds into a session and all of them are new.
    const allNew = [{ new: true }, { new: true }, { new: true }]
    expect(chooseHeldRoundIndex(allNew, 3, 0, 40, introduces)).toBeNull()
    // and at the very start of a session there is nothing behind at all
    expect(chooseHeldRoundIndex(rounds, 0, 0, 40, introduces)).toBeNull()
    expect(chooseHeldRoundIndex([], 5, 0, 40, introduces)).toBeNull()
  })

  it('never names a round the engine does not have', () => {
    // fromIndex past the end (a queue that shrank under us) must still be safe.
    const r = chooseHeldRoundIndex(rounds, 999, 0, 40, introduces)
    expect(r).not.toBeNull()
    expect(r!).toBeLessThan(rounds.length)
  })
})
