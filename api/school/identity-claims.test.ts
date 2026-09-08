/**
 * /api/school/identity-claims — the admin door onto school_identity_claims.
 * Auth and refusals only; the matching rule is tested in schoolDomain.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  memberships: [] as Array<{ schoolId: string; role: 'admin' | 'teacher' }>,
  inserted: [] as any[],
  rows: [] as any[],
}))

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'admin-uid' })),
}))
vi.mock('../_utils/schoolStaff', () => ({
  schoolMembershipsOf: vi.fn(async () => state.memberships),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      expect(table).toBe('school_identity_claims')
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        insert: (row: any) => { state.inserted.push(row); return chain },
        delete: () => chain,
        single: async () => ({ data: { id: 'new', ...state.inserted.at(-1) }, error: null }),
        then: (resolve: any) => resolve({ data: state.rows, error: null }),
      }
      return chain
    },
  }),
}))

process.env.SUPABASE_URL = 'https://x.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'

function call(method: string, body: any = {}, query: any = {}) {
  const res: any = { status: vi.fn(() => res), json: vi.fn(() => res), setHeader: vi.fn() }
  const req: any = { method, body, query, headers: {}, socket: {} }
  return { req, res }
}

describe('POST /api/school/identity-claims', () => {
  let handler: typeof import('./identity-claims').default
  beforeEach(async () => {
    state.memberships = [{ schoolId: 'school-1', role: 'admin' }]
    state.inserted = []
    handler = (await import('./identity-claims')).default
  })

  it('a teacher is refused — only an admin edits who the links let in', async () => {
    state.memberships = [{ schoolId: 'school-1', role: 'teacher' }]
    const { req, res } = call('POST', { kind: 'address', value: 'supply@gmail.com' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(state.inserted).toHaveLength(0)
  })

  it('a public mail domain can never be claimed, and says why', async () => {
    const { req, res } = call('POST', { kind: 'domain', value: 'gmail.com' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].reason).toBe('public_mail')
    expect(state.inserted).toHaveLength(0)
  })

  it('a named address is let in, lowercased, stamped admin_added on the caller\'s school', async () => {
    const { req, res } = call('POST', { kind: 'address', value: ' Supply.Teacher@Gmail.com ' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(state.inserted[0]).toMatchObject({ school_id: 'school-1', kind: 'address', value: 'supply.teacher@gmail.com', source: 'admin_added', added_by: 'admin-uid' })
  })

  it('a school id from the body never widens the caller onto a school they do not administer', async () => {
    const { req, res } = call('POST', { kind: 'domain', value: 'other.sch.uk', school_id: 'school-9' })
    await handler(req, res)
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
