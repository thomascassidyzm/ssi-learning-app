/**
 * GET /api/support/population — the shape test the spec names as a
 * requirement (§14 item 8): the response cannot carry a school id, a name or
 * a region. "Nine other schools" is reachable; "yes, Ysgol X" is not
 * expressible.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, TEACHER_SCOPE, ADMIN_SCOPE, type DB } from './_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })) }))
let scope: any
vi.mock('../_utils/schoolScope', () => ({ resolveVisibleScope: vi.fn(async () => scope) }))
vi.mock('../_utils/classPractice', () => ({ CLASS_PRACTICE_WINDOW_DAYS: 7, practisedSince: () => false, loadClassPractice: vi.fn(async () => new Map()) }))

let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let handler: typeof import('./population').default
let populationShape: typeof import('./population').populationShape

const recent = new Date().toISOString()
beforeEach(async () => {
  vi.resetModules()
  const mod = await import('./population')
  handler = mod.default
  populationShape = mod.populationShape
  DB = {
    support_signals: [
      { signal_key: 'tile-contradiction:node-stats', school_id: 's1', last_seen_at: recent },
      { signal_key: 'tile-contradiction:node-stats', school_id: 'school-uuid-0002', last_seen_at: recent },
      { signal_key: 'tile-contradiction:node-stats', school_id: 'school-uuid-0003', last_seen_at: recent },
      { signal_key: 'tile-contradiction:node-stats', school_id: 'school-uuid-0004', last_seen_at: '2026-01-01T00:00:00.000Z' },
      { signal_key: 'audio-failure:ipad;1234', school_id: 'school-uuid-0005', last_seen_at: recent },
    ],
    // Names and regions exist in the DB. The test is that none of it can reach the response.
    schools: [
      { id: 'school-uuid-0002', school_name: 'Ysgol Glan Hafren', region_code: 'WAL' },
      { id: 'school-uuid-0003', school_name: 'Ysgol Bro Dinefwr', region_code: 'WAL' },
    ],
  }
  scope = ADMIN_SCOPE
})

describe('GET /api/support/population', () => {
  it('refuses a plain class teacher with 403', async () => {
    scope = TEACHER_SCOPE
    const res = makeRes()
    await handler(makeReq({ query: { signal: 'tile-contradiction:node-stats' } }), res)
    expect(res.statusCode).toBe(403)
  })

  it('answers with integers only: { schools, since } and nothing else', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { signal: 'tile-contradiction:node-stats' } }), res)
    expect(res.statusCode).toBe(200)
    expect(Object.keys(res.body).sort()).toEqual(['schools', 'since'])
    expect(typeof res.body.schools).toBe('number')
    expect(Number.isInteger(res.body.schools)).toBe(true)
    expect(typeof res.body.since).toBe('string')
    expect(Number.isNaN(Date.parse(res.body.since))).toBe(false)
  })

  it('counts OTHER schools within the window — own school and stale rows excluded', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { signal: 'tile-contradiction:node-stats' } }), res)
    expect(res.body.schools).toBe(2)
  })

  it('cannot carry a school id, a name or a region', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { signal: 'tile-contradiction:node-stats' } }), res)
    const wire = JSON.stringify(res.body)
    for (const leak of ['school-uuid', 's1', 'Ysgol', 'Glan Hafren', 'Bro Dinefwr', 'WAL', 'school_id', 'school_name', 'region']) {
      expect(wire, `response must not contain "${leak}"`).not.toContain(leak)
    }
  })

  it('the shape function itself discards identities — the only builder the route has', () => {
    const out = populationShape(['a', 'b', 'b', 'own', ''], 'own', new Date('2026-09-04T00:00:00Z'))
    expect(out).toEqual({ schools: 2, since: '2026-09-04T00:00:00.000Z' })
    expect(Object.keys(out)).toEqual(['schools', 'since'])
  })

  it('rejects a malformed signal key', async () => {
    const res = makeRes()
    await handler(makeReq({ query: { signal: "'; drop table --" } }), res)
    expect(res.statusCode).toBe(400)
  })
})
