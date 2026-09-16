/**
 * Replying to a bug report (job #28). What these prove: the reply reaches the
 * learner's own inbox as an unread message with her report quoted under it, it
 * links back to the report, and running the tool twice never puts a second copy
 * in her inbox.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { makeChainable, type DB } from '../support/_testkit'
import {
  replyToBugReport,
  composeReplyBody,
  replyBroadcastId,
  REPLY_TITLE,
  BugReportReplyError,
} from './bugReportReply'
import { dedupeKeyFor } from './adminMessages'
import { listUserMessages, unreadCount } from './userMessages'

let db: DB
const svc: any = { from: (t: string) => makeChainable(db, t) }

const REPORT_ID = 'f1f368b7-545c-41a0-8e18-364443802199'
const HER_UID = 'da9f91dd-bd96-4c71-b6af-0a964e56d7dd'

beforeEach(() => {
  db = {
    bug_reports: [
      {
        id: REPORT_ID,
        auth_user_id: HER_UID,
        body: 'Seed 74 Svenska. The listening clip says vad where it should say var.',
        created_at: '2026-09-16T21:23:00.000Z',
        course_code: 'swe_for_eng',
        reply_message_id: null,
        replied_at: null,
        replied_by: null,
      },
    ],
    learners: [{ id: 'l1', user_id: HER_UID, display_name: 'A learner', is_demo: false, is_internal: false, is_class_entity: false }],
    admin_messages: [],
    user_messages: [],
  }
})

describe('composeReplyBody', () => {
  it('puts the reply first and quotes what she wrote, dated', () => {
    const body = composeReplyBody('  Thank you. You were right.  ', { body: 'It says vad.', created_at: '2026-09-16T21:23:00.000Z' })
    expect(body.startsWith('Thank you. You were right.')).toBe(true)
    expect(body).toContain('What you sent us on 16 September')
    expect(body).toContain('It says vad.')
  })
  it('drops the date rather than printing rubbish when the stamp is unreadable', () => {
    expect(composeReplyBody('Hello', { body: 'x', created_at: 'not-a-date' })).toContain('What you sent us\n')
  })
})

describe('replyBroadcastId', () => {
  it('is the same every time for one report, and different across reports', () => {
    expect(replyBroadcastId(REPORT_ID)).toBe(replyBroadcastId(REPORT_ID))
    expect(replyBroadcastId(REPORT_ID)).not.toBe(replyBroadcastId('other'))
    expect(replyBroadcastId(REPORT_ID)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('replyToBugReport', () => {
  it('lands one unread message in her own inbox and stamps the report', async () => {
    const out = await replyToBugReport(svc, { reportId: REPORT_ID, replyText: 'You were right on every point.', senderUserId: 'tom-uid' })
    expect(out.sent).toBe(true)
    expect(out.recipientUserId).toBe(HER_UID)

    const inbox = await listUserMessages(svc, HER_UID)
    expect(inbox).toHaveLength(1)
    expect(inbox[0].title).toBe(REPLY_TITLE)
    expect(inbox[0].source).toBe('admin_message')
    expect(inbox[0].body).toContain('You were right on every point.')
    expect(inbox[0].body).toContain('The listening clip says vad where it should say var.')
    expect(unreadCount(inbox)).toBe(1)
    expect(inbox[0].dedupe_key).toBe(dedupeKeyFor(out.broadcastId, HER_UID))

    const report = db.bug_reports[0]
    expect(report.reply_message_id).toBe(inbox[0].id)
    expect(report.replied_by).toBe('tom-uid')
    expect(report.replied_at).toBeTruthy()
  })

  it('refuses a report that has already been answered, and writes nothing', async () => {
    await replyToBugReport(svc, { reportId: REPORT_ID, replyText: 'First.', senderUserId: 'tom-uid' })
    await expect(replyToBugReport(svc, { reportId: REPORT_ID, replyText: 'Second.', senderUserId: 'tom-uid' })).rejects.toBeInstanceOf(BugReportReplyError)
    expect(db.user_messages).toHaveLength(1)
  })

  it('a resend of the same words adds no second copy to her inbox', async () => {
    const first = await replyToBugReport(svc, { reportId: REPORT_ID, replyText: 'Once.', senderUserId: 'tom-uid' })
    const again = await replyToBugReport(svc, { reportId: REPORT_ID, replyText: 'Once.', senderUserId: 'tom-uid', resend: true })
    expect(again.sent).toBe(false)
    expect(again.broadcastId).toBe(first.broadcastId)
    expect(db.user_messages).toHaveLength(1)
  })

  it('refuses a guest report, which has no inbox', async () => {
    db.bug_reports[0].auth_user_id = null
    await expect(replyToBugReport(svc, { reportId: REPORT_ID, replyText: 'Hello.', senderUserId: 'tom-uid' })).rejects.toThrow(/guest/)
    expect(db.user_messages).toHaveLength(0)
  })

  it('refuses an unknown report', async () => {
    await expect(replyToBugReport(svc, { reportId: 'nope', replyText: 'Hello.', senderUserId: 'tom-uid' })).rejects.toThrow(/no bug report/)
  })
})
