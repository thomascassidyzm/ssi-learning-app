/**
 * The grant that answers "should this learner ever be shown a price?".
 *
 * Two things are pinned here, and both of them are ways the Canolfan free
 * year could be silently taken back off a learner:
 *
 *   - THE CONDITION IS free_access_until ALONE. cancellation_state reads like
 *     a kill switch and is not one: it records what happened to the learner's
 *     own PRIOR paid subscription, and its 'needed' value marks precisely the
 *     people who are currently paying twice. Filtering on it would upsell the
 *     very learners with most reason to feel cheated.
 *   - A FAILED QUERY IS NOT A NO. It returns null, which is what the app
 *     already did before any of this existed — never an exception thrown out
 *     of /api/subscription, which would blank the settings screen.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveOrgFreeAccess } from './orgFreeAccess'

const FUTURE = new Date(Date.now() + 300 * 24 * 3600 * 1000).toISOString()

/** Minimal PostgREST-shaped stub: records the filters, returns the rows.
 *  The entitlements query has no terminal call, so the chain is thenable. */
function stubClient(opts: {
  enrolments?: unknown[]
  enrolmentError?: unknown
  policy?: unknown
  entitlements?: unknown[]
  onFilter?: (f: { column: string; value: unknown; op: string }) => void
}) {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    chain.select = self
    chain.eq = (column: string, value: unknown) => { opts.onFilter?.({ column, value, op: 'eq' }); return chain }
    chain.gt = (column: string, value: unknown) => { opts.onFilter?.({ column, value, op: 'gt' }); return chain }
    chain.order = self
    chain.limit = () =>
      Promise.resolve({ data: opts.enrolments ?? [], error: opts.enrolmentError ?? null })
    chain.maybeSingle = () => Promise.resolve({ data: opts.policy ?? null, error: null })
    // `await supabase.from('user_entitlements').select(...).eq(...)`
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: opts.entitlements ?? [], error: null }).then(resolve)
    void table
    return chain
  }
  return { from } as never
}

const WELSH = ['cym_n_for_eng', 'cym_s_for_eng']
const canolfan = {
  enrolments: [{ group_id: 'g1', free_access_until: FUTURE }],
  policy: { org_display_name: 'National Centre for Learning Welsh', granted_courses: WELSH },
  entitlements: [{ access_type: 'courses', granted_courses: WELSH, expires_at: FUTURE }],
}

describe('resolveOrgFreeAccess', () => {
  it('reports the grant, the funder, and the courses it actually covers', async () => {
    const got = await resolveOrgFreeAccess(stubClient(canolfan), 'learner-1')
    expect(got).toEqual({
      groupId: 'g1',
      orgName: 'National Centre for Learning Welsh',
      until: FUTURE,
      courses: WELSH,
    })
  })

  it('THE SCOPE: a language the grant does not name is not covered', async () => {
    const got = await resolveOrgFreeAccess(stubClient(canolfan), 'learner-1')
    expect(got!.courses).not.toContain('spa_for_eng')
  })

  it('narrows to the intersection when the policy has moved on', async () => {
    // The policy has since added Spanish; this learner's entitlement row, written
    // at enrolment, has not. Quoting them a free Spanish they cannot play would
    // wall them mid-lesson, so the narrower answer wins.
    const got = await resolveOrgFreeAccess(
      stubClient({
        ...canolfan,
        policy: { org_display_name: 'Canolfan', granted_courses: [...WELSH, 'spa_for_eng'] },
      }),
      'learner-1'
    )
    expect(got!.courses).toEqual(WELSH)
  })

  it('a full-access entitlement covers everything the policy grants', async () => {
    const got = await resolveOrgFreeAccess(
      stubClient({ ...canolfan, entitlements: [{ access_type: 'full', granted_courses: null, expires_at: null }] }),
      'learner-1'
    )
    expect(got!.courses).toEqual(WELSH)
  })

  it('an expired entitlement covers nothing, grant or no grant', async () => {
    const got = await resolveOrgFreeAccess(
      stubClient({
        ...canolfan,
        entitlements: [{ access_type: 'courses', granted_courses: WELSH, expires_at: '2020-01-01T00:00:00.000Z' }],
      }),
      'learner-1'
    )
    expect(got!.courses).toEqual([])
  })

  it('asks only for enrolments whose free period has not run out', async () => {
    const filters: { column: string; op: string }[] = []
    await resolveOrgFreeAccess(
      stubClient({ enrolments: [], onFilter: (f) => filters.push({ column: f.column, op: f.op }) }),
      'learner-1'
    )
    expect(filters).toContainEqual({ column: 'free_access_until', op: 'gt' })
    expect(filters).toContainEqual({ column: 'learner_id', op: 'eq' })
    // The trap: cancellation_state is about their old subscription, not this
    // enrolment. It must play no part in whether the year is still running.
    expect(filters.map((f) => f.column)).not.toContain('cancellation_state')
  })

  it('still reports the grant when the funder has no policy row', async () => {
    const got = await resolveOrgFreeAccess(
      stubClient({ enrolments: [{ group_id: 'g1', free_access_until: FUTURE }], policy: null }),
      'learner-1'
    )
    // No policy = no course list = nothing suppressed. It sells as it always did.
    expect(got).toEqual({ groupId: 'g1', orgName: null, until: FUTURE, courses: [] })
  })

  it('no enrolment is no grant', async () => {
    expect(await resolveOrgFreeAccess(stubClient({ enrolments: [] }), 'learner-1')).toBeNull()
  })

  it('a database error is null, never a throw', async () => {
    expect(
      await resolveOrgFreeAccess(stubClient({ enrolmentError: { message: 'boom' } }), 'learner-1')
    ).toBeNull()
    const exploding = { from: () => { throw new Error('down') } } as never
    expect(await resolveOrgFreeAccess(exploding, 'learner-1')).toBeNull()
  })
})

/** And the endpoint actually carries it to the client. */
describe('/api/subscription reports the grant', () => {
  it('includes freeAccess for a learner with no subscription', async () => {
    vi.resetModules()
    process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

    vi.doMock('../_utils/auth', () => ({ getAuthUserId: async () => 'auth-uid' }))
    vi.doMock('../_utils/cors', () => ({ applyCors: () => false }))
    vi.doMock('../_utils/familyAccess', () => ({
      resolveEffectiveSubscription: async () => ({ sub: null, viaFamily: false, coverEndsAt: null }),
    }))
    vi.doMock('../_utils/familyGrace', () => ({ familyCoverEndsAt: () => null }))
    vi.doMock('../_utils/orgFreeAccess', () => ({
      resolveOrgFreeAccess: async () => ({ groupId: 'g1', orgName: 'Canolfan', until: FUTURE, courses: ['cym_n_for_eng'] }),
    }))
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({
        from: () => {
          const chain: Record<string, unknown> = {}
          const self = () => chain
          chain.select = self
          chain.eq = self
          chain.limit = self
          chain.single = () => Promise.resolve({ data: { id: 'learner-1' }, error: null })
          chain.maybeSingle = () => Promise.resolve({ data: null, error: null })
          return chain
        },
      }),
    }))

    const handler = (await import('../subscription/index')).default
    const body: Record<string, unknown> = {}
    const res = {
      status: () => res,
      json: (payload: Record<string, unknown>) => { Object.assign(body, payload); return res },
      setHeader: () => res,
      end: () => res,
    } as never as import('@vercel/node').VercelResponse

    await handler({ method: 'GET', headers: {}, query: {} } as never, res)

    expect(body.isSubscribed).toBe(false)
    expect(body.freeAccess).toEqual({ groupId: 'g1', orgName: 'Canolfan', until: FUTURE, courses: ['cym_n_for_eng'] })
    vi.doUnmock('@supabase/supabase-js')
  })
})
