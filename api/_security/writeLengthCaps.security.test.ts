/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * INPUT-09c: string length caps on authenticated writes are applied
 * inconsistently. Some endpoints slice; the class-naming ones do not. None of
 * these columns is bounded in the schema either, so an unbounded body value
 * becomes an unbounded row.
 *
 * These are characterization tests for the missing caps, plus regression locks
 * on the endpoints that already cap correctly (the pattern to copy).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

const CLASS_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

/** Every column payload the handler under test tried to write. */
let writes: Record<string, unknown>[] = []

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: () => Promise.resolve({ valid: true, userId: 'auth-uid-teacher' }),
  getAuthUserId: () => Promise.resolve('auth-uid-teacher'),
}))

vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: () =>
    Promise.resolve({ role: 'teacher', classIds: [CLASS_ID], schoolIds: [], groupIds: [] }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const c: any = {
        select: () => c,
        eq: () => c,
        update: (payload: Record<string, unknown>) => {
          writes.push(payload)
          return c
        },
        insert: (payload: Record<string, unknown>) => {
          writes.push(payload)
          return c
        },
        single: () => Promise.resolve({ data: { id: CLASS_ID, class_name: 'x' }, error: null }),
        maybeSingle: () => Promise.resolve({ data: { id: CLASS_ID }, error: null }),
      }
      return c
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.setHeader = vi.fn(() => res)
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

describe('write-length caps (INPUT-09c)', () => {
  beforeEach(() => {
    writes = []
    vi.resetModules()
  })

  // SECURITY FINDING INPUT-09c: api/school/rename-class.ts:45 trims
  // `class_name` but never bounds it, unlike api/school/update-profile.ts:47
  // (`.slice(0, 200)`) and api/onboarding/profile.ts:40 (`.slice(0, 120)`) on
  // the same shape of input. `classes.class_name` is unbounded text, so an
  // authenticated teacher can store a multi-megabyte class name that every
  // roster, dashboard and analytics response then carries. It should slice to
  // the same bound the sibling endpoints use.
  it('INPUT-09c: rename-class stores an unbounded class_name (vulnerable, characterized)', async () => {
    const handler = (await import('../school/rename-class')).default
    const res = makeRes()
    const huge = 'A'.repeat(250_000)

    await handler(makeReq({ class_id: CLASS_ID, class_name: huge }), res)

    const written = writes.find((w) => 'class_name' in w)
    expect(written).toBeDefined()
    expect((written!.class_name as string).length).toBe(250_000)
  })

  it.todo('INPUT-09c: rename-class should cap class_name the way update-profile.ts:47 caps school_name')

  // CONTROL THAT HOLDS: the pattern to copy. Both of these slice before write.
  it('CONTROL: onboarding/profile caps display_name at 120 characters', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.promises.readFile(new URL('../onboarding/profile.ts', import.meta.url), 'utf8'),
    )
    expect(src).toContain('.slice(0, 120)')
  })

  it('CONTROL: school/update-profile caps school_name at 200 characters', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.promises.readFile(new URL('../school/update-profile.ts', import.meta.url), 'utf8'),
    )
    expect(src).toContain('.slice(0, 200)')
  })

  it('CONTROL: rename-class does type-check class_name as a string before writing', async () => {
    const handler = (await import('../school/rename-class')).default
    const res = makeRes()

    await handler(makeReq({ class_id: CLASS_ID, class_name: { evil: 1 } }), res)

    expect(res._status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('CONTROL: rename-class rejects an empty/whitespace-only name', async () => {
    const handler = (await import('../school/rename-class')).default
    const res = makeRes()

    await handler(makeReq({ class_id: CLASS_ID, class_name: '   ' }), res)

    expect(res._status).toBe(400)
    expect(writes).toHaveLength(0)
  })
})
