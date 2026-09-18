/**
 * POST /api/onboarding/provision — the domain claim rests on a PROVEN address.
 *
 * Job #188 (2026-09-18): the school door mints its session with no code
 * (api/auth/setup-mint.ts), so the founding admin behind a provision call may
 * be an address somebody merely typed. A domain claim written on a typed
 * address is "anyone can claim the domain" — the thing Tom named. This proves
 * the gate: an unproven founding admin provisions a working school and claims
 * NOTHING; a proven one claims as before.
 *
 * Seen red on the pre-fix provision.ts (claim written for the unproven admin)
 * and green after.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-head-1' })),
}))
vi.mock('../_utils/schoolJoinCodes', () => ({ ensureJoinCodesRegistered: vi.fn(async () => undefined) }))
vi.mock('../_utils/schoolPlatformTrial', () => ({
  provisionSchoolPlatformTrial: vi.fn(async () => ({ trial: null, burned: false, denied: false })),
  provisionTutorPlatformTrial: vi.fn(async () => ({ trial: null, burned: false })),
}))
vi.mock('../_utils/classLearnerEntity', () => ({ ensureClassLearnerEntity: vi.fn(async () => ({ learnerId: 'shadow-1' })) }))
vi.mock('../_utils/emailValidation', () => ({ isDisposableEmailDomain: vi.fn(() => false) }))

const claimDomainForSchool = vi.fn(async () => ({ status: 'claimed', domain: 'ysgol.cymru' }))
vi.mock('../_utils/schoolDomain', () => ({
  claimDomainForSchool: (...args: any[]) => (claimDomainForSchool as any)(...args),
  schoolsClaimingDomainOf: vi.fn(async () => []),
}))

/** The auth user provision resolves for the session. Swapped per test. */
let authUser: Record<string, unknown> = { email: 'head@ysgol.cymru' }

function makeChainable(table: string) {
  const calls: any[][] = []
  const resolve = () => {
    if (table === 'courses') return { data: { course_code: 'cym_for_eng', pricing_tier: 'free', new_app_status: 'live' }, error: null }
    if (table === 'learners' && calls.some((c) => c[0] === 'select'))
      return { data: { id: 'learner-1', display_name: 'Head', educational_role: null, platform_role: null }, error: null }
    if (table === 'schools' && calls.some((c) => c[0] === 'insert')) return { data: { id: 'school-new' }, error: null }
    return { data: null, error: null }
  }
  const b: any = {}
  for (const op of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'neq', 'gte', 'in', 'order', 'limit']) {
    b[op] = (...a: unknown[]) => { calls.push([op, ...a]); return b }
  }
  b.maybeSingle = () => Promise.resolve(resolve())
  b.single = () => Promise.resolve(resolve())
  b.then = (onF: any, onR: any) => Promise.resolve(resolve()).then(onF, onR)
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: authUser } }) } },
  }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}
const req = () => ({ method: 'POST', query: {}, headers: {}, body: { track: 'school', course_code: 'cym_for_eng' } }) as unknown as VercelRequest

describe('provision — the founding admin claims the domain only once the mailbox is proved', () => {
  let handler: typeof import('./provision').default
  beforeEach(async () => {
    vi.resetModules()
    claimDomainForSchool.mockClear()
    handler = (await import('./provision')).default
  })

  it('an UNPROVEN founding admin (minted at the door, no code) gets a working school and NO domain claim', async () => {
    authUser = { email: 'head@ysgol.cymru', user_metadata: { onboarded_via: 'possession', setup_door: 'school' } }
    const res = makeRes()
    await handler(req(), res)
    expect(res._status).toBe(200)
    expect(res._json?.role).toBe('school_admin')
    expect(claimDomainForSchool).not.toHaveBeenCalled()
  })

  it('a PROVEN founding admin claims, exactly as before', async () => {
    authUser = { email: 'head@ysgol.cymru', user_metadata: { onboarded_via: 'possession', email_confirmed_manually: true } }
    const res = makeRes()
    await handler(req(), res)
    expect(res._status).toBe(200)
    expect(claimDomainForSchool).toHaveBeenCalledTimes(1)
    expect((claimDomainForSchool.mock.calls[0] as any)[1]).toMatchObject({ schoolId: 'school-new', email: 'head@ysgol.cymru', source: 'founding_admin' })
  })

  it('an OTP-proven admin with no possession marker claims too (the tutor/org shape, and every pre-#188 school)', async () => {
    authUser = { email: 'head@ysgol.cymru', user_metadata: {} }
    const res = makeRes()
    await handler(req(), res)
    expect(res._status).toBe(200)
    expect(claimDomainForSchool).toHaveBeenCalledTimes(1)
  })
})
