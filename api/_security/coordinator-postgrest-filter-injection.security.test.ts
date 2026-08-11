/**
 * SECURITY AUDIT 2026-08-11 — coordinator sweep: PostgREST `.or()` filter injection.
 *
 * PostgREST parses the argument to `.or()` as a FILTER EXPRESSION, not as a
 * value: commas separate filters, parens group them. So any user-controlled
 * string interpolated into an `.or()` template literal is an injection point,
 * in exactly the way a value passed to `.eq(col, value)` is not.
 *
 * There are only 8 `.or()` call sites in api/**. This file locks the two
 * distinct outcomes the sweep found:
 *   - COORD-01 (finding): api/admin/users.ts interpolates the raw `search`
 *     query param into an `.or()` expression. Injectable. Admin-gated, but the
 *     client it runs on is the SERVICE ROLE key, so an injected filter runs
 *     with RLS bypassed.
 *   - COORD-02 (control that holds): api/groups/[id]/invites.ts interpolates
 *     `groups.path`, which the DB trigger `compute_group_path()` restricts to
 *     [a-z0-9-] segments joined by '/'. No comma, paren or dot can survive, so
 *     the interpolation is not injectable. This test is the regression lock on
 *     that invariant — if the slug charset ever widens, this goes red.
 *
 * Full write-up: docs/security-audit-2026-08-11/coordinator-sweep.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { groupSlug } from '../_utils/groupSlug'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

/** Every `.or()` expression string the handler hands to PostgREST. */
const orExpressions: string[] = []

function makeQueryBuilder(table: string) {
  const builder: any = {}
  for (const m of ['select', 'order', 'range', 'eq', 'gte', 'ilike', 'in']) {
    builder[m] = vi.fn(() => builder)
  }
  builder.or = vi.fn((expr: string) => { orExpressions.push(expr); return builder })
  builder.then = (resolve: any) => {
    if (table === 'learners') return resolve({ data: [], count: 0, error: null })
    return resolve({ data: [], error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table: string) => makeQueryBuilder(table)),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  })),
}))

function makeRes(): VercelResponse {
  const res: any = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  res.setHeader = vi.fn(() => res)
  res.end = vi.fn(() => res)
  return res as VercelResponse
}

async function callUsers(search: string) {
  orExpressions.length = 0
  const handler = (await import('../admin/users')).default
  const req = {
    method: 'GET',
    query: { search, page: '1', limit: '10' },
    headers: { authorization: 'Bearer token' },
  } as unknown as VercelRequest
  await handler(req, makeRes())
  return orExpressions
}

describe('COORD-01 — admin/users search is interpolated into a PostgREST .or() expression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyAdminResult = { userId: 'admin-uid' }
  })

  it('embeds a benign search term verbatim in the .or() filter expression', async () => {
    const exprs = await callUsers('alice')
    expect(exprs.some(e => e.includes('display_name.ilike.%alice%'))).toBe(true)
  })

  // SECURITY FINDING COORD-01: a `search` value containing a comma injects an
  // ADDITIONAL top-level filter into the OR group. `search` reaches this line
  // unescaped from req.query, and the query runs on the service-role client
  // (api/admin/users.ts:263), so the injected predicate is evaluated with RLS
  // bypassed. This test asserts the CURRENT (vulnerable) behaviour so the
  // finding is executable; see the it.todo below for the desired behaviour.
  it('CURRENT BEHAVIOUR: a comma in `search` injects a second filter clause', async () => {
    const [expr] = await callUsers('x,platform_role.eq.ssi_admin')
    // The comma is not escaped, so PostgREST reads TWO filters here, not one.
    expect(expr).toBe('display_name.ilike.%x,platform_role.eq.ssi_admin%')
    const topLevelClauses = expr.split(',')
    expect(topLevelClauses).toHaveLength(2)
    expect(topLevelClauses[1]).toBe('platform_role.eq.ssi_admin%')
  })

  // SECURITY FINDING COORD-01 (cont.): `%` and `_` are ILIKE wildcards and are
  // likewise unescaped, so a search of '%' matches every row and a search of
  // repeated wildcards forces a full scan on a service-role query.
  it('CURRENT BEHAVIOUR: ILIKE wildcards in `search` are passed through unescaped', async () => {
    const [expr] = await callUsers('%')
    expect(expr).toBe('display_name.ilike.%%%')
  })

  it.todo(
    'COORD-01 fix: `search` should be escaped (or rejected) before interpolation — ' +
    'reject/strip , ( ) . and escape % and _ — so one search term can only ever ' +
    'produce one filter clause',
  )
})

describe('COORD-02 — groups path interpolation is NOT injectable (control that holds)', () => {
  // api/groups/[id]/invites.ts:132 builds `path.eq.${path},path.like.${path}/%`.
  // That is safe ONLY because groups.path is derived by the DB trigger
  // compute_group_path(), whose slug line is
  //   LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g'))
  // mirrored exactly by groupSlug(). Lock the charset invariant the safety
  // argument rests on.
  const injectionAttempts = [
    'evil,is_active.eq.false',
    'evil)',
    'a.b.c',
    "'; drop table groups; --",
    'x%2Cy',
    'name(with)parens',
  ]

  it.each(injectionAttempts)('slug of %j contains no PostgREST filter metacharacter', (name) => {
    const slug = groupSlug(name)
    expect(slug).not.toMatch(/[,().*'"\\]/)
    expect(slug).toMatch(/^[a-z0-9-]*$/)
  })

  it('a path built from slugged segments stays inside the safe charset', () => {
    const path = ['Cardiff Council', 'Year 7, Set B', 'Ysgol (Bro)']
      .map(groupSlug)
      .join('/')
    expect(path).toMatch(/^[a-z0-9\-/]*$/)
    // Therefore `path.eq.${path}` cannot terminate the clause early.
    expect(path.includes(',')).toBe(false)
  })
})
