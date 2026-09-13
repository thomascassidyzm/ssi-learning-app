/**
 * THE ENTITLEMENT GATE RUNS BEFORE ANY CONTENT READ
 * (Astra refutation sec-E, re-checked and confirmed 2026-09-13).
 *
 * The handler used to fire the bounded content RPC and the course-wide
 * round-map read in the same Promise.all as the pricing lookup, and only THEN
 * resolve the caller's access. An anonymous or lapsed caller asking for a
 * LEGO past the free preview got a 403 — but only after the database had
 * already done the paid work, and after two content-shaped 404s ("Course not
 * found" / "LEGO not in round map") had told them whether the id existed.
 *
 * Now the order is: pricing row → access → content. These tests mock the
 * Supabase client and assert that a refused caller never reaches `rpc()` or
 * the round-map table, while an entitled caller still does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let accessResult: any
vi.mock('../../_utils/courseAccess', () => ({
  resolveServerCourseAccess: vi.fn(async () => accessResult),
}))

const rpc = vi.fn(async () => ({ data: { course: null, rounds: [] }, error: null }))
const tablesRead: string[] = []

function makeQueryBuilder(table: string) {
  tablesRead.push(table)
  const builder: any = {}
  for (const m of ['select', 'eq', 'in', 'order', 'gt', 'gte', 'lte', 'not', 'is']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => {
    if (table === 'courses') {
      return { data: { target_lang: 'es', pricing_tier: 'premium', is_community: false }, error: null }
    }
    return { data: null, error: null }
  })
  builder.then = (resolve: any) => resolve({ data: [], error: null })
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc,
    from: (table: string) => makeQueryBuilder(table),
  }),
}))

let handler: typeof import('./cycles').default

function makeReq(from: string): VercelRequest {
  return {
    method: 'GET',
    query: { code: 'spa_for_eng', from },
    headers: {},
    url: `/api/courses/spa_for_eng/cycles?from=${from}`,
  } as unknown as VercelRequest
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, string>,
    setHeader: vi.fn((k: string, v: string) => { res.headers[k] = v }),
    getHeader: vi.fn((k: string) => res.headers[k]),
    status: vi.fn((c: number) => { res.statusCode = c; return res }),
    json: vi.fn((b: any) => { res.body = b; return res }),
    end: vi.fn(() => res),
  }
  return res as VercelResponse & { statusCode: number; body: any }
}

beforeEach(async () => {
  vi.resetModules()
  rpc.mockClear()
  tablesRead.length = 0
  handler = (await import('./cycles')).default
})

describe('cycles — refused callers never reach the content RPC', () => {
  it('anonymous on a premium course, asking past the preview window: 403 before any content read', async () => {
    accessResult = { canAccess: false, canPreview: true, previewMaxSeed: 19, reason: 'subscription_required' }
    const res = makeRes()
    await handler(makeReq('S0100L01'), res)

    expect(res.statusCode).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
    expect(tablesRead).not.toContain('course_round_index')
  })

  it('a course with no preview at all: 403 before any content read', async () => {
    accessResult = { canAccess: false, canPreview: false, previewMaxSeed: null, reason: 'subscription_required' }
    const res = makeRes()
    await handler(makeReq('S0001L01'), res)

    expect(res.statusCode).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
    expect(tablesRead).not.toContain('course_round_index')
  })

  it('an entitled caller still reaches the content RPC', async () => {
    accessResult = { canAccess: true, canPreview: true, previewMaxSeed: null, reason: 'subscribed' }
    const res = makeRes()
    await handler(makeReq('S0100L01'), res)

    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
