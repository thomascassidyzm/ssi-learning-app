/**
 * Job #681, 2026-09-14. The org lens at /org/<id> is where View As LANDS, and
 * its action bar writes to the group routes — rename, delete, mint demo
 * activity, create a sub-group, mint an invite — every one of which carries a
 * deliberate ssi_admin bypass. So the usual protection ("an ssi_admin has no
 * scope of their own, so the route 403s naturally") does not hold there, and
 * without this guard a tour leaves rows behind in the viewed organisation's
 * name.
 *
 * One test per route, asserting the refusal happens at the ENTRY: verifyAdmin
 * is mocked to SUCCEED here, so a 403 can only have come from the guard. The
 * matching read is asserted to still pass the guard, because a lens that
 * renders nothing is not a tour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('./auth', () => ({
  verifyAdmin: vi.fn(async () => ({ valid: true, isAdmin: true, userId: 'admin-1' })),
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'admin-1' })),
  verifyAuth: vi.fn(async () => ({ valid: true, userId: 'admin-1' })),
}))

function req(method: string, viewAs: boolean): VercelRequest {
  return {
    method,
    query: { id: 'g1' },
    body: {},
    headers: { authorization: 'Bearer tok', ...(viewAs ? { 'x-ssi-view-as': '1' } : {}) },
  } as any
}

function res(): VercelResponse & { statusCode?: number; body?: any } {
  const r: any = {}
  r.setHeader = vi.fn()
  r.status = vi.fn((code: number) => { r.statusCode = code; return r })
  r.json = vi.fn((body: any) => { r.body = body; return r })
  r.end = vi.fn()
  return r
}

const ROUTES: Array<{ name: string; load: () => Promise<any>; write: string; read?: string }> = [
  { name: 'POST /api/groups', load: () => import('../groups/index'), write: 'POST', read: 'GET' },
  { name: 'PATCH /api/groups/:id', load: () => import('../groups/[id]'), write: 'PATCH', read: 'GET' },
  { name: 'DELETE /api/groups/:id', load: () => import('../groups/[id]'), write: 'DELETE' },
  { name: 'POST /api/groups/:id/invites', load: () => import('../groups/[id]/invites'), write: 'POST', read: 'GET' },
  { name: 'POST /api/groups/:id/demo-mint', load: () => import('../groups/[id]/demo-mint'), write: 'POST' },
  { name: 'POST /api/groups/:id/demo-refresh', load: () => import('../groups/[id]/demo-refresh'), write: 'POST' },
  { name: 'POST /api/admin/create-school', load: () => import('../admin/create-school'), write: 'POST' },
  { name: 'PATCH /api/admin/update-school', load: () => import('../admin/update-school'), write: 'PATCH', read: 'GET' },
  { name: 'DELETE /api/admin/update-school', load: () => import('../admin/update-school'), write: 'DELETE' },
]

describe('View As never writes in the viewed organisation\'s name', () => {
  beforeEach(() => { vi.resetModules() })

  for (const route of ROUTES) {
    it(`${route.name} is refused while viewing as`, async () => {
      const handler = (await route.load()).default
      const r = res()
      await handler(req(route.write, true), r)
      expect(r.statusCode).toBe(403)
      expect(String(r.body?.error)).toContain('viewing as')
    })

    if (route.read) {
      it(`${route.name.replace(/^\w+/, route.read)} still passes the guard while viewing as`, async () => {
        const handler = (await route.load()).default
        const r = res()
        await handler(req(route.read, true), r)
        expect(r.statusCode).not.toBe(403)
      })
    }
  }
})
