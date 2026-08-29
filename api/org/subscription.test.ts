/**
 * Tests for GET /api/org/subscription — server-side org billing gate.
 * Mirrors the shape of api/school/subscription.ts but resolves the org from
 * the caller's OWN govt_admins row (leaderGroupId), with an ssi_admin
 * ?group_id= escape hatch used ONLY when the caller leads no org of their own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let DB: {
  govt_admins: Array<{ user_id: string; group_id: string | null }>
  groups: Array<{ id: string; name: string; platform_status: string | null; platform_expires_at: string | null; seats: number | null; provider_subscription_id?: string | null; provider_customer_id?: string | null }>
  learners: Array<{ user_id: string; platform_role: string | null }>
  user_tags: Array<{ user_id: string; tag_type: string; tag_value: string; removed_at: string | null }>
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let countMode = false
  const builder: any = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count) countMode = true
      return builder
    },
    eq(col: string, val: unknown) { rows = rows.filter((r) => r[col] === val); return builder },
    is(col: string, val: unknown) { rows = rows.filter((r) => (r[col] ?? null) === val); return builder },
    in(col: string, vals: unknown[]) { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    // countSubtreeMembers walks the forest by parent_id (groupSubtree), never
    // by path prefix — `like` survives here only for any other caller's use.
    like(col: string, pattern: string) {
      const prefix = pattern.replace(/%$/, '')
      rows = rows.filter((r) => typeof r[col] === 'string' && r[col].startsWith(prefix))
      return builder
    },
    async maybeSingle() {
      return { data: rows[0] ?? null, error: null }
    },
    then(onF: any, onR: any) {
      return Promise.resolve(countMode ? { data: null, count: rows.length, error: null } : { data: rows, error: null }).then(onF, onR)
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(query: Record<string, string> = {}): VercelRequest {
  return { method: 'GET', query, headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn()
  return res
}

let handler: typeof import('./subscription').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./subscription')).default
  DB = {
    govt_admins: [],
    groups: [],
    learners: [],
    user_tags: [],
  }
})

describe('GET /api/org/subscription', () => {
  it('returns org: null, active:true (fail-open) when the caller leads no org', async () => {
    authUserId = 'nobody'
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.org).toBeNull()
    expect(res.body.gate.active).toBe(true)
  })

  it('resolves the caller\'s own org via leaderGroupId and reports an active trial', async () => {
    authUserId = 'leader-a'
    DB.govt_admins.push({ user_id: 'leader-a', group_id: 'org-1' })
    DB.groups.push({ id: 'org-1', name: 'Acme Ltd', platform_status: 'trial', platform_expires_at: new Date(Date.now() + 10 * 86400000).toISOString(), seats: null })
    DB.user_tags.push({ user_id: 'member-1', tag_type: 'group', tag_value: 'GROUP:org-1', removed_at: null })
    DB.user_tags.push({ user_id: 'member-2', tag_type: 'group', tag_value: 'GROUP:org-1', removed_at: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.org).toMatchObject({ id: 'org-1', name: 'Acme Ltd', platform_status: 'trial', member_count: 2 })
    expect(res.body.gate.active).toBe(true)
    expect(res.body.gate.trial_days_remaining).toBeGreaterThan(0)
  })

  it('counts members across the whole SUBTREE, deduped by person', async () => {
    // The live shape: 'Gwynedd Council' with a 'Finance Dept' sub-group. The
    // count drives the manager UI's honest "N seats paid, M people" display, so
    // it must cover everyone the org actually entitles — members of clock-less
    // sub-groups included, since they bill through this org. Counting the root
    // node alone would report 1 here and lead the leader to buy too few seats.
    authUserId = 'leader-sub'
    DB.govt_admins.push({ user_id: 'leader-sub', group_id: 'org-sub' })
    DB.groups.push(
      // Membership is the parent_id relation, not the slug path (TENANCY-05).
      { id: 'org-sub', name: 'Gwynedd Council', platform_status: 'active', platform_expires_at: null, seats: 5, path: 'org-sub', parent_id: null } as any,
      { id: 'dept-1', name: 'Finance Dept', platform_status: null, platform_expires_at: null, seats: null, path: 'org-sub.dept-1', parent_id: 'org-sub' } as any,
    )
    DB.user_tags.push(
      { user_id: 'person-1', tag_type: 'group', tag_value: 'GROUP:org-sub', removed_at: null },
      { user_id: 'person-2', tag_type: 'group', tag_value: 'GROUP:dept-1', removed_at: null },
      { user_id: 'person-3', tag_type: 'group', tag_value: 'GROUP:dept-1', removed_at: null },
      // Same person in two departments is ONE seat, not two.
      { user_id: 'person-3', tag_type: 'group', tag_value: 'GROUP:org-sub', removed_at: null },
      // A removed affiliation is not a seat.
      { user_id: 'person-gone', tag_type: 'group', tag_value: 'GROUP:dept-1', removed_at: new Date().toISOString() },
    )
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.org.member_count).toBe(3)
  })

  it('reports gate.active=false for an elapsed trial', async () => {
    authUserId = 'leader-b'
    DB.govt_admins.push({ user_id: 'leader-b', group_id: 'org-2' })
    DB.groups.push({ id: 'org-2', name: 'Stale Org', platform_status: 'trial', platform_expires_at: new Date(Date.now() - 86400000).toISOString(), seats: null })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.gate.active).toBe(false)
    expect(res.body.gate.trial_days_remaining).toBe(0)
  })

  it('ignores a client-supplied ?group_id= for a caller who leads their own org', async () => {
    authUserId = 'leader-c'
    DB.govt_admins.push({ user_id: 'leader-c', group_id: 'org-3' })
    DB.groups.push({ id: 'org-3', name: 'Own Org', platform_status: 'active', platform_expires_at: null, seats: 5 })
    DB.groups.push({ id: 'org-999', name: 'Someone Else', platform_status: 'active', platform_expires_at: null, seats: 5 })
    const res = makeRes()
    await handler(makeReq({ group_id: 'org-999' }), res)
    expect(res.body.org.id).toBe('org-3')
  })

  it('honours ?group_id= for an ssi_admin who leads no org of their own', async () => {
    authUserId = 'admin-x'
    DB.learners.push({ user_id: 'admin-x', platform_role: 'ssi_admin' })
    DB.groups.push({ id: 'org-42', name: 'Inspected Org', platform_status: 'active', platform_expires_at: null, seats: 3 })
    const res = makeRes()
    await handler(makeReq({ group_id: 'org-42' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.org.id).toBe('org-42')
  })

  it('does NOT honour ?group_id= for a non-ssi_admin who leads no org', async () => {
    authUserId = 'rando'
    DB.groups.push({ id: 'org-42', name: 'Inspected Org', platform_status: 'active', platform_expires_at: null, seats: 3 })
    const res = makeRes()
    await handler(makeReq({ group_id: 'org-42' }), res)
    expect(res.body.org).toBeNull()
  })
})
