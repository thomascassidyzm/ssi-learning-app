/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`: REGRESSION LOCKS for the controls
 * that hold.
 *
 * Every handler in api/school/** builds a SUPABASE_SERVICE_ROLE_KEY client, so
 * RLS is bypassed by design and the handler's own gate is the entire tenancy
 * boundary (CLAUDE.md RLS doctrine: RLS answers only "is this my row?";
 * hierarchy authz lives in server-mediated endpoints).
 *
 * The audit found no read/write asymmetry anywhere in this directory: the same
 * `resolveVisibleScope(...).classIds.includes(classId)` gate guards the reads
 * and the destructive writes alike. These tests lock that in — a future edit
 * that drops the gate, or that starts trusting a body/query id, turns them red.
 *
 * Locks: api/school/rename-class.ts:59, api/school/delete-class.ts:61
 *        (and the shape shared with api/school/class-progress.ts:399).
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

const OWN_CLASS = 'class-mine'
const OTHER_TENANT_CLASS = 'class-theirs'

let authResult: any
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
  verifyAdmin: vi.fn(async () => ({ error: 'not admin', status: 403 })),
}))

let scope: any
vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: vi.fn(async () => scope),
}))

/** Records any write that gets past the gate — there should be none. */
let updates: { table: string; values: Record<string, unknown>; id: unknown }[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      let pending: Record<string, unknown> | null = null
      const builder: any = {}
      builder.select = () => builder
      builder.update = (values: Record<string, unknown>) => { pending = values; return builder }
      builder.eq = (_c: string, val: unknown) => {
        if (pending) { updates.push({ table, values: pending, id: val }); pending = null }
        return builder
      }
      builder.is = () => builder
      builder.maybeSingle = () => Promise.resolve({ data: { id: OWN_CLASS, class_name: 'Renamed' }, error: null })
      builder.single = () => Promise.resolve({ data: { id: OWN_CLASS, class_name: 'Renamed' }, error: null })
      builder.then = (resolve: any) => resolve({ data: [], error: null })
      return builder
    },
  }),
}))

// The cascade must never be reached for an out-of-scope class.
const deleteCascade = vi.fn(async () => undefined)
vi.mock('../_utils/schoolGroupDeletion', () => ({
  computeClassImpact: vi.fn(async () => ({ className: 'Their Class', hasRealActivity: false, sessions: 0, learners: 0, teachers: 0 })),
  deleteClassCascade: deleteCascade,
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn()
  return res
}

let renameHandler: typeof import('./rename-class').default
let deleteHandler: typeof import('./delete-class').default

beforeEach(async () => {
  updates = []
  deleteCascade.mockClear()
  authResult = { valid: true, userId: 'teacher-uid' }
  scope = { learnerId: 'l-1', role: 'teacher', classIds: [OWN_CLASS], learnerIds: [], studentsByClass: {}, schoolIds: [], groupId: null }
  renameHandler = (await import('./rename-class')).default
  deleteHandler = (await import('./delete-class')).default
})

describe('CONTROL — rename-class enforces the visible-scope gate on the WRITE path', () => {
  it('renames a class inside the caller’s scope', async () => {
    const req = { method: 'POST', body: { class_id: OWN_CLASS, class_name: 'Year 8' }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res = makeRes()
    await renameHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(updates.filter((u) => u.table === 'classes')).toHaveLength(1)
  })

  it('403s and writes NOTHING for another tenant’s class id', async () => {
    const req = { method: 'POST', body: { class_id: OTHER_TENANT_CLASS, class_name: 'Pwned' }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res = makeRes()
    await renameHandler(req, res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('Not your class')
    expect(updates).toHaveLength(0)
  })

  it('401s before touching scope when the token is invalid', async () => {
    authResult = { valid: false, error: 'Invalid token' }
    const req = { method: 'POST', body: { class_id: OWN_CLASS, class_name: 'x' }, headers: {} } as unknown as VercelRequest
    const res = makeRes()
    await renameHandler(req, res)
    expect(res.statusCode).toBe(401)
    expect(updates).toHaveLength(0)
  })
})

describe('CONTROL — delete-class enforces the SAME gate on both its methods', () => {
  it('403s the GET impact preview for another tenant’s class', async () => {
    const req = { method: 'GET', query: { class_id: OTHER_TENANT_CLASS }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res = makeRes()
    await deleteHandler(req, res)
    expect(res.statusCode).toBe(403)
  })

  it('403s the POST delete for another tenant’s class and never reaches the cascade', async () => {
    const req = { method: 'POST', body: { class_id: OTHER_TENANT_CLASS }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res = makeRes()
    await deleteHandler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteCascade).not.toHaveBeenCalled()
  })

  it('allows the delete for a class inside the caller’s scope', async () => {
    const req = { method: 'POST', body: { class_id: OWN_CLASS }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res = makeRes()
    await deleteHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(deleteCascade).toHaveBeenCalledWith(expect.anything(), OWN_CLASS)
  })

  it('a caller with an EMPTY scope can delete nothing', async () => {
    scope = { ...scope, classIds: [] }
    const req = { method: 'POST', body: { class_id: OWN_CLASS }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res = makeRes()
    await deleteHandler(req, res)
    expect(res.statusCode).toBe(403)
    expect(deleteCascade).not.toHaveBeenCalled()
  })
})
