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
import { nextPractisingState, type NextLegoFetchOutcome } from './practisingMode'

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
