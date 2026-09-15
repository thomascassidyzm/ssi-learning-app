/**
 * The content gate and the account's own entitlement list resolve access the
 * same way (job #745, 2026-09-14). Before this fix resolveServerCourseAccess
 * read only stored rows + the cascade RPC, so a teacher whom
 * /api/entitlement/user said held a course through class coverage got the
 * preview-only bundle and a 403 on cycles past Yellow. RED on that code.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('./auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-uid-1' })),
}))
vi.mock('./familyAccess', () => ({
  resolveEffectiveSubscription: vi.fn(async () => ({ sub: null })),
}))
vi.mock('./resolveEntitlements', () => ({
  resolveActiveEntitlements: vi.fn(async () => ([
    { id: 'class-coverage', access_type: 'courses', granted_courses: ['cym_s_for_eng'], expires_at: '2027-08-07T01:03:36.898+00:00', redeemed_at: null, entitlement_code_id: null },
  ])),
}))

import { resolveServerCourseAccess } from './courseAccess'
import { resolveActiveEntitlements } from './resolveEntitlements'

// A supabase stub with NO user_entitlements rows and an empty cascade — the
// only thing granting the course is the derived class-coverage layer.
function stubSupabase() {
  const chain = (rows: unknown) => {
    const q: any = {}
    for (const m of ['select', 'eq', 'order', 'limit', 'in', 'is']) q[m] = () => q
    q.maybeSingle = async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null })
    q.single = q.maybeSingle
    q.then = (res: any) => Promise.resolve({ data: rows, error: null }).then(res)
    return q
  }
  return {
    from: (table: string) => {
      if (table === 'learners') return chain([{ id: 'learner-1', platform_role: null, educational_role: 'teacher' }])
      return chain([])
    },
    rpc: async () => ({ data: [], error: null }),
  } as any
}

const premiumWelsh = { course_code: 'cym_s_for_eng', pricing_tier: 'premium', is_community: false, target_lang: 'cym' }
const req = { headers: { authorization: 'Bearer t' } } as any

describe('resolveServerCourseAccess', () => {
  it('grants full access from a DERIVED entitlement layer, exactly as /api/entitlement/user does', async () => {
    const access = await resolveServerCourseAccess(req, stubSupabase(), premiumWelsh)
    expect(vi.mocked(resolveActiveEntitlements)).toHaveBeenCalledWith(expect.anything(), 'auth-uid-1', 'learner-1')
    expect(access.canAccess).toBe(true)
  })

  it('a resolver failure is preview-only for that request, never a full unlock and never a throw', async () => {
    vi.mocked(resolveActiveEntitlements).mockRejectedValueOnce(new Error('rpc down'))
    const access = await resolveServerCourseAccess(req, stubSupabase(), premiumWelsh)
    expect(access.canAccess).toBe(false)
    expect(access.canPreview).toBe(true)
  })

  it('a course the layers do not grant stays preview-only', async () => {
    const access = await resolveServerCourseAccess(req, stubSupabase(), { ...premiumWelsh, course_code: 'spa_for_eng', target_lang: 'spa' })
    expect(access.canAccess).toBe(false)
  })
})
