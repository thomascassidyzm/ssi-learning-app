/**
 * The server-side content gate must answer the SAME question the player asks.
 *
 * Found 2026-09-10 while writing down the entitlement-scope ruling: this gate
 * (bundle / cycles / infplay-cycles) read own subscription + stored
 * user_entitlements + the entitlement_grants cascade, and NOTHING ELSE — while
 * the player's own answer (resolveEntitlements.ts, served by
 * /api/entitlement/user) also carries class coverage, org coverage and
 * school-staff coverage. A school's self-serve signup deliberately writes no
 * entitlement_grants row (provision.ts), so an institution seat — a Chepstow
 * pupil on the school's Welsh trial — had NO layer here that could see it and
 * was sliced to the free preview. It played past seed 19 only because the
 * legacy anon-key script path is still live and is gated by the client.
 *
 * Tom's ruling the same day: an institution seat plays the languages the
 * institution licenses; £5 from ANY learner opens all courses, all languages.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest } from '@vercel/node'

let subResult: any = { sub: null, viaFamily: false, coverEndsAt: null }
let resolved: any[] = []

vi.mock('./auth', () => ({ verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })) }))
vi.mock('./familyAccess', () => ({ resolveEffectiveSubscription: vi.fn(async () => subResult) }))
vi.mock('./resolveEntitlements', () => ({ resolveActiveEntitlements: vi.fn(async () => resolved) }))

function fakeSupabase() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: { id: 'learner-1', platform_role: null, educational_role: 'student' }, error: null }),
    then: (onF: any) => Promise.resolve({ data: [], error: null }).then(onF),
  }
  return { from: () => builder, rpc: async () => ({ data: null, error: null }) } as any
}
const req = { headers: { authorization: 'Bearer tok' } } as unknown as VercelRequest
const WELSH = { course_code: 'cym_s_for_eng', pricing_tier: 'premium', is_community: false }
const SPANISH = { course_code: 'spa_for_eng', pricing_tier: 'premium', is_community: false }

describe('resolveServerCourseAccess — institution seat and paid seat', () => {
  let resolveServerCourseAccess: typeof import('./courseAccess').resolveServerCourseAccess
  beforeEach(async () => {
    vi.resetModules()
    subResult = { sub: null, viaFamily: false, coverEndsAt: null }
    resolved = []
    resolveServerCourseAccess = (await import('./courseAccess')).resolveServerCourseAccess
  })

  it('an INSTITUTION SEAT gets its class course in full, and only that course', async () => {
    resolved = [{ id: 'class-coverage', access_type: 'courses', granted_courses: ['cym_s_for_eng'], expires_at: '2027-07-16T00:00:00Z', redeemed_at: null, entitlement_code_id: null }]
    const welsh = await resolveServerCourseAccess(req, fakeSupabase(), WELSH)
    expect(welsh.canAccess).toBe(true)
    const spanish = await resolveServerCourseAccess(req, fakeSupabase(), SPANISH)
    expect(spanish.canAccess).toBe(false)
    expect(spanish.reason).toBe('preview_only')
  })

  it('a £5 SSi Student Access seat opens every premium course, whatever class it came through', async () => {
    subResult = { sub: { status: 'active', current_period_end: '2099-01-01T00:00:00Z', plan_name: 'SSi Student Access' }, viaFamily: false, coverEndsAt: null }
    const spanish = await resolveServerCourseAccess(req, fakeSupabase(), SPANISH)
    expect(spanish.canAccess).toBe(true)
    expect(spanish.reason).toBe('subscribed')
  })
})
