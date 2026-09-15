import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('./auth', () => ({ verifyAuthToken: async () => ({ valid: true, userId: 'auth' }) }))
const state = vi.hoisted(() => ({ subscription: { sub: null } as any }))
vi.mock('./familyAccess', () => ({ resolveEffectiveSubscription: async () => state.subscription }))
beforeEach(() => { state.subscription = { sub: null } })
vi.mock('./classCoverage', () => ({ resolveClassCourseCoverage: async () => ({ courses: [] }) }))
vi.mock('./orgCoverage', () => ({ resolveOrgCourseCoverage: async () => ({ courses: [] }) }))
vi.mock('./schoolCoverage', () => ({ resolveSchoolStaffCourseCoverage: async () => ({ courses: [] }) }))
import { resolveServerCourseAccess } from './courseAccess'
it('opens for an active grant and walls the same learner after revocation or before the start', async () => {
  const grant: any = { id: 'g', access_type: 'full', granted_courses: null,
    redeemed_at: '2020-01-01', expires_at: null, revoked_at: null, starts_at: null }
  const db: any = { from: (table: string) => ({ select: () => ({ eq: () =>
    table === 'learners' ? { maybeSingle: async () => ({ data: { id: 'learner' } }) }
      : Promise.resolve({ data: [grant] }) }) }), rpc: async () => ({ data: [] }) }
  const check = () => resolveServerCourseAccess({ headers: {} } as any, db,
    { course_code: 'cym_s_for_eng', pricing_tier: 'premium', is_community: false })
  expect((await check()).canAccess).toBe(true)
  grant.revoked_at = '2025-01-01'
  expect((await check()).canAccess).toBe(false)
  grant.revoked_at = null
  grant.starts_at = '2999-01-01'
  expect((await check()).canAccess).toBe(false)
  grant.starts_at = null
  grant.expires_at = '2020-01-02'
  expect((await check()).canAccess).toBe(false)
})

it('a revoked Paddle grant cannot be bypassed through the retained subscription row', async () => {
  state.subscription = { sub: { provider: 'paddle', provider_subscription_id: 'sub', status: 'active', current_period_end: '2999-01-01' }, viaFamily: false }
  const grant = { id: 'g', access_type: 'full', redeemed_at: '2020-01-01', revoked_at: '2025-01-01', expires_at: null }
  const db: any = { from(table: string) {
    const q: any = { select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === 'learners' ? { id: 'learner' } : grant }),
      then: (resolve: any) => Promise.resolve({ data: [grant] }).then(resolve) }
    return q
  }, rpc: async () => ({ data: [] }) }
  const course = { course_code: 'welsh', pricing_tier: 'premium', is_community: false }
  expect((await resolveServerCourseAccess({ headers: {} } as any, db, course)).canAccess).toBe(false)
  state.subscription.viaFamily = true
  expect((await resolveServerCourseAccess({ headers: {} } as any, db, course)).canAccess).toBe(true)
})
