/**
 * The "Understood" reply (job #77·?, 2026-09-17).
 *
 * Tom, on the note going to teachers who taught a class from their own
 * account: "we'll invite them to reply so we know they've got it. Like /
 * Understood." read_at only says the message was opened; an acknowledge
 * action is the teacher answering. Pinned here: the tap stamps
 * action_taken_at and runs nothing else, and a second tap is refused 409,
 * because an acknowledgement is given once.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, type DB } from '../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'teacher-uid' })) }))
let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let act: typeof import('./act').default

beforeEach(async () => {
  vi.resetModules()
  act = (await import('./act')).default
  DB = {
    learners: [{ id: 'l1', user_id: 'teacher-uid', display_name: 'leejames' }],
    user_messages: [
      {
        id: 'm1', recipient_user_id: 'teacher-uid', source: 'admin_message',
        title: 'Starting the lesson as the class', body: '…',
        action: { kind: 'acknowledge', label: 'Understood', payload: {} },
        action_taken_at: null, read_at: null, dismissed_at: null,
        created_at: '2026-09-17T09:00:00.000Z', dedupe_key: null,
      },
    ],
  }
})

describe('POST /api/messages/act — acknowledge', () => {
  it('stamps action_taken_at and answers with the kind', async () => {
    const res = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'm1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body?.outcome).toEqual({ kind: 'acknowledge' })
    expect(DB.user_messages[0].action_taken_at).toBeTruthy()
  })

  it('refuses a second tap with 409', async () => {
    await act(makeReq({ method: 'POST', body: { id: 'm1' } }), makeRes())
    const res = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'm1' } }), res)
    expect(res.statusCode).toBe(409)
  })
})
