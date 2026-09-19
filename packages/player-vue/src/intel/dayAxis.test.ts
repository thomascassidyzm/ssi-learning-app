/**
 * The by-day axis labels (Tom's own bug report, 18 Sep 2026: "I can't read
 * the legend on the x axis", iPhone, 402px).
 *
 * Pinned: the axis tick is the day number alone, so seven of them fit on a
 * phone, and the month is said once in the range instead of seven times on
 * the axis.
 */
import { describe, it, expect } from 'vitest'
import { dayTick, dayRange } from './dayAxis'

const week = ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']

describe('dayTick', () => {
  it('is the day number alone — short enough that seven fit at 320px', () => {
    expect(week.map(dayTick)).toEqual(['12', '13', '14', '15', '16', '17', '18'])
    expect(week.map(dayTick).every((t) => t.length <= 2)).toBe(true)
  })
  it('drops the leading zero', () => {
    expect(dayTick('2026-10-01')).toBe('1')
  })
})

describe('dayRange', () => {
  it('says the month once for a window inside one month', () => {
    expect(dayRange(week)).toBe('12–18 Sep')
  })
  it('names both months across a boundary, so 29, 30, 1, 2 is never ambiguous', () => {
    expect(dayRange(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])).toBe('29 Sep – 2 Oct')
  })
  it('one day, and no days', () => {
    expect(dayRange(['2026-09-18'])).toBe('18 Sep')
    expect(dayRange([])).toBe('')
  })
})
