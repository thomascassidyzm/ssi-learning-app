import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let rateCount: number
let existingInviteRow: any
let existingEntitlementRow: any
let insertedEntitlement: any
let insertError: any
let insertedEvents: any[]

function makeQueryBuilder(table: string) {
  const builder: any = {}
  const methods = ['select', 'eq', 'gte', 'contains']
  for (const m of methods) {
    builder[m] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => {
    if (table === 'invite_codes') return { data: existingInviteRow, error: null }
    if (table === 'entitlement_codes') return { data: existingEntitlementRow, error: null }
    return { data: null, error: null }
  })
  builder.single = vi.fn(async () => {
    if (insertError) return { data: null, error: insertError }
    return { data: insertedEntitlement, error: null }
  })
  builder.insert = vi.fn((rows: any) => {
    if (table === 'player_events') {
      insertedEvents.push(...(Array.isArray(rows) ? rows : [rows]))
      return { error: null }
    }
    // entitlement_codes insert — chainable to .select().single()
    return builder
  })
  // `.select(..., { count: 'exact', head: true })` resolves the chain itself
  // (no terminal call) — make the builder awaitable for the rate-limit query.
  builder.then = (resolve: any) => {
    if (table === 'player_events') return resolve({ count: rateCount, error: null })
    return resolve({ data: null, error: null })
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeQueryBuilder(table),
  }),
}))

let handler: typeof import('./create').default

function makeReq(method: string, body?: any): VercelRequest {
  return {
    method,
    headers: { authorization: 'Bearer tok' },
    body,
  } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

const validBody = {
  access_type: 'full',
  duration_type: 'lifetime',
  label: 'Complimentary access — Jane Doe',
}

beforeEach(async () => {
  verifyAdminResult = { userId: 'admin-1' }
  rateCount = 0
  existingInviteRow = null
  existingEntitlementRow = null
  insertedEntitlement = { id: 'ent-1', code: 'ABC-123' }
  insertError = null
  insertedEvents = []
  handler = (await import('./create')).default
})

describe('POST /api/entitlement/create', () => {
  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq('POST', validBody), res)
    expect(res.statusCode).toBe(403)
  })

  it('rate-limits after too many recent mints by the same admin', async () => {
    rateCount = 30
    const res = makeRes()
    await handler(makeReq('POST', validBody), res)
    expect(res.statusCode).toBe(429)
  })

  it('requires a valid access_type', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { ...validBody, access_type: 'nonsense' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('creates a code, carries metadata, and writes an audit row', async () => {
    const res = makeRes()
    await handler(
      makeReq('POST', {
        ...validBody,
        metadata: { granted_to_email: 'jane@example.com', name: 'Jane', note: 'press pass' },
      }),
      res,
    )
    expect(res.statusCode).toBe(201)
    expect(res.body.code).toBe('ABC-123')

    expect(insertedEvents).toHaveLength(1)
    expect(insertedEvents[0]).toMatchObject({
      event_type: 'admin_entitlement_code_minted',
      payload: {
        actor_user_id: 'admin-1',
        entitlement_code_id: 'ent-1',
        metadata: { granted_to_email: 'jane@example.com', name: 'Jane', note: 'press pass' },
      },
    })
  })

  it('500s when the insert fails', async () => {
    insertError = { message: 'boom' }
    const res = makeRes()
    await handler(makeReq('POST', validBody), res)
    expect(res.statusCode).toBe(500)
  })
})
