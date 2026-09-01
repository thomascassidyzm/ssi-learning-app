/**
 * Pins the fix for the four-identical-requests storm measured on staging
 * 2026-09-01: `/schools/students` fired GET /api/school/roster four times
 * within 3ms. If this test goes green after someone removes the coalescing,
 * the storm is back, so it asserts the request COUNT, not just the payload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchSchoolRoster, __resetSchoolRoster } from './schoolRoster'

describe('fetchSchoolRoster', () => {
  beforeEach(() => { __resetSchoolRoster(); vi.restoreAllMocks() })

  it('makes ONE request when several composables ask at the same moment', async () => {
    let release: (v: any) => void = () => {}
    const fetchMock = vi.fn(() => new Promise((r) => { release = r }))
    vi.stubGlobal('fetch', fetchMock)

    const all = Promise.all([
      fetchSchoolRoster('tok'), fetchSchoolRoster('tok'),
      fetchSchoolRoster('tok'), fetchSchoolRoster('tok'),
    ])
    release({ ok: true, json: async () => ({ school: { id: 's1' }, teachers: [1], students: [2, 3] }) })
    const results = await all

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/school/roster', {
      headers: { Authorization: 'Bearer tok' },
    })
    // Every caller gets the whole payload and takes its own slice.
    for (const r of results) expect(r).toEqual({ school: { id: 's1' }, teachers: [1], students: [2, 3] })
  })

  it('fetches again for a caller arriving after the first settled — no stale cache', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ students: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchSchoolRoster('tok')
    await fetchSchoolRoster('tok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not share a response between two different tokens', async () => {
    const fetchMock = vi.fn(() => new Promise((r) => setTimeout(() => r({ ok: true, json: async () => ({}) }), 0)))
    vi.stubGlobal('fetch', fetchMock)
    await Promise.all([fetchSchoolRoster('a'), fetchSchoolRoster('b')])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('clears the in-flight entry on failure so the next caller can retry', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchSchoolRoster('tok')).rejects.toThrow('roster 500')
    await expect(fetchSchoolRoster('tok')).rejects.toThrow('roster 500')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
