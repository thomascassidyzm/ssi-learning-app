/**
 * Tests for POST /api/code/redeem — region-tier slice 1 wiring:
 *   - govt_admin branch: honours grants_group_id; creates the group at
 *     redemption when absent (region-tier-design.md §1c).
 *   - school_admin branch: sets schools.group_id at birth and registers BOTH
 *     join codes (teacher + admin), not just teacher (§1f).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-user-1' })),
}))

// Captures every write (insert/update/upsert) per table for assertions.
let writes: Record<string, any[]> = {}
// Per-test table responders: (calls) => { data, error } | undefined (undefined = fall through to default)
let responders: Record<string, (calls: any[][]) => any> = {}

function recordWrite(table: string, op: string, payload: unknown) {
  writes[table] = writes[table] || []
  writes[table].push({ op, payload })
}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    insert: (obj: unknown) => { calls.push(['insert', obj]); recordWrite(table, 'insert', obj); return builder },
    update: (obj: unknown) => { calls.push(['update', obj]); recordWrite(table, 'update', obj); return builder },
    upsert: (obj: unknown, opts: unknown) => { calls.push(['upsert', obj, opts]); recordWrite(table, 'upsert', obj); return builder },
    delete: () => { calls.push(['delete']); recordWrite(table, 'delete', undefined); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    is: (col: string, val: unknown) => { calls.push(['is', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) {
        const r = respond(calls)
        if (r !== undefined) return r
      }
      return { data: null, error: null }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    single() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

let authUserOverride: { email?: string; user_metadata?: Record<string, unknown> } = { email: 'leader@example.com' }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => makeChainable(table),
    rpc: (name: string, params: any) => {
      if (name === 'claim_invite_code_use') return Promise.resolve({ data: params.p_id, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    auth: {
      admin: {
        getUserById: () => Promise.resolve({ data: { user: authUserOverride } }),
      },
    },
  }),
}))

function makeRes() {
  const res: any = { _headers: {} }
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(overrides: Partial<VercelRequest>): VercelRequest {
  return { method: 'POST', query: {}, headers: {}, body: {}, ...overrides } as VercelRequest
}

describe('POST /api/code/redeem (invite codes, region-tier slice 1)', () => {
  let handler: typeof import('./redeem').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    authUserOverride = { email: 'leader@example.com' }
    handler = (await import('./redeem')).default
  })

  it('govt_admin branch: honours an existing grants_group_id, does not create a new group', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-1',
            code: 'ABC-123',
            code_type: 'govt_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-existing',
            metadata: { organization_name: 'Gwynedd Education Authority' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'learner-1' }, error: null } // already exists
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ABC-123', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.role).toBe('govt_admin')
    // No new group created — reused the invite's grants_group_id.
    expect(writes.groups).toBeUndefined()
    expect(writes.govt_admins).toHaveLength(1)
    expect(writes.govt_admins[0].payload.group_id).toBe('group-existing')
  })

  it('govt_admin branch: creates the group at redemption when grants_group_id is absent', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-2',
            code: 'DEF-456',
            code_type: 'govt_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: { organization_name: 'New Region HQ' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-2' }, error: null })
    responders.groups = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      if (isInsert) return { data: { id: 'group-new' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'DEF-456', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(writes.groups).toHaveLength(1)
    expect(writes.groups[0].payload).toMatchObject({ name: 'New Region HQ', type: 'region' })
    expect(writes.govt_admins[0].payload.group_id).toBe('group-new')
  })

  it('school_admin branch: sets group_id at birth and registers BOTH join codes', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-3',
            code: 'SCH-789',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-gwynedd',
            metadata: { school_name: 'Ysgol y Garnedd' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-3' }, error: null })
    responders.schools = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      // The pre-insert existence check selects 'id' alongside the join codes;
      // ensureJoinCodesRegistered's own select does not — that's how the two
      // are told apart here. Pre-check → no existing school (this test covers
      // the fresh-insert path).
      const isPreCheckSelect = calls.some((c) => c[0] === 'select' && /\bid\b/.test(String(c[1])) && String(c[1]).includes('teacher_join_code'))
      const isSelectJoinCodes = calls.some((c) => c[0] === 'select' && String(c[1]).includes('teacher_join_code') && !/\bid\b/.test(String(c[1])))
      if (isInsert) {
        return {
          data: { id: 'school-1', teacher_join_code: 'TEACH-1', admin_join_code: 'ADMIN-1' },
          error: null,
        }
      }
      if (isPreCheckSelect) {
        return { data: null, error: null }
      }
      if (isSelectJoinCodes) {
        return { data: { teacher_join_code: 'TEACH-1', admin_join_code: 'ADMIN-1' }, error: null }
      }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'SCH-789', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    // Goes straight to /schools — no second onboarding journey / second OTP.
    expect(res._json.redirectTo).toBe('/schools')
    expect(writes.schools.filter((w) => w.op === 'insert')).toHaveLength(1)
    expect(writes.schools[0].payload.group_id).toBe('group-gwynedd')
    expect(writes.schools[0].payload.name_confirmed).toBe(false)
    expect(writes.invite_codes.some((w) => w.op === 'upsert')).toBe(true)
    const upserted = writes.invite_codes.find((w) => w.op === 'upsert')!.payload
    const codeTypes = upserted.map((r: any) => r.code_type)
    expect(codeTypes).toEqual(expect.arrayContaining(['teacher', 'school_admin_join']))
    // Trial clocks are set AT REDEMPTION, not via a later /schools1 → provision hop.
    expect(writes.trial_burns.some((w) => w.op === 'insert')).toBe(true)
    const trialUpdate = writes.schools.find((w) => w.op === 'update')!
    expect(trialUpdate.payload).toMatchObject({ platform_status: 'trial', trial_kind: 'free_1yr', trial_course_code: null })
  })

  it('school_admin branch: group_id is null when the invite carries none (self-serve, ungrouped)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-4',
            code: 'SCH-000',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-4' }, error: null })
    responders.schools = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isPreCheckSelect = calls.some((c) => c[0] === 'select' && /\bid\b/.test(String(c[1])) && String(c[1]).includes('teacher_join_code'))
      if (isInsert) return { data: { id: 'school-2', teacher_join_code: 'TEACH-2', admin_join_code: 'ADMIN-2' }, error: null }
      if (isPreCheckSelect) return { data: null, error: null }
      return { data: { teacher_join_code: 'TEACH-2', admin_join_code: 'ADMIN-2' }, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'SCH-000', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(writes.schools[0].payload.group_id).toBe(null)
  })

  it('school_admin branch: attaches group_id to a PRE-EXISTING ungrouped school for this admin instead of leaving it orphaned', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-5',
            code: 'SCH-ATTACH',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-gwynedd',
            metadata: { school_name: 'Gwynedd School 003' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-5' }, error: null })
    // This admin already has a school row from before this invite (e.g. an
    // earlier self-serve signup) — ungrouped.
    responders.schools = (calls) => {
      const isPreCheckSelect = calls.some(
        (c) => c[0] === 'select' && /\bid\b/.test(String(c[1])) && String(c[1]).includes('teacher_join_code'),
      )
      const isUpdate = calls.some((c) => c[0] === 'update')
      const isSelectJoinCodes = calls.some(
        (c) => c[0] === 'select' && String(c[1]).includes('teacher_join_code') && !/\bid\b/.test(String(c[1])),
      )
      if (isPreCheckSelect) {
        return { data: { id: 'school-preexisting', teacher_join_code: 'TEACH-5', admin_join_code: 'ADMIN-5', group_id: null }, error: null }
      }
      if (isUpdate) return { data: null, error: null }
      if (isSelectJoinCodes) return { data: { teacher_join_code: 'TEACH-5', admin_join_code: 'ADMIN-5' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'SCH-ATTACH', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    // No new school row created — the pre-existing one was reused.
    expect(writes.schools.some((w) => w.op === 'insert')).toBe(false)
    // The invite's group_id was backfilled onto the existing (previously ungrouped) row.
    const update = writes.schools.find((w) => w.op === 'update')!
    expect(update.payload).toEqual({ group_id: 'group-gwynedd' })
  })

  it('school_admin branch: attaches group_id when a concurrent ungrouped insert (e.g. self-serve /schools1 provision) wins the race, not just when found at precheck', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-6',
            code: 'SCH-RACE-ATTACH',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-gwynedd',
            metadata: { school_name: 'Gwynedd School 002' },
            max_uses: 1,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-6' }, error: null })
    // Precheck finds NOTHING (this is the first this admin has been seen), so
    // redeem.ts attempts its own grouped insert — but a concurrent ungrouped
    // insert (e.g. an abandoned self-serve /schools1 onboarding provisioning
    // late) commits first and wins the unique-index race.
    let idSelectCount = 0
    responders.schools = (calls) => {
      // Order matters: an insert's own chained .select().single() re-uses the
      // same 'id, teacher_join_code, ...' column string as the precheck AND
      // the post-23505 re-read select — isInsert must be checked first, and
      // the two bare selects are told apart by CALL ORDER (precheck is
      // always first, re-read always second), not by shape.
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isIdSelect = !isInsert && calls.some(
        (c) => c[0] === 'select' && /\bid\b/.test(String(c[1])) && String(c[1]).includes('teacher_join_code'),
      )
      const isUpdate = calls.some((c) => c[0] === 'update')
      const isSelectJoinCodes = calls.some(
        (c) => c[0] === 'select' && String(c[1]).includes('teacher_join_code') && !/\bid\b/.test(String(c[1])),
      )
      if (isInsert) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "schools_admin_user_id_key"' } }
      }
      if (isIdSelect) {
        idSelectCount += 1
        if (idSelectCount === 1) return { data: null, error: null } // precheck: nothing yet
        // Post-23505 re-read — the raced winner's row, ungrouped.
        return { data: { id: 'school-raced-winner', teacher_join_code: 'TEACH-6', admin_join_code: 'ADMIN-6', group_id: null }, error: null }
      }
      if (isUpdate) return { data: null, error: null }
      if (isSelectJoinCodes) return { data: { teacher_join_code: 'TEACH-6', admin_join_code: 'ADMIN-6' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'SCH-RACE-ATTACH', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    // The invite's group_id was backfilled onto the raced-winner row — this is
    // the fix: the 23505 recovery path must not skip group attachment just
    // because it didn't come through the precheck-existing branch.
    const update = writes.schools.find((w) => w.op === 'update')!
    expect(update.payload).toEqual({ group_id: 'group-gwynedd' })
  })

  it('school_admin branch: two concurrent redemptions for the same admin produce exactly ONE school (double-redeem race, WORKLIST 07-13)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-race',
            code: 'SCH-RACE',
            code_type: 'school_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: { school_name: 'Race Test School' },
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-race' }, error: null })

    // Models the real DB: the FIRST insert to actually commit wins and sets
    // the row; any insert attempted after that hits the 20260713 unique
    // index on admin_user_id and gets 23505, regardless of call ordering.
    let committedSchool: any = null
    responders.schools = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isInsert) {
        if (committedSchool) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "schools_admin_user_id_key"' } }
        }
        committedSchool = { id: 'school-race', teacher_join_code: 'TEACH-R', admin_join_code: 'ADMIN-R' }
        return { data: committedSchool, error: null }
      }
      if (isSelect) return { data: committedSchool, error: null }
      return { data: null, error: null }
    }

    const res1 = makeRes()
    const res2 = makeRes()
    await Promise.all([
      handler(makeReq({ body: { code: 'SCH-RACE', codeKind: 'invite' } }), res1),
      handler(makeReq({ body: { code: 'SCH-RACE', codeKind: 'invite' } }), res2),
    ])

    // Both requests report success (idempotent — the loser reuses the winner's row).
    expect(res1._json.success).toBe(true)
    expect(res2._json.success).toBe(true)
    // Exactly one school row actually committed.
    expect(writes.schools.filter((w) => w.op === 'insert')).toHaveLength(2) // both attempted the insert...
    expect(committedSchool.id).toBe('school-race') // ...but only one write ever "took"
  })

  it('govt_admin branch: two concurrent redemptions for the same admin produce exactly ONE govt_admins row', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-govt-race',
            code: 'GOVT-RACE',
            code_type: 'govt_admin',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: { organization_name: 'Race Region' },
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-govt-race' }, error: null })
    // Neither request sees the other's group ahead of time (no grants_group_id
    // to share, and no committed govt_admins row yet) — each mints its own,
    // exactly as two truly concurrent requests would.
    let groupInsertCount = 0
    responders.groups = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      if (isInsert) {
        groupInsertCount++
        return { data: { id: `group-${groupInsertCount}` }, error: null }
      }
      return { data: null, error: null }
    }

    let committedGovtAdmin: any = null
    responders.govt_admins = (calls) => {
      const isInsert = calls.some((c) => c[0] === 'insert')
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isInsert) {
        if (committedGovtAdmin) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "govt_admins_user_id_key"' } }
        }
        const payload = calls.find((c) => c[0] === 'insert')![1]
        committedGovtAdmin = { group_id: payload.group_id }
        return { data: committedGovtAdmin, error: null }
      }
      if (isSelect) return { data: committedGovtAdmin, error: null }
      return { data: null, error: null }
    }

    const res1 = makeRes()
    const res2 = makeRes()
    await Promise.all([
      handler(makeReq({ body: { code: 'GOVT-RACE', codeKind: 'invite' } }), res1),
      handler(makeReq({ body: { code: 'GOVT-RACE', codeKind: 'invite' } }), res2),
    ])

    expect(res1._json.success).toBe(true)
    expect(res2._json.success).toBe(true)
    // Exactly one govt_admins row survives.
    expect(committedGovtAdmin).not.toBeNull()
    // Both requests minted their own group (no shared group_id to race on),
    // but the loser's orphan group gets cleaned up — one delete, one survivor.
    expect(writes.groups.filter((w) => w.op === 'insert')).toHaveLength(2)
    expect(writes.groups.filter((w) => w.op === 'delete')).toHaveLength(1)
  })

  it('student branch: tags into the class, enrols in course_enrollments, and returns the class course_code (2026-07-15 landing fix)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-student-1',
            code: 'STU-123',
            code_type: 'student',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: 'class-welsh-1',
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'learner-student-1' }, error: null }
      return { data: null, error: null }
    }
    responders.classes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { course_code: 'cym_for_eng' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'STU-123', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.role).toBe('student')
    // The class's course_code comes back so the client can land the student
    // straight on it — the redirect target itself (finding #3, 2026-07-13).
    expect(res._json.courseCode).toBe('cym_for_eng')
    // Tagged onto the class roster.
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'class',
      tag_value: 'CLASS:class-welsh-1',
      role_in_context: 'student',
    })
    // Actually enrolled in the class's course — not just tagged (2026-07-15
    // finding: a class-invite student had a CLASS: tag but no
    // course_enrollments row, so "landed in the right course" wasn't the same
    // as "enrolled and ready to play").
    expect(writes.course_enrollments).toHaveLength(1)
    expect(writes.course_enrollments[0].op).toBe('upsert')
    expect(writes.course_enrollments[0].payload).toEqual({
      learner_id: 'learner-student-1',
      course_id: 'cym_for_eng',
    })
  })

  it('LEAF GRANT COMPAT (I10): a student code carrying an explicit grants_class_id still joins at tag_type=class (CLASS:<id>), never group — the leaf-only rule this pinned is superseded by I7, but an explicit leaf grant is unchanged', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-student-leaf',
            code: 'STU-LEAF',
            code_type: 'student',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: 'class-leaf-1',
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'learner-leaf-1' }, error: null }
      return { data: null, error: null }
    }
    responders.classes = () => ({ data: { course_code: 'cym_for_eng' }, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'STU-LEAF', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    // Exactly one user_tags write, and it is leaf-scoped (class). An explicit
    // grants_class_id always wins over any group grant (see the group-only
    // branch below) — this is compat, not an enforced leaf-only restriction.
    expect(writes.user_tags).toHaveLength(1)
    const tagWrite = writes.user_tags[0].payload
    expect(tagWrite.tag_type).toBe('class')
    expect(tagWrite.tag_value).toBe('CLASS:class-leaf-1')
    expect(tagWrite.tag_type).not.toBe('school')
    expect(tagWrite.tag_type).not.toBe('group')
  })

  it('DEGENERATE GRANT (pre-existing edge case, unhardened): a student code with neither grants_class_id nor grants_group_id still writes a broken CLASS:null tag rather than silently affiliating anywhere else', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-student-noclass',
            code: 'STU-NOCLASS',
            code_type: 'student',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'learner-noclass-1' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'STU-NOCLASS', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    // No group/school-level fallback is ever created for a student redemption.
    expect(writes.groups).toBeUndefined()
    expect(writes.schools).toBeUndefined()
    // The tag write still happens and is still tag_type='class' — the current
    // (undesirable) behavior is a broken tag_value rather than a silent
    // group/school-level enrollment. Documents the edge case for whoever
    // hardens this: grants_class_id should be validated before this branch.
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload.tag_type).toBe('class')
    expect(writes.user_tags[0].payload.tag_value).toBe('CLASS:null')
    // course_enrollments is skipped entirely without a class id — no orphan
    // enrollment gets created either.
    expect(writes.course_enrollments).toBeUndefined()
  })

  it('INTERIOR-NODE JOIN (I7): a teacher code carrying only grants_group_id (no grants_school_id) affiliates at the group node — writes a GROUP: tag, no dual-write when the node is not a school', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-teacher-group-1',
            code: 'TEACH-GRP-1',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-interior-1',
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-teacher-group-1' }, error: null })
    // Default schools responder (data: null) — this group node is not a school.

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TEACH-GRP-1', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.redirectTo).toBe('/schools')
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'group',
      tag_value: 'GROUP:group-interior-1',
      role_in_context: 'teacher',
    })
  })

  it("INTERIOR-NODE JOIN + DUAL-WRITE (THE-MODEL.md §5 item 5): a teacher code granting a group that IS a school's own node (schools.node_group_id) also writes the legacy SCHOOL: tag so deployed dashboards see the person tonight", async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-teacher-group-2',
            code: 'TEACH-GRP-2',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-school-node-1',
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-teacher-group-2' }, error: null })
    responders.schools = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'school-42' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TEACH-GRP-2', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(writes.user_tags).toHaveLength(2)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'group',
      tag_value: 'GROUP:group-school-node-1',
      role_in_context: 'teacher',
    })
    expect(writes.user_tags[1].payload).toMatchObject({
      tag_type: 'school',
      tag_value: 'SCHOOL:school-42',
      role_in_context: 'teacher',
    })
  })

  it('INTERIOR-NODE JOIN (I7): a student code carrying only grants_group_id (no grants_class_id) affiliates at the group node — writes a GROUP: tag, no dual-write when the node is not a school, and no course_enrollments write (no class to enrol into)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-student-group-1',
            code: 'STU-GRP-1',
            code_type: 'student',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-interior-2',
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-student-group-1' }, error: null })
    // Default schools responder (data: null) — this group node is not a school.

    const res = makeRes()
    await handler(makeReq({ body: { code: 'STU-GRP-1', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'group',
      tag_value: 'GROUP:group-interior-2',
      role_in_context: 'student',
    })
    // No class grant on a group-scoped student code — nothing to enrol into.
    expect(writes.course_enrollments).toBeUndefined()
  })

  it("INTERIOR-NODE JOIN + DUAL-WRITE (THE-MODEL.md §5 item 5): a student code granting a group that IS a school's own node also writes the legacy SCHOOL: tag", async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-student-group-2',
            code: 'STU-GRP-2',
            code_type: 'student',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-school-node-2',
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-student-group-2' }, error: null })
    responders.schools = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'school-77' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'STU-GRP-2', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(writes.user_tags).toHaveLength(2)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'group',
      tag_value: 'GROUP:group-school-node-2',
      role_in_context: 'student',
    })
    expect(writes.user_tags[1].payload).toMatchObject({
      tag_type: 'school',
      tag_value: 'SCHOOL:school-77',
      role_in_context: 'student',
    })
  })

  it('group-scoped dedup: a teacher already tagged GROUP:<id> gets "Already redeemed for this group" and writes nothing (check-then-act, same shape as the school/class dedup checks above)', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-teacher-group-dup',
            code: 'TEACH-GRP-DUP',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: null,
            grants_group_id: 'group-already-1',
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.user_tags = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'existing-tag-1' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TEACH-GRP-DUP', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(res._json.error).toBe('Already redeemed for this group')
    expect(writes.user_tags).toBeUndefined()
    expect(writes.learners).toBeUndefined()
  })

  it('teacher branch: a brand-new learner from possession-onboarding is created with needs_verification true', async () => {
    authUserOverride = { email: 'newteacher@school.example', user_metadata: { onboarded_via: 'possession', display_name: 'New Teacher' } }
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-teacher-1',
            code: 'TEACH-1',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: 'school-1',
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: null, error: null } // no existing learner — triggers the insert path
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TEACH-1', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    const insertWrite = writes.learners.find((w) => w.op === 'insert')
    expect(insertWrite?.payload).toMatchObject({ needs_verification: true })
  })

  it('teacher branch: a brand-new learner from OTP onboarding is created with needs_verification false', async () => {
    authUserOverride = { email: 'newteacher@school.example', user_metadata: {} }
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-teacher-2',
            code: 'TEACH-2',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: 'school-1',
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: null, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TEACH-2', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    const insertWrite = writes.learners.find((w) => w.op === 'insert')
    expect(insertWrite?.payload).toMatchObject({ needs_verification: false })
  })

  it('student branch: a failed course_enrollments write does not fail the redemption', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-student-2',
            code: 'STU-456',
            code_type: 'student',
            grants_region: null,
            grants_school_id: null,
            grants_class_id: 'class-welsh-2',
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'learner-student-2' }, error: null }
      return { data: null, error: null }
    }
    responders.classes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { course_code: 'zho_for_eng' }, error: null }
      return { data: null, error: null }
    }
    responders.course_enrollments = () => ({ data: null, error: { code: '23503', message: 'boom' } })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'STU-456', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.courseCode).toBe('zho_for_eng')
  })

  it('teacher branch: writes a SCHOOL: tag with role_in_context teacher and redirects to /schools', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-teacher-3',
            code: 'TEACH-3',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: 'school-9',
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-teacher-3' }, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'TEACH-3', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.redirectTo).toBe('/schools')
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'school',
      tag_value: 'SCHOOL:school-9',
      role_in_context: 'teacher',
    })
  })

  it('school_admin_join branch: writes a SCHOOL: tag with role_in_context admin and redirects to /schools', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-admin-join-1',
            code: 'ADMIN-JOIN-1',
            code_type: 'school_admin_join',
            grants_region: null,
            grants_school_id: 'school-9',
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-admin-join-1' }, error: null })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ADMIN-JOIN-1', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.redirectTo).toBe('/schools')
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload).toMatchObject({
      tag_type: 'school',
      tag_value: 'SCHOOL:school-9',
      role_in_context: 'admin',
    })
    // school_admin_join sets educational_role via the 'school_admin' override
    // (distinct from the plain school_admin invite-born branch above).
    const learnerUpdate = writes.learners.find((w) => w.op === 'update')
    expect(learnerUpdate?.payload).toMatchObject({ educational_role: 'school_admin' })
  })

  it('returns "Code expired" for an active invite code past its expires_at, without claiming a use', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-expired-1',
            code: 'EXP-1',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: 'school-9',
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: null,
            use_count: 0,
            expires_at: '2020-01-01T00:00:00.000Z',
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'EXP-1', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(res._json.error).toBe('Code expired')
    expect(writes.user_tags).toBeUndefined()
  })

  it('returns "Code fully used" once use_count reaches max_uses', async () => {
    responders.invite_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'invite-exhausted-1',
            code: 'MAXED-1',
            code_type: 'teacher',
            grants_region: null,
            grants_school_id: 'school-9',
            grants_class_id: null,
            grants_group_id: null,
            metadata: {},
            max_uses: 1,
            use_count: 1,
            expires_at: null,
            is_active: true,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'MAXED-1', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(res._json.error).toBe('Code fully used')
    expect(writes.user_tags).toBeUndefined()
  })

  it('returns "Invalid code" for an unknown/inactive code (no matching row)', async () => {
    responders.invite_codes = () => ({ data: null, error: { message: 'no rows' } })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'DOES-NOT-EXIST', codeKind: 'invite' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(res._json.error).toBe('Invalid code')
  })

  it('rejects a request missing codeKind', async () => {
    const res = makeRes()
    await handler(makeReq({ body: { code: 'ANY-CODE' } }), res)
    expect(res._status).toBe(400)
  })

  it('rejects unauthenticated callers', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'Missing or invalid Authorization header' })

    const res = makeRes()
    await handler(makeReq({ body: { code: 'ANY-CODE', codeKind: 'invite' } }), res)
    expect(res._status).toBe(401)
  })
})

describe('POST /api/code/redeem (entitlement codes)', () => {
  let handler: typeof import('./redeem').default

  beforeEach(async () => {
    vi.resetModules()
    writes = {}
    responders = {}
    authUserOverride = { email: 'learner@example.com' }
    handler = (await import('./redeem')).default
  })

  it('valid entitlement code creates a user_entitlements row and reports success', async () => {
    responders.entitlement_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'ent-1',
            code: 'FULL-1',
            access_type: 'full',
            granted_courses: null,
            duration_type: 'lifetime',
            duration_days: null,
            label: 'Full lifetime access',
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
            grants_platform_role: null,
            grants_dashboard_courses: null,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-ent-1' }, error: null })
    responders.user_entitlements = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: null, error: null } // not already redeemed
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'FULL-1', codeKind: 'entitlement' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(true)
    expect(res._json.codeKind).toBe('entitlement')
    expect(res._json.label).toBe('Full lifetime access')
    expect(writes.user_entitlements).toHaveLength(1)
    expect(writes.user_entitlements[0].payload).toMatchObject({
      learner_id: 'learner-ent-1',
      entitlement_code_id: 'ent-1',
      access_type: 'full',
      expires_at: null,
    })
  })

  it('reports "Code already redeemed" without inserting a second user_entitlements row', async () => {
    responders.entitlement_codes = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) {
        return {
          data: {
            id: 'ent-2',
            code: 'FULL-2',
            access_type: 'full',
            granted_courses: null,
            duration_type: 'lifetime',
            duration_days: null,
            label: 'Full lifetime access',
            max_uses: null,
            use_count: 0,
            expires_at: null,
            is_active: true,
            grants_platform_role: null,
            grants_dashboard_courses: null,
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    responders.learners = () => ({ data: { id: 'learner-ent-2' }, error: null })
    responders.user_entitlements = (calls) => {
      const isSelect = calls.some((c) => c[0] === 'select')
      if (isSelect) return { data: { id: 'existing-entitlement' }, error: null }
      return { data: null, error: null }
    }

    const res = makeRes()
    await handler(makeReq({ body: { code: 'FULL-2', codeKind: 'entitlement' } }), res)

    expect(res._status).toBe(200)
    expect(res._json.success).toBe(false)
    expect(res._json.error).toBe('Code already redeemed')
    expect(writes.user_entitlements).toBeUndefined()
  })
})
