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

vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })) }))

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
    learners: [{ id: 'learner-uuid-1', user_id: 'caller-1' }],
    player_events: [
      { user_id: 'learner-uuid-1', course_code: 'cym_for_eng', event_type: 'round_complete', occurred_at: recent(90), payload: { legoId: 'S0012L02' } },
      { user_id: 'learner-uuid-1', course_code: 'cym_for_eng', event_type: 'session_end', occurred_at: recent(30), payload: null },
      { user_id: 'learner-uuid-1', course_code: 'cym_for_eng', event_type: 'cold_start', occurred_at: recent(60 * 60), payload: null },
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
    expect(row.learner_id).toBe('learner-uuid-1')
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

describe('mergeEvents', () => {
  it('dedupes on occurred_at + event_type and orders by time', () => {
    const a = { event_type: 'x', occurred_at: '2026-09-12T10:00:00Z', payload: null }
    const b = { event_type: 'y', occurred_at: '2026-09-12T10:00:01Z', payload: null }
    expect(mergeEvents([b], [a, { ...b, payload: { dup: true } }]).map((e) => e.event_type)).toEqual(['x', 'y'])
  })
})
