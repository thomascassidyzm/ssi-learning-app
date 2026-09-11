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

let adminOk = false
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'caller-1' })),
  verifyAdmin: vi.fn(async () => (adminOk ? { userId: 'caller-1' } : { error: 'Forbidden', status: 403 })),
}))

let scope: any
let schoolReadScope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
  scopeForSchoolRead: vi.fn(async () => schoolReadScope),
  chunk: (arr: any[], size = 150) => {
    const out = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
  },
}))

let DB: { classes: any[]; schools: any[]; learner_speaking_opportunities: any[]; player_events: any[]; course_enrollments?: any[]; user_tags?: any[]; learners?: any[] }

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
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
  adminOk = false
  schoolReadScope = null
})

describe('GET /api/school/class-practice-7d — the SCHOOL HEADLINE rollup (job #265, 2026-09-11)', () => {
  it('rollup: minutes in the app this week count the class account AND staff own accounts once each; classes practising this week come off the enrollment cursor', async () => {
    // A teacher's own account: 15 minutes today. Tagged as school staff, so
    // the admin's node home counts her — and therefore so must this.
    DB.user_tags = [
      { tag_type: 'school', tag_value: 'SCHOOL:s1', user_id: 'uid-teacher', role_in_context: 'teacher', removed_at: null },
      { tag_type: 'class', tag_value: 'CLASS:c1', user_id: 'uid-l1', role_in_context: 'student', removed_at: null },
    ]
    DB.learners = [
      { id: 'teacher-learner', user_id: 'uid-teacher', display_name: 'Ms Jones' },
      { id: 'l1', user_id: 'uid-l1', display_name: 'Asha' },
    ]
    DB.player_events.push(...[0, 5, 10, 15].map((min) => ({ learner_id: 'teacher-learner', occurred_at: at(-min) })))
    // The class cursor bumped this week → c1 is a class practising this week.
    DB.course_enrollments = [{ learner_id: 'class-learner-1', last_practiced_at: at(-60) }]
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(200)
    // class account 1500s + student 600s + teacher 900s = 3000s = 50 min.
    // (The per-class figure stays students + class account: 2100s.)
    expect(res.body.rollup).toEqual({ windowDays: 7, classCount: 1, activeClasses7d: 1, inAppMinutes7d: 50 })
    expect(res.body.practiceByClass).toEqual({ c1: 2100 })
  })

  it('rollup is present, and zero, when the caller has no classes — never absent', async () => {
    scope.classIds = []
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.rollup).toEqual({ windowDays: 7, classCount: 0, activeClasses7d: 0, inAppMinutes7d: 0 })
  })

  it('admin passthrough: an ssi_admin with an EMPTY scope may read one school by ?school_id — View-as no longer renders zeros as if real', async () => {
    scope = { learnerId: 'admin-l', role: 'ssi_admin', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    schoolReadScope = { learnerId: null, role: 'ssi_admin', classIds: ['c1'], learnerIds: ['l1'], studentsByClass: { c1: ['l1'] }, schoolIds: ['s1'], groupId: null }
    adminOk = true
    const res = makeRes()
    await handler(makeReq({ school_id: 's1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.practiceByClass).toEqual({ c1: 2100 })
    expect(res.body.rollup.classCount).toBe(1)
  })

  it('admin passthrough refuses a non-admin with an empty scope, and never widens a staff caller\'s own scope', async () => {
    scope = { learnerId: 'x', role: 'student', classIds: [], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
    const res = makeRes()
    await handler(makeReq({ school_id: 's1' }), res)
    expect(res.statusCode).toBe(403)
    // A school_admin passing someone else's school_id still gets their own scope.
    scope = { learnerId: 'l1', role: 'school_admin', classIds: ['c1'], learnerIds: ['l1'], studentsByClass: { c1: ['l1'] }, schoolIds: ['s1'], groupId: null }
    schoolReadScope = { learnerId: null, role: 'ssi_admin', classIds: ['c-other'], learnerIds: [], studentsByClass: {}, schoolIds: ['s-other'], groupId: null }
    adminOk = true
    const res2 = makeRes()
    await handler(makeReq({ school_id: 's-other' }), res2)
    expect(res2.statusCode).toBe(200)
    expect(Object.keys(res2.body.practiceByClass)).toEqual(['c1'])
  })
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

  it('ACTIVE DAYS: the days a class practised on count the class account and its students together — a class with no pupil accounts still earns its days from the front', async () => {
    // Student today; the class account yesterday → two distinct days for c1.
    // A second class with NO students and only whole-class play earns its
    // day all the same — that is Ysgol Cas-gwent's shape (job #217).
    DB.classes.push({ id: 'c2', school_id: 's1', class_learner_id: 'class-learner-2' })
    DB.player_events.push({ learner_id: 'class-learner-2', occurred_at: at(-30) })
    scope.classIds = ['c1', 'c2']
    const res = makeRes()
    await handler(makeReq({}), res)
    expect(res.statusCode).toBe(200)
    // c1's expected days come from the fixture's own stamps (the class
    // account's hour of play yesterday can straddle UTC midnight).
    const c1Days = new Set(DB.player_events.filter((e) => e.learner_id !== 'class-learner-2').map((e) => String(e.occurred_at).slice(0, 10))).size
    expect(c1Days).toBeGreaterThanOrEqual(2)
    expect(res.body.activeDaysByClass).toEqual({ c1: c1Days, c2: 1 })
    expect(res.body.classPlayByClass.c2).toBe(0) // one clip is presence, not length
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
