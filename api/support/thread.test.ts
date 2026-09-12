/**
 * GET /api/support/thread — admin-only, created on first use, oldest-first,
 * and a peek never counts as reading.
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

let handler: typeof import('./thread').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./thread')).default
  DB = { support_threads: [], support_messages: [] }
  scope = ADMIN_SCOPE
})

describe('GET /api/support/thread', () => {
  it('refuses a plain class teacher with 403 and creates no thread', async () => {
    scope = TEACHER_SCOPE
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(403)
    expect(DB.support_threads).toHaveLength(0)
  })

  it('creates the school\'s thread on first open and returns it empty', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(DB.support_threads).toHaveLength(1)
    expect(DB.support_threads[0].school_id).toBe('s1')
    expect(res.body.messages).toEqual([])
    expect(res.body.unread).toBe(0)
    expect(DB.support_threads[0].last_read_at).toBeTruthy()
  })

  it('returns messages oldest-first with the escalation state on the row, and marks the thread read', async () => {
    DB.support_threads = [{ id: 't1', school_id: 's1', last_read_at: '2026-09-10T18:00:00.000Z', language: 'eng', standing_notes: {} }]
    DB.support_messages = [
      { id: 'm2', thread_id: 't1', body: 'reply', direction: 'out', author_source: 'agent', author_name: 'SSi', in_reply_to: 'm1', escalated_at: null, escalation_resolved_at: null, answered_at: null, created_at: '2026-09-10T19:41:00.000Z' },
      { id: 'm1', thread_id: 't1', body: 'question', direction: 'in', author_source: 'human', author_name: 'Angharad', in_reply_to: null, escalated_at: '2026-09-10T19:40:00.000Z', escalation_resolved_at: null, answered_at: '2026-09-10T19:41:00.000Z', created_at: '2026-09-10T19:39:00.000Z' },
      { id: 'm0', thread_id: 'OTHER', body: 'another school', direction: 'in', author_source: 'human', created_at: '2026-09-10T10:00:00.000Z' },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.messages.map((m: any) => m.id)).toEqual(['m1', 'm2'])
    expect(res.body.messages[0].escalated_at).toBe('2026-09-10T19:40:00.000Z')
    expect(res.body.unread).toBe(1)
    expect(DB.support_threads[0].last_read_at > '2026-09-10T18:00:00.000Z').toBe(true)
    expect(JSON.stringify(res.body)).not.toContain('another school')
  })

  it('?peek=1 reports the unread count without marking the thread read', async () => {
    DB.support_threads = [{ id: 't1', school_id: 's1', last_read_at: '2026-09-10T18:00:00.000Z', language: null, standing_notes: {} }]
    DB.support_messages = [
      { id: 'm2', thread_id: 't1', body: 'reply', direction: 'out', author_source: 'human', author_name: 'Tom', created_at: '2026-09-10T19:41:00.000Z' },
    ]
    const res = makeRes()
    await handler(makeReq({ query: { peek: '1' } }), res)
    expect(res.body).toEqual({ unread: 1 })
    expect(DB.support_threads[0].last_read_at).toBe('2026-09-10T18:00:00.000Z')
  })
})
