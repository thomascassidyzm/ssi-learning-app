/**
 * practiceMinutes — Tom, 2026-09-14 16:17Z (job #683): "round up to the
 * nearest minute, not down ... learners who start playing and do 20-30s are
 * showing as 0 mins" and "0 hours? ... it should just give the mins. 0 h 14
 * mins. or something like that when it's hours played".
 *
 * Red on the Math.round formatter of job #265 (25 s → "0 min"; 74 min →
 * "74 min" with no hour form); green after.
 */
import { describe, it, expect } from 'vitest'
import { secondsToMinutes, hoursToMinutes, formatPracticeMinutes } from './practiceMinutes'

describe('practiceMinutes — minutes round UP, hours only from an hour', () => {
  it('25 seconds of play reads 1 min, never 0', () => {
    expect(secondsToMinutes(25)).toBe(1)
    expect(formatPracticeMinutes(secondsToMinutes(25))).toBe('1 min')
  })
  it('zero stays zero', () => {
    expect(secondsToMinutes(0)).toBe(0)
    expect(secondsToMinutes(null)).toBe(0)
    expect(formatPracticeMinutes(0)).toBe('0 min')
  })
  it('a fraction of an hour from the DB views rounds up too', () => {
    expect(hoursToMinutes(0.01)).toBe(1)
    expect(hoursToMinutes(0.5)).toBe(30)
  })
  it('under an hour is minutes only', () => {
    expect(formatPracticeMinutes(59)).toBe('59 min')
    expect(formatPracticeMinutes(14)).toBe('14 min')
  })
  it('from an hour up it is hours and minutes, and "0 h" never appears', () => {
    expect(formatPracticeMinutes(74)).toBe('1 h 14 min')
    expect(formatPracticeMinutes(60)).toBe('1 h')
    expect(formatPracticeMinutes(272)).toBe('4 h 32 min')
    expect(formatPracticeMinutes(14)).not.toMatch(/0 h/)
  })
})
