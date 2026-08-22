/**
 * SEC22-03 / SEC22-04 — api/admin/vad-prosody.ts, the endpoint added since the
 * 2026-08-11 audit ran and therefore never covered by it.
 *
 * Audit 2026-08-22 (branch security/audit-2026-08-22).
 *
 * The endpoint's core posture is RIGHT, and the first two tests lock that:
 * it is `verifyAdmin`-gated, and it exists precisely BECAUSE `player_events` is
 * own-row under RLS for admins too — it is the server-mediated door the RLS
 * doctrine in CLAUDE.md calls for, not a way around RLS. Two residues:
 *
 *   SEC22-03 (low, info-disclosure): the 500 handler returns the caught error's
 *   own `.message` to the client. Everywhere else on this surface returns a
 *   fixed string (`api/board/snapshot/[code].ts`: 'Internal server error';
 *   `api/billing/bind-customer.ts`: 'Could not prepare checkout') and logs the
 *   detail server-side. A PostgREST/Postgres error message can carry column
 *   names, relation names and constraint text. Reachable only by an
 *   authenticated ssi_admin, so the confidentiality impact is ~nil — it is
 *   filed as a CONVENTION divergence on a young endpoint, cheapest to correct
 *   now, before it is copied by the next endpoint that pattern-matches on it.
 *
 *   SEC22-04 (low, resource amplification): one request may issue up to 100
 *   sequential 1000-row reads (MAX_EVENTS / PAGE) and hold up to 100_000 rows
 *   in memory before folding, with no cache and no caller-supplied bound. The
 *   cap is honest — `truncated` is returned, never a silent truncation, which
 *   is the good half. But the work is unbounded by the caller and the function
 *   carries no `maxDuration` override in vercel.json, so it takes the platform
 *   default. Admin-only, hence low; recorded so that if this endpoint is ever
 *   widened past ssi_admin, the amplification is already on the record.
 *
 * TEST CONVENTION (docs/security-audit-2026-08-11/README.md): findings are
 * CHARACTERIZATION tests asserting today's behaviour — they pass now and go red
 * when fixed, which is the signal the finding is closed. Controls that hold are
 * ordinary passing tests.
 *
 * No network and no database: the Supabase client and the auth helper are both
 * mocked, so this exercises the handler's own control flow only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const verifyAdmin = vi.fn()
vi.mock('../_utils/auth', () => ({ verifyAdmin: (...a: unknown[]) => verifyAdmin(...a) }))

/** Supabase stub whose paged `.range()` read is programmable per test. */
let rangeImpl: () => Promise<{ data: unknown[] | null; error: unknown }>
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({ range: () => rangeImpl() }),
        }),
      }),
    }),
  }),
}))

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this },
    json(payload: unknown) { this.body = payload; return this },
  }
  return res
}

const req = (over: Record<string, unknown> = {}) =>
  ({ method: 'GET', headers: {}, query: {}, ...over }) as never

async function handler() {
  return (await import('./vad-prosody')).default
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests'
  rangeImpl = async () => ({ data: [], error: null })
  // The handler reads the service key at MODULE LOAD, so each test needs a
  // fresh evaluation against the env it just set — otherwise the fail-closed
  // test below leaves an empty-key module cached for everyone after it.
  vi.resetModules()
})

describe('vad-prosody: the admin gate (control — must keep holding)', () => {
  it('rejects an unauthenticated caller with verifyAdmin\'s own status', async () => {
    verifyAdmin.mockResolvedValue({ error: 'Unauthorized', status: 401 })
    const res = mockRes()

    await (await handler())(req(), res as never)

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ error: 'Unauthorized' })
  })

  // The load-bearing one: a VALID but non-admin session must not read another
  // learner's telemetry. This endpoint holds the service role, so the gate is
  // the only thing between an ordinary learner and everyone's prosody rows.
  it('rejects a valid non-admin session with 403 and reads nothing', async () => {
    verifyAdmin.mockResolvedValue({ error: 'Requires SSi admin access', status: 403, userId: 'u1' })
    const reads = vi.fn(async () => ({ data: [], error: null }))
    rangeImpl = reads
    const res = mockRes()

    await (await handler())(req(), res as never)

    expect(res.statusCode).toBe(403)
    expect(reads).not.toHaveBeenCalled()
  })

  it('rejects non-GET methods before authenticating', async () => {
    const res = mockRes()

    await (await handler())(req({ method: 'POST' }), res as never)

    expect(res.statusCode).toBe(405)
    expect(verifyAdmin).not.toHaveBeenCalled()
  })

  it('fails closed when the service key is absent rather than reading unprivileged', async () => {
    verifyAdmin.mockResolvedValue({ userId: 'admin-1' })
    process.env.SUPABASE_SERVICE_ROLE_KEY = ''
    vi.resetModules()
    const res = mockRes()

    await (await handler())(req(), res as never)

    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Server misconfigured' })
  })
})

describe('SEC22-03: the 500 body carries the internal error message', () => {
  // SECURITY FINDING SEC22-03: characterization — asserts the leak as it is
  // today. Fixing it (return a fixed string, log the detail) turns this red.
  it('CHARACTERIZATION: a database error\'s own text is returned to the caller', async () => {
    verifyAdmin.mockResolvedValue({ userId: 'admin-1' })
    rangeImpl = async () => ({
      data: null,
      error: new Error('relation "player_events" does not exist — column payload->>peakEnergyDb'),
    })
    const res = mockRes()

    await (await handler())(req(), res as never)

    expect(res.statusCode).toBe(500)
    // The internal detail crosses the wire verbatim.
    expect((res.body as { error: string }).error).toContain('relation "player_events" does not exist')
  })

  it.todo(
    'SECURE: the 500 body is a fixed string and the detail is logged server-side only, as api/board/snapshot/[code].ts does',
  )

  // The convention this diverges from, pinned to a live example so the todo
  // above has something concrete to be measured against.
  it('the convention it diverges from: board/snapshot returns a fixed 500 string', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const snapshot = readFileSync(resolve(here, '../board/snapshot/[code].ts'), 'utf8')

    expect(snapshot).toContain("res.status(500).json({ error: 'Internal server error' })")
  })
})

describe('SEC22-04: unbounded server work per request', () => {
  // SECURITY FINDING SEC22-04: characterization of the amplification bound.
  it('CHARACTERIZATION: one request may issue 100 sequential reads of 1000 rows', async () => {
    verifyAdmin.mockResolvedValue({ userId: 'admin-1' })
    let calls = 0
    // Always return a FULL page, so the loop never short-circuits and runs to
    // its cap — the worst case a single caller can provoke.
    rangeImpl = async () => {
      calls++
      return { data: Array.from({ length: 1000 }, () => ({ user_id: 'L1' })), error: null }
    }
    const res = mockRes()

    await (await handler())(req(), res as never)

    expect(calls).toBe(100)
    expect(res.statusCode).toBe(200)
    expect((res.body as { events: number }).events).toBe(100_000)
  })

  it.todo(
    'SECURE: the aggregate is bounded by a caller-independent budget (cached rollup, or a DB-side aggregate) rather than 100 round trips per request',
  )

  // The good half of the current design, locked: the cap is never silent.
  it('reports truncation rather than silently capping (control — must keep holding)', async () => {
    verifyAdmin.mockResolvedValue({ userId: 'admin-1' })
    rangeImpl = async () => ({
      data: Array.from({ length: 1000 }, () => ({ user_id: 'L1' })),
      error: null,
    })
    const res = mockRes()

    await (await handler())(req(), res as never)

    expect((res.body as { truncated: boolean }).truncated).toBe(true)
  })

  // AGGREGATES ONLY is a stated security property of this endpoint (the 128-point
  // envelope contour must never cross the wire). Lock the projection that
  // enforces it: the select asks for a scalar peakCount, never `payload->envelope`.
  it('never selects the raw envelope contour — aggregates only (control)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(resolve(here, 'vad-prosody.ts'), 'utf8')

    expect(src).toContain("'payload->envelope->>peakCount'")
    expect(src).not.toContain("'payload->>envelope'")
    expect(src).not.toMatch(/select\(\s*'\*'\s*\)/)
  })
})
