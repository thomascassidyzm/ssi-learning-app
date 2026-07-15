import { describe, it, expect } from 'vitest'
import { parseBoardTokens, findUnknownBoardTokens, formatMetricValue, metricsBySlug, type ResolvedMetric } from './boardTokens'

function metric(overrides: Partial<ResolvedMetric> = {}): ResolvedMetric {
  return {
    slug: 'schools.total',
    label: 'Schools on platform',
    method: 'Count of schools rows, excluding demo schools.',
    value: 11,
    asOf: '2026-07-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('parseBoardTokens', () => {
  it('returns a single text segment for plain prose', () => {
    const segments = parseBoardTokens('No tokens here.', {})
    expect(segments).toEqual([{ type: 'text', text: 'No tokens here.' }])
  })

  it('resolves a known metric token inline', () => {
    const m = metric()
    const segments = parseBoardTokens('We have {{metric:schools.total}} schools.', { [m.slug]: m })
    expect(segments).toEqual([
      { type: 'text', text: 'We have ' },
      { type: 'metric', metric: m },
      { type: 'text', text: ' schools.' },
    ])
  })

  it('marks an unresolved slug as unknown', () => {
    const segments = parseBoardTokens('{{metric:ghost.metric}} is missing.', {})
    expect(segments[0]).toEqual({ type: 'unknown', slug: 'ghost.metric' })
  })

  it('handles multiple tokens back to back', () => {
    const a = metric({ slug: 'a.one', value: 1 })
    const b = metric({ slug: 'b.two', value: 2 })
    const segments = parseBoardTokens('{{metric:a.one}}{{metric:b.two}}', metricsBySlug([a, b]))
    expect(segments).toEqual([
      { type: 'metric', metric: a },
      { type: 'metric', metric: b },
    ])
  })

  it('handles a token at the very start and end with no surrounding text', () => {
    const m = metric()
    const segments = parseBoardTokens('{{metric:schools.total}}', { [m.slug]: m })
    expect(segments).toEqual([{ type: 'metric', metric: m }])
  })

  it('returns empty array for empty markdown', () => {
    expect(parseBoardTokens('', {})).toEqual([])
  })
})

describe('findUnknownBoardTokens', () => {
  it('returns no unknowns when every token resolves', () => {
    const m = metric()
    const unknown = findUnknownBoardTokens('{{metric:schools.total}} schools', { [m.slug]: m })
    expect(unknown).toEqual([])
  })

  it('collects every unresolved slug in order, including duplicates', () => {
    const unknown = findUnknownBoardTokens(
      '{{metric:ghost.one}} and {{metric:ghost.two}} and {{metric:ghost.one}} again',
      {},
    )
    expect(unknown).toEqual(['ghost.one', 'ghost.two', 'ghost.one'])
  })
})

describe('formatMetricValue', () => {
  it('formats with thousands separators (en-GB)', () => {
    expect(formatMetricValue(metric({ value: 26751 }))).toBe('26,751')
  })

  it('formats small numbers unchanged', () => {
    expect(formatMetricValue(metric({ value: 11 }))).toBe('11')
  })
})

describe('metricsBySlug', () => {
  it('indexes a metric list by slug', () => {
    const a = metric({ slug: 'a.one' })
    const b = metric({ slug: 'b.two' })
    expect(metricsBySlug([a, b])).toEqual({ 'a.one': a, 'b.two': b })
  })
})
