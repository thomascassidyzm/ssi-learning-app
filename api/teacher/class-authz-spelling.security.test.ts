/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`, finding TENANCY-08 (low).
 *
 * "Is this person an admin of this school?" has TWO valid spellings, and
 * _utils/schoolStaff.ts:105-133 is the designated single owner of the question:
 * the `schools.admin_user_id` founding pointer, OR an active `SCHOOL:` tag with
 * `role_in_context='admin'` — which is what the invite/claim path writes for
 * every admin after the founder. Its docstring records the live consequence of
 * asking only the first (Tom, staging, 2026-08-08) and states the intent: "ONE
 * predicate, exported, so the two spellings can never again be recognised in
 * one place and missed in another."
 *
 * Three sites still hand-roll the pointer-only ladder rather than calling it:
 *   · api/teacher/create-class-join-code.ts:125-132
 *   · api/teacher/create-class-learner.ts:114-121
 *   · api/school/roster.ts:297-304   (?class_id co-teacher picker)
 *
 * This FAILS CLOSED — a tag-admin is refused verbs for her own school's
 * classes — so it is a denial, not an exposure. It is reported because CLAUDE.md
 * names duplicated authz rules as the drift mechanism, and this is that
 * mechanism caught on three surfaces.
 *
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

const TAG_ADMIN = 'tag-admin-uid'      // holds the SCHOOL: admin tag, not the pointer
const FOUNDING_ADMIN = 'founder-uid'   // holds schools.admin_user_id
const SCHOOL_ID = 'school-1'
const CLASS_ID = 'class-1'

/**
 * A service client where the school's founding pointer is FOUNDING_ADMIN and
 * TAG_ADMIN holds an active SCHOOL: admin tag — the ordinary post-founder shape.
 */
function makeSupabase(): SupabaseClient {
  const from = (table: string) => {
    const eqs: [string, unknown][] = []
    const builder: any = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => { eqs.push([col, val]); return builder }
    builder.is = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => {
      const get = (c: string) => eqs.find(([k]) => k === c)?.[1]
      if (table === 'schools') {
        return Promise.resolve({ data: { id: SCHOOL_ID, admin_user_id: FOUNDING_ADMIN, group_id: null, node_group_id: null }, error: null })
      }
      if (table === 'user_tags') {
        const isSchoolAdminTag =
          get('tag_type') === 'school' &&
          get('tag_value') === `SCHOOL:${SCHOOL_ID}` &&
          get('role_in_context') === 'admin' &&
          get('user_id') === TAG_ADMIN
        return Promise.resolve({ data: isSchoolAdminTag ? { id: 'tag-1' } : null, error: null })
      }
      if (table === 'learners') {
        // Neither principal is a platform admin.
        return Promise.resolve({ data: { platform_role: null, educational_role: 'school_admin' }, error: null })
      }
      if (table === 'classes') {
        return Promise.resolve({ data: { id: CLASS_ID, teacher_user_id: 'someone-else', school_id: SCHOOL_ID, group_id: null, student_join_code: 'ABC-123' }, error: null })
      }
      if (table === 'govt_admins') return Promise.resolve({ data: null, error: null })
      return Promise.resolve({ data: null, error: null })
    }
    builder.single = builder.maybeSingle
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }
  return { from } as unknown as SupabaseClient
}

describe('CONTROL — the shared predicates accept BOTH admin spellings', () => {
  it('isSchoolAdminOf accepts the founding pointer', async () => {
    const { isSchoolAdminOf } = await import('../_utils/schoolStaff')
    await expect(isSchoolAdminOf(makeSupabase(), FOUNDING_ADMIN, SCHOOL_ID)).resolves.toBe(true)
  })

  it('isSchoolAdminOf accepts the SCHOOL: admin tag', async () => {
    const { isSchoolAdminOf } = await import('../_utils/schoolStaff')
    await expect(isSchoolAdminOf(makeSupabase(), TAG_ADMIN, SCHOOL_ID)).resolves.toBe(true)
  })

  it('isSchoolAdminOf still denies an unrelated user', async () => {
    const { isSchoolAdminOf } = await import('../_utils/schoolStaff')
    await expect(isSchoolAdminOf(makeSupabase(), 'stranger-uid', SCHOOL_ID)).resolves.toBe(false)
  })

  it('canTeachClass — the ready-made composite — lets the tag-admin teach her school’s class', async () => {
    const { canTeachClass } = await import('../_utils/classTeacherAuth')
    const classRow = { id: CLASS_ID, teacher_user_id: 'someone-else', school_id: SCHOOL_ID, group_id: null }
    await expect(canTeachClass(makeSupabase(), TAG_ADMIN, classRow)).resolves.toBe(true)
  })

  it('canTeachClass denies a stranger', async () => {
    const { canTeachClass } = await import('../_utils/classTeacherAuth')
    const classRow = { id: CLASS_ID, teacher_user_id: 'someone-else', school_id: SCHOOL_ID, group_id: null }
    await expect(canTeachClass(makeSupabase(), 'stranger-uid', classRow)).resolves.toBe(false)
  })
})

// ---------------------------------------------------------------------------

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: TAG_ADMIN })),
  verifyAdmin: vi.fn(async () => ({ error: 'not admin', status: 403, userId: TAG_ADMIN })),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeSupabase(),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

let joinCodeHandler: typeof import('./create-class-join-code').default

beforeEach(async () => {
  joinCodeHandler = (await import('./create-class-join-code')).default
})

/**
 * SECURITY FINDING TENANCY-08: create-class-join-code.ts:125-132 asks only
 * `schools.admin_user_id === callerUserId`, so the school's tag-admin — every
 * admin after the founder — is refused a verb for a class in her own school.
 * The same pointer-only ladder appears in create-class-learner.ts:114-121 and
 * roster.ts:297-304.
 *
 * WHAT SHOULD HAPPEN INSTEAD: these three ladders should be replaced by
 * `canTeachClass(supabase, callerUserId, classRow)`, which already composes
 * lead-pointer → active class tag → platform admin → isSchoolAdminOf (both
 * spellings) — proven by the CONTROL block above. The assertion below should
 * then read 200, not 403.
 */
describe('SECURITY FINDING TENANCY-08 — pointer-only admin check denies the school’s own tag-admin', () => {
  it('403s the tag-admin creating a join code for a class in her own school (current behaviour)', async () => {
    const req = { method: 'POST', body: { class_id: CLASS_ID }, headers: { authorization: 'Bearer tok' } } as unknown as VercelRequest
    const res = makeRes()
    await joinCodeHandler(req, res)

    expect(res.statusCode).toBe(403) // ← the defect: canTeachClass would allow her
    expect(res.body.error).toMatch(/Not authorized/i)
  })

  it.todo('TENANCY-08: create-class-join-code.ts should authorise via canTeachClass and return 200 for a tag-admin')
  it.todo('TENANCY-08: create-class-learner.ts should authorise via canTeachClass')
  it.todo('TENANCY-08: school/roster.ts ?class_id lookup should authorise via canTeachClass')
})
