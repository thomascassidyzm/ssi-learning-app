/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * PostgREST filter-string injection: `.or(...)` takes a RAW PostgREST logic
 * tree, not a parameterised value. Anything interpolated into it with a
 * template literal is syntax, not data — a `,` or `.` in the interpolated
 * string adds a NEW disjunct to the filter.
 *
 * This file drives the real handlers with a recording Supabase mock so the
 * filter string that would actually be sent is observable.
 *
 * Findings documented here: INPUT-02 (class-progress .or injection),
 * INPUT-03 (mass assignment in updateLegoProgress), INPUT-06 (admin search).
 * Controls locked here: the `groups.path` slug constraint that makes the
 * invites.ts `.or(path.eq.${path},…)` interpolation non-injectable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const CLASS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CLASS_LEARNER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const OTHER_LEARNER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

/** Every `.or()` string and `.update()` payload the handler builds, in order. */
const recorded = {
  orFilters: [] as string[],
  updates: [] as Record<string, unknown>[],
}

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: () => Promise.resolve({ valid: true, userId: 'auth-uid-teacher' }),
}))

vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: () =>
    Promise.resolve({ role: 'teacher', classIds: [CLASS_ID], schoolIds: [], groupIds: [] }),
}))

vi.mock('@supabase/supabase-js', () => {
  function makeChain(table: string): any {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => {
        if (table === 'classes') {
          return Promise.resolve({
            data: { class_learner_id: CLASS_LEARNER_ID, course_code: 'fra_for_eng' },
            error: null,
          })
        }
        // lego_progress ownership hop: the row belongs to the class learner.
        return Promise.resolve({ data: { learner_id: CLASS_LEARNER_ID }, error: null })
      },
      single: () => Promise.resolve({ data: {}, error: null }),
      update: (payload: Record<string, unknown>) => {
        recorded.updates.push(payload)
        return chain
      },
      insert: () => chain,
      or: (filter: string) => {
        recorded.orFilters.push(filter)
        return Promise.resolve({ data: null, error: null })
      },
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
    }
    return chain
  }
  return { createClient: () => ({ from: (table: string) => makeChain(table) }) }
})

function makeRes() {
  const res: any = { _headers: {} }
  res.setHeader = vi.fn((k: string, v: string) => {
    res._headers[k] = v
    return res
  })
  res.status = vi.fn((code: number) => {
    res._status = code
    return res
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res
  })
  res.end = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any }
}

function makeReq(body: unknown): VercelRequest {
  return {
    method: 'POST',
    query: {},
    headers: { authorization: 'Bearer fake-jwt' },
    body,
  } as VercelRequest
}

describe('PostgREST filter injection — api/school/class-progress.ts', () => {
  let handler: typeof import('../school/class-progress').default

  beforeEach(async () => {
    recorded.orFilters = []
    recorded.updates = []
    vi.resetModules()
    handler = (await import('../school/class-progress')).default
  })

  // SECURITY FINDING INPUT-02: `roundIndex` arrives as an untyped positional
  // arg (api/school/class-progress.ts:374-386 — `const a: any[] = args`) and is
  // interpolated raw into the `.or()` at line 224. A caller who sends a string
  // containing a comma injects an extra disjunct into the WHERE clause of a
  // service-role UPDATE. It should be coerced with Number()/Number.isInteger()
  // and rejected if not a finite integer, so only a numeric literal can ever
  // reach the filter string.
  it('INPUT-02: a string roundIndex is interpolated verbatim into the .or() filter (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        classId: CLASS_ID,
        method: 'setLivePosition',
        // Second positional arg is roundIndex. This payload adds a disjunct.
        args: ['S0001L01', '0,current_cycle_index.gte.0', 0],
      }),
      res,
    )

    expect(res._status).toBe(200)
    expect(recorded.orFilters).toContain(
      'last_completed_round_index.is.null,last_completed_round_index.lte.0,current_cycle_index.gte.0',
    )
  })

  it.todo(
    'INPUT-02: setLivePosition should reject a non-integer roundIndex with 400 instead of interpolating it into .or()',
  )

  // SECURITY FINDING INPUT-02b: same pattern on the infplay ratchet
  // (api/school/class-progress.ts:254) — `ratchetHighestTo.legoId` is a raw
  // client string interpolated into the .or(). It should be validated against
  // the LEGO id shape /^S\d{4}L\d{2}$/ that api/courses/[code]/cycles.ts:61
  // already applies to the same value on the read path.
  it('INPUT-02b: setMode ratchet legoId is interpolated verbatim into the .or() filter (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        classId: CLASS_ID,
        method: 'setMode',
        args: ['infplay', { legoId: 'S0001L01,current_mode.eq.main', roundIndex: 1 }],
      }),
      res,
    )

    expect(res._status).toBe(200)
    expect(recorded.orFilters).toContain(
      'last_completed_lego_id.is.null,last_completed_lego_id.lt.S0001L01,current_mode.eq.main',
    )
  })

  it.todo(
    'INPUT-02b: setMode should validate ratchetHighestTo.legoId against /^S\\d{4}L\\d{2}$/ before building the filter',
  )

  // SECURITY FINDING INPUT-03: `updateLegoProgress` spreads the client-supplied
  // `updates` object straight into `.update({ ...updates, updated_at })`
  // (api/school/class-progress.ts:190). The ownership hop above it proves the
  // row belongs to the class learner, but nothing constrains WHICH COLUMNS are
  // written — so `learner_id` can be re-pointed at an arbitrary learner,
  // handing another account a progress row it never earned. It should
  // allow-list columns exactly the way saveLegoProgress (line 152) already
  // does, and explicitly drop learner_id/course_id/id.
  it('INPUT-03: updateLegoProgress writes arbitrary caller-supplied columns, including learner_id (vulnerable, characterized)', async () => {
    const res = makeRes()
    await handler(
      makeReq({
        classId: CLASS_ID,
        method: 'updateLegoProgress',
        args: ['row-id-1', { learner_id: OTHER_LEARNER_ID, reps_completed: 9999, is_retired: true }],
      }),
      res,
    )

    expect(res._status).toBe(200)
    const written = recorded.updates.find((u) => 'learner_id' in u)
    expect(written).toBeDefined()
    expect(written!.learner_id).toBe(OTHER_LEARNER_ID)
  })

  it.todo(
    'INPUT-03: updateLegoProgress should allow-list writable columns and never accept learner_id/course_id from the body',
  )

  // CONTROL THAT HOLDS: saveLegoProgress already allow-lists. A spoofed
  // learner_id in the payload is dropped and the server-resolved class learner
  // is used. This is the regression lock for the fix INPUT-03 needs.
  it('CONTROL: saveLegoProgress ignores a spoofed learner_id and uses the server-resolved class learner', async () => {
    const inserts: Record<string, unknown>[] = []
    vi.resetModules()
    vi.doMock('@supabase/supabase-js', () => {
      function makeChain(table: string): any {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'classes'
                  ? { class_learner_id: CLASS_LEARNER_ID, course_code: 'fra_for_eng' }
                  : { learner_id: CLASS_LEARNER_ID },
              error: null,
            }),
          insert: (payload: Record<string, unknown>) => {
            inserts.push(payload)
            return chain
          },
          update: () => chain,
          or: () => Promise.resolve({ data: null, error: null }),
          single: () => Promise.resolve({ data: {}, error: null }),
        }
        return chain
      }
      return { createClient: () => ({ from: (t: string) => makeChain(t) }) }
    })
    const h = (await import('../school/class-progress')).default

    const res = makeRes()
    await h(
      makeReq({
        classId: CLASS_ID,
        method: 'saveLegoProgress',
        args: [{ lego_id: 'S0001L01', learner_id: OTHER_LEARNER_ID, course_id: 'evil_course' }],
      }),
      res,
    )

    expect(res._status).toBe(200)
    expect(inserts[0].learner_id).toBe(CLASS_LEARNER_ID)
    expect(inserts[0].course_id).toBe('fra_for_eng')
    vi.doUnmock('@supabase/supabase-js')
  })
})

describe('PostgREST filter injection — groups.path interpolation (control)', () => {
  // CONTROL THAT HOLDS: api/groups/[id]/invites.ts:132 interpolates
  // `groups.path` into `.or(`path.eq.${path},path.like.${path}/%`)`. That is
  // only safe because `compute_group_path()` (supabase/schema.sql:2287)
  // slugifies the group name to `[a-zA-Z0-9]+ -> '-'` before storing it, so a
  // stored path can never contain the `,` `.` `(` `)` that PostgREST's logic
  // tree treats as syntax. This test locks the slug rule that the
  // interpolation depends on — if groupSlug() ever widens, that .or() becomes
  // a second-order injection.
  it('CONTROL: groupSlug() strips every PostgREST logic-tree metacharacter', async () => {
    const { groupSlug } = await import('../_utils/groupSlug')
    const hostile = 'Evil,path.like.*,or(id.eq.1).name'
    const slug = groupSlug(hostile)

    expect(slug).toMatch(/^[a-z0-9-]*$/)
    for (const meta of [',', '.', '(', ')', '*', '%', ':', '"']) {
      expect(slug).not.toContain(meta)
    }
  })

  it('CONTROL: a slugged path stays segment-safe so path.like.${path}/% cannot escape its subtree', async () => {
    const { groupSlug } = await import('../_utils/groupSlug')
    expect(groupSlug('Acme Ltd')).toBe('acme-ltd')
    expect(groupSlug('Acme/Ltd')).toBe('acme-ltd') // '/' is not a slug character
  })
})

describe('PostgREST filter injection — api/admin/users.ts search (INPUT-06)', () => {
  // SECURITY FINDING INPUT-06: `search` (a raw query param) is interpolated
  // into BOTH `.ilike('email', `%${search}%`)` (line 299, a VALUE — safe,
  // postgrest-js encodes it) and `.or(`display_name.ilike.%${search}%`)`
  // (lines 314-318, SYNTAX — not safe). The endpoint is behind verifyAdmin so
  // the blast radius is an already-privileged caller re-shaping a same-table
  // filter, which is why this is low rather than high — but the pattern is the
  // classic Supabase injection and should not be copied. Fix: build the search
  // branch with two separate queries, or escape `,` `.` `(` `)` `:` in the
  // interpolated value.
  //
  // This is a pure string-construction characterization: it reproduces the
  // exact expression at api/admin/users.ts:314 without invoking the
  // admin-owned handler (another audit worker owns tests under api/admin/).
  it('INPUT-06: an admin search term containing a comma adds a disjunct to the .or() (vulnerable, characterized)', () => {
    const search = 'x,platform_role.eq.ssi_admin'
    const orParts = [`display_name.ilike.%${search}%`]
    const filter = orParts.join(',')

    expect(filter).toBe('display_name.ilike.%x,platform_role.eq.ssi_admin%')
    expect(filter.split(',').length).toBe(2)
  })

  it.todo('INPUT-06: api/admin/users.ts should escape or reject PostgREST metacharacters in `search` before .or()')
})
