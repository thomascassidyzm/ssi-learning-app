/**
 * GET /api/admin/test-doors — the privilege, enforced where the claimant cannot
 * reach it.
 *
 * Tom's ruling, 2026-08-31: "a client-side-only admin check is not a permission,
 * it is a suggestion." The client's `isSsiAdmin` is rehydrated from
 * localStorage, so it is forgeable by exactly the person it gates. This route is
 * the fact behind that claim, and these tests pin the four answers that matter —
 * including the one that is NOT a denial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

let adminResult: { userId: string } | { error: string; status: number; userId?: string }
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => adminResult),
}))

import handler from './test-doors'

function makeRes() {
  const res = {
    statusCode: 0,
    body: null as any,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v },
    status(code: number) { this.statusCode = code; return this },
    json(payload: any) { this.body = payload; return this },
  }
  return res as unknown as VercelResponse & typeof res
}

const GET = { method: 'GET', headers: {} } as unknown as VercelRequest

describe('GET /api/admin/test-doors', () => {
  beforeEach(() => {
    adminResult = { userId: 'admin-uid' }
  })

  it('allows a verified ssi_admin', async () => {
    const res = makeRes()
    await handler(GET, res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ allowed: true, userId: 'admin-uid' })
  })

  it('refuses an ordinary learner with 403 and allowed:false', async () => {
    // The whole point: a forged localStorage role gets this far and no further.
    adminResult = { error: 'Requires SSi admin access', status: 403, userId: 'learner-uid' }
    const res = makeRes()
    await handler(GET, res)
    expect(res.statusCode).toBe(403)
    expect(res.body.allowed).toBe(false)
  })

  it('refuses an unauthenticated caller with 401', async () => {
    adminResult = { error: 'Unauthorized', status: 401 }
    const res = makeRes()
    await handler(GET, res)
    expect(res.statusCode).toBe(401)
    expect(res.body.allowed).toBe(false)
  })

  it('surfaces a verification failure as 500 rather than a quiet denial', async () => {
    // A transient RLS/network blip must stay distinguishable from a demotion,
    // or a real admin silently loses their controls with nothing to read.
    adminResult = { error: 'Admin verification failed', status: 500 }
    const res = makeRes()
    await handler(GET, res)
    expect(res.statusCode).toBe(500)
  })

  it('never lets a 200 be cached — a revoked role must not outlive its grant', async () => {
    const res = makeRes()
    await handler(GET, res)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('rejects anything but GET', async () => {
    const res = makeRes()
    await handler({ method: 'POST', headers: {} } as unknown as VercelRequest, res)
    expect(res.statusCode).toBe(405)
  })
})
