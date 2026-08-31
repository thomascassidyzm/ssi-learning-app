/**
 * THE SWITCH MUST SAY WHAT IT DID.
 *
 * A live session on 2026-08-31 could not be settled afterwards: Tom threw the
 * practising-mode test switch while online, saw belts skip to black, and said
 * "we do not know if practising mode really worked". Nothing in the app could
 * answer him, because two of the four probe outcomes leave the mode alone BY
 * DESIGN and neither of them said so anywhere. A correct no-op and an unwired
 * switch looked identical.
 *
 * So the contract asserted here is not about the blackout — it is about the
 * REPORT: every outcome produces a line, the two inert ones say why they are
 * inert, and a stale verdict can never sit under a fresh throw.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setContentBlackout,
  resetContentBlackout,
  reportBlackoutProbe,
  lastBlackoutProbe,
} from './contentBlackout'

describe('the practising test switch reports its own verdict', () => {
  beforeEach(() => resetContentBlackout())

  it('has nothing to say before it has been thrown', () => {
    expect(lastBlackoutProbe()).toBeNull()
  })

  it("says the mode is ON when the probe genuinely failed", () => {
    reportBlackoutProbe('failed', true)
    const r = lastBlackoutProbe()!
    expect(r.practising).toBe(true)
    expect(r.message).toMatch(/Practising mode is ON/)
  })

  it("names the course's end as the reason, rather than staying silent", () => {
    // The outcome that most likely bit him: skip to black belt, run out of new
    // content, and the blackout has nothing left to take away.
    reportBlackoutProbe('no-next', false)
    const r = lastBlackoutProbe()!
    expect(r.practising).toBe(false)
    expect(r.message).toMatch(/end of the course/)
  })

  it('names a probe that was never made, rather than staying silent', () => {
    reportBlackoutProbe('skipped', false)
    expect(lastBlackoutProbe()!.message).toMatch(/never made/)
  })

  it('never shows the previous throw’s verdict under a fresh one', () => {
    reportBlackoutProbe('failed', true)
    expect(lastBlackoutProbe()).not.toBeNull()
    setContentBlackout(false)
    expect(lastBlackoutProbe()).toBeNull()
  })
})
