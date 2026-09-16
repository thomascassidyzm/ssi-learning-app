/**
 * Replying to a learner's report, and the Support inbox's own reading of both
 * postboxes (job #28). What these prove: the reply reaches her own inbox as an
 * unread message with her report quoted under it, it links back to the report,
 * running the tool twice never puts a second copy in her inbox, and the inbox
 * list shows unanswered first with seen state read off the message she was sent.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { makeChainable, type DB } from '../support/_testkit'
import {
  replyToLearnerReport,
  listLearnerReports,
  sortForInbox,
  composeReplyBody,
  replyBroadcastId,
  REPLY_TITLE,
  LearnerReportError,
} from './learnerReports'
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
        position: { lego_id: 'S0074L02', known_text: 'to understand', target_text: 'förstå', belt: 'green' },
        device: { platform: 'Linux armv81', viewport: '384x778', standalone: true },
        app_version: 'ea0683f main',
        deployment_env: 'production',
        reporter_email: 'her@example.com',
        reply_message_id: null,
        replied_at: null,
        replied_by: null,
      },
    ],
    tester_feedback: [
      {
        id: 'tf-1',
        user_id: 'other-uid',
        display_name: 'aran',
        feedback_type: 'bug',
        title: 'choose your course not scrolling',
        description: 'The course list will not scroll on my phone.',
        route: '/',
        device_info: { platform: 'iPhone' },
        build_version: 'abc123',
        status: 'new',
        created_at: '2026-09-14T11:23:00.000Z',
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
    const body = composeReplyBody('  Thank you. You were right.  ', { body: 'It says vad.', createdAt: '2026-09-16T21:23:00.000Z', title: null })
    expect(body.startsWith('Thank you. You were right.')).toBe(true)
    expect(body).toContain('What you sent us on 16 September')
    expect(body).toContain('It says vad.')
  })
  it('keeps a tester report title above its description', () => {
    const body = composeReplyBody('Fixed.', { body: 'It will not scroll.', createdAt: '2026-09-14T11:23:00.000Z', title: 'not scrolling' })
    expect(body.indexOf('not scrolling')).toBeLessThan(body.indexOf('It will not scroll.'))
  })
  it('drops the date rather than printing rubbish when the stamp is unreadable', () => {
    expect(composeReplyBody('Hello', { body: 'x', createdAt: 'not-a-date', title: null })).toContain('What you sent us\n')
  })
})

describe('replyBroadcastId', () => {
  it('is the same every time for one report, and different across reports and sources', () => {
    expect(replyBroadcastId('bug_report', REPORT_ID)).toBe(replyBroadcastId('bug_report', REPORT_ID))
    expect(replyBroadcastId('bug_report', REPORT_ID)).not.toBe(replyBroadcastId('tester_feedback', REPORT_ID))
    expect(replyBroadcastId('bug_report', REPORT_ID)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('replyToLearnerReport', () => {
  it('lands one unread message in her own inbox and stamps the report', async () => {
    const out = await replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'You were right on every point.', senderUserId: 'tom-uid' })
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

  it('answers a tester_feedback row the same way, on its own table', async () => {
    db.learners.push({ id: 'l2', user_id: 'other-uid', display_name: 'aran', is_demo: false, is_internal: false, is_class_entity: false })
    const out = await replyToLearnerReport(svc, { source: 'tester_feedback', reportId: 'tf-1', replyText: 'Fixed on Tuesday.', senderUserId: 'tom-uid' })
    expect(out.sent).toBe(true)
    expect(db.tester_feedback[0].replied_at).toBeTruthy()
    expect(db.bug_reports[0].replied_at).toBeNull()
    const inbox = await listUserMessages(svc, 'other-uid')
    expect(inbox[0].body).toContain('Fixed on Tuesday.')
  })

  it('refuses a report that has already been answered, and writes nothing', async () => {
    await replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'First.', senderUserId: 'tom-uid' })
    await expect(replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'Second.', senderUserId: 'tom-uid' })).rejects.toBeInstanceOf(LearnerReportError)
    expect(db.user_messages).toHaveLength(1)
  })

  it('a resend of the same words adds no second copy to her inbox', async () => {
    const first = await replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'Once.', senderUserId: 'tom-uid' })
    const again = await replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'Once.', senderUserId: 'tom-uid', resend: true })
    expect(again.sent).toBe(false)
    expect(again.broadcastId).toBe(first.broadcastId)
    expect(db.user_messages).toHaveLength(1)
  })

  it('refuses a guest report, which has no inbox', async () => {
    db.bug_reports[0].auth_user_id = null
    await expect(replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'Hello.', senderUserId: 'tom-uid' })).rejects.toThrow(/guest/)
    expect(db.user_messages).toHaveLength(0)
  })

  it('refuses an unknown report', async () => {
    await expect(replyToLearnerReport(svc, { source: 'bug_report', reportId: 'nope', replyText: 'Hello.', senderUserId: 'tom-uid' })).rejects.toThrow(/no bug_report/)
  })
})

describe('listLearnerReports', () => {
  it('reads both postboxes into one shape, unanswered first', async () => {
    const rows = await listLearnerReports(svc)
    expect(rows.map((r) => r.source)).toEqual(['bug_report', 'tester_feedback'])
    const bug = rows[0]
    expect(bug.who).toBe('her@example.com')
    expect(bug.position).toBe('to understand — förstå, green belt')
    expect(bug.device).toContain('Linux armv81')
    expect(bug.repliedAt).toBeNull()
    expect(rows[1].title).toBe('choose your course not scrolling')
    expect(rows[1].status).toBe('new')
  })

  it('carries the reply back with whether she has opened it, and sinks answered rows', async () => {
    await replyToLearnerReport(svc, { source: 'bug_report', reportId: REPORT_ID, replyText: 'You were right.', senderUserId: 'tom-uid' })
    let rows = await listLearnerReports(svc)
    expect(rows[0].source).toBe('tester_feedback') // unanswered floats above the answered one
    const answered = rows.find((r) => r.source === 'bug_report')!
    expect(answered.replyText).toContain('You were right.')
    expect(answered.replySeenAt).toBeNull()

    db.user_messages[0].read_at = '2026-09-17T08:00:00.000Z'
    rows = await listLearnerReports(svc)
    expect(rows.find((r) => r.source === 'bug_report')!.replySeenAt).toBe('2026-09-17T08:00:00.000Z')
  })
})

describe('sortForInbox', () => {
  it('is unanswered first, then newest first', () => {
    const rows: any[] = [
      { id: 'a', createdAt: '2026-09-01T00:00:00Z', repliedAt: '2026-09-02T00:00:00Z' },
      { id: 'b', createdAt: '2026-09-03T00:00:00Z', repliedAt: null },
      { id: 'c', createdAt: '2026-09-05T00:00:00Z', repliedAt: null },
      { id: 'd', createdAt: '2026-09-09T00:00:00Z', repliedAt: '2026-09-10T00:00:00Z' },
    ]
    expect(sortForInbox(rows).map((r: any) => r.id)).toEqual(['c', 'b', 'd', 'a'])
  })
})
