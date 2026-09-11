/**
 * BURST SIGN-UP — the first failure the old system actually had.
 * =============================================================
 *
 * Kai, 2026-09-08: the old sign-up link "had a hard maximum and it was hit —
 * thousands of learners came through at once."
 *
 * That is not a hypothetical shape of traffic. A Canolfan tutor puts the link
 * on a screen and a class of thirty taps it inside a minute; an intake email
 * goes out to a few thousand people and a large fraction open it the same
 * evening. So these tests do not check that the endpoint works — the other
 * files do that — they check that it works when everyone arrives at once, and
 * that no number anywhere can shut the door.
 *
 * THE FAKE IS DELIBERATELY UNKIND. Every write yields to the event loop before
 * it lands, so operations from concurrent requests genuinely interleave and
 * the 23505 recovery paths are really exercised rather than merely present. A
 * synchronous fake would pass these tests with a read-then-write increment and
 * a check-then-insert, which are exactly the two things that break under load.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let currentUser: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: currentUser })),
}))

type Row = Record<string, any>
let DB: Record<string, Row[]>
let rpcCalls: string[]

/** The unique keys Postgres really holds on these tables. */
const UNIQUE: Record<string, string[]> = {
  org_enrolments: ['group_id', 'learner_id'],
  learners: ['user_id'],
  // The primary key, which api/_utils/orgEntitlementGrant.ts computes rather
  // than letting the database invent one — that is what makes the free-period
  // grant idempotent under a genuine burst.
  user_entitlements: ['id'],
  user_tags: ['user_id', 'tag_type', 'tag_value'],
}

/** A turn of the event loop, so concurrent requests interleave for real. */
const yieldTurn = () => new Promise<void>((r) => setTimeout(r, 0))

function makeChainable(table: string) {
  let rows: Row[] = [...(DB[table] ?? [])]
  const b: any = {
    select() { return b },
    eq(c: string, v: unknown) { rows = rows.filter((r) => r[c] === v); return b },
    is(c: string, v: unknown) { rows = rows.filter((r) => (r[c] ?? null) === v); return b },
    in(c: string, v: unknown[]) { rows = rows.filter((r) => v.includes(r[c])); return b },
    // `verified_emails` is a text[]; `.contains(col, [value])` is the array
    // containment the sibling-account lookup uses.
    contains(c: string, v: unknown[]) {
      rows = rows.filter((r) => Array.isArray(r[c]) && (v as any[]).every((x) => r[c].includes(x)))
      return b
    },
    order() { return b },
    range(f: number, t: number) { rows = rows.slice(f, t + 1); return b },
    insert(payload: Row) {
      const store = (DB[table] ??= [])
      const key = UNIQUE[table]
      const land = async () => {
        // The yield is the point: another request may insert the same key
        // while this one is in flight, which is what a burst looks like.
        await yieldTurn()
        if (key && store.some((e) => key.every((k) => e[k] === payload[k]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const written = { id: payload.id ?? `${table}-${store.length + 1}`, ...payload }
        store.push(written)
        return { data: written, error: null }
      }
      return {
        select: () => ({
          maybeSingle: async () => land(),
          single: async () => land(),
        }),
        then: (f: any) => land().then(f),
      }
    },
    update(patch: Row) {
      const target = rows
      return {
        async eq(c: string, v: unknown) {
          await yieldTurn()
          for (const r of target.filter((x) => x[c] === v)) Object.assign(r, patch)
          return { data: null, error: null }
        },
      }
    },
    async maybeSingle() { await yieldTurn(); return { data: rows[0] ?? null, error: null } },
    async single() { await yieldTurn(); return { data: rows[0] ?? null, error: null } },
    then(f: any, r: any) { return yieldTurn().then(() => ({ data: rows, error: null })).then(f, r) },
  }
  return b
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (t: string) => makeChainable(t),
    rpc: async (name: string, args: any) => {
      rpcCalls.push(name)
      if (name === 'claim_invite_code_use') {
        // ATOMIC in the live database: the increment happens under a lock, so
        // the fake does it without a yield in the middle. That difference is
        // the whole reason the endpoint uses the rpc rather than reading the
        // count and writing it back.
        const row = (DB.invite_codes ?? []).find((c) => c.id === args.p_id)
        if (row) row.use_count = (row.use_count ?? 0) + 1
        return { data: args.p_id, error: null }
      }
      return { data: null, error: null }
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com`, user_metadata: {} } } }),
      },
    },
  }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((c: number) => { res.statusCode = c; return res })
  res.json = vi.fn((b: any) => { res.body = b; return res })
  res.setHeader = vi.fn()
  return res
}
const post = (body: Record<string, unknown>): VercelRequest =>
  ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer t' } }) as any

let handler: typeof import('./enrol').default

/**
 * One request from one person. `currentUser` is module-level because
 * verifyAuthToken is mocked once, so each call sets it immediately before
 * awaiting — which is itself a small interleaving hazard the helper closes by
 * capturing the id into the request before yielding.
 */
async function enrolAs(userId: string, code = 'CYM-001') {
  currentUser = userId
  const res = makeRes()
  await handler(post({ code, dataSharingConsent: true, ageBand16to24: false }), res)
  return res
}

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./enrol')).default
  rpcCalls = []
  DB = {
    invite_codes: [{ id: 'inv-1', code: 'CYM-001', code_normalized: 'CYM001', code_type: 'student', grants_group_id: 'g-canolfan', is_active: true, expires_at: null, max_uses: null, use_count: 0 }],
    org_enrolment_policies: [{
      group_id: 'g-canolfan', org_display_name: 'Dysgu Cymraeg', consent_statement: 'I agree.',
      consent_version: 'v1', ask_age_band: true, age_band_label: 'I am aged 16 to 24', free_months: 12,
      granted_courses: ['cym_n_for_eng', 'cym_s_for_eng'], is_active: true, link_expires_at: null,
    }],
    groups: [{ id: 'g-canolfan', path: 'dysgu-cymraeg', parent_id: null }],
    learners: [],
    org_enrolments: [],
    subscriptions: [],
    user_tags: [],
    user_entitlements: [],
    schools: [],
  }
})

describe('a whole cohort arrives at once', () => {
  it('FAILURE MODE: the sign-up link has a maximum and the tail of a cohort is locked out', async () => {
    const COHORT = 500
    const results = await Promise.all(
      Array.from({ length: COHORT }, (_, i) => enrolAs(`auth-${i}`)),
    )

    // EVERY ONE OF THEM IS IN. Not most of them.
    const refused = results.filter((r) => r.body?.success !== true)
    expect(refused).toHaveLength(0)
    expect(DB.org_enrolments).toHaveLength(COHORT)
    expect(new Set(DB.org_enrolments.map((e) => e.learner_id)).size).toBe(COHORT)
    // One learner row each, no ghosts from the creation race.
    expect(DB.learners).toHaveLength(COHORT)
    // And the counter is honest, which a read-then-write increment would not
    // be under this interleaving.
    expect(DB.invite_codes[0].use_count).toBe(COHORT)
  })

  it('FAILURE MODE: a cap set on the link by some other route quietly shuts the door', async () => {
    // Hand-edited, or minted by an older tool. The link is ALREADY over its
    // cap when the cohort arrives — which is the state the old system's link
    // was in when the tail of its intake could not get in. Starting at the cap
    // rather than at zero is what makes this test bite: a cap check reading
    // use_count would refuse every single one of these.
    DB.invite_codes[0].max_uses = 10
    DB.invite_codes[0].use_count = 10
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => enrolAs(`auth-${i}`)))
    expect(results.filter((r) => r.body?.success !== true)).toHaveLength(0)
    expect(DB.org_enrolments).toHaveLength(50)
    // Specifically: nobody is told the code is used up.
    expect(results.some((r) => /fully used|limit|maximum/i.test(r.body?.error ?? ''))).toBe(false)
  })

  it('one person double-tapping through a slow connection gets one enrolment', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => enrolAs('auth-impatient')))
    expect(results.every((r) => r.body?.success === true)).toBe(true)
    expect(DB.org_enrolments).toHaveLength(1)
    expect(DB.learners).toHaveLength(1)
    // Exactly one of them created it; the other nineteen were told they were
    // already in, rather than erroring or writing a second row.
    expect(results.filter((r) => r.body.alreadyEnrolled === false)).toHaveLength(1)
    expect(results.filter((r) => r.body.alreadyEnrolled === true)).toHaveLength(19)
  })

  it('gives every learner exactly one free-year entitlement, not one per attempt', async () => {
    await Promise.all(Array.from({ length: 10 }, () => enrolAs('auth-keen')))
    await Promise.all(Array.from({ length: 10 }, (_, i) => enrolAs(`auth-other-${i}`)))
    expect(DB.user_entitlements).toHaveLength(11)
    expect(DB.user_entitlements[0].granted_courses).toEqual(['cym_n_for_eng', 'cym_s_for_eng'])
  })

  it('the counter never gates, so a failure to count never costs anybody their place', async () => {
    // The rpc is best-effort by design. Prove it: every enrolment still lands
    // even if the counter is never touched.
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => enrolAs(`auth-${i}`)))
    expect(results.every((r) => r.body?.success === true)).toBe(true)
    expect(rpcCalls.filter((n) => n === 'claim_invite_code_use')).toHaveLength(30)
  })
})

describe('nothing caps the cohort itself', () => {
  it('FAILURE MODE: a seat count or a size limit deciding who gets in', () => {
    // Kai: the old system's GROUP size had a maximum too, it was raised, and
    // then the fetches began timing out. Ours has no maximum to raise. This is
    // a source assertion rather than a behavioural one for the same reason THE
    // LINE is: a behavioural test proves today's path did not consult a seat
    // count, whereas this fails the moment anybody wires one in.
    const src = readFileSync(join(__dirname, 'enrol.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(src, 'no seat cap on the enrolment path').not.toMatch(/seat/i)
    expect(src, 'no membership-count gate').not.toMatch(/member_count|countSubtreeMembers/)
    // And the only cap-shaped field it reads is max_uses, which it reads ONLY
    // to warn about and never to refuse on.
    const maxUsesLines = src.split('\n').filter((l) => l.includes('max_uses'))
    expect(maxUsesLines.length).toBeGreaterThan(0)
    for (const line of maxUsesLines) {
      expect(line, line).not.toMatch(/res\.status|return\b/)
    }
  })
})

describe('the link\'s lifetime is data, not a constant', () => {
  it('a link with no expiry stays open — "leave it up all year"', async () => {
    DB.invite_codes[0].expires_at = null
    DB.org_enrolment_policies[0].link_expires_at = null
    const res = await enrolAs('auth-1')
    expect(res.body.success).toBe(true)
  })

  it('an expiry on the org policy closes it — "a fresh link each year"', async () => {
    DB.org_enrolment_policies[0].link_expires_at = '2026-01-01T00:00:00Z'
    const res = await enrolAs('auth-1')
    expect(res.body.success).toBe(false)
    expect(res.body.error).toMatch(/expired/i)
    expect(DB.org_enrolments).toHaveLength(0)
  })

  it('an expiry on the code itself closes it too, and neither is compiled in', async () => {
    DB.invite_codes[0].expires_at = '2026-01-01T00:00:00Z'
    const res = await enrolAs('auth-1')
    expect(res.body.success).toBe(false)
    expect(res.body.error).toMatch(/expired/i)
  })

  it('a retired link stops working while the enrolments it made survive', async () => {
    await enrolAs('auth-early')
    expect(DB.org_enrolments).toHaveLength(1)
    // Year two: the old code is deactivated by the rotate path.
    DB.invite_codes[0].is_active = false
    const res = await enrolAs('auth-late')
    expect(res.body.success).toBe(false)
    // The person who came through the old door is still enrolled — the code is
    // a door, not the membership.
    expect(DB.org_enrolments).toHaveLength(1)
  })
})
