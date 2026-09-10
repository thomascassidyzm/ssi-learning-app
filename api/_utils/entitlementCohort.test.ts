/**
 * The money side, tested apart from the counting side — which is the whole
 * point of Tom's ruling of 2026-09-10: gifted tells billing not to expect
 * payment and tells analytics nothing at all.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyStanding,
  countStandings,
  isPayingStatus,
  resolveMoneyStandings,
} from './entitlementCohort'

function fakeClient(
  subs: { learner_id: string; status: string | null }[],
  ents: { learner_id: string; expires_at: string | null }[],
) {
  return {
    from(table: string) {
      const rows = table === 'subscriptions' ? subs : ents
      return {
        select: () => ({ in: async () => ({ data: rows, error: null }) }),
      }
    },
  } as any
}

describe('classifyStanding', () => {
  it('calls a comped learner gifted, never excluded and never invisible', () => {
    expect(classifyStanding(false, true)).toBe('gifted')
  })

  it('lets payment win when somebody both pays and holds an old comp', () => {
    expect(classifyStanding(true, true)).toBe('paying')
  })

  it('calls somebody with neither free', () => {
    expect(classifyStanding(false, false)).toBe('free')
  })
})

describe('isPayingStatus', () => {
  it('counts active and past_due as money expected, cancelled and none as not', () => {
    expect(isPayingStatus('active')).toBe(true)
    expect(isPayingStatus('past_due')).toBe(true)
    expect(isPayingStatus('cancelled')).toBe(false)
    expect(isPayingStatus('none')).toBe(false)
    expect(isPayingStatus(null)).toBe(false)
  })
})

describe('resolveMoneyStandings', () => {
  const now = new Date('2026-09-10T00:00:00Z')

  it('separates the three kinds across a real population', async () => {
    const svc = fakeClient(
      [
        { learner_id: 'pays', status: 'active' },
        { learner_id: 'lapsed', status: 'cancelled' },
      ],
      [
        { learner_id: 'comped', expires_at: null },
        { learner_id: 'pilot', expires_at: '2027-01-01T00:00:00Z' },
        { learner_id: 'expired', expires_at: '2026-01-01T00:00:00Z' },
      ],
    )
    const standings = await resolveMoneyStandings(
      svc,
      ['pays', 'lapsed', 'comped', 'pilot', 'expired'],
      now,
    )
    expect(standings.get('pays')).toBe('paying')
    expect(standings.get('comped')).toBe('gifted')
    expect(standings.get('pilot')).toBe('gifted')
    expect(standings.get('lapsed')).toBe('free')
    expect(standings.get('expired')).toBe('free')
  })

  it('counts the gifted cohort so it can be looked at', async () => {
    const svc = fakeClient(
      [{ learner_id: 'a', status: 'active' }],
      [{ learner_id: 'b', expires_at: null }, { learner_id: 'c', expires_at: null }],
    )
    const standings = await resolveMoneyStandings(svc, ['a', 'b', 'c', 'd'], now)
    expect(countStandings(standings.values())).toEqual({ paying: 1, gifted: 2, free: 1 })
  })

  it('asks nothing when there is nobody to ask about', async () => {
    const standings = await resolveMoneyStandings(fakeClient([], []), [], now)
    expect(standings.size).toBe(0)
  })
})
