/**
 * The two doors, tested as endpoints.
 *
 * Tom's ruling of 2026-09-10 is not only about a default — it is about the
 * SHAPE of the choice. Minting a real person and minting a fixture are two
 * actions, so that "is this a real person?" is answered by picking one, never
 * by whatever a checkbox was last left at.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'admin-1' })),
  verifyAdmin: vi.fn(async () => ({ userId: 'admin-1' })),
}))
vi.mock('../_utils/cors', () => ({ applyCors: () => false }))

let writes: Record<string, any[]> = {}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      const builder: any = {
        _result: { data: null, error: null },
        select: () => builder,
        eq: () => Promise.resolve({ error: null }),
        delete: () => builder,
        insert: (payload: any) => {
          writes[table] = writes[table] || []
          writes[table].push(payload)
          builder._result = { data: { id: `${table}-1`, user_id: payload.user_id ?? null }, error: null }
          return builder
        },
        single: () => Promise.resolve(builder._result),
        then: (onF: any, onR: any) => Promise.resolve(builder._result).then(onF, onR),
      }
      return builder
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}
const makeReq = (body: unknown): VercelRequest => ({ method: 'POST', body, headers: {}, query: {} } as any)

beforeEach(() => { writes = {} })

describe('POST /api/admin/mint-learner', () => {
  it('mints a real, included learner and says so in the answer', async () => {
    const handler = (await import('./mint-learner')).default
    const res = makeRes()
    await handler(makeReq({ display_name: 'Pilot teacher' }), res)
    expect(res._status).toBe(200)
    expect(res._json.counts_in_analytics).toBe(true)
    expect(res._json.gifted).toBe(false)
    expect(writes.learners[0].is_internal).toBe(false)
    expect(writes.learners[0].is_demo).toBe(false)
  })

  it('mints them GIFTED when asked, and they are still included', async () => {
    const handler = (await import('./mint-learner')).default
    const res = makeRes()
    await handler(makeReq({ display_name: 'Comped friend', gift: { access_type: 'full', duration_type: 'lifetime' } }), res)
    expect(res._json.gifted).toBe(true)
    expect(res._json.counts_in_analytics).toBe(true)
    expect(writes.user_entitlements[0].access_type).toBe('full')
    expect(writes.learners[0].is_internal).toBe(false)
  })

  it('refuses to be asked for an exclusion flag, and names the other door', async () => {
    const handler = (await import('./mint-learner')).default
    const res = makeRes()
    await handler(makeReq({ display_name: 'Fixture', is_demo: true }), res)
    expect(res._status).toBe(400)
    expect(res._json.error).toMatch(/mint-demo-learner/)
    expect(writes.learners).toBeUndefined()
  })

  it('refuses a malformed gift before writing anything', async () => {
    const handler = (await import('./mint-learner')).default
    const res = makeRes()
    await handler(makeReq({ display_name: 'Comped friend', gift: { access_type: 'courses' } }), res)
    expect(res._status).toBe(400)
    expect(writes.learners).toBeUndefined()
  })
})

describe('POST /api/admin/mint-demo-learner', () => {
  it('is the door that excludes, and the kind must be chosen out loud', async () => {
    const handler = (await import('./mint-demo-learner')).default

    const noKind = makeRes()
    await handler(makeReq({ display_name: 'Demo pupil' }), noKind)
    expect(noKind._status).toBe(400)
    expect(writes.learners).toBeUndefined()

    const res = makeRes()
    await handler(makeReq({ kind: 'demo', display_name: 'Demo pupil' }), res)
    expect(res._status).toBe(200)
    expect(res._json.counts_in_analytics).toBe(false)
    expect(writes.learners[0].is_demo).toBe(true)
  })

  it('mints a test account excluded by is_internal, which is the flag the canonical function reads', async () => {
    const handler = (await import('./mint-demo-learner')).default
    const res = makeRes()
    await handler(makeReq({ kind: 'test', display_name: 'QA rig' }), res)
    expect(writes.learners[0].is_internal).toBe(true)
    expect(res._json.counts_in_analytics).toBe(false)
  })
})
