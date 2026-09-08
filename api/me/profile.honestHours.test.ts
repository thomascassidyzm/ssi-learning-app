/**
 * The plan's hours are PLAYBACK hours, not wall clock.
 *
 * Founder ruling 2026-08-19 — "no cap, make the measurement accurate". One
 * definition of a minute across the whole app: a minute in which the app was
 * actually playing. That counter is
 * `learner_speaking_opportunities.play_seconds`, and the learner's own Library
 * Total Time tile has read it since August (api/me/engaged-time.ts).
 *
 * This page did not. It summed `sessions.duration_seconds`, which on rows
 * whose accumulator never closed was `ended_at - started_at` — so the same
 * learner read one total in the Library and a far bigger one on their own
 * profile, and the thirty-hour plan was drawn against the bigger one.
 *
 * These tests are red on the old code (they read 40 hours, not 3) and green on
 * the new. They also pin the guard that came out of the live data: 431
 * accounts have session rows and no ledger rows at all, and none of them may
 * be handed the SAMPLE figure of 7.5 hours as though it were their own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const learnerRow = { id: 'learner-1' }

/** Rows the fake DB will serve, per table. Set per test. */
let ledgerRows: Array<{ day?: string; opportunities?: number; play_seconds: number }> = []
/** The wall-clock rows the OLD code summed. Present so its answer is visible. */
let sessionRows: Array<{ duration_seconds: number }> = []
let sessionCount = 0

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: async () => ({ valid: true, userId: 'auth-uid-1' }),
}))

vi.mock('@supabase/supabase-js', () => {
  function builder(table: string, head: boolean) {
    const rows = () => {
      if (table === 'learner_speaking_opportunities') return ledgerRows
      if (table === 'sessions') return sessionRows
      return []
    }
    const result: any = {
      get data() { return head ? null : rows() },
      error: null,
      count: table === 'sessions' ? sessionCount : 0,
    }
    const chain: any = {
      select: (_c?: string, o?: any) => builder(table, !!o?.head),
      eq: () => chain,
      gte: () => chain,
      order: () => chain,
      limit: () => chain,
      range: (from: number) => (from === 0 ? result : { data: [], error: null, count: 0 }),
      maybeSingle: async () => ({ data: table === 'learners' ? learnerRow : null, error: null }),
      then: (r: any) => Promise.resolve(result).then(r),
    }
    return chain
  }
  return {
    createClient: () => ({ from: (table: string) => builder(table, false) }),
  }
})

import handler from './profile'

function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(c: number) { out.status = c; return res },
    json(b: any) { out.body = b; return res },
  }
  return { res, out }
}

async function payload() {
  const { res, out } = mockRes()
  await handler({ method: 'GET', query: {}, headers: { authorization: 'Bearer x' } } as any, res)
  return out.body
}

beforeEach(() => {
  ledgerRows = []
  sessionRows = []
  sessionCount = 0
})

describe('the plan reads the playback ledger', () => {
  it('reports the playback hours, not the wall-clock hours behind them', async () => {
    // 3 hours of real playback. The old code read 40 hours of wall clock for
    // exactly this learner; nothing in the response may carry that number.
    ledgerRows = [{ day: '2026-09-01', opportunities: 40, play_seconds: 3 * 3600 }]
    sessionRows = [{ duration_seconds: 40 * 3600 }]
    sessionCount = sessionRows.length

    const body = await payload()
    expect(body.plan.source).toBe('real')
    expect(body.plan.hoursDone).toBe(3)
  })

  it('gives a learner with no recorded playback their own zero, never the sample figure', async () => {
    // 431 live accounts look like this: session rows, no ledger rows. Their
    // Library tile already says zero; this page must agree with it.
    ledgerRows = []
    sessionRows = [{ duration_seconds: 5 * 3600 }]
    sessionCount = sessionRows.length

    const body = await payload()
    expect(body.plan.source).toBe('real')
    expect(body.plan.hoursDone).toBe(0)
    expect(body.plan.hoursDone).not.toBe(7.5)
  })

  it('still labels a genuinely empty account as sample data', async () => {
    const body = await payload()
    expect(body.plan.source).toBe('mock')
  })
})
