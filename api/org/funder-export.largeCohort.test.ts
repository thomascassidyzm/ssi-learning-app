/**
 * A LARGE COHORT — the second failure the old system actually had, and the one
 * Kai named as most concrete.
 * ==========================================================================
 *
 * Kai, 2026-09-08: the old system's group size had a maximum, it was raised,
 * "and then data fetches started timing out (and still do)" once groups got
 * large.
 *
 * The arithmetic behind that. A learner practising four days a week leaves
 * roughly 200 rows a year in the playback ledger per course. Ten thousand
 * learners is therefore about two million rows for an all-time window — two
 * thousand round trips at PostgREST's thousand-row page. It does not matter
 * how fast each one is; that shape times out, and it gets worse every month
 * the reporting year runs.
 *
 * So the tests here are about SHAPE, not speed: how many round trips, and how
 * many rows crossed the wire. A wall-clock assertion on a laptop proves
 * nothing about a serverless function talking to a database in Dublin, but
 * "one aggregate call per window, and the row count does not grow with the
 * length of the window" holds everywhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/groupTreeAuth', () => ({
  resolveGroupTreeCaller: vi.fn(async () => ({ userId: 'admin-1', isAdmin: true, ownGroupId: null })),
  callerCanSeeGroup: vi.fn(async () => true),
}))

const COHORT = 10_000
const COURSES = ['cym_n_for_eng', 'cym_s_for_eng']
const FAMILY = { cym_n_for_eng: 'welsh_north', cym_s_for_eng: 'welsh_south' }

/** learner id -> per-course seconds, the shape the SQL aggregate returns. */
let TOTALS: Array<{ learner_id: string; course_code: string; seconds: number }>
let ROSTER: Array<{ learner_id: string; enrolled_on: string; reporting_from: string; age_band_16_24: boolean }>
/** Every round trip the endpoint makes, so the SHAPE of the read is visible. */
let calls: Array<{ kind: string; detail: string; rows: number }>
/** When false, the aggregate functions are "not deployed" and the fallback runs. */
let aggregateDeployed: boolean
/** The raw per-day ledger, only ever read by the fallback. */
let RAW_LEDGER: Array<{ learner_id: string; course_code: string; day: string; play_seconds: number }>

function buildCohort(size: number, daysEach: number) {
  ROSTER = []
  TOTALS = []
  RAW_LEDGER = []
  for (let i = 0; i < size; i++) {
    const id = `L${String(i).padStart(6, '0')}`
    ROSTER.push({ learner_id: id, enrolled_on: '2026-09-01', reporting_from: '2026-09-01', age_band_16_24: i % 5 === 0 })
    // Four in five have played; the rest are the silent registered, who must
    // still appear in the count and drag the average down honestly.
    if (i % 5 === 4) continue
    for (const course of COURSES) {
      // North gets more minutes than South for everyone, so the higher-of rule
      // has something to bite on at scale.
      const perDay = course === 'cym_n_for_eng' ? 600 : 300
      TOTALS.push({ learner_id: id, course_code: course, seconds: perDay * daysEach })
      for (let d = 0; d < daysEach; d++) {
        RAW_LEDGER.push({
          learner_id: id,
          course_code: course,
          day: `2026-09-${String((d % 30) + 1).padStart(2, '0')}`,
          play_seconds: perDay,
        })
      }
    }
  }
}

function makeChainable(table: string) {
  let rows: any[] = []
  if (table === 'groups') rows = [{ id: 'g-org', name: 'Dysgu Cymraeg', type: 'organisation', parent_id: null, path: 'dysgu-cymraeg', is_demo: false, is_test: false, created_at: '2026-01-01' }]
  if (table === 'org_enrolment_policies') rows = [{ group_id: 'g-org', org_display_name: 'Dysgu Cymraeg', course_family_map: FAMILY }]
  if (table === 'org_enrolments') rows = ROSTER.map((r) => ({ learner_id: r.learner_id, group_id: 'g-org', enrolled_at: `${r.enrolled_on}T09:00:00Z`, reporting_from: r.reporting_from, age_band_16_24: r.age_band_16_24 }))
  if (table === 'learner_speaking_opportunities') rows = RAW_LEDGER
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    in(c: string, v: unknown[]) { const s = new Set(v as any[]); rows = rows.filter((r) => s.has(r[c])); return b },
    is() { return b },
    gte(c: string, v: any) { rows = rows.filter((r) => r[c] >= v); return b },
    lte(c: string, v: any) { rows = rows.filter((r) => r[c] <= v); return b },
    order() { return b },
    range(from: number, to: number) {
      rows = rows.slice(from, to + 1)
      calls.push({ kind: 'select', detail: table, rows: rows.length })
      return b
    },
    async maybeSingle() { calls.push({ kind: 'select', detail: table, rows: Math.min(rows.length, 1) }); return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) {
      if (!calls.length || calls[calls.length - 1].detail !== table) calls.push({ kind: 'select', detail: table, rows: rows.length })
      return Promise.resolve({ data: rows, error: null }).then(f, r)
    },
  }
  return b
}

const MISSING = { code: 'PGRST202', message: 'Could not find the function in the schema cache' }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => makeChainable(t),
    rpc: (name: string, args: any) => {
      let rows: any[] = []
      if (name === 'org_enrolment_roster') rows = ROSTER.map((r) => ({ ...r }))
      else if (name === 'org_enrolment_window_seconds') {
        // The database applies the window; the fixture's cohort all played in
        // September, so a window that excludes it returns nothing.
        const overlaps = args.p_from <= '2026-09-30' && args.p_to >= '2026-09-01'
        rows = overlaps ? TOTALS.map((t) => ({ ...t })) : []
      }
      const builder: any = {
        range(from: number, to: number) {
          const page = rows.slice(from, to + 1)
          calls.push({ kind: 'rpc', detail: name, rows: page.length })
          return Promise.resolve(aggregateDeployed ? { data: page, error: null } : { data: null, error: MISSING })
        },
        then(f: any) {
          calls.push({ kind: 'rpc', detail: name, rows: rows.length })
          return Promise.resolve(aggregateDeployed ? { data: rows, error: null } : { data: null, error: MISSING }).then(f)
        },
      }
      return builder
    },
  }),
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

const rowsOnWire = () => calls.reduce((a, c) => a + c.rows, 0)

let handler: typeof import('./funder-export').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./funder-export')).default
  calls = []
  aggregateDeployed = true
})

describe('ten thousand learners', () => {
  it('FAILURE MODE: a large cohort dragged across the wire a day at a time', async () => {
    // A month of daily practice on two courses each — small next to a year,
    // and already 128,000 ledger rows.
    buildCohort(COHORT, 8)
    expect(RAW_LEDGER.length).toBeGreaterThan(100_000)

    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.measurement.path).toBe('database-aggregate')
    expect(res.body.measurement.cohortSize).toBe(COHORT)

    // THE ASSERTION THAT MATTERS. The raw ledger is 128,000 rows; what
    // actually crossed the wire is the aggregate, two orders of magnitude
    // smaller, and NOT ONE per-day row was read.
    expect(calls.some((c) => c.detail === 'learner_speaking_opportunities')).toBe(false)
    expect(rowsOnWire()).toBeLessThan(RAW_LEDGER.length / 2)
  })

  it('the read does not grow as the reporting year lengthens', async () => {
    // The old system got slower every month. This one must not: the aggregate
    // returns one row per learner per course whether the window is a week or
    // five years.
    buildCohort(2_000, 4)
    await handler(get({ groupId: 'g-org', month: '2026-09' }), makeRes())
    const shortWindow = rowsOnWire()

    calls = []
    buildCohort(2_000, 200) // fifty times the days
    await handler(get({ groupId: 'g-org', month: '2026-09' }), makeRes())
    const longWindow = rowsOnWire()

    expect(RAW_LEDGER.length).toBeGreaterThan(600_000)
    expect(longWindow).toBe(shortWindow)
  })

  it('is a bounded number of round trips, not one per learner', async () => {
    buildCohort(COHORT, 8)
    await handler(get({ groupId: 'g-org', month: '2026-09' }), makeRes())
    // Three windows plus a roster, each paged at a thousand — tens of calls
    // for ten thousand learners, never thousands.
    expect(calls.length).toBeLessThan(200)
    expect(calls.filter((c) => c.kind === 'rpc').length).toBeGreaterThan(0)
  })

  it('gets the same answer at scale that it gets on a handful', async () => {
    buildCohort(COHORT, 8)
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    const month = res.body.windows.find((w: any) => w.window.label === '2026-09')

    expect(month.all.registered).toBe(COHORT)
    // Four in five played: 600s/day north beats 300s/day south, eight days.
    // 4,800 seconds = 80 minutes each, and the higher-of rule means 80, not 120.
    const players = COHORT * 0.8
    expect(month.all.totalMinutes).toBe(players * 80)
    expect(month.all.overSixtyMinutes).toBe(players)
    expect(month.all.overHundredMinutes).toBe(0)
    // Averaged across EVERYONE, silent fifth included.
    expect(month.all.averageMinutesAll).toBe(64)
    expect(month.all.averageMinutesOverThree).toBe(80)
    expect(month.aged16to24.registered).toBe(COHORT / 5)
  })

  it('carries no learner identity out, however large the cohort', async () => {
    buildCohort(1_000, 4)
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09', format: 'csv' }), res)
    expect(String(res.body)).not.toContain('L000001')
    expect(String(res.body).split('\n').filter(Boolean)).toHaveLength(7) // header + 3 windows x 2 cohorts
  })
})

describe('before the aggregate is deployed', () => {
  it('a small cohort still exports, by the raw path, and says so', async () => {
    aggregateDeployed = false
    buildCohort(20, 3)
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.measurement.path).toBe('raw-ledger-fallback')
    const month = res.body.windows.find((w: any) => w.window.label === '2026-09')
    expect(month.all.registered).toBe(20)
    expect(month.all.totalMinutes).toBe(16 * 30) // 16 players x 600s x 3 days / 60
  })

  it('FAILURE MODE: a large cohort answered from a truncated read', async () => {
    // The important half of the fallback. Faced with a cohort it cannot read
    // honestly it REFUSES, naming the migration — rather than timing out, and
    // far rather than returning a number computed from part of the data,
    // which nobody would ever notice was wrong.
    aggregateDeployed = false
    buildCohort(COHORT, 8)
    const res = makeRes()
    await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
    expect(res.statusCode).toBe(503)
    expect(res.body.error).toMatch(/20260908e_org_enrolments/)
    expect(res.body.cohortSize).toBe(COHORT)
    expect(res.body.windows).toBeUndefined()
  })
})

describe('nothing caps the cohort itself', () => {
  it('there is no size at which the export starts refusing a bigger org', async () => {
    for (const size of [1, 1_000, 25_000]) {
      calls = []
      buildCohort(size, 1)
      const res = makeRes()
      await handler(get({ groupId: 'g-org', month: '2026-09' }), res)
      expect(res.statusCode, `cohort of ${size}`).toBe(200)
      expect(res.body.measurement.cohortSize, `cohort of ${size}`).toBe(size)
    }
  })
})
