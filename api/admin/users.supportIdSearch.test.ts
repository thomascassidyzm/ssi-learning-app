/**
 * SUPPORT CAN FIND AN ACCOUNT FROM THE CODE THE LEARNER READ OUT.
 *
 * Tom, 2026-09-09: the commonest support case is a person who cannot remember
 * which email they signed up with, and there are no passwords, so neither they
 * nor we can identify the account. Their own Settings now shows an eight
 * character account code. This is the other half of that: typing the code into
 * the admin user search finds them.
 *
 * The code is the front of the learner id in Crockford base32, so the lookup
 * is an indexed uuid RANGE — no new column, no backfill, and no scan over
 * every account computing codes to compare. An ordinary search term is
 * untouched, which is the second thing pinned here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supportIdForLearnerId } from '../../packages/core/src/identity/supportId'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({ verifyAdmin: vi.fn(async () => ({ userId: 'admin-1' })) }))

const LEARNER_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'
let orFilters: string[] = []

function makeQueryBuilder(table: string) {
  const builder: any = {}
  for (const m of ['select', 'order', 'range', 'ilike', 'in', 'eq', 'gte']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.or = vi.fn((expr: string) => { if (table === 'learners') orFilters.push(expr); return builder })
  builder.then = (resolve: any) =>
    resolve(
      table === 'learners'
        ? { data: [], count: 0, error: null }
        : { data: [], error: null },
    )
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
    rpc: vi.fn(async () => ({ data: [], error: null })),
  }),
}))

let handler: typeof import('./users').default

const req = (search: string): VercelRequest =>
  ({ method: 'GET', headers: { authorization: 'Bearer tok' }, query: { page: '1', search } }) as any

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  orFilters = []
  handler = (await import('./users')).default
})

describe('admin user search by account code', () => {
  it('turns the code into the uuid range that brackets its learner', async () => {
    const code = supportIdForLearnerId(LEARNER_ID)!
    await handler(req(code), makeRes())
    const expr = orFilters.join(' ')
    expect(expr).toContain('id.gte.3f2504e0-4f00')
    expect(expr).toContain('id.lte.3f2504e0-4fff')
  })

  it('finds them from a lower-case code typed without its hyphen', async () => {
    const code = supportIdForLearnerId(LEARNER_ID)!
    await handler(req(code.replace('-', '').toLowerCase()), makeRes())
    expect(orFilters.join(' ')).toContain('id.gte.3f2504e0-4f00')
  })

  it('leaves an ordinary name or email search exactly as it was', async () => {
    await handler(req('alice@example.com'), makeRes())
    const expr = orFilters.join(' ')
    expect(expr).toContain('display_name.ilike.')
    expect(expr).not.toContain('id.gte.')
  })
})
