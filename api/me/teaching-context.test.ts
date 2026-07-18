import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let DB: Record<string, any[]>

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  let single = false
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    is: (col: string, val: unknown) => { rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val)); return builder },
    limit: () => builder,
    order: () => builder,
    maybeSingle: () => { single = true; return builder },
    then: (resolve: any) => Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

let handler: typeof import('./teaching-context').default

function makeReq(): VercelRequest {
  return { method: 'GET', headers: { authorization: 'Bearer tok' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  return res
}

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./teaching-context')).default
  DB = {
    learners: [{ id: 'l1', user_id: 'auth-1' }],
    user_tags: [],
    schools: [],
    class_teachers: [],
    classes: [],
  }
})

describe('GET /api/me/teaching-context', () => {
  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ ...makeReq(), method: 'POST' }, res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects an unauthenticated caller', async () => {
    const { verifyAuthToken } = await import('../_utils/auth')
    ;(verifyAuthToken as any).mockResolvedValueOnce({ valid: false, error: 'no token' })
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(401)
  })

  it('no learner row: empty context, not an error', async () => {
    DB.learners = []
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ groups: [], classes: [], can_play_as_class: false })
  })

  it('school teacher WITH classes: groups + classes populated, can_play_as_class true', async () => {
    DB.user_tags = [
      { user_id: 'auth-1', tag_type: 'school', tag_value: 'SCHOOL:s1', removed_at: null },
    ]
    DB.classes = [
      { id: 'c1', teacher_user_id: 'auth-1', is_active: true },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.groups).toEqual([{ id: 's1', label: 'school' }])
    expect(res.body.classes).toEqual(['c1'])
    expect(res.body.can_play_as_class).toBe(true)
  })

  it('school teacher WITHOUT classes: groups populated, no classes, play-as-class off', async () => {
    DB.user_tags = [
      { user_id: 'auth-1', tag_type: 'school', tag_value: 'SCHOOL:s1', removed_at: null },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.groups).toEqual([{ id: 's1', label: 'school' }])
    expect(res.body.classes).toEqual([])
    expect(res.body.can_play_as_class).toBe(false)
  })

  it('groupless tutor WITH a class: zero groups, classes populated — the tutor signature', async () => {
    DB.classes = [
      { id: 'c1', teacher_user_id: 'auth-1', is_active: true },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.groups).toEqual([])
    expect(res.body.classes).toEqual(['c1'])
    expect(res.body.can_play_as_class).toBe(true)
  })

  it('groupless tutor WITHOUT a class: empty everywhere, no capability', async () => {
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body).toEqual({ groups: [], classes: [], can_play_as_class: false })
  })

  it('unions class_teachers relationship + legacy lead pointer, deduped', async () => {
    DB.class_teachers = [
      { class_id: 'c1', teacher_user_id: 'auth-1' },
      { class_id: 'c2', teacher_user_id: 'auth-1' },
    ]
    DB.classes = [
      { id: 'c1', teacher_user_id: 'auth-1', is_active: true }, // also owns c1 — must dedupe
      { id: 'c3', teacher_user_id: 'auth-1', is_active: true },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(new Set(res.body.classes)).toEqual(new Set(['c1', 'c2', 'c3']))
    expect(res.body.classes.length).toBe(3)
  })

  it('ignores removed school tags — a departed teacher is not still "grouped"', async () => {
    DB.user_tags = [
      { user_id: 'auth-1', tag_type: 'school', tag_value: 'SCHOOL:s1', removed_at: '2026-01-01' },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.groups).toEqual([])
  })

  it('falls back to schools.admin_user_id for a legacy admin with no tag row', async () => {
    DB.schools = [{ id: 's9', admin_user_id: 'auth-1' }]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.groups).toEqual([{ id: 's9', label: 'school' }])
  })

  it('a direct group-node tag (non-school) is reported with label "group"', async () => {
    DB.user_tags = [
      { user_id: 'auth-1', tag_type: 'group', tag_value: 'GROUP:g1', removed_at: null },
    ]
    const res = makeRes()
    await handler(makeReq(), res)
    expect(res.body.groups).toEqual([{ id: 'g1', label: 'group' }])
  })
})
