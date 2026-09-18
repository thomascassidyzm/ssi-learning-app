/**
 * TOM'S RULING 1 (job #195, 2026-09-18): an unproven school can build but
 * not enrol. Every route that turns a pupil code into a child's membership
 * asks api/_utils/schoolProof.ts first, and a held school refuses with the
 * line that names what unblocks it. Before this gate none of these routes
 * consulted the school's proof at all — these tests fail on that code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let held = false
let claimRpcCalls = 0
vi.mock('../_utils/schoolProof', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_utils/schoolProof')>()
  return {
    ...real,
    classEnrolmentHeld: vi.fn(async () => held),
    schoolEnrolmentHeld: vi.fn(async () => held),
  }
})
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'pupil-1' })),
}))
vi.mock('../_utils/operatorGuard', () => ({ isOperatorAccount: vi.fn(async () => false), OPERATOR_CAPTURE_ERROR: 'x' }))

const inviteRow = {
  id: 'inv-1', code: 'ABC-123', code_type: 'student', grants_class_id: 'class-1',
  grants_school_id: null, grants_group_id: null, grants_region: null, metadata: {},
  max_uses: null, use_count: 0, expires_at: null, is_active: true,
}
const classRow = { id: 'class-1', class_name: '3B', course_code: 'cym_for_eng', teacher_user_id: 't1', is_active: true, student_join_code: 'ABC-123', school_id: 'school-1', group_id: null }

function chain(table: string) {
  const calls: any[][] = []
  const b: any = {}
  for (const op of ['select', 'eq', 'neq', 'is', 'in', 'order', 'limit', 'contains']) b[op] = (...a: any[]) => { calls.push([op, ...a]); return b }
  b.insert = () => Promise.resolve({ error: null })
  b.update = () => b
  b.upsert = () => Promise.resolve({ error: null })
  b.gte = () => Promise.resolve({ count: 0, error: null })
  const resolve = () => {
    if (table === 'invite_codes' || table === 'invite_code_validation') return { data: inviteRow, error: null }
    if (table === 'classes') return { data: classRow, error: null }
    if (table === 'schools') return { data: { school_name: 'Ysgol', platform_status: 'trial', admin_user_id: 'head-1' }, error: null }
    if (table === 'learners') return { data: { id: 'learner-1', display_name: 'P', platform_role: null, educational_role: null }, error: null }
    return { data: null, error: null, count: 0 }
  }
  b.maybeSingle = () => Promise.resolve(resolve())
  b.single = () => Promise.resolve(resolve())
  b.then = (onF: any, onR: any) => Promise.resolve(resolve()).then(onF, onR)
  return b
}
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => chain(table),
    rpc: (name: string, params: any) => {
      if (name === 'claim_invite_code_use') claimRpcCalls += 1
      return Promise.resolve({ data: params?.p_id ?? null, error: null })
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { id: 'pupil-1', email: 'p@example.org', user_metadata: {} } } }) } },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}
const req = (over: Partial<VercelRequest>) => ({ method: 'POST', headers: { authorization: 'Bearer tok' }, query: {}, body: {}, socket: { remoteAddress: '10.0.0.1' }, ...over }) as any as VercelRequest

describe('a pupil code on a held school', () => {
  beforeEach(() => { vi.resetModules(); claimRpcCalls = 0 })

  it('POST /api/code/redeem refuses it before a use is claimed, and lets it through once open', async () => {
    const handler = (await import('./redeem')).default
    held = true
    let res = makeRes()
    await handler(req({ body: { code: 'ABC-123', codeKind: 'invite' } }), res)
    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(res._json.code).toBe('enrolment_held')
    expect(res._json.error).toMatch(/confirming first/)
    expect(claimRpcCalls).toBe(0)

    held = false
    res = makeRes()
    await handler(req({ body: { code: 'ABC-123', codeKind: 'invite' } }), res)
    expect(res._json.code).not.toBe('enrolment_held')
    expect(claimRpcCalls).toBe(1)
  })

  it('POST /api/code/validate answers valid:false with the line, and gives no class name away', async () => {
    const handler = (await import('./validate')).default
    held = true
    const res = makeRes()
    await handler(req({ body: { code: 'ABC-123' } }), res)
    expect(res._status).toBe(200)
    expect(res._json.valid).toBe(false)
    expect(res._json.code).toBe('enrolment_held')
    expect(JSON.stringify(res._json)).not.toContain('3B')
  })

  it('GET /api/teacher/by-code says the class link is unavailable, with the line', async () => {
    const handler = (await import('../teacher/by-code')).default
    held = true
    let res = makeRes()
    await handler(req({ method: 'GET', query: { code: 'ABC-123' } }), res)
    expect(res._status).toBe(404)
    expect(res._json.reason).toBe('unavailable')
    expect(res._json.message).toMatch(/confirming first/)

    held = false
    res = makeRes()
    await handler(req({ method: 'GET', query: { code: 'ABC-123' } }), res)
    expect(res._status).toBe(200)
  })
})
