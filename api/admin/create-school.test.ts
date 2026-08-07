/**
 * Tests for POST /api/admin/create-school — the recorded admin's own
 * membership row.
 *
 * The class (Chepstow, 2026-08-06): every path that creates a school with an
 * `admin_user_id` must also give that person the `user_tags` SCHOOL: row, or
 * they are invisible to every staff-keyed number in the school (the headline
 * hours, the teacher count, the Teachers list are all derived from user_tags).
 * This path never did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => ({ userId: 'ssi-admin-uid' })),
}))
vi.mock('../_utils/schoolNode', () => ({
  ensureSchoolNode: vi.fn(async () => undefined),
}))

let writes: Record<string, any[]>
let tagError: { code?: string; message?: string } | null

function makeChainable(table: string) {
  const builder: any = {
    insert: (payload: unknown) => {
      writes[table] = writes[table] || []
      writes[table].push({ op: 'insert', payload })
      if (table === 'user_tags') return Promise.resolve({ data: null, error: tagError })
      return builder
    },
    delete: () => { writes[table] = writes[table] || []; writes[table].push({ op: 'delete' }); return builder },
    select: () => builder,
    eq: () => builder,
    single: () =>
      Promise.resolve(
        table === 'schools'
          ? { data: { id: 'school-new', school_name: 'Ysgol Newydd', teacher_join_code: 'TJC', admin_join_code: 'AJC', group_id: null, created_at: 'now' }, error: null }
          : { data: null, error: null },
      ),
    then: (onF: any) => Promise.resolve({ data: null, error: null }).then(onF),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeRes() {
  const res: any = {}
  res.status = vi.fn((code: number) => { res._status = code; return res })
  res.json = vi.fn((body: unknown) => { res._json = body; return res })
  return res as VercelResponse & { _status?: number; _json?: any }
}

const req = { method: 'POST', query: {}, headers: {}, body: { school_name: 'Ysgol Newydd' } } as VercelRequest

let handler: typeof import('./create-school').default

beforeEach(async () => {
  vi.resetModules()
  writes = {}
  tagError = null
  handler = (await import('./create-school')).default
})

describe('POST /api/admin/create-school', () => {
  it('gives the recorded admin_user_id a SCHOOL: membership tag with role admin', async () => {
    const res = makeRes()
    await handler(req, res)

    expect(res._status).toBe(200)
    expect(writes.user_tags).toHaveLength(1)
    expect(writes.user_tags[0].payload).toMatchObject({
      user_id: 'ssi-admin-uid',
      tag_type: 'school',
      tag_value: 'SCHOOL:school-new',
      role_in_context: 'admin',
    })
  })

  it('never writes the admin as a teacher (one convention across the estate)', async () => {
    const res = makeRes()
    await handler(req, res)
    expect(writes.user_tags[0].payload.role_in_context).not.toBe('teacher')
  })

  it('a failed tag write does NOT roll back the school (non-fatal, healable)', async () => {
    tagError = { code: '42501', message: 'permission denied' }
    const res = makeRes()
    await handler(req, res)

    expect(res._status).toBe(200)
    expect((writes.schools || []).some((w) => w.op === 'delete')).toBe(false)
  })

  it('a 23505 on the tag is an idempotent no-op, not a failure', async () => {
    tagError = { code: '23505', message: 'duplicate key value' }
    const res = makeRes()
    await handler(req, res)
    expect(res._status).toBe(200)
  })
})
