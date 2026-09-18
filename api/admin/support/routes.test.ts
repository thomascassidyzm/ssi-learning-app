/**
 * The platform support inbox's two routes (job #220): ssi_admin only, one list
 * of every school's and org's thread, and a reply that is authored as the
 * admin who typed it — never as the school admin, and never at all while
 * touring under View As.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, VIEW_AS_HEADERS, type DB } from '../../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let adminAnswer: any = { userId: 'admin-uid' }
vi.mock('../../_utils/auth', () => ({ verifyAdmin: vi.fn(async () => adminAnswer) }))
let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let list: typeof import('./index').default
let reply: typeof import('./reply').default

const T = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString()

beforeEach(async () => {
  vi.resetModules()
  list = (await import('./index')).default
  reply = (await import('./reply')).default
  adminAnswer = { userId: 'admin-uid' }
  DB = {
    support_threads: [
      { id: 'th-1', school_id: 'sch-1', group_id: null, created_at: T(1), last_message_at: T(4), last_read_at: T(2), language: 'eng', standing_notes: {} },
    ],
    support_messages: [
      { id: 'm-1', thread_id: 'th-1', body: 'Our hours look wrong', direction: 'in', author_source: 'human', author_name: 'Bethan', author_user_id: 'school-admin-uid', answered_at: null, created_at: T(4), envelope: null, signal_key: null },
    ],
    schools: [{ id: 'sch-1', school_name: 'Ysgol Bryn' }],
    groups: [],
    learners: [{ user_id: 'admin-uid', display_name: 'Kai' }],
  }
})

describe('GET /api/admin/support', () => {
  it('refuses a caller who is not an ssi_admin', async () => {
    adminAnswer = { error: 'Requires SSi admin access', status: 403, userId: 'u1' }
    const res = makeRes()
    await list(makeReq(), res)
    expect(res.statusCode).toBe(403)
  })

  it('lists every school thread with its school, its person and whether it is waiting', async () => {
    const res = makeRes()
    await list(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.unanswered).toBe(1)
    expect(res.body.threads[0]).toMatchObject({ id: 'th-1', who: 'Ysgol Bryn', person: 'Bethan', unanswered: 1, kind: 'school' })
  })

  it('opens one thread with every turn, and never marks it read', async () => {
    const res = makeRes()
    await list(makeReq({ query: { id: 'th-1' } }), res)
    expect(res.body.thread.messages.map((m: any) => m.id)).toEqual(['m-1'])
    expect(DB.support_threads[0].last_read_at).toBe(T(2))
  })

  it('404s on a thread that is not a school or org thread', async () => {
    const res = makeRes()
    await list(makeReq({ query: { id: 'nope' } }), res)
    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/admin/support/reply', () => {
  it('writes the reply as the admin, answers the open question, and leaves the school read state alone', async () => {
    const res = makeRes()
    await reply(makeReq({ method: 'POST', body: { threadId: 'th-1', text: 'Here is what happened.' } }), res)
    expect(res.statusCode).toBe(200)
    const out = DB.support_messages.filter((m) => m.direction === 'out')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ author_user_id: 'admin-uid', author_source: 'human', author_via: 'jwt', in_reply_to: 'm-1' })
    // THE ONE GUARD: never in the school admin's name.
    expect(out[0].author_user_id).not.toBe('school-admin-uid')
    expect(DB.support_messages[0].answered_at).toBeTruthy()
    expect(DB.support_threads[0].last_read_at).toBe(T(2))
  })

  it('refuses the write outright while the admin is touring under View As', async () => {
    const res = makeRes()
    await reply(makeReq({ method: 'POST', headers: VIEW_AS_HEADERS, body: { threadId: 'th-1', text: 'hello' } }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.support_messages.filter((m) => m.direction === 'out')).toHaveLength(0)
  })

  it('refuses a non-admin, an empty body and an unknown thread', async () => {
    adminAnswer = { error: 'Requires SSi admin access', status: 403, userId: 'u1' }
    let res = makeRes()
    await reply(makeReq({ method: 'POST', body: { threadId: 'th-1', text: 'hello' } }), res)
    expect(res.statusCode).toBe(403)

    adminAnswer = { userId: 'admin-uid' }
    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { threadId: 'th-1', text: '   ' } }), res)
    expect(res.statusCode).toBe(400)

    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { threadId: 'missing', text: 'hello' } }), res)
    expect(res.statusCode).toBe(404)
    expect(DB.support_messages.filter((m) => m.direction === 'out')).toHaveLength(0)
  })
})
