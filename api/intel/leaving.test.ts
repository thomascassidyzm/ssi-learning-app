import { describe, it, expect } from 'vitest'
import { reasonsFor, rankLeaving, type LeavingRow } from './leaving'

const DAY = 86_400_000
const now = Date.parse('2026-09-10T20:00:00Z')

// Question 2's rule, proven without a database: who is on the list and why,
// and that the list is ranked by recency then regularity — the two things
// that exist — never by a value nobody stores.
describe('who is about to leave', () => {
  it('flags a regular who has stopped, and not one who is still practising', () => {
    expect(reasonsFor({ lastPracticed: now - 9 * DAY, regularDays: 4, paying: false, cancelling: false, endsAt: null }, now))
      .toEqual(['regular-and-stopped'])
    expect(reasonsFor({ lastPracticed: now - 2 * DAY, regularDays: 4, paying: false, cancelling: false, endsAt: null }, now))
      .toEqual([])
  })

  it('flags a paying person who is quiet, including one who never practised', () => {
    expect(reasonsFor({ lastPracticed: null, regularDays: 0, paying: true, cancelling: false, endsAt: null }, now))
      .toEqual(['paying-and-quiet'])
  })

  it('flags an ending gift or a cancelling subscription, and carries every reason that applies', () => {
    expect(reasonsFor({ lastPracticed: now - DAY, regularDays: 0, paying: false, cancelling: false, endsAt: now + 3 * DAY }, now))
      .toEqual(['ending-soon'])
    expect(reasonsFor({ lastPracticed: now - 20 * DAY, regularDays: 5, paying: true, cancelling: true, endsAt: now + 30 * DAY }, now))
      .toEqual(['regular-and-stopped', 'paying-and-quiet', 'ending-soon'])
  })

  it('ranks by recency first, then regularity, never by anything resembling value', () => {
    const row = (name: string, days: number | null, regular: number): LeavingRow =>
      ({ learnerId: name, name, email: null, reasons: ['regular-and-stopped'], daysSincePractice: days, regularDays: regular, course: null, endsAt: null })
    const sorted = [row('c', 30, 9), row('a', 8, 3), row('b', 8, 7), row('d', null, 0)].sort(rankLeaving)
    expect(sorted.map((r) => r.name)).toEqual(['b', 'a', 'c', 'd'])
  })
})
