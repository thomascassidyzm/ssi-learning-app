/**
 * The platform support inbox (job #220): the ordering Tom asked for, the fold
 * that decides whether a row is waiting on us, and the reply that has to look
 * exactly like the watcher's so the doorbell and the read receipts keep working.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { makeChainable, FAILING_TABLES, type DB } from '../support/_testkit'
import {
  orderThreads,
  summariseTurns,
  toContext,
  listPlatformThreads,
  loadPlatformThread,
  replyAsPlatform,
  PlatformSupportError,
} from './platformSupport'

let db: DB
const svc = { from: (t: string) => makeChainable(db, t) } as any

const T = (n: number) => new Date(Date.UTC(2026, 8, n)).toISOString()

beforeEach(() => {
  FAILING_TABLES.clear()
  db = {
    support_threads: [
      { id: 'th-school', school_id: 'sch-1', group_id: null, created_at: T(1), last_message_at: T(5), last_read_at: T(2), language: 'eng', standing_notes: {} },
      { id: 'th-group', school_id: null, group_id: 'grp-1', created_at: T(1), last_message_at: T(9), last_read_at: null, language: 'cym', standing_notes: {} },
      // A learner's reply thread (job #821) — listed here too (job #221).
      { id: 'th-learner', school_id: null, group_id: null, learner_user_id: 'auth-learner', origin_message_id: 'm1', created_at: T(3), last_message_at: T(8), last_read_at: null, language: 'eng', standing_notes: {} },
      // A second learner thread whose origin is a bug_report's own reply — already shown via her report row, so it must be left out.
      { id: 'th-learner-dup', school_id: null, group_id: null, learner_user_id: 'auth-learner-2', origin_message_id: 'm-reported', created_at: T(3), last_message_at: T(7), last_read_at: null, language: 'eng', standing_notes: {} },
    ],
    support_messages: [
      { id: 'm-1', thread_id: 'th-school', body: 'Our hours look wrong', direction: 'in', author_source: 'human', author_name: 'Bethan', answered_at: T(5), created_at: T(4), envelope: { client: { route: '/schools', displayed_label: 'Practice hours', displayed_value: '12', build_version: 'abc123', device_info: { userAgent: 'iPhone' } }, server: { computed_at: T(4), summary: { total_practice_hours: 31 } } }, signal_key: 'tile-contradiction:hours' },
      { id: 'm-2', thread_id: 'th-school', body: 'Fixed now', direction: 'out', author_source: 'agent', author_name: 'SSi', answered_at: null, created_at: T(5), envelope: null, signal_key: null },
      { id: 'm-3', thread_id: 'th-group', body: 'Can we add a school?', direction: 'in', author_source: 'human', author_name: 'Gwen', answered_at: null, created_at: T(9), envelope: null, signal_key: null },
      { id: 'm-4', thread_id: 'th-learner', body: 'a learner writing back', direction: 'in', author_source: 'human', author_name: 'Sam', answered_at: null, created_at: T(8), envelope: null, signal_key: null },
      { id: 'm-5', thread_id: 'th-learner-dup', body: 'still stuck', direction: 'in', author_source: 'human', author_name: 'Alys', answered_at: null, created_at: T(7), envelope: null, signal_key: null },
    ],
    schools: [{ id: 'sch-1', school_name: 'Ysgol Bryn' }],
    groups: [{ id: 'grp-1', name: 'Gwynedd' }],
    learners: [
      { id: 'learner-uuid-1', user_id: 'auth-admin', display_name: 'Kai' },
      { id: 'learner-uuid-2', user_id: 'auth-learner', display_name: 'Sam' },
      { id: '01234567-89ab-cdef-0000-000000000000', user_id: 'auth-learner-2', display_name: null },
    ],
    bug_reports: [{ id: 'br-1', reply_message_id: 'm-reported' }],
    tester_feedback: [],
  }
})

describe('orderThreads — waiting first, then newest first', () => {
  it('puts every waiting thread above every answered one, newest within each', () => {
    const rows = [
      { unanswered: 0, lastMessageAt: T(20), createdAt: T(1) },
      { unanswered: 1, lastMessageAt: T(2), createdAt: T(1) },
      { unanswered: 3, lastMessageAt: T(10), createdAt: T(1) },
      { unanswered: 0, lastMessageAt: null, createdAt: T(15) },
    ]
    expect(orderThreads(rows).map((r) => r.lastMessageAt ?? r.createdAt)).toEqual([T(10), T(2), T(20), T(15)])
  })
})

describe('summariseTurns', () => {
  it('counts only unanswered questions, and names the person who asked last', () => {
    const turns = [
      { id: 'a', thread_id: 't', body: 'first', direction: 'in' as const, author_name: 'Bethan', answered_at: T(2), created_at: T(1) },
      { id: 'b', thread_id: 't', body: 'answer', direction: 'out' as const, author_name: 'SSi', answered_at: null, created_at: T(2) },
      { id: 'c', thread_id: 't', body: 'second', direction: 'in' as const, author_name: 'Alun', answered_at: null, created_at: T(3) },
    ]
    expect(summariseTurns(turns)).toEqual({ unanswered: 1, messageCount: 3, lastBody: 'second', lastDirection: 'in', person: 'Alun' })
  })
})

describe('toContext', () => {
  it('flattens the envelope to the facts the answerer needs, and nothing else', () => {
    const ctx = toContext(db.support_messages[0] as any)!
    expect(ctx.route).toBe('/schools')
    expect(ctx.displayedValue).toBe('12')
    expect(ctx.build).toBe('abc123')
    expect(ctx.device).toBe('iPhone')
    expect(ctx.signalKey).toBe('tile-contradiction:hours')
    expect((ctx.server as any).summary.total_practice_hours).toBe(31)
  })
  it('is null when there is no envelope at all', () => {
    expect(toContext(db.support_messages[2] as any)).toBeNull()
  })
})

describe('listPlatformThreads', () => {
  it('lists school, org and learner threads, names them, and leaves out a learner thread already shown via her report', async () => {
    const rows = await listPlatformThreads(svc)
    expect(rows.map((r) => r.id)).toEqual(['th-group', 'th-learner', 'th-school'])
    expect(rows[0]).toMatchObject({ kind: 'group', who: 'Gwynedd', unanswered: 1, person: 'Gwen' })
    expect(rows[1]).toMatchObject({ kind: 'learner', who: 'Sam', person: null, unanswered: 1 })
    expect(rows[2]).toMatchObject({ kind: 'school', who: 'Ysgol Bryn', unanswered: 0, lastDirection: 'out' })
  })

  it('names a learner without a display name by her support id, never by anything that looks like an email', async () => {
    // th-learner-dup would sort right beside th-learner were it not excluded — force it in to check the name shape in isolation.
    db.support_threads[3].origin_message_id = 'm-not-reported'
    const rows = await listPlatformThreads(svc)
    const row = rows.find((r) => r.id === 'th-learner-dup')!
    expect(row.who).not.toContain('@')
    expect(row.who).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  })

  it('is loud when the read is refused, never an empty inbox', async () => {
    FAILING_TABLES.set('support_threads', { message: 'permission denied' })
    await expect(listPlatformThreads(svc)).rejects.toThrow(/support threads read failed/)
  })
})

describe('loadPlatformThread', () => {
  it('returns every turn with the envelope of the latest question', async () => {
    const detail = (await loadPlatformThread(svc, 'th-school'))!
    expect(detail.messages.map((m) => m.id)).toEqual(['m-1', 'm-2'])
    expect(detail.context?.displayedLabel).toBe('Practice hours')
    // The envelope never rides on the message rows themselves.
    expect(Object.keys(detail.messages[0])).not.toContain('envelope')
  })

  it('opens a learner-owned thread too, naming her and what she was replying to', async () => {
    db.user_messages = [{ id: 'm1', title: 'New pods coming', body: 'Just to let you know…' }]
    const detail = (await loadPlatformThread(svc, 'th-learner'))!
    expect(detail.kind).toBe('learner')
    expect(detail.who).toBe('Sam')
    expect(detail.messages.map((m) => m.id)).toEqual(['m-4'])
    expect(detail.originMessage).toEqual({ title: 'New pods coming', body: 'Just to let you know…' })
  })

  it('404s (null) on an id that is not a school, org or learner thread', async () => {
    expect(await loadPlatformThread(svc, 'nope')).toBeNull()
  })
})

describe('replyAsPlatform', () => {
  it('writes the watcher-shaped out row, authored as the ssi_admin', async () => {
    await replyAsPlatform(svc, { threadId: 'th-group', text: 'Yes — here is how.', senderUserId: 'auth-admin' })
    const out = db.support_messages.filter((m) => m.thread_id === 'th-group' && m.direction === 'out')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      author_source: 'human',
      author_via: 'jwt',
      author_user_id: 'auth-admin',
      author_name: 'Kai',
      in_reply_to: 'm-3',
    })
  })

  it('stamps answered_at on the open question so the watcher does not answer it twice', async () => {
    await replyAsPlatform(svc, { threadId: 'th-group', text: 'answered', senderUserId: 'auth-admin' })
    expect(db.support_messages.find((m) => m.id === 'm-3')!.answered_at).toBeTruthy()
  })

  it('never touches last_read_at — that is the school\'s reading, and the doorbell keys on it', async () => {
    await replyAsPlatform(svc, { threadId: 'th-school', text: 'more', senderUserId: 'auth-admin' })
    const thread = db.support_threads.find((t) => t.id === 'th-school')!
    expect(thread.last_read_at).toBe(T(2))
    expect(thread.last_message_at).not.toBe(T(5))
  })

  it('refuses an unknown thread', async () => {
    await expect(replyAsPlatform(svc, { threadId: 'nope', text: 'x', senderUserId: 'auth-admin' })).rejects.toBeInstanceOf(PlatformSupportError)
  })

  it('answers a learner thread through the same write path as a school or org thread', async () => {
    await replyAsPlatform(svc, { threadId: 'th-learner', text: 'Yes, more Spanish pods are on the way.', senderUserId: 'auth-admin' })
    const out = db.support_messages.filter((m) => m.thread_id === 'th-learner' && m.direction === 'out')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ author_user_id: 'auth-admin', author_name: 'Kai', in_reply_to: 'm-4' })
    expect(db.support_messages.find((m) => m.id === 'm-4')!.answered_at).toBeTruthy()
  })
})
