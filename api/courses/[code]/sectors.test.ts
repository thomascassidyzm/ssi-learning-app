/**
 * Tests for the sector registry endpoint — the laws, not the plumbing.
 *
 * Three things must not drift: an empty list is a correct 200 (the shell ships
 * before the registrations do), a draft segment is never offered to a learner,
 * and the anchor is CONTENT in both languages or `null` — never a guess and
 * never a number.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let DB: Record<string, any[]>

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let single = false
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    order: () => builder,
    maybeSingle: () => { single = true; return builder },
    then: (resolve: any) =>
      Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

let handler: typeof import('./sectors').default

function makeRes(): VercelResponse & { statusCode?: number; body?: any; headers: Record<string, string> } {
  const res: any = { headers: {} }
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v; return res })
  return res
}

function makeReq(query: Record<string, any> = { code: 'spa_for_eng' }): VercelRequest {
  return { method: 'GET', query, headers: {} } as any
}

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./sectors')).default
  DB = {
    course_sectors: [
      {
        base_course_code: 'spa_for_eng',
        sector_slug: 'health',
        sector_course_code: 'spa_for_eng_health',
        roles: ['nurse', 'general', 'patient'],
        core_anchor_lego_id: 'S0042L03',
        status: 'live',
      },
      {
        base_course_code: 'spa_for_eng',
        sector_slug: 'trades',
        sector_course_code: 'spa_for_eng_trades',
        roles: null,
        core_anchor_lego_id: 'S9999L01',
        status: 'draft',
      },
    ],
    course_legos: [
      {
        course_code: 'spa_for_eng',
        lego_id: 'S0042L03',
        known_text: 'I wanted to speak to you',
        target_text: 'quería hablar contigo',
      },
    ],
  }
})

describe('GET /api/courses/:code/sectors', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' } as any, res)
    expect(res.statusCode).toBe(405)
  })

  it('an unknown course code answers 200 with an empty list, not a 404', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'no_such_course' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ sectors: [] })
  })

  it('a registered course with no rows answers the same empty list', async () => {
    DB.course_sectors = []
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.sectors).toEqual([])
  })

  it('offers only live segments by default — a draft has no content and must never reach a learner', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.sectors.map((s: any) => s.slug)).toEqual(['health'])
  })

  it('?include=draft also returns drafts, for QA', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng', include: 'draft' }), res)
    expect(res.body.sectors.map((s: any) => s.slug).sort()).toEqual(['health', 'trades'])
  })

  it('resolves the anchor to its own content in both languages', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.sectors[0].anchor).toEqual({
      legoId: 'S0042L03',
      known: 'I wanted to speak to you',
      target: 'quería hablar contigo',
    })
  })

  it('an unresolvable anchor is null, never a guess', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng', include: 'draft' }), res)
    const trades = res.body.sectors.find((s: any) => s.slug === 'trades')
    expect(trades.anchor).toBeNull()
  })

  it('scopes the anchor lookup to the base course — a same-id lego elsewhere never leaks in', async () => {
    DB.course_legos = [
      { course_code: 'fra_for_eng', lego_id: 'S0042L03', known_text: 'wrong', target_text: 'faux' },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.sectors[0].anchor).toBeNull()
  })

  it('puts general first in roles, and defaults to general when none are declared', async () => {
    const res = makeRes()
    await handler(makeReq({ code: 'spa_for_eng', include: 'draft' }), res)
    const health = res.body.sectors.find((s: any) => s.slug === 'health')
    const trades = res.body.sectors.find((s: any) => s.slug === 'trades')
    expect(health.roles[0]).toBe('general')
    expect(health.roles).toContain('nurse')
    expect(trades.roles).toEqual(['general'])
  })

  it('sets a short cache header like the courses catalogue', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.headers['Cache-Control']).toContain('max-age=300')
  })
})
