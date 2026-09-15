import { describe, it, expect } from 'vitest'
import { parseYearGroup, yearGroupBreakdown, practisedWithin, type YearGroupClass } from './yearGroup'

describe('parseYearGroup — a leading 6 to 13, never stored', () => {
  it('parses the real St Albans and Chepstow shapes', () => {
    expect(parseYearGroup('7B')).toBe(7)
    expect(parseYearGroup('8H')).toBe(8)
    expect(parseYearGroup('Year 9 French')).toBe(9)
    expect(parseYearGroup('10 Set 1')).toBe(10)
    expect(parseYearGroup('10a1 LJ')).toBe(10)
    expect(parseYearGroup('7C ST')).toBe(7)
    expect(parseYearGroup('9b/KW LJ')).toBe(9)
    expect(parseYearGroup('8CV')).toBe(8)
    expect(parseYearGroup('Y7 Welsh')).toBe(7)
    expect(parseYearGroup('Yr 11')).toBe(11)
    expect(parseYearGroup('13A')).toBe(13)
    expect(parseYearGroup('6S')).toBe(6)
  })

  it('refuses a phantom Year 1, a trailing number, a bare name and years outside 6 to 13', () => {
    expect(parseYearGroup('1 AJ Admin')).toBeNull()
    expect(parseYearGroup('B8')).toBeNull()
    expect(parseYearGroup('Rachel Tiller Cleaves Personal')).toBeNull()
    expect(parseYearGroup('5B')).toBeNull()
    expect(parseYearGroup('14C')).toBeNull()
    expect(parseYearGroup('100')).toBeNull()
    expect(parseYearGroup('')).toBeNull()
  })
})

function cls(id: string, name: string, phrases7d = 0, practising = false, minutes7d = 0): YearGroupClass {
  return { id, name, minutes7d, phrases7d, practising }
}

describe('yearGroupBreakdown — one tile per year group, Other last, or per-class when fewer than half parse', () => {
  it('groups by year, sums phrases, counts practising out of classes, and puts unparsed names in one Other tile', () => {
    const b = yearGroupBreakdown([
      cls('a', '7H', 52, true, 41), cls('b', '7O', 34, true, 23), cls('c', '7T', 0, false),
      cls('d', '8H', 53, true, 30),
      cls('e', 'B8', 0, false), cls('f', 'Rachel Tiller Cleaves Personal', 0, false),
    ])
    expect(b.mode).toBe('year')
    expect(b.tiles.map((t) => [t.key, t.classCount, t.practising, t.phrases7d])).toEqual([
      ['year:7', 3, 2, 86],
      ['year:8', 1, 1, 53],
      ['other', 2, 0, 0],
    ])
  })

  // Job #766 (Tom, 2026-09-15): the tile's number is IN-APP MINUTES this week,
  // summed across the group's classes from the rows' own per-class figure.
  // Seen RED on the pre-change module (no minutes7d on a tile) and GREEN after.
  it('sums each class\'s in-app minutes this week into its year group', () => {
    const b = yearGroupBreakdown([
      cls('a', '7H', 52, true, 41), cls('b', '7O', 34, true, 23), cls('c', '7T', 0, false),
      cls('d', '8H', 53, true, 30),
      cls('e', 'B8', 0, false, 7),
    ])
    expect(b.tiles.map((t) => [t.key, t.minutes7d])).toEqual([['year:7', 64], ['year:8', 30], ['other', 7]])
  })

  it('falls back to per-class tiles, busiest first, when fewer than half the names parse', () => {
    // Busiest = most minutes in the app (job #766); phrases only break a tie.
    const b = yearGroupBreakdown([
      cls('a', 'Beginners', 10, true, 12), cls('b', 'Staff room', 30, true, 25), cls('c', 'Lunch club', 0, false), cls('d', '7B', 5, true, 3),
    ])
    expect(b.mode).toBe('class')
    expect(b.tiles.map((t) => t.name)).toEqual(['Staff room', 'Beginners', '7B', 'Lunch club'])
    expect(b.tiles[0]).toMatchObject({ classCount: 1, practising: 1, minutes7d: 25, phrases7d: 30, year: null })
  })

  it('exactly half parsing still groups by year', () => {
    const b = yearGroupBreakdown([cls('a', '7B'), cls('b', 'Choir')])
    expect(b.mode).toBe('year')
    expect(b.tiles.map((t) => t.key)).toEqual(['year:7', 'other'])
  })

  it('no classes means no tiles', () => {
    expect(yearGroupBreakdown([])).toEqual({ mode: 'year', tiles: [] })
  })
})

describe('practisedWithin — the headline rule for practising this week', () => {
  it('counts a class that last practised inside the window and not one outside it or never', () => {
    const now = Date.parse('2026-09-12T02:00:00Z')
    expect(practisedWithin('2026-09-10T08:00:00Z', 7, now)).toBe(true)
    expect(practisedWithin('2026-09-01T08:00:00Z', 7, now)).toBe(false)
    expect(practisedWithin(null, 7, now)).toBe(false)
    expect(practisedWithin('not a date', 7, now)).toBe(false)
  })
})
