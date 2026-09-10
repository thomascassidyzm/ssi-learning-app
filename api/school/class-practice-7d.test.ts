/**
 * Tests for GET /api/school/class-practice-7d, focused on the coverage gate
 * (archive/docs-retired-2026-08-24/schools/group-commercial-model.md, "Server-side enforcement of (4)").
 * resolveVisibleScope is mocked. Also the IN-APP TIME PIN: the time figure is
 * sessionised diary time (api/_utils/inAppTime.ts), never audio-played seconds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
  chunk: (arr: any[], size = 150) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  },
}))

let DB: { classes: any[]; schools: any[]; learner_speaking_opportunities: any[]; player_events: any[] }

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    gte: (col: string, v: string) => { rows = rows.filter((r) => r[col] === undefined || String(r[col]) >= v); return builder },
    order: (col: string, opts?: { ascending?: boolean }) => {
      const asc = (opts?.ascending ?? true) !== false
      rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
      return builder
    },
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return builder },
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

/** ISO stamp `min` minutes from now (negative = ago). */
const at = (min: number) => new Date(Date.now() + min * 60000).toISOString()

function makeReq(query: Record<string, string>): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.setHeader = vi.fn()
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./class-practice-7d').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./class-practice-7d')).default
  DB = {
    classes: [{ id: 'c1', school_id: 's1', class_learner_id: 'class-learner-1' }],
    // A LIVE trial has a real end date. (Before 2026-09-09 this fixture had
    // none and still counted as live — the "no end date means forever" hole.)
    schools: [{ id: 's1', platform_status: 'trial', platform_expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString() }],
    learner_speaking_opportunities: [{ learner_id: 'l1', play_seconds: 120 }],
    // THE DIARY. Student l1: one 10-minute lesson today with a clip every few
    // minutes — 120s of audio inside 600s in the app. The CLASS's own account:
    // a 20-minute whole-class lesson yesterday, then a 40-minute silence, then
    // 5 more minutes — two blocks, 25 min, the silence not counted.
    player_events: [
      ...[0, 3, 7, 10].map((min) => ({ learner_id: 'l1', occurred_at: at(-min) })),
      ...[0, 5, 10, 15, 20, 60, 65].map((min) => ({ learner_id: 'class-learner-1', occurred_at: at(-1440 - 65 + min) })),
    ],
  }
  scope = {
    learnerId: 'l1', role: 'school_admin', classIds: ['c1'], learnerIds: ['l1'],
    studentsByClass: { c1: ['l1'] }, schoolIds: ['s1'], groupId: null,
  }
})

describe('GET /api/school/class-practice-7d — IN-APP TIME (founder ruling 2026-09-10)', () => {
  it('IN-APP TIME PIN: the headline is time in the app including the gaps, whole-class play counted once; audio-played rides beside it', async () => {
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    // Student: 600s in the app. Class account: 1200s + 300s, the 40-minute
    // silence between them not counted. Never 120 (audio played), never the
    // class account's sessions.duration_seconds.
    expect(res.body.practiceByClass).toEqual({ c1: 2100 })
    expect(res.body.classPlayByClass).toEqual({ c1: 1500 })
    expect(res.body.audioPlayedByClass).toEqual({ c1: 120 })
    expect(res.body.metric).toBe('in_app_session_time')
    expect(res.body.idleCutoffSeconds).toBe(300)
  })
})

describe('GET /api/school/class-practice-7d — coverage gate', () => {
  it('returns practice data as normal while the school is on a live trial', async () => {
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.practiceByClass).toEqual({ c1: 2100 })
  })

  it('403s coverage_expired once the school\'s coverage has lapsed', async () => {
    DB.schools[0].platform_status = 'expired'
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('coverage_expired')
  })

  it('is never gated for a govt_admin scope — group rollups stay intact', async () => {
    DB.schools[0].platform_status = 'expired'
    scope = { ...scope, role: 'govt_admin', schoolIds: ['s1'] }
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.practiceByClass).toEqual({ c1: 2100 })
  })

  it('a teacher spanning two schools only loses the expired school\'s classes', async () => {
    DB.classes.push({ id: 'c2', school_id: 's2' })
    DB.schools.push({ id: 's2', platform_status: 'expired', platform_expires_at: null })
    DB.learner_speaking_opportunities.push({ learner_id: 'l2', play_seconds: 60 })
    DB.player_events.push({ learner_id: 'l2', occurred_at: at(-4) }, { learner_id: 'l2', occurred_at: at(-1) })
    scope = {
      learnerId: 'l1', role: 'teacher', classIds: ['c1', 'c2'], learnerIds: ['l1', 'l2'],
      studentsByClass: { c1: ['l1'], c2: ['l2'] }, schoolIds: [], groupId: null,
    }
    const req = makeReq({})
    const res = makeRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body.practiceByClass).toEqual({ c1: 2100 })
  })
})
