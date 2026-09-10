/**
 * Tests for POST /api/school/create-class — the "Add a class" verb a leader
 * standing on a group/school node uses (founder ruling 2026-09-07: a class
 * can exist without a teacher, but it must belong to a group).
 *
 * Fails on the pre-fix code for the reason the feature existed: there WAS no
 * server path, only the client insert whose RLS policy (`classes_insert`,
 * WITH CHECK teacher_user_id = auth.uid()::text) forces the creator to name
 * themselves the teacher. These cover the two things that matter — a class
 * lands with teacher_user_id NULL, and authority is the #147 subtree
 * predicate rather than a second rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

// The caller resolution and the subtree predicate are the SHARED #147 pieces;
// mocked here so these tests assert this endpoint's use of them, not their
// internals (they have their own tests).
let caller: { userId: string; isAdmin: boolean; ownGroupId: string | null } | null
let visibleGroupIds: string[]
vi.mock('../_utils/groupTreeAuth', () => ({
  resolveGroupTreeCaller: vi.fn(async (_req: any, res: any) => {
    if (!caller) { res.status(403).json({ error: 'You do not govern any group' }); return null }
    return caller
  }),
  callerCanSeeGroup: vi.fn(async (_svc: any, c: any, groupId: string) =>
    c.isAdmin || visibleGroupIds.includes(groupId)),
}))

vi.mock('../_utils/actAsGuard', () => ({ rejectIfViewAs: vi.fn(() => null) }))
vi.mock('../_utils/mintRateLimit', () => ({
  enforceMintRateLimit: vi.fn(async () => ({ ok: true })),
  CLASS_MINT_OUTCOME: 'class_mint_attempt',
}))
vi.mock('../_utils/classLearnerEntity', () => ({
  ensureClassLearnerEntity: vi.fn(async () => ({ learnerId: 'class-learner-1' })),
}))

const FUTURE = new Date(Date.now() + 90 * 86400_000).toISOString()
const PAST = new Date(Date.now() - 86400_000).toISOString()

let DB: {
  groups: Array<Record<string, any>>
  schools: Array<Record<string, any>>
  classes: Array<Record<string, any>>
  invite_codes: Array<Record<string, any>>
  entitlement_grants: Array<Record<string, any>>
}

function makeChainable(table: string) {
  const rows = () => (DB as any)[table] as any[]
  const filters: Array<[string, unknown]> = []
  const builder: any = {
    select() { return builder },
    eq(col: string, val: unknown) { filters.push([col, val]); return builder },
    maybeSingle: async () => {
      const match = rows().find((r) => filters.every(([c, v]) => r[c] === v))
      return { data: match ?? null, error: null }
    },
    // `await svc.from(t).select(...).eq(...)` — the list form the entitlement
    // ladder reads entitlement_grants with.
    then: (resolve: any) =>
      resolve({ data: rows().filter((r) => filters.every(([c, v]) => r[c] === v)), error: null }),
    insert(row: any) {
      const created = { id: `${table}-${rows().length + 1}`, student_join_code: 'JOIN123', created_at: '2026-09-07T00:00:00Z', ...row }
      rows().push(created)
      return {
        select: () => ({ single: async () => ({ data: created, error: null }) }),
        // invite_codes insert is awaited directly (no .select())
        then: (resolve: any) => resolve({ data: created, error: null }),
      }
    },
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(body: any): VercelRequest {
  return { method: 'POST', body, headers: { authorization: 'Bearer tok' } } as any
}
function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let handler: typeof import('./create-class').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./create-class')).default
  DB = {
    // 'root-org' is the school's own node and carries no clock of its own —
    // the SCHOOL row is what answers for it (classCourseEntitlement.ts).
    groups: [
      { id: 'root-org', parent_id: null, platform_status: null },
      { id: 'sub-group', parent_id: 'root-org', platform_status: null },
      { id: 'someone-elses-group', parent_id: null, platform_status: null },
      { id: 'live-org', parent_id: null, platform_status: 'trial', platform_expires_at: FUTURE, created_at: PAST },
      { id: 'sub-of-live-org', parent_id: 'live-org', platform_status: null },
    ],
    // The leader-created school: 365-day heritage platform trial, no course
    // named (api/govt/create-school.ts) — exactly the row the free-premium
    // hole was found on.
    schools: [{ id: 'school-1', node_group_id: 'root-org', platform_status: 'trial', trial_course_code: null }],
    classes: [],
    invite_codes: [],
    entitlement_grants: [],
  }
  caller = { userId: 'leader-1', isAdmin: false, ownGroupId: 'root-org' }
  visibleGroupIds = ['root-org', 'sub-group']
})

describe('POST /api/school/create-class', () => {
  it('creates a class at the org root with NO teacher — teacher_user_id is null', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: 'Year 7 Welsh', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(201)
    expect(DB.classes).toHaveLength(1)
    expect(DB.classes[0].teacher_user_id).toBeNull()
    expect(DB.classes[0].group_id).toBe('root-org')
    expect(res.body.class.class_name).toBe('Year 7 Welsh')
  })

  it('a class on a SCHOOL node keeps the school_id arm, so the school lane still sees it', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: '8B', course_code: 'cym_s_for_eng' }), res)
    expect(DB.classes[0].school_id).toBe('school-1')
  })

  it('a class on a plain group node has no school, only the group', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'sub-group', class_name: 'Pilot', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(201)
    expect(DB.classes[0].school_id).toBeNull()
    expect(DB.classes[0].group_id).toBe('sub-group')
  })

  it('REFUSES a group outside the leader subtree — 403, nothing written', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'someone-elses-group', class_name: 'Pwned', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.classes).toHaveLength(0)
  })

  it('an ssi_admin may create anywhere in the forest', async () => {
    caller = { userId: 'admin-1', isAdmin: true, ownGroupId: null }
    visibleGroupIds = []
    const res = makeRes()
    await handler(makeReq({ group_id: 'someone-elses-group', class_name: 'Support class', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(201)
  })

  it('401/403s a caller who governs nothing — the shared resolver answers', async () => {
    caller = null
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: 'X', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.classes).toHaveLength(0)
  })

  it('404s a group id that does not exist', async () => {
    visibleGroupIds = ['ghost-group']
    const res = makeRes()
    await handler(makeReq({ group_id: 'ghost-group', class_name: 'X', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('400s a missing group_id, class_name or course_code', async () => {
    for (const body of [
      { class_name: 'X', course_code: 'cym_s_for_eng' },
      { group_id: 'root-org', course_code: 'cym_s_for_eng' },
      { group_id: 'root-org', class_name: 'X' },
    ]) {
      const res = makeRes()
      await handler(makeReq(body), res)
      expect(res.statusCode).toBe(400)
    }
    expect(DB.classes).toHaveLength(0)
  })

  it('mints the invite_codes row that backs the class join code', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: 'Year 9', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(201)
    expect(DB.invite_codes).toHaveLength(1)
    expect(DB.invite_codes[0].grants_class_id).toBe(DB.classes[0].id)
  })
})

/**
 * The course gate (2026-09-10). Before it, this endpoint wrote whatever
 * course_code it was handed, and classCoverage.ts then granted that course to
 * every student in the class for as long as the school's platform clock ran —
 * so a leader-created school on its 365-day heritage trial could hand out a
 * premium Big-10 course free for a year. Each refusal below returned 201 on
 * the pre-fix code.
 */
describe('POST /api/school/create-class — course entitlement', () => {
  it('REFUSES a premium course the school has no entitlement for — 403, nothing written', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: 'Free Spanish', course_code: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.requires_checkout).toBe(true)
    expect(DB.classes).toHaveLength(0)
    expect(DB.invite_codes).toHaveLength(0)
  })

  it('REFUSES a premium course on a plain group node no billed node covers', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'sub-group', class_name: 'Free Spanish', course_code: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.classes).toHaveLength(0)
  })

  it('allows the premium course the school is actually trialling', async () => {
    DB.schools[0].trial_course_code = 'spa_for_eng'
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: '9A Spanish', course_code: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(201)
    expect(DB.classes[0].course_code).toBe('spa_for_eng')
  })

  it('allows any course once the school is paying', async () => {
    DB.schools[0].platform_status = 'active'
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: '9A Spanish', course_code: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(201)
  })

  it('allows a premium course under a live org node — the org trial is all-languages', async () => {
    visibleGroupIds = ['sub-of-live-org']
    const res = makeRes()
    await handler(makeReq({ group_id: 'sub-of-live-org', class_name: 'Spanish pilot', course_code: 'spa_for_eng' }), res)
    expect(res.statusCode).toBe(201)
  })

  it('still allows a heritage course on a school with no course of its own', async () => {
    const res = makeRes()
    await handler(makeReq({ group_id: 'root-org', class_name: 'Year 7 Welsh', course_code: 'cym_s_for_eng' }), res)
    expect(res.statusCode).toBe(201)
  })
})
