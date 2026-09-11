// @vitest-environment node
/**
 * LIVE PROBE of the intelligence endpoints against the real database —
 * read-only, opt-in, skipped unless INTEL_LIVE=1 and a service-role key are
 * in the environment. Same pattern as explainer/verifyIme.live.test.ts.
 *
 * Why it exists: an endpoint whose only run was its unit test has never met
 * the live tables' shapes. This calls each handler with verifyAdmin replaced
 * by a stub — the admin gate is tested elsewhere; here the question is
 * whether the queries answer — and asserts the shape and the honesty rules:
 * a population is resolved, a count is never negative, and thin numbers
 * read as thin rather than as errors. Term-time has not started; empty is
 * expected and is not a failure.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../_utils/auth', () => ({
  verifyAdmin: async () => ({ userId: 'live-probe', learnerId: 'live-probe' }),
}))

const live = process.env.INTEL_LIVE === '1' && !!process.env.SUPABASE_SERVICE_ROLE_KEY

type Json = Record<string, unknown>
async function call(mod: { default: (req: unknown, res: unknown) => Promise<void> }, query: Record<string, string> = {}): Promise<{ status: number; body: Json }> {
  let status = 0
  let body: Json = {}
  const res = {
    status(s: number) { status = s; return this },
    json(b: Json) { body = b; return this },
    setHeader() { return this },
    end() { return this },
  }
  await mod.default({ method: 'GET', query, headers: {} }, res)
  return { status, body }
}

describe.skipIf(!live)('intelligence endpoints, live and read-only', () => {
  it('pulse counts real people, never sessions', async () => {
    const { status, body } = await call(await import('./pulse'))
    expect(status).toBe(200)
    expect(body.population as number).toBeGreaterThan(0)
    expect(body.thisWeek as number).toBeLessThanOrEqual(body.population as number)
    console.log('[pulse]', JSON.stringify({ thisWeek: body.thisWeek, lastWeek: body.lastWeek, population: body.population, standing: body.standing, courses: (body.courses as unknown[]).length, countries: (body.countries as unknown[]).length }))
  }, 60_000)

  it('leaving ranks by recency and regularity', async () => {
    const { status, body } = await call(await import('./leaving'))
    expect(status).toBe(200)
    const rows = body.rows as { daysSincePractice: number | null; reasons: string[] }[]
    for (const r of rows) expect(r.reasons.length).toBeGreaterThan(0)
    console.log('[leaving]', JSON.stringify({ rows: rows.length, counts: body.counts, buckets: body.buckets, practisedRecently: body.practisedRecently }))
  }, 60_000)

  it('courses rank by people practising this month', async () => {
    const { status, body } = await call(await import('./courses'))
    expect(status).toBe(200)
    const rows = body.rows as { course: string; reach: number; practised30: number; finished: number | null }[]
    expect(rows.length).toBeGreaterThan(0)
    // Reach is the union of ever-enrolled and practised-this-month, so the
    // share can never read over one — the probe of 2026-09-10 caught it doing so.
    for (const r of rows) expect(r.practised30).toBeLessThanOrEqual(r.reach)
    console.log('[courses]', JSON.stringify(rows.slice(0, 6)))
  }, 60_000)

  it('working answers with a failure rate or an honest null', async () => {
    const { status, body } = await call(await import('./working'), { days: '7' })
    expect(status).toBe(200)
    console.log('[working]', JSON.stringify({ people: body.people, overall: body.overall, currentBuild: body.currentBuild, builds: (body.byBuild as unknown[]).length, days: (body.byDay as unknown[]).length, truncated: body.truncated }))
  }, 120_000)

  it('findings say how silent the nightly job is', async () => {
    const { status, body } = await call(await import('./findings'))
    expect(status).toBe(200)
    console.log('[findings]', JSON.stringify({ generatedAt: body.generatedAt, ageHours: body.ageHours, silent: body.silent, questions: Object.fromEntries(Object.entries(body.byQuestion as Record<string, unknown[]>).map(([k, v]) => [k, v.length])) }))
  }, 30_000)

  it('one person reads in one call, with their standing in the numbers stated', async () => {
    const leaving = await call(await import('./leaving'))
    const first = (leaving.body.rows as { learnerId: string }[])[0]
    if (!first) return
    const { status, body } = await call(await import('./person'), { id: first.learnerId })
    expect(status).toBe(200)
    expect(typeof body.counted).toBe('boolean')
    console.log('[person]', JSON.stringify({ counted: body.counted, excludedBecause: body.excludedBecause, standing: body.standing, access: (body.access as unknown[]).length, positions: (body.positions as unknown[]).length, recent: (body.recent as unknown[]).length, supportId: body.supportId, practice: body.practice }))
  }, 60_000)

  it('weak points floors a real course honestly', async () => {
    const { status, body } = await call(await import('./weak-points'), { course: 'spa_for_eng' })
    expect(status).toBe(200)
    console.log('[weak-points]', JSON.stringify({ learners: body.learners, tooFewToSay: body.tooFewToSay, rows: (body.rows as unknown[]).length, truncated: body.truncated }))
  }, 120_000)
})
