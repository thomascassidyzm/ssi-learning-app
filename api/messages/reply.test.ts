/**
 * A learner's reply to an admin message becomes a support thread (job #821).
 *
 * Pinned: the reply opens ONE learner-owned thread per learner-message pair,
 * writes an 'in' support_messages turn carrying the origin, a second reply
 * reuses the thread, a reply to a non-admin message or a foreign message is
 * refused, View As is refused, and GET thread lists the turns and marks the
 * thread read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, VIEW_AS_HEADERS, type DB } from '../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'learner-uid' })) }))
let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let reply: typeof import('./reply').default
let thread: typeof import('./thread').default

beforeEach(async () => {
  vi.resetModules()
  reply = (await import('./reply')).default
  thread = (await import('./thread')).default
  DB = {
    learners: [{ id: 'l1', user_id: 'learner-uid', display_name: 'Ana' }],
    user_messages: [
      { id: 'am1', recipient_user_id: 'learner-uid', source: 'admin_message', title: 'Pod 1 is live', body: 'Have a listen.', action: null, action_taken_at: null, read_at: null, dismissed_at: null, created_at: '2026-09-15T10:00:00.000Z', dedupe_key: 'admin_message:b1:learner-uid' },
      { id: 'cp1', recipient_user_id: 'learner-uid', source: 'class_play_copied', title: 'copy', body: '…', action: null, action_taken_at: null, read_at: null, dismissed_at: null, created_at: '2026-09-14T10:00:00.000Z', dedupe_key: null },
      { id: 'am-other', recipient_user_id: 'someone-else', source: 'admin_message', title: 'x', body: 'y', action: null, action_taken_at: null, read_at: null, dismissed_at: null, created_at: '2026-09-15T10:00:00.000Z', dedupe_key: null },
    ],
    support_threads: [],
    support_messages: [],
  }
})

describe('POST /api/messages/reply', () => {
  it('opens a learner-owned thread for the message and writes the reply as an in turn', async () => {
    const res = makeRes()
    await reply(makeReq({ method: 'POST', body: { id: 'am1', text: 'Where do I find it?', route: '/me/inbox' } }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.support_threads).toHaveLength(1)
    expect(DB.support_threads[0]).toMatchObject({ learner_user_id: 'learner-uid', origin_message_id: 'am1' })
    expect(DB.support_threads[0].school_id).toBeUndefined()
    expect(DB.support_messages).toHaveLength(1)
    expect(DB.support_messages[0]).toMatchObject({ direction: 'in', author_source: 'human', author_user_id: 'learner-uid', author_name: 'Ana', body: 'Where do I find it?' })
    expect(DB.support_messages[0].envelope.server.origin).toMatchObject({ message_id: 'am1', title: 'Pod 1 is live' })
    expect(DB.support_messages[0].envelope.client.route).toBe('/me/inbox')
    expect(DB.support_messages[0].answered_at).toBeUndefined() // a turn not yet taken: what the watcher selects on
    expect(DB.user_messages[0].read_at).toBeTruthy() // replying is reading
  })

  it('a second reply reuses the same thread: one thread per learner-message pair', async () => {
    await reply(makeReq({ method: 'POST', body: { id: 'am1', text: 'one' } }), makeRes())
    await reply(makeReq({ method: 'POST', body: { id: 'am1', text: 'two' } }), makeRes())
    expect(DB.support_threads).toHaveLength(1)
    expect(DB.support_messages.map((m) => m.body)).toEqual(['one', 'two'])
  })

  it('refuses a reply to a message that is not from SSi, a foreign message, an empty text, and View As', async () => {
    let res = makeRes()
    await reply(makeReq({ method: 'POST', body: { id: 'cp1', text: 'hi' } }), res)
    expect(res.statusCode).toBe(400)
    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { id: 'am-other', text: 'hi' } }), res)
    expect(res.statusCode).toBe(404)
    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { id: 'am1', text: '   ' } }), res)
    expect(res.statusCode).toBe(400)
    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { id: 'am1', text: 'hi' }, headers: VIEW_AS_HEADERS }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.support_threads).toHaveLength(0)
  })
})

describe('GET /api/messages/thread', () => {
  it('lists the turns oldest first and marks the thread read; no thread yet is an empty list', async () => {
    let res = makeRes()
    await thread(makeReq({ query: { id: 'am1' } }), res)
    expect(res.body).toEqual({ turns: [] })
    await reply(makeReq({ method: 'POST', body: { id: 'am1', text: 'hello?' } }), makeRes())
    DB.support_messages.push({ id: 'out1', thread_id: DB.support_threads[0].id, body: 'Tap Library, then Pods.', direction: 'out', author_name: 'Tom', created_at: '2030-01-01T12:00:00.000Z' })
    DB.support_threads[0].last_read_at = null
    res = makeRes()
    await thread(makeReq({ query: { id: 'am1' } }), res)
    expect(res.body.turns.map((t: any) => [t.direction, t.body])).toEqual([['in', 'hello?'], ['out', 'Tap Library, then Pods.']])
    expect(DB.support_threads[0].last_read_at).toBeTruthy()
  })
  it('a foreign message is 404', async () => {
    const res = makeRes()
    await thread(makeReq({ query: { id: 'am-other' } }), res)
    expect(res.statusCode).toBe(404)
  })
})
