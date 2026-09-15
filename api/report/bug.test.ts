/**
 * POST /api/report/bug — the postbox rejects an empty report, resolves the
 * learner from the bearer alone, and assembles the server half itself: the
 * deployment env and the last five minutes of player_events merged with the
 * client's unflushed buffer. Red before the route existed, green after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeChainable, makeReq, makeRes, type DB } from '../support/_testkit'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
delete process.env.VERCEL_ENV

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1', email: 'gwen@example.com' })) }))
// Scope is that function's own responsibility; here it stands in for a school admin of sch-1.
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => ({ learnerId: '0f8a3c2e-6b1d-4c5a-9e7f-1a2b3c4d5e6f', role: 'school_admin', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: ['sch-1'], groupId: null })),
  schoolIdForStaffMember: vi.fn(async () => null),
}))

let DB: DB
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (t: string) => makeChainable(DB, t) }) }))

let handler: typeof import('./bug').default
let mergeEvents: typeof import('./bug').mergeEvents

const recent = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString()

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('./bug')
  handler = mod.default
  mergeEvents = mod.mergeEvents
  DB = {
    learners: [{ id: '0f8a3c2e-6b1d-4c5a-9e7f-1a2b3c4d5e6f', user_id: 'caller-1', platform_role: null, educational_role: 'school_admin' }],
    player_events: [
      { user_id: '0f8a3c2e-6b1d-4c5a-9e7f-1a2b3c4d5e6f', course_code: 'cym_for_eng', event_type: 'round_complete', occurred_at: recent(90), payload: { legoId: 'S0012L02' } },
      { user_id: '0f8a3c2e-6b1d-4c5a-9e7f-1a2b3c4d5e6f', course_code: 'cym_for_eng', event_type: 'session_end', occurred_at: recent(30), payload: null },
      { user_id: '0f8a3c2e-6b1d-4c5a-9e7f-1a2b3c4d5e6f', course_code: 'cym_for_eng', event_type: 'cold_start', occurred_at: recent(60 * 60), payload: null },
      { user_id: 'someone-else', course_code: 'cym_for_eng', event_type: 'round_complete', occurred_at: recent(10), payload: null },
    ],
    bug_reports: [],
  }
})

describe('POST /api/report/bug', () => {
  it('rejects an empty report and writes nothing', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: '   ' } }), res)
    expect(res.statusCode).toBe(400)
    expect(DB.bug_reports).toHaveLength(0)
  })

  it('stores the learner resolved from the bearer and the server-assembled fields', async () => {
    const res = makeRes()
    const req = makeReq({
      method: 'POST',
      body: {
        text: 'I finished a session and came back at the start of White belt.',
        course_code: 'cym_for_eng',
        learner_id: 'attacker-claims-this',
        position: { lego_id: 'S0012L02', known_text: 'I want to learn', target_text: 'dw i eisiau dysgu', belt: 'Yellow', extra: 'dropped' },
        device: { user_agent: 'Mozilla/5.0 (iPhone)', platform: 'iPhone', viewport: '390x844', online: true, standalone: true },
        app_version: 'abc1234 dev',
        app_shell: 'web',
        route: '/',
        recent_events: [
          { event_type: 'session_end', occurred_at: DB.player_events[1].occurred_at, payload: null },
          { event_type: 'tap_pause', occurred_at: recent(5), payload: { where: 'player' } },
        ],
      },
    })
    req.headers.host = 'staging.saysomethingin.app'
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(DB.bug_reports).toHaveLength(1)
    const row = DB.bug_reports[0]
    expect(row.learner_id).toBe('0f8a3c2e-6b1d-4c5a-9e7f-1a2b3c4d5e6f')
    expect(row.auth_user_id).toBe('caller-1')
    expect(row.deployment_env).toBe('staging')
    expect(row.position).toEqual({ lego_id: 'S0012L02', known_text: 'I want to learn', target_text: 'dw i eisiau dysgu', belt: 'Yellow' })
    expect(row.posted_at).toBeUndefined()
    // Server pulled this learner's last five minutes (not the hour-old row, not
    // someone else's), the duplicate session_end was not doubled, and the
    // client's unflushed tap_pause was kept.
    const types = row.recent_events.map((e: { event_type: string }) => e.event_type)
    expect(types).toEqual(['round_complete', 'session_end', 'tap_pause'])
  })

  it('lets a guest report with no bearer and no learner', async () => {
    const res = makeRes()
    const req = makeReq({ method: 'POST', body: { text: 'audio stopped', recent_events: [{ event_type: 'audio_error', occurred_at: recent(3), payload: null }] } })
    delete (req.headers as Record<string, unknown>).authorization
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(DB.bug_reports).toHaveLength(1)
    expect(DB.bug_reports[0].learner_id).toBeNull()
    expect(DB.bug_reports[0].auth_user_id).toBeNull()
    expect(DB.bug_reports[0].recent_events.map((e: { event_type: string }) => e.event_type)).toEqual(['audio_error'])
  })
})

describe('POST /api/report/bug — the schools dashboard door (job #633)', () => {
  it('stores source schools_dashboard with the dashboard context, keeping only the known keys', async () => {
    const res = makeRes()
    const req = makeReq({
      method: 'POST',
      body: {
        text: 'The Students page shows 0 students but my class has 12.',
        source: 'schools_dashboard',
        route: '/schools/students',
        context: { role: 'school_admin', school_id: 'sch-1', school_name: 'Seaside', class_id: 'c-9', page_title: 'Students', secret: 'dropped' },
      },
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const row = DB.bug_reports[0]
    expect(row.source).toBe('schools_dashboard')
    expect(row.route).toBe('/schools/students')
    expect(row.context).toEqual({ role: 'school_admin', school_id: 'sch-1', school_name: 'Seaside', class_id: 'c-9', page_title: 'Students' })
  })

  it('stores source tester_widget for the floating tester widget, with no context (job #652)', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: '[Bug] choose your course not scrolling', source: 'tester_widget', route: '/' } }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.bug_reports[0].source).toBe('tester_widget')
    expect(DB.bug_reports[0].context).toBeNull()
  })

  it('stores source content_flag with the clip named, so the content team can find it (job #677)', async () => {
    const res = makeRes()
    const req = makeReq({
      method: 'POST',
      body: {
        text: 'Flagged: "I want to learn" / "dw i eisiau dysgu"',
        source: 'content_flag',
        course_code: 'cym_for_eng',
        context: { audio_id: 'aud-1', lego_id: 'S0012L02', seed_id: 'S0012', known_text: 'I want to learn', target_text: 'dw i eisiau dysgu', role: 'dropped' },
      },
    })
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const row = DB.bug_reports[0]
    expect(row.source).toBe('content_flag')
    expect(row.context).toEqual({ audio_id: 'aud-1', lego_id: 'S0012L02', seed_id: 'S0012', known_text: 'I want to learn', target_text: 'dw i eisiau dysgu' })
  })

  it('stamps who sent it, from the bearer and the learner row, never the client (job #677)', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'the class list is empty', reporter_email: 'spoof@example.com', account_code: 'ZZZZ-ZZZZ' } }), res)
    expect(res.statusCode).toBe(200)
    const row = DB.bug_reports[0]
    expect(row.reporter_email).toBe('gwen@example.com')
    expect(row.account_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(row.educational_role).toBe('school_admin')
    expect(row.school_role).toBe('school_admin')
    expect(row.school_id).toBe('sch-1')
    expect(row.platform_role).toBeNull()
  })

  it('a player report is source learner with no context, whatever the client sends', async () => {
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'audio stopped', source: 'made-up', context: { school_id: 'x' } } }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.bug_reports[0].source).toBe('learner')
    expect(DB.bug_reports[0].context).toBeNull()
  })

  it('refuses a view-as session and writes nothing', async () => {
    const res = makeRes()
    const req = makeReq({ method: 'POST', body: { text: 'raised while viewing as', source: 'schools_dashboard' } })
    ;(req.headers as Record<string, string>)['x-ssi-view-as'] = '1'
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(DB.bug_reports).toHaveLength(0)
  })

  it('throttles a signed-in caller past ten reports an hour', async () => {
    for (let i = 0; i < 10; i++) {
      DB.bug_reports.push({ id: `old-${i}`, auth_user_id: 'caller-1', created_at: recent(600 + i) })
    }
    // Someone else's rows and this caller's stale rows do not count.
    DB.bug_reports.push({ id: 'other', auth_user_id: 'someone-else', created_at: recent(10) })
    DB.bug_reports.push({ id: 'stale', auth_user_id: 'caller-1', created_at: recent(2 * 60 * 60) })
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'eleventh' } }), res)
    expect(res.statusCode).toBe(429)
    expect(DB.bug_reports.map((r) => r.body)).not.toContain('eleventh')
  })

  it('lets a signed-in caller through under the throttle', async () => {
    for (let i = 0; i < 9; i++) {
      DB.bug_reports.push({ id: `old-${i}`, auth_user_id: 'caller-1', created_at: recent(600 + i) })
    }
    const res = makeRes()
    await handler(makeReq({ method: 'POST', body: { text: 'tenth' } }), res)
    expect(res.statusCode).toBe(200)
  })
})

describe('mergeEvents', () => {
  it('dedupes on occurred_at + event_type and orders by time', () => {
    const a = { event_type: 'x', occurred_at: '2026-09-12T10:00:00Z', payload: null }
    const b = { event_type: 'y', occurred_at: '2026-09-12T10:00:01Z', payload: null }
    expect(mergeEvents([b], [a, { ...b, payload: { dup: true } }]).map((e) => e.event_type)).toEqual(['x', 'y'])
  })
})
