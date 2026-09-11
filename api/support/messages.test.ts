/**
 * POST /api/support/messages — the admin-only gate is server-side, and the
 * envelope is built from the caller's RESOLVED scope, never from the body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, TEACHER_SCOPE, ADMIN_SCOPE, LEADER_SCOPE, type DB } from './_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })) }))
let scope: any
vi.mock('../_utils/schoolScope', () => ({ resolveVisibleScope: vi.fn(async () => scope) }))
vi.mock('../_utils/classPractice', () => ({
  CLASS_PRACTICE_WINDOW_DAYS: 7,
  practisedSince: () => false,
  loadClassPractice: vi.fn(async (_svc: unknown, classes: Array<{ id: string }>) => new Map(classes.map((c) => [c.id, { phrases: 0, lastPractisedAt: null, phraseCounts: new Map(), phraseTimes: [] }]))),
}))

let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let handler: typeof import('./messages').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./messages')).default
  DB = {
    learners: [{ user_id: 'caller-1', display_name: 'Angharad Jones' }],
    schools: [
      { id: 's1', school_name: 'Ysgol Cas-gwent', region_code: 'WAL', platform_status: 'trial', trial_course_code: 'spa_for_eng', trial_kind: 'free_1yr' },
      { id: 's9', school_name: 'Somebody Else', region_code: 'ENG', platform_status: 'active', trial_course_code: null, trial_kind: null },
    ],
    school_summary: [
      { school_id: 's1', total_practice_hours: 1.74, staff_practice_hours: 1.74, student_count: 0, teacher_count: 3, class_count: 34 },
      { school_id: 's9', total_practice_hours: 99, staff_practice_hours: 0, student_count: 400, teacher_count: 20, class_count: 12 },
    ],
    classes: [{ id: 'c1', school_id: 's1', is_active: true, class_learner_id: 'cl1' }],
    support_threads: [],
    support_messages: [],
  }
  scope = ADMIN_SCOPE
})

describe('POST /api/support/messages', () => {
  it('refuses a plain class teacher with 403 and writes nothing', async () => {
    scope = TEACHER_SCOPE
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'How do I remove a TA?' } }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.support_messages).toHaveLength(0)
    expect(DB.support_threads).toHaveLength(0)
  })

  it('writes the admin\'s row on her school\'s thread, created on first use', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'This says 0 hours but three classes have been on it all week.' } }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.support_threads).toHaveLength(1)
    expect(DB.support_threads[0].school_id).toBe('s1')
    const row = DB.support_messages[0]
    expect(row.direction).toBe('in')
    expect(row.author_source).toBe('human')
    expect(row.author_name).toBe('Angharad Jones')
    expect(row.author_via).toBe('jwt')
    expect(row.answered_at).toBeUndefined()
    expect(res.body.thread_id).toBe(DB.support_threads[0].id)
    expect(res.body.message.body).toContain('0 hours')
  })

  it('assembles the envelope from the RESOLVED scope, ignoring any school the body claims', async () => {
    const res = makeRes()
    await handler(makeReq({
      method: 'POST',
      body: {
        text: 'help',
        school_id: 's9',
        envelope: { server: { school: { id: 's9' } } },
        anchor: 'node-stats',
        displayed_label: 'Minutes in the app this week',
        displayed_value: '0',
        route: '/org/abc',
        build_version: '1234',
        device_info: { userAgent: 'iPad', screen: '1024x768', extra: 'smuggled' },
      },
    }), res)
    expect(res.statusCode).toBe(200)
    const env = DB.support_messages[0].envelope
    expect(env.server.school.id).toBe('s1')
    expect(env.server.school.name).toBe('Ysgol Cas-gwent')
    expect(env.server.summary.total_practice_hours).toBe(1.74)
    expect(env.server.summary.class_count).toBe(34)
    expect(env.server.class_practice).toEqual({ window_days: 7, class_count: 1, active_classes: 0, phrases: 0 })
    expect(env.server.role).toBe('school_admin')
    // The client half carries the tile, the displayed value and the device — and only those.
    expect(env.client).toEqual({
      anchor: 'node-stats',
      displayed_label: 'Minutes in the app this week',
      displayed_value: '0',
      route: '/org/abc',
      build_version: '1234',
      device_info: { userAgent: 'iPad', screen: '1024x768', language: undefined },
    })
    expect(JSON.stringify(env)).not.toContain('s9')
    expect(JSON.stringify(env)).not.toContain('smuggled')
  })

  it('an org leader writes on the org\'s thread, keyed by group', async () => {
    scope = LEADER_SCOPE
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'Can we add Welsh next term?' } }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.support_threads[0]).toMatchObject({ group_id: 'g1' })
    expect(DB.support_threads[0].school_id).toBeUndefined()
    expect(DB.support_messages[0].envelope.server).toMatchObject({ role: 'govt_admin', group: { id: 'g1', school_count: 2 } })
  })

  it('rejects an empty message', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: '   ' } }), res)
    expect(res.statusCode).toBe(400)
    expect(DB.support_messages).toHaveLength(0)
  })
})
