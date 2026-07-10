/**
 * FAMILY-PLAN-SPEC.md §4.1(a) fold-in: /api/access/claim (called on every
 * sign-in) attaches any pending family invite matching the verified sign-in
 * email — Grandpa's total pain is the OTP sign-in he'd have done anyway.
 * Must never break sign-in even if the family attach throws.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

interface QueryResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

let tableQueues: Record<string, QueryResult<any>[]> = {}
let tableCursors: Record<string, number> = {}
let getUserResponse: { data: { user: { id: string; email: string } | null }; error: any } = {
  data: { user: { id: 'grandpa-user-1', email: 'grandpa@example.com' } },
  error: null,
}

function nextFor(table: string): QueryResult<any> {
  const queue = tableQueues[table] || []
  const i = tableCursors[table] ?? 0
  tableCursors[table] = i + 1
  return queue[i] ?? { data: null, error: null }
}

function makeBuilder(table: string): any {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    insert: () => builder,
    update: () => builder,
    maybeSingle: () => Promise.resolve(nextFor(table)),
    single: () => Promise.resolve(nextFor(table)),
    then: (resolve: any) => Promise.resolve(nextFor(table)).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeBuilder(table),
    auth: { getUser: () => Promise.resolve(getUserResponse) },
  }),
}))

const { default: claimHandler } = await import('../../../../../api/access/claim')

function makeRes() {
  const res: any = {
    status(s: number) { this._status = s; return res },
    json(b: unknown) { this._body = b; return res },
  }
  return res
}
function makeReq(): any {
  return { method: 'POST', headers: { authorization: 'Bearer test-token' } }
}

beforeEach(() => {
  tableQueues = {}
  tableCursors = {}
  getUserResponse = { data: { user: { id: 'grandpa-user-1', email: 'grandpa@example.com' } }, error: null }
})

describe('POST /api/access/claim — family invite fold-in', () => {
  it('attaches a pending family invite matching the verified sign-in email', async () => {
    tableQueues = {
      // applyGrantsForEmail's own path first
      learners: [
        { data: { id: 'grandpa-learner-1' }, error: null }, // applyGrantsForEmail's learner lookup
        { data: { id: 'grandpa-learner-1' }, error: null }, // resolveLearnerId for family attach
      ],
      email_access_grants: [{ data: [], error: null }], // no allowlist grants
      family_members: [
        { data: [{ id: 'invite-1', owner_learner_id: 'owner-1' }], error: null }, // pending lookup
        { data: null, error: null }, // isInAnyLiveFamily → false
        { data: [], error: null }, // countUsedSeats
        { data: { id: 'invite-1' }, error: null }, // update → active
      ],
    }
    const res = makeRes()
    await claimHandler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._body.familyAttached).toBe(1)
  })

  it('never breaks sign-in even if the family attach throws', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'grandpa-learner-1' }, error: null },
        { data: { id: 'grandpa-learner-1' }, error: null },
      ],
      email_access_grants: [{ data: [], error: null }],
      family_members: [{ data: null, error: { message: 'boom' } }], // pending lookup errors
    }
    const res = makeRes()
    await claimHandler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._body.familyAttached).toBe(0)
  })

  it('is a no-op when there is no pending invite for this email', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'grandpa-learner-1' }, error: null },
        { data: { id: 'grandpa-learner-1' }, error: null },
      ],
      email_access_grants: [{ data: [], error: null }],
      family_members: [{ data: [], error: null }],
    }
    const res = makeRes()
    await claimHandler(makeReq(), res)
    expect(res._status).toBe(200)
    expect(res._body.familyAttached).toBe(0)
  })
})
