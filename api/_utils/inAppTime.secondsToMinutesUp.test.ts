/**
 * Tom, 2026-09-14 16:17Z (job #683): "round up to the nearest minute, not
 * down. because learners who start playing and do 20-30s are showing as 0
 * mins". class-practice-7d used Math.round at the seconds source, so a
 * 25-second lesson reached every page as 0. Red before, green after.
 */
import { describe, it, expect } from 'vitest'
import { secondsToMinutesUp } from './inAppTime'

describe('secondsToMinutesUp', () => {
  it('25 seconds is 1 minute, never 0', () => { expect(secondsToMinutesUp(25)).toBe(1) })
  it('zero and nothing stay zero', () => { expect(secondsToMinutesUp(0)).toBe(0); expect(secondsToMinutesUp(null)).toBe(0) })
  it('whole minutes are untouched, a second over rounds up', () => { expect(secondsToMinutesUp(120)).toBe(2); expect(secondsToMinutesUp(121)).toBe(3) })
})
