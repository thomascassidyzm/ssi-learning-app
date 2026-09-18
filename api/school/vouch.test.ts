/**
 * GET/POST /api/school/vouch — ruling 1's "or an admin vouches". The founder
 * can never vouch for herself; a platform admin or a leader above the
 * school can; the stamp lands in the founder's app_metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let caller = 'admin-1'
vi.mock('../_utils/auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: caller })) }))
vi.mock('../_utils/actAsGuard', () => ({ rejectIfViewAs: () => null }))
let platformAdmin = false
let leaderAbove = false
vi.mock('../_utils/classTeacherAuth', () => ({
  isPlatformAdmin: vi.fn(async () => platformAdmin),
  isLeaderAboveClass: vi.fn(async () => leaderAbove),
}))
let held = true
vi.mock('../_utils/schoolProof', async (importOriginal) => {
  const real = await importOriginal<typeof import('../_utils/schoolProof')>()
  return { ...real, schoolEnrolmentHeld: vi.fn(async () => held) }
})
let users: Record<string, any> = {}
let updates: any[] = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'school-1', admin_user_id: 'head-1' }, error: null }) }) }) }),
    auth: { admin: {
      getUserById: async (id: string) => ({ data: { user: users[id] ?? null }, error: null }),
      updateUserById: async (id: string, patch: any) => { updates.push({ id, patch }); return { data: {}, error: null } },
    } },
  }),
}))
function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}
const post = () => ({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { school_id: 'school-1' }, query: {} }) as any as VercelRequest
const get = () => ({ method: 'GET', headers: { authorization: 'Bearer t' }, body: {}, query: { school_id: 'school-1' } }) as any as VercelRequest

describe('/api/school/vouch', () => {
  let handler: typeof import('./vouch').default
  beforeEach(async () => {
    vi.resetModules(); updates = []; held = true; platformAdmin = false; leaderAbove = false; caller = 'admin-1'
    users = {
      'head-1': { id: 'head-1', user_metadata: { onboarded_via: 'possession', setup_door: 'school' }, app_metadata: { provider: 'email' } },
      'admin-1': { id: 'admin-1', user_metadata: {}, app_metadata: {} },
      'coadmin-unproven': { id: 'coadmin-unproven', user_metadata: { onboarded_via: 'possession' }, app_metadata: {} },
    }
    handler = (await import('./vouch')).default
  })
  it('the founder cannot vouch for herself', async () => {
    caller = 'head-1'; platformAdmin = true
    const res = makeRes(); await handler(post(), res)
    expect(res._status).toBe(403); expect(updates).toHaveLength(0)
  })
  it('a stranger cannot vouch', async () => {
    const res = makeRes(); await handler(post(), res)
    expect(res._status).toBe(403)
  })
  it('an unproven co-admin cannot vouch — the door would be vouching for itself', async () => {
    caller = 'coadmin-unproven'; leaderAbove = true
    const res = makeRes(); await handler(post(), res)
    expect(res._status).toBe(403)
  })
  it('a platform admin vouches: the stamp lands in the FOUNDER app_metadata, merged not replaced', async () => {
    platformAdmin = true
    const res = makeRes(); await handler(post(), res)
    expect(res._status).toBe(200); expect(res._json.vouched).toBe(true)
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe('head-1')
    expect(updates[0].patch.app_metadata.provider).toBe('email')
    expect(updates[0].patch.app_metadata.school_vouch).toMatchObject({ school_id: 'school-1', by: 'admin-1' })
  })
  it('a proven leader above the school vouches too', async () => {
    leaderAbove = true
    const res = makeRes(); await handler(post(), res)
    expect(res._status).toBe(200); expect(updates).toHaveLength(1)
  })
  it('GET answers held for the same callers, and POST on an open school writes nothing', async () => {
    platformAdmin = true
    let res = makeRes(); await handler(get(), res)
    expect(res._json).toEqual({ held: true })
    held = false
    res = makeRes(); await handler(post(), res)
    expect(res._json.already_open).toBe(true); expect(updates).toHaveLength(0)
  })
})
