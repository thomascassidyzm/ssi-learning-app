/**
 * Security audit 2026-08-11 — area 4 (admin-entitlement).
 * See docs/security-audit-2026-08-11/admin-entitlement.md
 *
 * Regression locks for the ADMIN AUTHORIZATION table: the money-adjacent admin
 * handlers must refuse an unauthenticated caller AND an authenticated non-admin
 * one. These are controls that HOLD — they are pinned here so a refactor that
 * drops a gate fails loudly rather than silently opening a grant endpoint.
 *
 * Also characterizes ADMIN-ENT-12 (grant/revoke hand-roll a narrower admin
 * check than verifyAdmin's).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

// ── auth seam ──────────────────────────────────────────────────────────────
let authResult: { valid: boolean; userId?: string; error?: string } = {
  valid: true,
  userId: 'caller-uid',
}
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
  getAuthUserId: vi.fn(async () => (authResult.valid ? authResult.userId ?? null : null)),
  verifyAdmin: vi.fn(async () =>
    authResult.valid && authResult.userId
      ? { userId: authResult.userId }
      : { error: authResult.error || 'Unauthorized', status: 401 },
  ),
}))

// ── supabase seam: per-table responders + write recorder ───────────────────
let writes: Record<string, Array<{ op: string; payload: unknown }>> = {}
let responders: Record<string, (calls: unknown[][]) => unknown> = {}

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: unknown[][] = []
  const builder: any = {
    select: (c?: string) => { calls.push(['select', c]); return builder },
    insert: (o: unknown) => { calls.push(['insert', o]); recordWrite(table, 'insert', o); return builder },
    update: (o: unknown) => { calls.push(['update', o]); recordWrite(table, 'update', o); return builder },
    delete: () => { calls.push(['delete']); recordWrite(table, 'delete', undefined); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    order: () => { calls.push(['order']); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) { const r = respond(calls); if (r !== undefined) return r }
      return { data: null, error: null }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

let rpcCalls: Array<{ name: string; params: unknown }> = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: (name: string, params: unknown) => {
      rpcCalls.push({ name, params })
      return { then: (onF: any, onR: any) => Promise.resolve({ data: null, error: null }).then(onF, onR) }
    },
  }),
}))

function makeReq(body: unknown = {}, method = 'POST', query: Record<string, unknown> = {}): VercelRequest {
  return { method, headers: { authorization: 'Bearer t' }, body, query } as unknown as VercelRequest
}

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

/** The learners row the handler reads to decide whether the caller is an admin. */
function callerRole(role: string | null, eduRole: string | null = null) {
  responders.learners = () => ({
    data: role === null && eduRole === null ? null : { platform_role: role, educational_role: eduRole },
    error: null,
  })
}

beforeEach(() => {
  vi.resetModules()
  writes = {}
  responders = {}
  rpcCalls = []
  authResult = { valid: true, userId: 'caller-uid' }
})

describe('POST /api/admin/grant-entitlement — admin gate', () => {
  async function load() {
    return (await import('./grant-entitlement')).default
  }

  it('405s a non-POST method before touching auth', async () => {
    const res = makeRes()
    await (await load())(makeReq({}, 'GET'), res)
    expect(res._status).toBe(405)
  })

  it('401s an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const res = makeRes()
    await (await load())(makeReq({ learner_id: 'l1', access_type: 'full', duration_type: 'lifetime' }), res)
    expect(res._status).toBe(401)
    expect(writes.user_entitlements).toBeUndefined()
  })

  it('403s an authenticated NON-admin and writes no entitlement', async () => {
    callerRole('tester')
    const res = makeRes()
    await (await load())(
      makeReq({ learner_id: 'victim', access_type: 'full', duration_type: 'lifetime' }),
      res,
    )
    expect(res._status).toBe(403)
    expect(writes.user_entitlements).toBeUndefined()
  })

  it('403s a caller with no learners row at all', async () => {
    callerRole(null)
    const res = makeRes()
    await (await load())(
      makeReq({ learner_id: 'victim', access_type: 'full', duration_type: 'lifetime' }),
      res,
    )
    expect(res._status).toBe(403)
    expect(writes.user_entitlements).toBeUndefined()
  })

  // SECURITY FINDING ADMIN-ENT-12: api/admin/grant-entitlement.ts:39 hand-rolls
  // `platform_role !== 'ssi_admin'`, which is NARROWER than verifyAdmin
  // (api/_utils/auth.ts:114 also accepts educational_role === 'god'). Not a
  // hole — it is stricter — but it is a second, drifting definition of "admin".
  // Should be: both call the same shared helper.
  it('ADMIN-ENT-12: rejects a god-role caller that verifyAdmin would accept', async () => {
    callerRole(null, 'god')
    const res = makeRes()
    await (await load())(
      makeReq({ learner_id: 'l1', access_type: 'full', duration_type: 'lifetime' }),
      res,
    )
    expect(res._status).toBe(403)
  })

  it.todo(
    'ADMIN-ENT-12: grant-entitlement should delegate to the shared verifyAdmin helper so the admin definition cannot drift',
  )

  it('lets a real ssi_admin through and writes the entitlement', async () => {
    callerRole('ssi_admin')
    responders.user_entitlements = () => ({ data: { id: 'ent-1' }, error: null })
    const res = makeRes()
    await (await load())(
      makeReq({ learner_id: 'l1', access_type: 'full', duration_type: 'lifetime' }),
      res,
    )
    expect(res._status).toBe(201)
    expect(writes.user_entitlements?.[0]?.op).toBe('insert')
  })
})

describe('POST /api/admin/revoke-entitlement — admin gate', () => {
  async function load() {
    return (await import('./revoke-entitlement')).default
  }

  it('401s an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Empty token' }
    const res = makeRes()
    await (await load())(makeReq({ entitlement_id: 'ent-1' }), res)
    expect(res._status).toBe(401)
    expect(writes.user_entitlements).toBeUndefined()
  })

  it('403s an authenticated NON-admin and deletes nothing', async () => {
    callerRole('popty_user')
    const res = makeRes()
    await (await load())(makeReq({ entitlement_id: 'ent-1' }), res)
    expect(res._status).toBe(403)
    expect(writes.user_entitlements).toBeUndefined()
  })
})

describe('GET/POST /api/admin/codes — scoped, not admin-only (by design)', () => {
  async function load() {
    return (await import('./codes')).default
  }

  it('401s an unauthenticated caller', async () => {
    authResult = { valid: false, error: 'Missing or invalid Authorization header' }
    const res = makeRes()
    await (await load())(makeReq({}, 'GET'), res)
    expect(res._status).toBe(401)
  })

  it('scopes a non-admin GET to codes they created themselves', async () => {
    callerRole('tester')
    let inviteCalls: unknown[][] = []
    responders.invite_codes = (calls) => { inviteCalls = calls; return { data: [], error: null } }
    const res = makeRes()
    await (await load())(makeReq({}, 'GET'), res)
    expect(res._status).toBe(200)
    // The created_by filter is what makes an un-gated GET safe.
    expect(inviteCalls).toContainEqual(['eq', 'created_by', 'caller-uid'])
  })

  it('does NOT scope an ssi_admin GET', async () => {
    callerRole('ssi_admin')
    let inviteCalls: unknown[][] = []
    responders.invite_codes = (calls) => { inviteCalls = calls; return { data: [], error: null } }
    const res = makeRes()
    await (await load())(makeReq({}, 'GET'), res)
    expect(res._status).toBe(200)
    expect(inviteCalls.some((c) => c[0] === 'eq' && c[1] === 'created_by')).toBe(false)
  })

  it('403s a non-admin trying to toggle an entitlement code', async () => {
    callerRole('tester')
    const res = makeRes()
    await (await load())(makeReq({ kind: 'entitlement', id: 'code-1', is_active: false }), res)
    expect(res._status).toBe(403)
    expect(writes.entitlement_codes).toBeUndefined()
  })

  it("403s a non-admin trying to toggle someone else's invite code", async () => {
    callerRole('tester')
    responders.invite_codes = () => ({ data: { created_by: 'someone-else' }, error: null })
    const res = makeRes()
    await (await load())(makeReq({ kind: 'invite', id: 'code-1', is_active: false }), res)
    expect(res._status).toBe(403)
    expect(writes.invite_codes).toBeUndefined()
  })
})

describe('POST /api/admin/update-user-role — escalation guards', () => {
  async function load() {
    return (await import('./update-user-role')).default
  }

  it('rejects a platform_role value outside the allowlist', async () => {
    const res = makeRes()
    await (await load())(makeReq({ learner_id: 'l1', field: 'platform_role', value: 'superuser' }), res)
    expect(res._status).toBe(400)
    expect(writes.learners).toBeUndefined()
  })

  it('rejects a field other than platform_role / educational_role', async () => {
    const res = makeRes()
    await (await load())(makeReq({ learner_id: 'l1', field: 'verified_emails', value: 'x' }), res)
    expect(res._status).toBe(400)
    expect(writes.learners).toBeUndefined()
  })

  it('refuses an admin changing their OWN platform_role (self-promotion guard)', async () => {
    responders.learners = () => ({
      data: { id: 'l1', user_id: 'caller-uid', platform_role: 'ssi_admin', educational_role: null },
      error: null,
    })
    const res = makeRes()
    await (await load())(makeReq({ learner_id: 'l1', field: 'platform_role', value: 'ssi_admin' }), res)
    expect(res._status).toBe(403)
    expect(writes.learners).toBeUndefined()
  })

  // 'god' is refused for ANY target, self or not, by the value allowlist at
  // update-user-role.ts:32 — which fires (400) before the self-grant guard at
  // :114 (403) is reached. So the guard is defence in depth over an allowlist
  // that already excludes the role; both layers are pinned here.
  it('refuses granting the god educational_role to anyone (allowlist, before the self-guard)', async () => {
    responders.learners = () => ({
      data: { id: 'l1', user_id: 'caller-uid', platform_role: 'ssi_admin', educational_role: null },
      error: null,
    })
    const res = makeRes()
    await (await load())(makeReq({ learner_id: 'l1', field: 'educational_role', value: 'god' }), res)
    expect(res._status).toBe(400)
    expect(writes.learners).toBeUndefined()
  })

  it('refuses granting god to ANOTHER learner too', async () => {
    responders.learners = () => ({
      data: { id: 'l2', user_id: 'other-uid', platform_role: null, educational_role: 'teacher' },
      error: null,
    })
    const res = makeRes()
    await (await load())(makeReq({ learner_id: 'l2', field: 'educational_role', value: 'god' }), res)
    expect(res._status).toBe(400)
    expect(writes.learners).toBeUndefined()
  })
})
