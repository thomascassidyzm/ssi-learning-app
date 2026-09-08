/**
 * GET /api/org/funder-export — the endpoint, and what must never leave in it.
 *
 * The arithmetic is tested in api/_utils/orgFunderExport.test.ts. These tests
 * are about the things only the endpoint can get wrong: who may pull it, which
 * groups it gathers, whether a person enrolled twice is counted twice, and
 * whether anything identifiable ends up in the file that goes to the funder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let caller: { userId: string; isAdmin: boolean; ownGroupId: string | null } | null
let canSee = true
vi.mock('../_utils/groupTreeAuth', () => ({
  resolveGroupTreeCaller: vi.fn(async (_req: any, res: any) => {
    if (!caller) {
      res.status(403).json({ error: 'You do not govern any group' })
      return null
    }
    return caller
  }),
  callerCanSeeGroup: vi.fn(async () => canSee),
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>

function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    in(c: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[c])); return b },
    is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return b },
    gte(c: string, v: any) { rows = rows.filter((r) => r[c] >= v); return b },
    lte(c: string, v: any) { rows = rows.filter((r) => r[c] <= v); return b },
    order(c: string) { rows = [...rows].sort((x, y) => (x[c] < y[c] ? -1 : 1)); return b },
    range(from: number, to: number) { rows = rows.slice(from, to + 1); return b },
    async maybeSingle() { return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return Promise.resolve({ data: rows, error: null }).then(f, r) },
  }
  return b
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => makeChainable(t) }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any; headers: Record<string, string> } {
  const res: any = { headers: {} }
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  res.send = vi.fn((b: any) => { res.body = b; return res })
  res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v })
  return res
}
const get = (query: Record<string, string>): VercelRequest =>
  ({ method: 'GET', query, headers: { authorization: 'Bearer t' } }) as any

let handler: typeof import('./funder-export').default

const L1 = '11111111-1111-4111-8111-111111111111'
const L2 = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./funder-export')).default
  caller = { userId: 'admin-1', isAdmin: true, ownGroupId: null }
  canSee = true
  DB = {
    groups: [{ id: 'g-org', name: 'Dysgu Cymraeg', type: 'organisation', parent_id: null, path: 'dysgu-cymraeg', is_demo: false, is_test: false, created_at: '2026-01-01' }],
    org_enrolment_policies: [{
      group_id: 'g-org', org_display_name: 'Dysgu Cymraeg',
      course_family_map: { cym_s_for_eng: 'welsh_south', cym_n_for_eng: 'welsh_north' },
    }],
    org_enrolments: [],
    learner_speaking_opportunities: [],
  }
})

describe('who may pull it', () => {
  it('refuses a caller who governs no group', async () => {
    caller = null
    const res = makeRes()
    await handler(get({ groupId: 'g-org' }), res)
    expect(res.statusCode).toBe(403)
  })

  it("refuses a leader asking about somebody else's org", async () => {
    caller = { userId: 'leader-x', isAdmin: false, ownGroupId: 'g-other' }
    canSee = false
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    expect(res.statusCode).toBe(403)
  })

  it('requires a groupId rather than defaulting to the whole estate', async () => {
    const res = makeRes()
    await handler(get({}), res)
    expect(res.statusCode).toBe(400)
  })
})

describe('the numbers', () => {
  beforeEach(() => {
    DB.org_enrolments.push(
      { learner_id: L1, group_id: 'g-org', enrolled_at: '2026-09-01T09:00:00Z', reporting_from: '2026-09-01', age_band_16_24: true },
      { learner_id: L2, group_id: 'g-org', enrolled_at: '2026-09-04T09:00:00Z', reporting_from: '2026-09-04', age_band_16_24: false },
    )
    DB.learner_speaking_opportunities.push(
      { learner_id: L1, course_code: 'cym_s_for_eng', day: '2026-09-10', play_seconds: 3600 },
      { learner_id: L1, course_code: 'cym_n_for_eng', day: '2026-09-11', play_seconds: 1800 },
      { learner_id: L2, course_code: 'cym_s_for_eng', day: '2026-09-12', play_seconds: 240 },
    )
  })

  it('reports three windows, counts a two-dialect learner at the higher dialect, and includes the silent', async () => {
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    expect(res.statusCode).toBe(200)
    const month = res.body.windows.find((w: any) => w.window.label === '2026-09')
    expect(res.body.windows).toHaveLength(3)
    expect(month.all.registered).toBe(2)
    // L1: 60 south, 30 north -> 60, not 90.
    expect(month.all.totalMinutes).toBe(64)
    expect(month.all.overFiveMinutes).toBe(1)
    expect(month.all.overSixtyMinutes).toBe(0)
    expect(month.aged16to24.registered).toBe(1)
    expect(month.aged16to24.totalMinutes).toBe(60)
  })

  it('FAILURE MODE: a person enrolled in two cohorts counted as two registered people', async () => {
    DB.groups.push({ id: 'g-cohort2', name: 'Cohort 2', type: 'group', parent_id: 'g-org', path: 'dysgu-cymraeg/cohort-2', is_demo: false, is_test: false, created_at: '2026-01-01' })
    DB.org_enrolments.push({ learner_id: L1, group_id: 'g-cohort2', enrolled_at: '2026-09-20T09:00:00Z', reporting_from: '2026-09-20', age_band_16_24: false })
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    const month = res.body.windows.find((w: any) => w.window.label === '2026-09')
    expect(month.all.registered).toBe(2)
    expect(res.body.duplicateEnrolmentsCollapsed).toBe(1)
    // The EARLIEST enrolment wins, so their minutes are not clipped by the
    // later cohort's baseline, and the age tick survives from wherever it was
    // given.
    expect(month.all.totalMinutes).toBe(64)
    expect(month.aged16to24.registered).toBe(1)
  })

  it('names an unmapped Welsh course code rather than dropping it in silence', async () => {
    DB.learner_speaking_opportunities.push({ learner_id: L2, course_code: 'cym_for_eng_north', day: '2026-09-13', play_seconds: 6000 })
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    expect(res.body.unmappedCourseCodes).toEqual(['cym_for_eng_north'])
  })

  it('rejects a malformed month instead of inventing a window', async () => {
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-13' }), res)
    expect(res.statusCode).toBe(400)
  })
})

describe('dedupeRoster', () => {
  it('FAILURE MODE: a later cohort row overwriting the real registration date', async () => {
    const { dedupeRoster } = await import('./funder-export')
    // Deliberately out of order: the second cohort's row is seen FIRST, which
    // is what a paged read with no guaranteed ordering can hand you.
    const { roster, duplicateEnrolments } = dedupeRoster([
      { learner_id: L1, enrolled_at: '2026-09-20T09:00:00Z', reporting_from: '2026-09-20', age_band_16_24: false },
      { learner_id: L1, enrolled_at: '2026-09-01T09:00:00Z', reporting_from: '2026-09-01', age_band_16_24: true },
    ])
    expect(roster).toHaveLength(1)
    expect(duplicateEnrolments).toBe(1)
    // The earliest registration and its baseline win, whichever order they
    // arrived in — otherwise the person's own honest history gets clipped by
    // a cohort they joined later.
    expect(roster[0].enrolled_on).toBe('2026-09-01')
    expect(roster[0].reporting_from).toBe('2026-09-01')
    // And the tick survives from wherever it was given.
    expect(roster[0].age_band_16_24).toBe(true)
  })
})

describe('what must never leave the building', () => {
  it('FAILURE MODE: the 16-24 tick leaking into something identifiable', async () => {
    DB.org_enrolments.push({ learner_id: L1, group_id: 'g-org', enrolled_at: '2026-09-01T09:00:00Z', reporting_from: '2026-09-01', age_band_16_24: true })
    DB.learner_speaking_opportunities.push({ learner_id: L1, course_code: 'cym_s_for_eng', day: '2026-09-10', play_seconds: 3600 })

    const json = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), json)
    const asText = JSON.stringify(json.body)
    expect(asText).not.toContain(L1)
    expect(asText).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
    expect(asText).not.toMatch(/@/)

    const csv = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09', format: 'csv' }), csv)
    expect(csv.headers['Content-Type']).toContain('text/csv')
    expect(String(csv.body)).not.toContain(L1)
    expect(String(csv.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
  })

  it('says in the payload what a minute means, so the number is never read as wall clock', async () => {
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    expect(res.body.minutesDefinition).toMatch(/playing audio/i)
    expect(res.body.minutesDefinition).toMatch(/not wall clock/i)
  })
})

describe('the switchover snapshot', () => {
  it('can be pulled for ANY month on the day it is asked for, with no date compiled in', async () => {
    // Kai has not named a switchover date. The machinery must answer for
    // whatever month he eventually names, including the current one.
    const now = new Date()
    const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: thisMonth }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.month).toBe(thisMonth)
    expect(res.body.generatedAt).toBeTruthy()
  })

  it('defaults to the previous COMPLETE month rather than a stub of today', async () => {
    const { defaultMonth } = await import('./funder-export')
    expect(defaultMonth(new Date('2026-09-03T00:00:00Z'))).toBe('2026-08')
    expect(defaultMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12')
  })

  it('honours an explicit April baseline and derives one when not given', async () => {
    const explicit = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09', baselineFrom: '2026-04-01' }), explicit)
    expect(explicit.body.baselineFrom).toBe('2026-04-01')
    expect(explicit.body.windows.some((w: any) => w.window.label === 'since_2026-04-01')).toBe(true)

    const derived = makeRes()
    await handler(get({ groupId: 'g-org', month: '2027-02' }), derived)
    // February 2027 sits in the funding year that began April 2026.
    expect(derived.body.baselineFrom).toBe('2026-04-01')

    const bad = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09', baselineFrom: 'April' }), bad)
    expect(bad.statusCode).toBe(400)
  })
})
