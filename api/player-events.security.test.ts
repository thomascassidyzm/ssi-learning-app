/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * /api/player-events is the largest UNAUTHENTICATED write surface in the API:
 * it takes a client batch and inserts it with the service-role key. This file
 * locks the input caps that hold and characterizes the ones that don't.
 *
 * Findings: INPUT-04 (cookie-spoofed attribution), INPUT-09 (unbounded
 * course_code / client_version).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const VICTIM_LEARNER_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

let inserted: any[] = []

vi.mock('./_utils/auth', () => ({
  // No bearer path is exercised here — every test posts anonymously, which is
  // exactly how the live player fires these events for guests.
  verifyAuthToken: () => Promise.resolve({ valid: false, error: 'no token' }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      insert: (rows: any[]) => {
        inserted.push(...rows)
        return Promise.resolve({ error: null })
      },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
    }),
  }),
}))

function makeRes() {
  const res: any = { _headers: {} }
  res.setHeader = vi.fn((k: string, v: string) => {
    res._headers[k] = v
    return res
  })
  res.status = vi.fn((code: number) => {
    res._status = code
    return res
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res
  })
  res.end = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any; _headers: Record<string, string> }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return {
    method: 'POST',
    query: {},
    headers: { host: 'saysomethingin.app' },
    cookies: {},
    body: {},
    ...overrides,
  } as VercelRequest
}

describe('POST /api/player-events — input handling', () => {
  let handler: typeof import('./player-events').default

  beforeEach(async () => {
    inserted = []
    vi.resetModules()
    handler = (await import('./player-events')).default
  })

  // ── Controls that HOLD ────────────────────────────────────────────────

  it('CONTROL: rejects a batch over the 50-event cap', async () => {
    const res = makeRes()
    const events = Array.from({ length: 51 }, () => ({ event_type: 'audio_play' }))
    await handler(makeReq({ body: { events } }), res)
    expect(res._status).toBe(400)
    expect(inserted).toHaveLength(0)
  })

  it('CONTROL: rejects a non-array events field instead of coercing it', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { events: { event_type: 'audio_play' } } }), res)
    expect(res._status).toBe(400)
  })

  it('CONTROL: truncates an oversized payload rather than storing it', async () => {
    const res = makeRes()
    const big = { blob: 'A'.repeat(9 * 1024) }
    await handler(makeReq({ body: { events: [{ event_type: 'audio_play', payload: big }] } }), res)
    expect(res._status).toBe(200)
    expect(inserted[0].payload).toEqual({ _truncated: true, _bytes: expect.any(Number) })
  })

  it('CONTROL: caps event_type at 64 characters', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { events: [{ event_type: 'x'.repeat(500) }] } }), res)
    expect(res._status).toBe(200)
    expect((inserted[0].event_type as string).length).toBe(64)
  })

  it('CONTROL: a non-uuid session_id is nulled, not written through', async () => {
    const res = makeRes()
    await handler(
      makeReq({ body: { events: [{ event_type: 'audio_play', session_id: "'; drop table--" }] } }),
      res,
    )
    expect(res._status).toBe(200)
    expect(inserted[0].session_id).toBeNull()
  })

  it('CONTROL: a __proto__ key in the payload does not pollute Object.prototype', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        body: { events: [{ event_type: 'audio_play', payload: JSON.parse('{"__proto__":{"polluted":true}}') }] },
      }),
      res,
    )
    expect(res._status).toBe(200)
    expect(({} as any).polluted).toBeUndefined()
  })

  it('CONTROL: env is derived from the Host header server-side, not from the body', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        headers: { host: 'staging.saysomethingin.app' },
        body: { events: [{ event_type: 'audio_play', env: 'production' }] },
      }),
      res,
    )
    expect(inserted[0].env).toBe('staging')
  })

  it('CONTROL: a guest cookie (non-uuid) attributes to null, not to a coerced value', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        cookies: { 'ssi-user-id': `guest-${VICTIM_LEARNER_ID}` },
        body: { events: [{ event_type: 'audio_play' }] },
      }),
      res,
    )
    expect(inserted[0].user_id).toBeNull()
    expect(inserted[0].learner_id).toBeNull()
  })

  // ── Findings ──────────────────────────────────────────────────────────

  // SECURITY FINDING INPUT-04: with no Authorization header, identity comes
  // from the client-set `ssi-user-id` cookie and is trusted after nothing more
  // than a uuid shape check (api/player-events.ts:111-112). Any unauthenticated
  // caller who knows (or brute-guesses) a learner uuid can write arbitrary
  // telemetry attributed to that learner, via a service-role insert — and
  // player_events feeds admin analytics, engaged-time and the attention lists.
  // What should happen instead: an event carrying an identity must present a
  // verified bearer; a cookie-only caller should be written as an anonymous
  // event (learner_id null) rather than as the named learner.
  it('INPUT-04: an unauthenticated caller attributes events to any learner uuid via cookie (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        cookies: { 'ssi-user-id': VICTIM_LEARNER_ID },
        body: { events: [{ event_type: 'audio_play', payload: { fabricated: true } }] },
      }),
      res,
    )

    expect(res._status).toBe(200)
    expect(inserted[0].user_id).toBe(VICTIM_LEARNER_ID)
    expect(inserted[0].learner_id).toBe(VICTIM_LEARNER_ID)
  })

  it.todo(
    'INPUT-04: without a verified bearer, player-events should insert learner_id=null rather than trusting the ssi-user-id cookie',
  )

  // SECURITY FINDING INPUT-09: `payload` is capped at 8 KB and `event_type` at
  // 64 chars, but `course_code` and `client_version` are passed straight
  // through (api/player-events.ts:186,189). 50 events × a multi-megabyte
  // string each is a cheap, unauthenticated way to write junk into the events
  // table. They should be shape-checked and sliced the same way event_type is.
  it('INPUT-09: course_code and client_version are stored unbounded (vulnerable, characterized)', async () => {
    const res = makeRes()
    const huge = 'z'.repeat(100_000)
    await handler(
      makeReq({ body: { events: [{ event_type: 'audio_play', course_code: huge, client_version: huge }] } }),
      res,
    )

    expect(res._status).toBe(200)
    expect((inserted[0].course_code as string).length).toBe(100_000)
    expect((inserted[0].client_version as string).length).toBe(100_000)
  })

  it.todo('INPUT-09: course_code and client_version should be type-checked and length-capped before insert')

  // SECURITY FINDING INPUT-09b: neither field is type-checked either, so a
  // non-string value reaches the insert and is rejected by Postgres — a
  // guaranteed 500 from unauthenticated input. The row builder should coerce
  // or drop, exactly as it already does for occurred_at and session_id.
  it('INPUT-09b: a non-string course_code reaches the insert payload untyped (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(
      makeReq({ body: { events: [{ event_type: 'audio_play', course_code: { evil: 1 } as any }] } }),
      res,
    )

    expect(res._status).toBe(200)
    expect(inserted[0].course_code).toEqual({ evil: 1 })
  })

  it.todo('INPUT-09b: course_code should be dropped to null when it is not a string')
})
