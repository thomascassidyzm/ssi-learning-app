import { describe, it, expect, vi } from 'vitest'
import resolver, { parseLegoOrder, paceTone } from './coverage'

function mockClient(rpcResult: { data: unknown; error: unknown }) {
  return { rpc: vi.fn(async () => rpcResult) } as any
}

describe('coverage resolver (teaching-insights · coverage lane)', () => {
  it('ranks classes fastest-pace-first and grades pace tone relative to the cohort', async () => {
    const client = mockClient({
      data: [
        // a stalled class — barely advances over many weeks → alarm, ranked last
        { class_id: 'C1', class_name: 'Slow Yr7', course_code: 'spa', furthest_lego_id: 'S0008L01', legos_advanced: 1, active_minutes: 40, active_weeks: 6 },
        // a fast class — big advance over a short span → good, ranked first
        { class_id: 'C2', class_name: 'Fast AS', course_code: 'fra', furthest_lego_id: 'S0040L02', legos_advanced: 60, active_minutes: 120, active_weeks: 4 },
      ],
      error: null,
    })
    const out = await resolver(client, { metric: 'coverage', frame: 'group' })
    expect(out.kind).toBe('table')
    expect(out.rows.length).toBe(2)
    // fastest pace first
    expect(out.rows[0].cells.class).toBe('Fast AS')
    expect(out.rows[0].tone).toBe('good')
    // stalled-ish class ranks last; with pace far below the leader it is warn/alarm
    expect(out.rows[1].cells.class).toBe('Slow Yr7')
    expect(['warn', 'alarm']).toContain(out.rows[1].tone)
    // efficiency = legos / minutes (rounded to 2dp)
    expect(out.rows[0].cells.efficiency).toBeCloseTo(0.5, 2)
  })

  it('degrades to a well-formed empty table on RPC error (never throws)', async () => {
    const out = await resolver(mockClient({ data: null, error: { message: 'admin only' } }), { metric: 'coverage' })
    expect(out.kind).toBe('table')
    expect(out.rows).toEqual([])
    expect(out.columns.length).toBeGreaterThan(0)
  })

  it('returns empty when the RPC yields no rows', async () => {
    const out = await resolver(mockClient({ data: [], error: null }), { metric: 'coverage' })
    expect(out.rows).toEqual([])
  })

  it('parseLegoOrder makes S####L## orderable (seed*100 + lego); junk → 0', () => {
    expect(parseLegoOrder('S0014L02')).toBe(1402)
    expect(parseLegoOrder('S40L1')).toBe(4001)
    expect(parseLegoOrder(null)).toBe(0)
    expect(parseLegoOrder('not-a-lego')).toBe(0)
  })

  it('paceTone: stalled → alarm, fastest → good', () => {
    expect(paceTone(0, 10)).toBe('alarm')
    expect(paceTone(10, 10)).toBe('good')
    expect(paceTone(1, 10)).toBe('warn')
  })
})
