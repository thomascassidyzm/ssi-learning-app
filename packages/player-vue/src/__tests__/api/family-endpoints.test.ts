/**
 * Endpoint-level tests for /api/family/* (FAMILY-PLAN-SPEC.md §6 PR5 list):
 * seat cap, dup invite, owner-email reject, ownership checks on remove/leave.
 * The shared seat-cap/no-steal/idempotency logic itself is unit-tested in
 * familyMembership.test.ts — these tests cover each endpoint's own
 * validation + wiring around that shared core.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
process.env.SUPABASE_ANON_KEY = 'test-anon-key'
process.env.RESEND_API_KEY = 'test-resend-key'

interface QueryResult<T> {
  data: T | null
  error: { message: string; code?: string } | null
}

// Per-table response QUEUES — each call to a table pops the next queued
// response, so a test scripts the exact sequence of reads/writes a handler
// makes (e.g. invite.ts: owner lookup → learner verified_emails → seat count
// → insert → immediate-attach reads).
let tableQueues: Record<string, QueryResult<any>[]> = {}
let tableCursors: Record<string, number> = {}
let calls: Array<{ table: string; method: string; args: any[] }> = []
let authUserResponse: { data: { user: { id: string } | null }; error: any } = {
  data: { user: { id: 'owner-user-1' } },
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
    select: (...a: any[]) => { calls.push({ table, method: 'select', args: a }); return builder },
    eq: (...a: any[]) => { calls.push({ table, method: 'eq', args: a }); return builder },
    is: (...a: any[]) => { calls.push({ table, method: 'is', args: a }); return builder },
    in: (...a: any[]) => { calls.push({ table, method: 'in', args: a }); return builder },
    contains: (...a: any[]) => { calls.push({ table, method: 'contains', args: a }); return builder },
    insert: (...a: any[]) => { calls.push({ table, method: 'insert', args: a }); return builder },
    update: (...a: any[]) => { calls.push({ table, method: 'update', args: a }); return builder },
    maybeSingle: () => Promise.resolve(nextFor(table)),
    single: () => Promise.resolve(nextFor(table)),
    then: (resolve: any) => Promise.resolve(nextFor(table)).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeBuilder(table),
    auth: {
      getUser: () => Promise.resolve(authUserResponse),
      admin: {
        createUser: vi.fn(() => Promise.resolve({ data: { user: { id: 'child-auth-1' } }, error: null })),
        deleteUser: vi.fn(() => Promise.resolve({ error: null })),
        generateLink: vi.fn(() =>
          Promise.resolve({ data: { properties: { action_link: 'https://example.com/magic' } }, error: null }),
        ),
        getUserById: vi.fn(() => Promise.resolve({ data: { user: { email: 'fam-x@members.saysomethingin.app' } }, error: null })),
      },
    },
  }),
}))

const { default: inviteHandler } = await import('../../../../../api/family/invite')
const { default: createChildHandler } = await import('../../../../../api/family/create-child')
const { default: removeHandler } = await import('../../../../../api/family/remove')
const { default: leaveHandler } = await import('../../../../../api/family/leave')

interface FakeRes {
  _status?: number
  _body?: unknown
  status: (s: number) => FakeRes
  json: (b: unknown) => FakeRes
}
function makeRes(): FakeRes {
  const res: FakeRes = {
    status(s) { this._status = s; return this },
    json(b) { this._body = b; return this },
  }
  return res
}
function makeReq(body: any = {}): any {
  return { method: 'POST', headers: { authorization: 'Bearer test-token' }, body }
}

// Every mail this API sends goes out through one POST to Resend, so stubbing
// fetch is how a test sees whether anybody was actually told anything.
let mailSent: Array<{ to: string[]; subject: string; text: string }> = []

beforeEach(() => {
  tableQueues = {}
  tableCursors = {}
  calls = []
  mailSent = []
  authUserResponse = { data: { user: { id: 'owner-user-1' } }, error: null }
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    mailSent.push(JSON.parse(init.body))
    return { ok: true, status: 200, json: async () => ({ id: 'msg-1' }), text: async () => '' } as any
  }))
})

describe('POST /api/family/invite', () => {
  it('rejects when the family is already at the seat cap', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null }, // resolveLearnerId
        { data: { verified_emails: [] }, error: null }, // owner's own emails (for self-invite check)
      ],
      family_members: [
        { data: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` })), error: null }, // countUsedSeats: 1+5=6 = cap
      ],
    }
    const res = makeRes()
    await inviteHandler(makeReq({ email: 'grandpa@example.com' }), res as any)
    expect(res._status).toBe(400)
    expect((res._body as any).error).toMatch(/full/i)
  })

  it('rejects inviting your own email', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null },
        { data: { verified_emails: ['me@example.com'] }, error: null },
      ],
    }
    const res = makeRes()
    await inviteHandler(makeReq({ email: 'ME@Example.com' }), res as any)
    expect(res._status).toBe(400)
    expect((res._body as any).error).toMatch(/own email/i)
  })

  it('rejects a duplicate live invite (23505 from family_members_invite_dedupe)', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null },
        { data: { verified_emails: [] }, error: null },
      ],
      family_members: [
        { data: [], error: null }, // seat count: fine
        { data: null, error: { message: 'duplicate key', code: '23505' } }, // insert
      ],
    }
    const res = makeRes()
    await inviteHandler(makeReq({ email: 'grandpa@example.com' }), res as any)
    expect(res._status).toBe(409)
  })

  it('creates the invite and attaches immediately when a matching verified account already exists', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null }, // resolveLearnerId (owner)
        { data: { verified_emails: [] }, error: null }, // owner's own emails
        { data: [{ id: 'grandpa-learner-1', verified_emails: ['grandpa@example.com'] }], error: null }, // existing-account lookup
      ],
      family_members: [
        { data: [], error: null }, // seat count
        { data: { id: 'invite-1', owner_learner_id: 'owner-learner-1', invited_email: 'grandpa@example.com', status: 'invited' }, error: null }, // insert
        { data: [{ id: 'invite-1', owner_learner_id: 'owner-learner-1' }], error: null }, // attachPendingInvitesForEmail: pending lookup
        { data: null, error: null }, // isInAnyLiveFamily → false
        { data: [], error: null }, // countUsedSeats for the attach belt+braces check
        { data: { id: 'invite-1' }, error: null }, // update → active
      ],
    }
    const res = makeRes()
    await inviteHandler(makeReq({ email: 'grandpa@example.com' }), res as any)
    expect(res._status).toBe(200)
    expect((res._body as any).attachedNow).toBe(true)

    // The gap this closed: the invite used to be written and NOBODY was told.
    expect((res._body as any).emailed).toBe(true)
    expect(mailSent.length).toBe(1)
    expect(mailSent[0].to).toEqual(['grandpa@example.com'])
    // Already has an account — "carry on as usual", never "sign up".
    expect(mailSent[0].text).toContain('Sign in the way you normally do')
    expect(mailSent[0].text).not.toMatch(/do not have an account/i)
  })

  it('emails a pending invitee the OTHER message: sign in with this address and the place attaches then', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null }, // resolveLearnerId (owner)
        { data: { verified_emails: [], display_name: 'Bethan' }, error: null }, // owner's own emails + name
        { data: [], error: null }, // existing-account lookup: nobody has this address
      ],
      family_members: [
        { data: [], error: null }, // seat count
        { data: { id: 'invite-2', invited_email: 'newperson@example.com', status: 'invited' }, error: null }, // insert
      ],
    }
    const res = makeRes()
    await inviteHandler(makeReq({ email: 'newperson@example.com' }), res as any)

    expect(res._status).toBe(200)
    expect((res._body as any).attachedNow).toBe(false)
    expect((res._body as any).emailed).toBe(true)
    expect(mailSent.length).toBe(1)
    expect(mailSent[0].subject).toBe('Bethan has added you to their SaySomethingin family plan')
    expect(mailSent[0].text).toContain('You do not have an account yet')
    expect(mailSent[0].text).toContain('newperson@example.com')
  })

  it('still creates the invite when the mail cannot be sent — the seat is real either way', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'nope' }) as any))
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null },
        { data: { verified_emails: [] }, error: null },
        { data: [], error: null },
      ],
      family_members: [
        { data: [], error: null },
        { data: { id: 'invite-3', invited_email: 'newperson@example.com', status: 'invited' }, error: null },
      ],
    }
    const res = makeRes()
    await inviteHandler(makeReq({ email: 'newperson@example.com' }), res as any)
    expect(res._status).toBe(200)
    expect((res._body as any).invite.id).toBe('invite-3')
    expect((res._body as any).emailed).toBe(false)
  })
})

describe('POST /api/family/create-child', () => {
  it('rejects when the family is already at the seat cap', async () => {
    tableQueues = {
      learners: [{ data: { id: 'owner-learner-1' }, error: null }],
      family_members: [{ data: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}` })), error: null }],
    }
    const res = makeRes()
    await createChildHandler(makeReq({ display_name: 'Dylan' }), res as any)
    expect(res._status).toBe(400)
    expect((res._body as any).error).toMatch(/full/i)
  })

  it('requires a non-empty display_name', async () => {
    const res = makeRes()
    await createChildHandler(makeReq({ display_name: '  ' }), res as any)
    expect(res._status).toBe(400)
  })

  it('creates the synthetic auth user, learner row, and active membership; returns a sign-in link', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null }, // resolveLearnerId
        { data: { id: 'child-learner-1' }, error: null }, // learners insert
      ],
      family_members: [
        { data: [], error: null }, // seat count
        { data: { id: 'member-1', is_child_account: true, status: 'active' }, error: null }, // membership insert
      ],
    }
    const res = makeRes()
    await createChildHandler(makeReq({ display_name: 'Dylan' }), res as any)
    expect(res._status).toBe(200)
    expect((res._body as any).signInLink).toBe('https://example.com/magic')
    const insertCalls = calls.filter((c) => c.method === 'insert')
    expect(insertCalls.some((c) => c.table === 'family_members' && c.args[0].is_child_account === true)).toBe(true)
  })

  it('sends NO email for a child seat — the address is synthetic and the parent gets a QR code instead', async () => {
    tableQueues = {
      learners: [
        { data: { id: 'owner-learner-1' }, error: null },
        { data: { id: 'child-learner-1' }, error: null },
      ],
      family_members: [
        { data: [], error: null },
        { data: { id: 'member-1', is_child_account: true, status: 'active' }, error: null },
      ],
    }
    const res = makeRes()
    await createChildHandler(makeReq({ display_name: 'Dylan' }), res as any)
    expect(res._status).toBe(200)
    expect(mailSent).toEqual([])
  })
})

describe('POST /api/family/remove', () => {
  it('only removes a member owned by the caller (ownership check via the query filter)', async () => {
    tableQueues = {
      learners: [{ data: { id: 'owner-learner-1' }, error: null }],
      family_members: [{ data: null, error: null }], // filtered by owner_learner_id → not found for a foreign member
    }
    const res = makeRes()
    await removeHandler(makeReq({ member_id: 'someone-elses-member' }), res as any)
    expect(res._status).toBe(404)
  })

  it('stamps a member removed', async () => {
    tableQueues = {
      learners: [{ data: { id: 'owner-learner-1' }, error: null }],
      family_members: [{ data: { id: 'm1', status: 'removed' }, error: null }],
    }
    const res = makeRes()
    await removeHandler(makeReq({ member_id: 'm1' }), res as any)
    expect(res._status).toBe(200)
  })
})

describe('POST /api/family/leave', () => {
  it('404s when the caller is not a member of any family', async () => {
    tableQueues = {
      learners: [{ data: { id: 'learner-1' }, error: null }],
      family_members: [{ data: null, error: null }],
    }
    const res = makeRes()
    await leaveHandler(makeReq({}), res as any)
    expect(res._status).toBe(404)
  })

  it('stamps the caller\'s own membership removed, no member_id needed in the body', async () => {
    tableQueues = {
      learners: [{ data: { id: 'member-learner-1' }, error: null }],
      family_members: [{ data: { id: 'm1', status: 'removed' }, error: null }],
    }
    const res = makeRes()
    await leaveHandler(makeReq({}), res as any)
    expect(res._status).toBe(200)
  })
})
