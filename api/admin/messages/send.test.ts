/** The composer routes are ssi_admin only (job #821): a learner token is 403 before anything is read. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, type DB } from '../../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let adminAnswer: any = { userId: 'admin-uid' }
vi.mock('../../_utils/auth', () => ({ verifyAdmin: vi.fn(async () => adminAnswer) }))
let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let send: typeof import('./send').default
let audience: typeof import('./audience').default

beforeEach(async () => {
  vi.resetModules()
  send = (await import('./send')).default
  audience = (await import('./audience')).default
  adminAnswer = { userId: 'admin-uid' }
  DB = {
    learners: [{ id: 'l1', user_id: 'u1', display_name: 'Ana', is_demo: false, is_internal: false, is_class_entity: false }],
    course_enrollments: [],
    admin_messages: [],
    user_messages: [],
  }
})

describe('admin messaging routes', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  it('a non-admin is refused before anything is read', async () => {
    adminAnswer = { error: 'Requires SSi admin access', status: 403, userId: 'u1' }
    const res = makeRes()
    await send(makeReq({ method: 'POST', body: { id, kind: 'all', title: 't', body: 'b' } }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_messages).toHaveLength(0)
  })
  it('a retry with different words under the same id is 409 and writes nothing', async () => {
    let res = makeRes()
    await send(makeReq({ method: 'POST', body: { id, kind: 'all', title: 't', body: 'b' } }), res)
    expect(res.statusCode).toBe(200)
    res = makeRes()
    await send(makeReq({ method: 'POST', body: { id, kind: 'all', title: 'changed', body: 'b' } }), res)
    expect(res.statusCode).toBe(409)
    expect(DB.user_messages).toHaveLength(1)
    expect(DB.user_messages[0].title).toBe('t')
  })
  it('previews the count without writing, then sends, then a retry sends nothing', async () => {
    let res = makeRes()
    await audience(makeReq({ query: { kind: 'all' } }), res)
    expect(res.body).toEqual({ kind: 'all', count: 1, sample: ['Ana'] })
    expect(DB.user_messages).toHaveLength(0)
    res = makeRes()
    await send(makeReq({ method: 'POST', body: { id, kind: 'all', title: 'Pod 1', body: 'Listen.' } }), res)
    expect(res.body).toEqual({ id, audience: 1, sent: 1 })
    res = makeRes()
    await send(makeReq({ method: 'POST', body: { id, kind: 'all', title: 'Pod 1', body: 'Listen.' } }), res)
    expect(res.body).toEqual({ id, audience: 1, sent: 0 })
    expect(DB.user_messages).toHaveLength(1)
    expect(DB.admin_messages[0].sender_user_id).toBe('admin-uid')
  })
})
