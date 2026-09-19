/**
 * Admin-to-learner messaging (job #821): audience resolution and the
 * idempotent send, against the round-tripping table double.
 *
 * Pinned here:
 *   - a COURSE audience is every sendable learner with progress on that
 *     course — demo, internal and class-entity accounts are out, an enrolment
 *     never played is out, two enrolments are one recipient;
 *   - ALL is every sendable learner; ONE is exactly the named learner, even a
 *     demo one (Tom sends himself a test);
 *   - a send writes one inbox row per recipient keyed on the broadcast id, and
 *     the same send again writes NOTHING and says so;
 *   - the audience and the words are FROZEN on the broadcast row at first send
 *     (job #847): a retry reuses the frozen list, never re-resolving it, and a
 *     retry with different words or audience is refused.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { makeChainable, type DB } from '../support/_testkit'
import { resolveAudience, sendAdminMessage, courseAudiences, parseSendBody, BroadcastMismatchError, groupSentRows, recentAdminMessages, type SentSummary } from './adminMessages'

let DB: DB
const svc = () => ({ from: (t: string) => makeChainable(DB, t) }) as any

beforeEach(() => {
  DB = {
    learners: [
      { id: 'l1', user_id: 'u1', display_name: 'Ana', is_demo: false, is_internal: false, is_class_entity: false },
      { id: 'l2', user_id: 'u2', display_name: 'Ben', is_demo: false, is_internal: false, is_class_entity: false },
      { id: 'l3', user_id: 'u3', display_name: 'Demo', is_demo: true, is_internal: false, is_class_entity: false },
      { id: 'l4', user_id: 'u4', display_name: 'Staff', is_demo: false, is_internal: true, is_class_entity: false },
      { id: 'l5', user_id: 'u5', display_name: 'Year 7', is_demo: false, is_internal: false, is_class_entity: true },
      { id: 'l6', user_id: 'u6', display_name: 'Cai', is_demo: false, is_internal: false, is_class_entity: false },
    ],
    course_enrollments: [
      { learner_id: 'l1', course_id: 'spa_for_eng', last_practiced_at: '2026-09-01T00:00:00Z', highest_completed_lego_id: 'S0003L01', total_practice_minutes: 12 },
      { learner_id: 'l1', course_id: 'spa_for_eng', last_practiced_at: null, highest_completed_lego_id: null, total_practice_minutes: 3 }, // a second row, same learner
      { learner_id: 'l2', course_id: 'spa_for_eng', last_practiced_at: null, highest_completed_lego_id: null, total_practice_minutes: 0 }, // opened, never played
      { learner_id: 'l3', course_id: 'spa_for_eng', last_practiced_at: '2026-09-01T00:00:00Z', highest_completed_lego_id: null, total_practice_minutes: 0 },
      { learner_id: 'l4', course_id: 'spa_for_eng', last_practiced_at: '2026-09-01T00:00:00Z', highest_completed_lego_id: null, total_practice_minutes: 0 },
      { learner_id: 'l5', course_id: 'spa_for_eng', last_practiced_at: '2026-09-01T00:00:00Z', highest_completed_lego_id: null, total_practice_minutes: 0 },
      { learner_id: 'l6', course_id: 'cym_s_for_eng', last_practiced_at: null, highest_completed_lego_id: 'S0001L02', total_practice_minutes: 0 },
    ],
    courses: [{ course_code: 'spa_for_eng', display_name: 'Spanish' }, { course_code: 'cym_s_for_eng', display_name: 'Welsh south' }],
    admin_messages: [],
    user_messages: [],
  }
})

describe('resolveAudience', () => {
  it('course: sendable learners with progress on that course, one recipient per learner', async () => {
    const a = await resolveAudience(svc(), { kind: 'course', courseCode: 'spa_for_eng' })
    expect(a.members.map((m) => m.userId)).toEqual(['u1'])
  })
  it('all: every sendable learner, demo / internal / class entities out', async () => {
    const a = await resolveAudience(svc(), { kind: 'all' })
    expect(a.members.map((m) => m.userId).sort()).toEqual(['u1', 'u2', 'u6'])
  })
  it('one: exactly the named learner, even a demo one; an unknown uid is nobody', async () => {
    expect((await resolveAudience(svc(), { kind: 'one', userId: 'u3' })).members.map((m) => m.userId)).toEqual(['u3'])
    expect((await resolveAudience(svc(), { kind: 'one', userId: 'nope' })).members).toEqual([])
  })
  it('courseAudiences lists each course with its sendable-with-progress count, largest first', async () => {
    const c = await courseAudiences(svc())
    expect(c).toEqual([
      { courseCode: 'cym_s_for_eng', displayName: 'Welsh south', learners: 1 },
      { courseCode: 'spa_for_eng', displayName: 'Spanish', learners: 1 },
    ])
  })
})

describe('sendAdminMessage', () => {
  const input = { id: '11111111-2222-4333-8444-555555555555', senderUserId: 'admin', spec: { kind: 'all' as const }, title: 'Pod 1 is live', body: 'Have a listen.' }

  it('writes one keyed inbox row per recipient and a broadcast row', async () => {
    const r = await sendAdminMessage(svc(), input)
    expect(r).toEqual({ id: input.id, audience: 3, sent: 3 })
    expect(DB.user_messages.map((m) => m.recipient_user_id).sort()).toEqual(['u1', 'u2', 'u6'])
    expect(DB.user_messages.every((m) => m.source === 'admin_message' && m.dedupe_key === `admin_message:${input.id}:${m.recipient_user_id}` && m.read_at == null)).toBe(true)
    expect(DB.admin_messages).toHaveLength(1)
    expect(DB.admin_messages[0]).toMatchObject({ id: input.id, audience_kind: 'all', recipient_count: 3 })
    expect(DB.admin_messages[0].sent_at).toBeTruthy()
  })

  it('the same send again lands nothing: idempotent per message id', async () => {
    await sendAdminMessage(svc(), input)
    const again = await sendAdminMessage(svc(), input)
    expect(again).toEqual({ id: input.id, audience: 3, sent: 0 })
    expect(DB.user_messages).toHaveLength(3)
    expect(DB.admin_messages).toHaveLength(1)
  })

  it('a retry reuses the audience frozen at first send: a learner who qualified later is not swept in', async () => {
    await sendAdminMessage(svc(), input)
    DB.learners.push({ id: 'l7', user_id: 'u7', display_name: 'Dai', is_demo: false, is_internal: false, is_class_entity: false })
    const again = await sendAdminMessage(svc(), input)
    expect(again).toEqual({ id: input.id, audience: 3, sent: 0 })
    expect(DB.user_messages.map((m) => m.recipient_user_id).sort()).toEqual(['u1', 'u2', 'u6'])
    expect(DB.admin_messages[0].recipient_user_ids).toEqual(['u1', 'u2', 'u6'])
  })

  it('a retry that finishes a half-landed send reaches only the frozen audience', async () => {
    await sendAdminMessage(svc(), input)
    DB.user_messages = DB.user_messages.filter((m) => m.recipient_user_id !== 'u6') // the first call timed out after two chunks, say
    DB.learners.push({ id: 'l7', user_id: 'u7', display_name: 'Dai', is_demo: false, is_internal: false, is_class_entity: false })
    const again = await sendAdminMessage(svc(), input)
    expect(again).toEqual({ id: input.id, audience: 3, sent: 1 })
    expect(DB.user_messages.map((m) => m.recipient_user_id).sort()).toEqual(['u1', 'u2', 'u6'])
  })

  it('a retry with changed title, body or audience under the same id is refused, and writes nothing', async () => {
    await sendAdminMessage(svc(), input)
    await expect(sendAdminMessage(svc(), { ...input, title: 'Pod 2 is live' })).rejects.toBeInstanceOf(BroadcastMismatchError)
    await expect(sendAdminMessage(svc(), { ...input, body: 'Different words.' })).rejects.toThrow(/body differs/)
    await expect(sendAdminMessage(svc(), { ...input, spec: { kind: 'course', courseCode: 'spa_for_eng' } })).rejects.toThrow(/audience differs/)
    expect(DB.user_messages).toHaveLength(3)
    expect(DB.user_messages.every((m) => m.title === 'Pod 1 is live')).toBe(true)
    expect(DB.admin_messages[0]).toMatchObject({ title: 'Pod 1 is live', body: 'Have a listen.' })
  })

  it('a broadcast from before the audience was frozen retries as it always did: the audience is resolved again', async () => {
    DB.admin_messages.push({ id: input.id, sender_user_id: 'admin', audience_kind: 'all', course_code: null, target_user_id: null, title: input.title, body: input.body, recipient_count: 3, recipient_user_ids: null, sent_at: '2026-09-15T00:00:00Z' })
    const r = await sendAdminMessage(svc(), input)
    expect(r).toEqual({ id: input.id, audience: 3, sent: 3 })
  })

  it('a different id to the same audience is a new message', async () => {
    await sendAdminMessage(svc(), input)
    await sendAdminMessage(svc(), { ...input, id: '11111111-2222-4333-8444-666666666666' })
    expect(DB.user_messages).toHaveLength(6)
  })
})

describe('parseSendBody', () => {
  it('needs a uuid id, a title, a body and a well-formed audience', () => {
    expect(parseSendBody({})).toEqual({ error: 'id must be a uuid minted by the composer' })
    const id = '11111111-2222-4333-8444-555555555555'
    expect(parseSendBody({ id, title: 'x', body: 'y', kind: 'course' })).toEqual({ error: 'course_code is required' })
    expect(parseSendBody({ id, title: 'x', body: 'y', kind: 'one', user_id: 'u1' })).toEqual({ input: { id, title: 'x', body: 'y', spec: { kind: 'one', userId: 'u1' } } })
    expect(parseSendBody({ id, title: '', body: 'y', kind: 'all' })).toEqual({ error: 'title is required' })
  })
})

describe('groupSentRows — one row per SEND, not per recipient (Tom, 2026-09-19)', () => {
  const row = (over: Partial<SentSummary>): SentSummary => ({
    id: 'm1',
    audience_kind: 'one',
    course_code: null,
    target_user_id: 'u1',
    title: "What's new in your school dashboard",
    body: 'Three things changed.',
    recipient_count: 1,
    created_at: '2026-09-18T12:27:22.718Z',
    sent_at: '2026-09-18T12:27:22.840Z',
    ...over,
  })

  it('folds a per-recipient loop into one row carrying the whole audience', () => {
    // The real 18 Sep send: one audience_kind 'one' broadcast per recipient,
    // seconds apart, same words.
    const rows = ['u1', 'u2', 'u3'].map((u, i) =>
      row({ id: `m${i}`, target_user_id: u, created_at: `2026-09-18T12:27:${22 - i}.000Z` }),
    )
    const out = groupSentRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].recipient_count).toBe(3)
    expect(out[0].parts).toBe(3)
    // Naming one of the three would be a lie.
    expect(out[0].target_user_id).toBeNull()
  })

  it('a genuine second send of the same words on another day stays its own row', () => {
    const out = groupSentRows([
      row({ id: 'a', created_at: '2026-09-19T09:00:00.000Z' }),
      row({ id: 'b', created_at: '2026-09-18T12:27:22.000Z' }),
    ])
    expect(out.map((g) => g.id)).toEqual(['a', 'b'])
    expect(out.every((g) => g.parts === 1)).toBe(true)
  })

  it('leaves an ordinary single send alone, target and all', () => {
    const out = groupSentRows([row({ id: 'solo', title: 'Pod 1 is live' })])
    expect(out).toEqual([{ ...row({ id: 'solo', title: 'Pod 1 is live' }), parts: 1 }])
  })

  it('different words in the same minute are different sends', () => {
    const out = groupSentRows([row({ id: 'a' }), row({ id: 'b', body: 'Something else.' })])
    expect(out).toHaveLength(2)
  })

  it('the real 18 Sep send folds to ONE row of 123 though it straddles a minute', () => {
    // 123 rows, 12:26:32 to 12:27:22 UTC (Astra cold-check, job #247). Grouped
    // by clock minute this read as two rows, 67 and 56.
    const first = Date.parse('2026-09-18T12:26:32.000Z')
    const rows = Array.from({ length: 123 }, (_, i) =>
      row({ id: `m${i}`, target_user_id: `u${i}`, created_at: new Date(first + Math.round((i * 50000) / 122)).toISOString() }),
    )
    const out = groupSentRows(rows)
    expect(out).toHaveLength(1)
    expect(out[0].parts).toBe(123)
    expect(out[0].recipient_count).toBe(123)
  })

  it('two sends of the same words ten minutes apart stay two rows', () => {
    const out = groupSentRows([
      row({ id: 'a', created_at: '2026-09-18T12:37:00.000Z' }),
      row({ id: 'b', created_at: '2026-09-18T12:27:00.000Z' }),
    ])
    expect(out.map((g) => g.id)).toEqual(['a', 'b'])
    expect(out.every((g) => g.parts === 1)).toBe(true)
  })

  it('two admins sending the same words at once are two sends', () => {
    const out = groupSentRows([
      row({ id: 'a', sender_user_id: 'admin-1' }),
      row({ id: 'b', sender_user_id: 'admin-2', created_at: '2026-09-18T12:27:21.000Z' }),
    ])
    expect(out).toHaveLength(2)
  })
})

describe('recentAdminMessages — the count is the whole run, not the read window', () => {
  it('reads past one page so a 600-row loop send reports 600, not 500', async () => {
    const first = Date.parse('2026-09-18T12:00:00.000Z')
    DB.admin_messages = Array.from({ length: 600 }, (_, i) => ({
      id: `m${i}`,
      sender_user_id: 'admin',
      audience_kind: 'one',
      course_code: null,
      target_user_id: `u${i}`,
      title: 'Release note',
      body: 'Three things changed.',
      recipient_count: 1,
      created_at: new Date(first + i * 1000).toISOString(),
      sent_at: new Date(first + i * 1000).toISOString(),
    }))
    // One older, unrelated send, so the big group is closed by something after it.
    DB.admin_messages.push({
      id: 'old', sender_user_id: 'admin', audience_kind: 'all', course_code: null, target_user_id: null,
      title: 'Pod 1 is live', body: 'Have a listen.', recipient_count: 3,
      created_at: '2026-09-01T09:00:00.000Z', sent_at: '2026-09-01T09:00:00.000Z',
    })
    const out = await recentAdminMessages(svc())
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ parts: 600, recipient_count: 600, target_user_id: null })
    expect(out[1]).toMatchObject({ id: 'old', parts: 1, recipient_count: 3 })
  })
})
