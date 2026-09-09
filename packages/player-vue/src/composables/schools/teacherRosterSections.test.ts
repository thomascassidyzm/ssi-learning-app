/**
 * The Teachers page's two sections — the visible half of the school-belonging
 * mechanism. Belonging is the admin's act, so an arrival nobody has given a
 * class to sits apart, visible and removable, rather than passing for staff.
 */
import { describe, it, expect } from 'vitest'
import { isPending, orderPending, settledStaff } from './teacherRosterSections'

const row = (name: string, classes: number, extra: Record<string, unknown> = {}) =>
  ({ name, classes, joined_at: '2026-01-01', ...extra }) as any

describe('teacherRosterSections', () => {
  it('an arrival with no classes is pending; anyone teaching a class is not', () => {
    expect(isPending(row('New', 0))).toBe(true)
    expect(isPending(row('Sian', 2))).toBe(false)
  })

  it('a teacher who made their own class is NOT pending — the ordinary case, never flagged', () => {
    expect(isPending(row('Owain', 1, { self_assigned: true, vouched_by: null }))).toBe(false)
    expect(settledStaff([row('Owain', 1, { self_assigned: true })]).map((r: any) => r.name)).toEqual(['Owain'])
  })

  it('orders pending arrivals off-domain first, then unknown, then on-domain — the sort hint, and nothing else', () => {
    const rows = [
      row('OnDomain', 0, { onDomain: true }),
      row('Unknown', 0, { onDomain: null }),
      row('OffDomain', 0, { onDomain: false }),
    ]
    expect(orderPending(rows).map((r: any) => r.name)).toEqual(['OffDomain', 'Unknown', 'OnDomain'])
  })

  it('within a rank, longest-waiting first — the arrival nobody has claimed in a fortnight comes top', () => {
    const rows = [
      row('Recent', 0, { onDomain: false, joined_at: '2026-09-08' }),
      row('Stale', 0, { onDomain: false, joined_at: '2026-07-17' }),
    ]
    expect(orderPending(rows).map((r: any) => r.name)).toEqual(['Stale', 'Recent'])
  })

  it('the hint NEVER moves anyone between sections — an on-domain arrival with no class is still pending', () => {
    const rows = [row('LooksLikeStaff', 0, { onDomain: true }), row('Teaching', 3, { onDomain: false })]
    expect(orderPending(rows).map((r: any) => r.name)).toEqual(['LooksLikeStaff'])
    expect(settledStaff(rows).map((r: any) => r.name)).toEqual(['Teaching'])
  })

  it('every row lands in exactly one section', () => {
    const rows = [row('A', 0), row('B', 1), row('C', 0), row('D', 5)]
    expect(orderPending(rows).length + settledStaff(rows).length).toBe(rows.length)
  })
})
