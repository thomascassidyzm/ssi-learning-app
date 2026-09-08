/**
 * THE ELEVENTH LEARNER IN THE ROOM — /api/org/enrol GET, per-IP throttle.
 * =======================================================================
 *
 * A Canolfan tutor puts the enrolment link on the screen and a whole class
 * taps it inside a minute. Every tap is a GET on this endpoint, and every
 * device in the room shares one NAT'd IP, so the class arrives as one address
 * spending one window. At PER_IP_LIMIT (10) the eleventh learner was told the
 * link could not be found while holding a perfectly good one — the same live
 * failure api/code/validate.ts already fixed by moving to the wide budget
 * (REDEEM_PER_IP_LIMIT, 120/15min).
 *
 * These tests drive the REAL throttle — codeAttemptThrottle is deliberately
 * NOT mocked here, unlike the sibling enrol tests — against a fake
 * possession_mint_attempts table that accumulates exactly as the live one
 * does. So the assertion is about learners getting in, not about a constant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

type Row = Record<string, any>
let DB: Record<string, Row[]>

/**
 * Enough of PostgREST for this path: the head/count query isIpOverLimit runs
 * (select + eq + neq… + gte, awaited), the two maybeSingle lookups, and the
 * attempt insert. The builder is thenable so `await query.gte(...)` resolves
 * to a count the same way the real client does.
 */
function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    neq(c: string, v: unknown) { rows = rows.filter((r) => r[c] !== v); return b },
    gte(c: string, v: any) { rows = rows.filter((r) => r[c] >= v); return b },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    single: async () => ({ data: rows[0] ?? null, error: null }),
    insert: async (payload: Row) => {
      ;(DB[table] ??= []).push({ id: `${table}-${(DB[table] ?? []).length + 1}`, created_at: new Date().toISOString(), ...payload })
      return { data: null, error: null }
    },
    then(resolve: (v: any) => unknown) { return Promise.resolve({ count: rows.length, data: rows, error: null }).then(resolve) },
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (t: string) => makeChainable(t) }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  res.setHeader = vi.fn()
  return res
}

/** One tap on the link, from one device behind the room's shared address. */
const openLink = (ip: string): VercelRequest =>
  ({ method: 'GET', query: { code: 'CYM-001' }, headers: { 'x-vercel-forwarded-for': ip } }) as any

let handler: typeof import('./enrol').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./enrol')).default
  DB = {
    possession_mint_attempts: [],
    invite_codes: [{ id: 'inv-1', code_normalized: 'CYM001', grants_group_id: 'g-canolfan', is_active: true, expires_at: null }],
    org_enrolment_policies: [{
      group_id: 'g-canolfan', org_display_name: 'Y Ganolfan', consent_statement: 'Rwy\'n cytuno',
      consent_version: 'v1', ask_age_band: true, age_band_label: '16-24', free_months: 12, is_active: true,
    }],
  }
})

describe('org enrolment link — a shared room is not an attack', () => {
  it('the eleventh learner in the room gets in, and so does the hundredth', async () => {
    const room = '81.100.4.7'
    const statuses: number[] = []
    for (let i = 1; i <= 120; i++) {
      const res = makeRes()
      await handler(openLink(room), res)
      statuses.push(res.statusCode!)
      if (res.statusCode === 200) expect(res.body.found).toBe(true)
    }
    // Every one of the 120, including the eleventh, read the consent page.
    expect(statuses.filter((s) => s === 429)).toHaveLength(0)
    expect(statuses.every((s) => s === 200)).toBe(true)
    // And the window really did accumulate — the pass is not a throttle that
    // silently never counted anything.
    expect(DB.possession_mint_attempts).toHaveLength(120)
  })

  it('still refuses past the limit — 121 onwards is a 429', async () => {
    const room = '81.100.4.7'
    for (let i = 1; i <= 120; i++) await handler(openLink(room), makeRes())

    const over = makeRes()
    await handler(openLink(room), over)
    expect(over.statusCode).toBe(429)

    const alsoOver = makeRes()
    await handler(openLink(room), alsoOver)
    expect(alsoOver.statusCode).toBe(429)
    // A refusal must not count toward the window, or a retrying client
    // perpetuates its own block.
    expect(DB.possession_mint_attempts).toHaveLength(120)
  })

  it('one room spending its budget does not throttle the room next door', async () => {
    for (let i = 1; i <= 121; i++) await handler(openLink('81.100.4.7'), makeRes())

    const elsewhere = makeRes()
    await handler(openLink('212.9.9.9'), elsewhere)
    expect(elsewhere.statusCode).toBe(200)
    expect(elsewhere.body.found).toBe(true)
  })
})
