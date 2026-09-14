/**
 * The inbox routes (job #684): GET /api/messages, POST read, dismiss, act.
 *
 * What these pin, against a round-tripping table double:
 *   - listing is own-row and marks NOTHING read ("delivered is not seen");
 *   - every route refuses under View As before touching a row;
 *   - read stamps read_at once; dismiss stamps dismissed_at and leaves the
 *     message unread; a foreign id is 404 from both;
 *   - act runs the undo once, stamps action_taken_at, refuses a second run
 *     with 409, and relays a refused undo (played_since) without stamping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, VIEW_AS_HEADERS, type DB } from '../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'teacher-uid' })) }))

let undoOutcome: any = { ok: true, undoAuditId: 'audit-2', deleted: { sessions: 2 }, cursorRestored: true }
const undoCopy = vi.fn(async () => undoOutcome)
vi.mock('../_utils/classProgressCopy', () => ({
  undoCopy: (...a: unknown[]) => undoCopy(...a),
  readAudit: vi.fn(async () => ({ id: 'audit-1', source_learner_id: 'l-teacher', class_id: 'class-1' })),
}))
vi.mock('../_utils/classTeacherAuth', () => ({
  fetchClassAuthRow: vi.fn(async () => null),
  isSchoolAdminOfClass: vi.fn(async () => false),
}))

let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let list: typeof import('./index').default
let read: typeof import('./read').default
let dismiss: typeof import('./dismiss').default
let act: typeof import('./act').default

beforeEach(async () => {
  vi.resetModules()
  list = (await import('./index')).default
  read = (await import('./read')).default
  dismiss = (await import('./dismiss')).default
  act = (await import('./act')).default
  undoOutcome = { ok: true, undoAuditId: 'audit-2', deleted: { sessions: 2 }, cursorRestored: true }
  undoCopy.mockClear()
  DB = {
    learners: [{ id: 'l-teacher', user_id: 'teacher-uid' }],
    user_messages: [
      { id: 'um1', recipient_user_id: 'teacher-uid', source: 'class_play_copied', title: 'Your own practice on Welsh is now on Year 7\'s account', body: '…', action: { kind: 'undo_class_play_copy', label: 'Undo', payload: { audit_id: 'audit-1', class_id: 'class-1' } }, action_taken_at: null, read_at: null, dismissed_at: null, created_at: '2026-09-14T10:00:00.000Z', dedupe_key: 'class_play_copied:audit-1' },
      { id: 'um2', recipient_user_id: 'teacher-uid', source: 'support_reply', title: 'A reply', body: 'hello', action: { kind: 'open_support', label: 'Open Support', payload: { thread_id: 't1' } }, action_taken_at: null, read_at: '2026-09-13T10:00:00.000Z', dismissed_at: null, created_at: '2026-09-13T09:00:00.000Z', dedupe_key: null },
      { id: 'um-other', recipient_user_id: 'someone-else', source: 'support_reply', title: 'not yours', body: 'secret', action: null, action_taken_at: null, read_at: null, dismissed_at: null, created_at: '2026-09-14T11:00:00.000Z', dedupe_key: null },
    ],
  }
})

describe('GET /api/messages', () => {
  it('lists only the caller\'s messages, newest first, with the unread count, and marks nothing read', async () => {
    const res = makeRes()
    await list(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.messages.map((m: any) => m.id)).toEqual(['um1', 'um2'])
    expect(res.body.unread).toBe(1)
    expect(JSON.stringify(res.body)).not.toContain('secret')
    expect(JSON.stringify(res.body)).not.toContain('dedupe_key')
    expect(JSON.stringify(res.body)).not.toContain('audit-1') // the payload stays server-side
    expect(DB.user_messages[0].read_at).toBeNull()
  })

  it('refuses under View As', async () => {
    const res = makeRes()
    await list(makeReq({ headers: VIEW_AS_HEADERS }), res)
    expect(res.statusCode).toBe(403)
  })
})

describe('POST /api/messages/read', () => {
  it('stamps read_at on the tapped message and nothing else', async () => {
    const res = makeRes()
    await read(makeReq({ method: 'POST', body: { id: 'um1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.message.read_at).toBeTruthy()
    expect(DB.user_messages[0].read_at).toBeTruthy()
    expect(DB.user_messages[2].read_at).toBeNull()
  })
  it('a foreign id is 404 and untouched', async () => {
    const res = makeRes()
    await read(makeReq({ method: 'POST', body: { id: 'um-other' } }), res)
    expect(res.statusCode).toBe(404)
    expect(DB.user_messages[2].read_at).toBeNull()
  })
  it('refuses under View As before reading anything', async () => {
    const res = makeRes()
    await read(makeReq({ method: 'POST', body: { id: 'um1' }, headers: VIEW_AS_HEADERS }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_messages[0].read_at).toBeNull()
  })
})

describe('POST /api/messages/dismiss', () => {
  it('stamps dismissed_at and leaves the message unread', async () => {
    const res = makeRes()
    await dismiss(makeReq({ method: 'POST', body: { id: 'um1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.user_messages[0].dismissed_at).toBeTruthy()
    expect(DB.user_messages[0].read_at).toBeNull()
  })
  it('refuses under View As', async () => {
    const res = makeRes()
    await dismiss(makeReq({ method: 'POST', body: { id: 'um1' }, headers: VIEW_AS_HEADERS }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_messages[0].dismissed_at).toBeNull()
  })
})

describe('POST /api/messages/act', () => {
  it('runs the undo once as the caller, stamps action_taken_at (and read), and refuses a second run', async () => {
    const res = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'um1' } }), res)
    expect(res.statusCode).toBe(200)
    expect(undoCopy).toHaveBeenCalledWith(expect.anything(), 'audit-1', { actorUserId: 'teacher-uid' })
    expect(res.body.outcome).toMatchObject({ kind: 'undo_class_play_copy', deleted: { sessions: 2 } })
    expect(DB.user_messages[0].action_taken_at).toBeTruthy()
    expect(DB.user_messages[0].read_at).toBeTruthy()

    const again = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'um1' } }), again)
    expect(again.statusCode).toBe(409)
    expect(undoCopy).toHaveBeenCalledTimes(1)
  })
  it('relays a refused undo with its reason and stamps nothing', async () => {
    undoOutcome = { ok: false, reason: 'played_since' }
    const res = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'um1' } }), res)
    expect(res.statusCode).toBe(409)
    expect(res.body.reason).toBe('played_since')
    expect(res.body.error).toMatch(/played since/)
    expect(DB.user_messages[0].action_taken_at).toBeNull()
  })
  it('open_support runs nothing and stamps nothing', async () => {
    const res = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'um2' } }), res)
    expect(res.statusCode).toBe(200)
    expect(undoCopy).not.toHaveBeenCalled()
    expect(DB.user_messages[1].action_taken_at).toBeNull()
  })
  it('refuses under View As', async () => {
    const res = makeRes()
    await act(makeReq({ method: 'POST', body: { id: 'um1' }, headers: VIEW_AS_HEADERS }), res)
    expect(res.statusCode).toBe(403)
    expect(undoCopy).not.toHaveBeenCalled()
  })
})
