import { describe, it, expect } from 'vitest'
import { BOARD_METRICS, getBoardMetric, resolveBoardMetric, resolveAllBoardMetrics } from './boardMetrics'

// Minimal chainable Supabase mock — enough surface for each resolver's
// query shape (select/eq/gte/range, plus the head-count form and .rpc()).
function makeSvc(tables: Record<string, any>, rpc: Record<string, any> = {}) {
  return {
    rpc(fn: string) {
      return Promise.resolve({ data: rpc[fn] ?? [], error: null })
    },
    from(table: string) {
      const rows = tables[table] ?? []
      const builder: any = {
        _rows: rows,
        _eqFilters: [] as Array<[string, unknown]>,
        _gteFilters: [] as Array<[string, unknown]>,
        _countOnly: false,
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          if (opts?.head) builder._countOnly = true
          return builder
        },
        eq(col: string, val: unknown) {
          builder._eqFilters.push([col, val])
          return builder
        },
        gte(col: string, val: unknown) {
          builder._gteFilters.push([col, val])
          return builder
        },
        range(from: number, to: number) {
          const filtered = builder._applyFilters()
          const page = filtered.slice(from, to + 1)
          return Promise.resolve({ data: page, error: null })
        },
        _applyFilters() {
          return rows.filter((r: any) =>
            builder._eqFilters.every(([c, v]: [string, unknown]) => r[c] === v) &&
            builder._gteFilters.every(([c, v]: [string, unknown]) => r[c] >= v),
          )
        },
        then(resolve: any) {
          const filtered = builder._applyFilters()
          if (builder._countOnly) {
            return Promise.resolve({ data: null, error: null, count: filtered.length }).then(resolve)
          }
          return Promise.resolve({ data: filtered, error: null }).then(resolve)
        },
      }
      return builder
    },
  } as any
}

describe('boardMetrics registry', () => {
  it('exposes exactly the three WP-1 metrics', () => {
    const slugs = BOARD_METRICS.map(m => m.slug).sort()
    expect(slugs).toEqual(['learners.active_30d', 'minutes.total_30d', 'schools.total'])
  })

  it('every metric carries a label and method', () => {
    for (const m of BOARD_METRICS) {
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.method.length).toBeGreaterThan(0)
    }
  })
})

describe('learners.active_30d', () => {
  it('counts distinct non-test learners with a session in the window', async () => {
    const now = Date.now()
    const recent = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
    const stale = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString()
    const svc = makeSvc(
      {
        sessions: [
          { learner_id: 'l1', started_at: recent },
          { learner_id: 'l1', started_at: recent }, // same learner twice — deduped
          { learner_id: 'l2', started_at: recent },
          { learner_id: 'demo-1', started_at: recent }, // test learner — excluded
          { learner_id: 'l3', started_at: stale }, // outside window — excluded
        ],
      },
      { test_learner_ids: [{ learner_id: 'demo-1' }] },
    )
    const result = await resolveBoardMetric(svc, 'learners.active_30d')
    expect(result?.value).toBe(2)
    expect(result?.asOf).toBeTruthy()
  })

  it('returns zero with no sessions', async () => {
    const svc = makeSvc({ sessions: [] })
    const result = await resolveBoardMetric(svc, 'learners.active_30d')
    expect(result?.value).toBe(0)
  })
})

describe('minutes.total_30d', () => {
  it('sums minutes_practiced within the window', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const svc = makeSvc({
      daily_contributions: [
        { contribution_date: today, minutes_practiced: 100 },
        { contribution_date: today, minutes_practiced: 50 },
      ],
    })
    const result = await resolveBoardMetric(svc, 'minutes.total_30d')
    expect(result?.value).toBe(150)
  })

  it('returns zero with no rows', async () => {
    const svc = makeSvc({ daily_contributions: [] })
    const result = await resolveBoardMetric(svc, 'minutes.total_30d')
    expect(result?.value).toBe(0)
  })
})

describe('schools.total', () => {
  it('counts only non-test schools', async () => {
    const svc = makeSvc({
      schools: [
        { id: 's1', is_test: false },
        { id: 's2', is_test: false },
        { id: 's3', is_test: true },
      ],
    })
    const result = await resolveBoardMetric(svc, 'schools.total')
    expect(result?.value).toBe(2)
  })
})

describe('resolveBoardMetric', () => {
  it('returns null for an unknown slug', async () => {
    const svc = makeSvc({})
    const result = await resolveBoardMetric(svc, 'not.a.real.metric')
    expect(result).toBeNull()
  })
})

describe('resolveAllBoardMetrics', () => {
  it('resolves all three metrics with slug/label/method/value/asOf', async () => {
    const svc = makeSvc({
      sessions: [],
      daily_contributions: [],
      schools: [{ id: 's1', is_test: false }],
    })
    const results = await resolveAllBoardMetrics(svc)
    expect(results).toHaveLength(3)
    for (const r of results) {
      expect(r.slug).toBeTruthy()
      expect(r.label).toBeTruthy()
      expect(r.method).toBeTruthy()
      expect(typeof r.value).toBe('number')
      expect(r.asOf).toBeTruthy()
    }
    const schoolsMetric = results.find(r => r.slug === 'schools.total')
    expect(schoolsMetric?.value).toBe(1)
  })
})

describe('getBoardMetric', () => {
  it('finds a metric by slug', () => {
    expect(getBoardMetric('schools.total')?.slug).toBe('schools.total')
  })
  it('returns undefined for an unknown slug', () => {
    expect(getBoardMetric('nope')).toBeUndefined()
  })
})
