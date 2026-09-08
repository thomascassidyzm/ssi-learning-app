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

/** Minimal PostgREST-shaped stub: records the filters, returns the rows. */
function stubClient(opts: {
  enrolments?: unknown[]
  enrolmentError?: unknown
  policy?: unknown
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
    void table
    return chain
  }
  return { from } as never
}

describe('resolveOrgFreeAccess', () => {
  it('reports the grant, with the funder named', async () => {
    const got = await resolveOrgFreeAccess(
      stubClient({
        enrolments: [{ group_id: 'g1', free_access_until: FUTURE }],
        policy: { org_display_name: 'National Centre for Learning Welsh' },
      }),
      'learner-1'
    )
    expect(got).toEqual({ groupId: 'g1', orgName: 'National Centre for Learning Welsh', until: FUTURE })
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

  it('still frees the learner when the funder has no policy row', async () => {
    const got = await resolveOrgFreeAccess(
      stubClient({ enrolments: [{ group_id: 'g1', free_access_until: FUTURE }], policy: null }),
      'learner-1'
    )
    expect(got).toEqual({ groupId: 'g1', orgName: null, until: FUTURE })
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
      resolveOrgFreeAccess: async () => ({ groupId: 'g1', orgName: 'Canolfan', until: FUTURE }),
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
    expect(body.freeAccess).toEqual({ groupId: 'g1', orgName: 'Canolfan', until: FUTURE })
    vi.doUnmock('@supabase/supabase-js')
  })
})
