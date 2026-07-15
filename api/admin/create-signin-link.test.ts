import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let verifyAdminResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
}))

let rateCount: number
let learnerRow: any
let emailRow: any
let generateLinkResult: any
let insertedEvents: any[]

function makeQueryBuilder(table: string) {
  const builder: any = {}
  const methods = ['select', 'eq', 'gte', 'contains', 'order', 'limit']
  for (const m of methods) {
    builder[m] = vi.fn(() => builder)
  }
  builder.single = vi.fn(async () => {
    if (table === 'learners') return { data: learnerRow, error: learnerRow ? null : { code: 'PGRST116' } }
    return { data: null, error: null }
  })
  builder.maybeSingle = vi.fn(async () => {
    if (table === 'learner_emails') return { data: emailRow, error: null }
    return { data: null, error: null }
  })
  builder.insert = vi.fn(async (rows: any) => {
    insertedEvents.push(...(Array.isArray(rows) ? rows : [rows]))
    return { error: null }
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
    auth: {
      admin: {
        generateLink: vi.fn(async () => generateLinkResult),
      },
    },
  }),
}))

let handler: typeof import('./create-signin-link').default

function makeReq(method: string, body?: any): VercelRequest {
  return {
    method,
    headers: { authorization: 'Bearer tok', host: 'staging.saysomethingin.app' },
    body,
  } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  verifyAdminResult = { userId: 'admin-1' }
  rateCount = 0
  learnerRow = { id: 'learner-1', user_id: 'auth-uid-1', display_name: 'Jane Teacher' }
  emailRow = { email: 'jane@school.example' }
  generateLinkResult = {
    data: { properties: { action_link: 'https://staging.saysomethingin.app/auth/confirm?token=abc' } },
    error: null,
  }
  insertedEvents = []
  handler = (await import('./create-signin-link')).default
})

describe('POST /api/admin/create-signin-link', () => {
  it('rejects a non-POST method', async () => {
    const res = makeRes()
    await handler(makeReq('GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects a non-admin caller', async () => {
    verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
    const res = makeRes()
    await handler(makeReq('POST', { learner_id: 'learner-1' }), res)
    expect(res.statusCode).toBe(403)
  })

  it('requires learner_id', async () => {
    const res = makeRes()
    await handler(makeReq('POST', {}), res)
    expect(res.statusCode).toBe(400)
  })

  it('404s when the user is not found', async () => {
    learnerRow = null
    const res = makeRes()
    await handler(makeReq('POST', { learner_id: 'nope' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('400s when the user has no email on file', async () => {
    emailRow = null
    const res = makeRes()
    await handler(makeReq('POST', { learner_id: 'learner-1' }), res)
    expect(res.statusCode).toBe(400)
  })

  it('rate-limits after too many recent mints by the same admin', async () => {
    rateCount = 15
    const res = makeRes()
    await handler(makeReq('POST', { learner_id: 'learner-1' }), res)
    expect(res.statusCode).toBe(429)
  })

  it('mints a link and returns it, and writes an audit row', async () => {
    const res = makeRes()
    await handler(makeReq('POST', { learner_id: 'learner-1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.action_link).toBe('https://staging.saysomethingin.app/auth/confirm?token=abc')
    expect(res.body.email).toBe('jane@school.example')

    expect(insertedEvents).toHaveLength(1)
    expect(insertedEvents[0]).toMatchObject({
      event_type: 'admin_signin_link_minted',
      user_id: 'learner-1',
      learner_id: 'learner-1',
      payload: { actor_user_id: 'admin-1', target_user_id: 'auth-uid-1' },
    })
  })

  it('500s when generateLink fails', async () => {
    generateLinkResult = { data: null, error: { message: 'boom' } }
    const res = makeRes()
    await handler(makeReq('POST', { learner_id: 'learner-1' }), res)
    expect(res.statusCode).toBe(500)
  })
})
