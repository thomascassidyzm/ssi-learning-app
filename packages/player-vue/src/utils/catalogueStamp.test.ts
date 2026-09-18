/**
 * Job #119 — the catalogue is served from the local mirror and revalidated by
 * stamp, so a repeat boot spends ~200 bytes on the question rather than 17.8 KB
 * on the answer it already has.
 *
 * The third case is the one that has to be proved rather than believed: a
 * repeat visit AFTER the course content moved must refetch.
 */
import { describe, it, expect } from 'vitest'
import { catalogueStampOf, decideCatalogueRead } from './catalogueStamp'

describe('catalogueStampOf', () => {
  it('reads count and newest updated_at', () => {
    expect(catalogueStampOf({ count: 83, data: [{ updated_at: '2026-09-17T10:00:00Z' }] }))
      .toBe('83:2026-09-17T10:00:00Z')
  })

  it('is null when the query did not land, so the caller falls back to the mirror', () => {
    expect(catalogueStampOf(null)).toBeNull()
    expect(catalogueStampOf({ error: new Error('offline') })).toBeNull()
    expect(catalogueStampOf({ data: null, count: 3 })).toBeNull()
    // no exact count header (PostgREST asked without count) — not a stamp
    expect(catalogueStampOf({ data: [{ updated_at: 'x' }] })).toBeNull()
  })

  it('survives an empty catalogue without pretending it is the same as an error', () => {
    expect(catalogueStampOf({ count: 0, data: [] })).toBe('0:')
  })
})

describe('decideCatalogueRead', () => {
  const stamp = '83:2026-09-17T10:00:00Z'

  it('fetches when there is no mirror', () => {
    expect(decideCatalogueRead({ hasMirror: false, mirroredStamp: null, liveStamp: stamp }))
      .toBe('fetch')
  })

  it('fetches once when the mirror predates stamping', () => {
    expect(decideCatalogueRead({ hasMirror: true, mirroredStamp: null, liveStamp: stamp }))
      .toBe('fetch')
  })

  it('serves the mirror when the stamp has not moved', () => {
    expect(decideCatalogueRead({ hasMirror: true, mirroredStamp: stamp, liveStamp: stamp }))
      .toBe('mirror')
  })

  it('REFETCHES when the course content changed under it', () => {
    expect(decideCatalogueRead({
      hasMirror: true,
      mirroredStamp: stamp,
      liveStamp: '83:2026-09-17T11:30:00Z',
    })).toBe('fetch')
  })

  it('refetches when a course was withdrawn, even though the newest row went BACKWARDS', () => {
    expect(decideCatalogueRead({
      hasMirror: true,
      mirroredStamp: stamp,
      liveStamp: '82:2026-09-16T09:00:00Z',
    })).toBe('fetch')
  })

  it('serves the mirror when the stamp cannot be reached at all (offline)', () => {
    expect(decideCatalogueRead({ hasMirror: true, mirroredStamp: stamp, liveStamp: null }))
      .toBe('mirror')
  })
})
