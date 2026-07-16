import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let learners: any[]
let learnerEmails: any[]
let subscriptions: any[]
let entitlements: any[]
let enrollments: any[]
let practiceRpcResult: { data: any; error: any }
const fromCalls: string[] = []

// Generic chainable query builder: every method returns `this`, and the
// object resolves (via `.then`) to a table-specific result — mirrors how
// the real supabase-js query builders behave (thenable, no terminal call
// needed once `.select()` has been chained).
function makeQueryBuilder(table: string) {
  fromCalls.push(table)
  const state: { search?: string; gte?: string; eqStatus?: string } = {}
  const builder: any = {}
  const chain = ['select', 'order', 'range', 'or'].reduce((acc, m) => {
    builder[m] = vi.fn((...args: any[]) => {
      if (m === 'or') state.search = args[0]
      return builder
    })
    return acc
  }, {} as any)
  void chain
  builder.eq = vi.fn((_col: string, val: string) => { state.eqStatus = val; return builder })
  builder.gte = vi.fn((_col: string, val: string) => { state.gte = val; return builder })
  builder.ilike = vi.fn(() => builder)
  let inIds: string[] | null = null
  builder.in = vi.fn((_col: string, ids: string[]) => { inIds = ids; return builder })

  builder.then = (resolve: any) => {
    switch (table) {
      case 'learners': {
        // Mode A: bulk fetch by user_id — data, no count.
        if (inIds) {
          return resolve({ data: learners.filter(l => inIds!.includes(l.user_id)), error: null })
        }
        // Hero-stat head:count queries (totalUsers / newThisWeek) never call .range().
        if (builder.range.mock.calls.length === 0) {
          const count = state.gte ? learners.filter(l => l.created_at >= state.gte!).length : learners.length
          return resolve({ count, error: null })
        }
        // Mode B: the paginated list query.
        return resolve({ data: learners, count: learners.length, error: null })
      }
      case 'learner_emails':
        return resolve({ data: learnerEmails, error: null })
      case 'subscriptions':
        return resolve({ data: subscriptions.filter(s => !state.eqStatus || s.status === state.eqStatus), error: null })
      case 'user_entitlements':
        return resolve({ data: entitlements, error: null })
      case 'course_enrollments':
        return resolve({ data: enrollments, error: null })
      default:
        return resolve({ data: null, error: null })
    }
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
    rpc: vi.fn(async () => practiceRpcResult),
  }),
}))

let handler: typeof import('./users').default

function makeReq(query: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', headers: { authorization: 'Bearer tok' }, query } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  verifyAdminResult = { userId: 'admin-1' }
  fromCalls.length = 0
  learners = [
    { id: 'l1', user_id: 'u1', display_name: 'Alice', created_at: '2026-07-10T00:00:00Z', educational_role: null, platform_role: null, needs_verification: true },
    { id: 'l2', user_id: 'u2', display_name: 'Bob', created_at: '2026-01-01T00:00:00Z', educational_role: null, platform_role: 'ssi_admin', needs_verification: false },
  ]
  learnerEmails = [
    { learner_id: 'l1', email: 'alice@example.com', is_primary: true },
    { learner_id: 'l2', email: 'bob@example.com', is_primary: true },
  ]
  subscriptions = []
  entitlements = []
  enrollments = [
    { learner_id: 'l1', course_id: 'spa_for_eng', last_practiced_at: '2026-07-15T00:00:00Z', total_practice_minutes: 30 },
  ]
  practiceRpcResult = { data: [{ learner_id: 'l1', practice_minutes: 45 }], error: null }
  handler = (await import('./users')).default
})

describe('GET /api/admin/users', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(403)
  })

  it('Mode B: returns enriched users with tier, activity, and hero stats', async () => {
    const res = makeRes()
    await handler(makeReq({ page: '1', limit: '50' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.users).toHaveLength(2)
    expect(res.body.totalUsers).toBe(2)

    const alice = res.body.users.find((u: any) => u.id === 'l1')
    expect(alice.primary_email).toBe('alice@example.com')
    expect(alice.tier).toBe('free')
    expect(alice.practice_minutes).toBe(45) // from the RPC, not the stale counter
    expect(alice.course_ids).toEqual(['spa_for_eng'])
    expect(alice.needs_verification).toBe(true)

    const bob = res.body.users.find((u: any) => u.id === 'l2')
    expect(bob.tier).toBe('admin') // ssi_admin platform_role
    expect(bob.practice_minutes).toBe(0) // no RPC row, no enrollment fallback
  })

  it('Mode B: falls back to the enrollment counter when the practice RPC errors', async () => {
    practiceRpcResult = { data: null, error: { message: 'rpc boom' } }
    const res = makeRes()
    await handler(makeReq({ page: '1', limit: '50' }), res)
    const alice = res.body.users.find((u: any) => u.id === 'l1')
    expect(alice.practice_minutes).toBe(30) // course_enrollments.total_practice_minutes fallback
  })

  it('Mode B: fetches the page and both hero-stat counts in a single parallel wave', async () => {
    const res = makeRes()
    await handler(makeReq({ page: '1', limit: '50' }), res)
    expect(res.statusCode).toBe(200)
    // Three independent 'learners' queries (page list, totalUsers, newThisWeek)
    // fire together rather than the old shape (page query, then two more
    // sequential round-trips after enrichment finished).
    expect(fromCalls.filter(t => t === 'learners')).toHaveLength(3)
  })

  it('Mode A: bulk fetch by user_ids, no pagination or stats', async () => {
    const res = makeRes()
    await handler(makeReq({ ids: 'u1,u2' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.totalUsers).toBeUndefined()
  })
})
