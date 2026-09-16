/** The Support inbox routes are ssi_admin only, and a reply is refused before anything is written (job #28). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, type DB } from '../../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let adminAnswer: any = { userId: 'admin-uid' }
vi.mock('../../_utils/auth', () => ({ verifyAdmin: vi.fn(async () => adminAnswer) }))
let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let reply: typeof import('./reply').default
let list: typeof import('./index').default

const REPORT_ID = 'f1f368b7-545c-41a0-8e18-364443802199'
const HER_UID = 'da9f91dd-bd96-4c71-b6af-0a964e56d7dd'

beforeEach(async () => {
  vi.resetModules()
  reply = (await import('./reply')).default
  list = (await import('./index')).default
  adminAnswer = { userId: 'admin-uid' }
  DB = {
    bug_reports: [{ id: REPORT_ID, auth_user_id: HER_UID, body: 'The clip says vad.', created_at: '2026-09-16T21:23:00.000Z', course_code: 'swe_for_eng', reply_message_id: null, replied_at: null, replied_by: null }],
    tester_feedback: [],
    learners: [{ id: 'l1', user_id: HER_UID, display_name: 'A learner', is_demo: false, is_internal: false, is_class_entity: false }],
    admin_messages: [],
    user_messages: [],
  }
})

describe('admin Support inbox routes', () => {
  it('a non-admin is refused before anything is read or written', async () => {
    adminAnswer = { error: 'Requires SSi admin access', status: 403, userId: 'u1' }
    let res = makeRes()
    await list(makeReq(), res)
    expect(res.statusCode).toBe(403)
    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { source: 'bug_report', id: REPORT_ID, text: 'Hello.' } }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_messages).toHaveLength(0)
  })

  it('lists both postboxes with the unanswered count', async () => {
    const res = makeRes()
    await list(makeReq(), res)
    expect(res.body.reports).toHaveLength(1)
    expect(res.body.unanswered).toBe(1)
  })

  it('refuses a reply with no words, and an unknown source', async () => {
    let res = makeRes()
    await reply(makeReq({ method: 'POST', body: { source: 'bug_report', id: REPORT_ID, text: '   ' } }), res)
    expect(res.statusCode).toBe(400)
    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { source: 'invented', id: REPORT_ID, text: 'Hi.' } }), res)
    expect(res.statusCode).toBe(400)
    expect(DB.user_messages).toHaveLength(0)
  })

  it('sends the reply, stamps the report, and refuses a second answer', async () => {
    let res = makeRes()
    await reply(makeReq({ method: 'POST', body: { source: 'bug_report', id: REPORT_ID, text: 'You were right.' } }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.sent).toBe(true)
    expect(res.body.report.repliedBy).toBe('admin-uid')
    expect(DB.user_messages).toHaveLength(1)
    expect(DB.user_messages[0].recipient_user_id).toBe(HER_UID)

    res = makeRes()
    await reply(makeReq({ method: 'POST', body: { source: 'bug_report', id: REPORT_ID, text: 'Again.' } }), res)
    expect(res.statusCode).toBe(400)
    expect(DB.user_messages).toHaveLength(1)
  })
})
