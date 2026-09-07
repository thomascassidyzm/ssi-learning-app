/**
 * Tests for GET/POST /api/teacher/class-students — the write that puts a pupil
 * on a class roster.
 *
 * This route exists because `user_tags_insert` lets a signed-in user tag only
 * THEMSELVES: the client literally cannot write a class/student row for
 * somebody else, so before this endpoint the class page had no way to add a
 * student at all. What the tests hold down is the boundary that comes with a
 * service-role write:
 *   - only a teacher of the class (or a leader above it) may use it;
 *   - only a pupil already inside this class's school may be moved into it,
 *     so a class id plus a guessed user id is not a cross-tenant lever;
 *   - putting back a pupil who was removed reactivates their row rather than
 *     failing on the total unique key;
 *   - nothing but membership and enrolment is written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId: string
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))
vi.mock('../_utils/actAsGuard', () => ({ rejectIfViewAs: () => null }))
vi.mock('../_utils/cors', () => ({ applyCors: () => false }))

let canTeach: boolean
let isLeader: boolean
vi.mock('../_utils/classTeacherAuth', () => ({
  fetchClassAuthRow: vi.fn(async (_svc: unknown, id: string) =>
    DB.classes.find(c => c.id === id)
      ? { id, teacher_user_id: 't1', school_id: 'SCH1', group_id: null }
      : null),
  canTeachClass: vi.fn(async () => canTeach),
  isLeaderAboveClass: vi.fn(async () => isLeader),
}))

interface Tag { id: string; user_id: string; tag_type: string; tag_value: string; role_in_context: string; removed_at: string | null }
let DB: {
  classes: Array<{ id: string; class_name: string; school_id: string; is_active: boolean; course_code: string }>
  user_tags: Tag[]
  learners: Array<{ id: string; user_id: string; display_name: string }>
  course_enrollments: Array<{ learner_id: string; course_id: string }>
}

/**
 * A deliberately small Supabase stand-in: it records the filters as they are
 * chained and applies them at await time, which is enough to tell a correct
 * query from one that would return the wrong people.
 */
function makeTable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let inserted: any = null
  let updated: any = null
  const api: any = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return api },
    in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return api },
    is: (c: string, v: unknown) => { filters.push(r => r[c] === v); return api },
    rows: () => ((DB as any)[table] as any[]).filter(r => filters.every(f => f(r))),
    maybeSingle: async () => ({ data: api.rows()[0] ?? null, error: null }),
    insert: (row: any) => { inserted = row; return { ...thenable(async () => { (DB as any)[table].push({ id: `tag-${DB.user_tags.length + 1}`, removed_at: null, ...inserted }); return { error: null } }) } },
    update: (patch: any) => { updated = patch; return { eq: (c: string, v: unknown) => thenable(async () => { for (const r of ((DB as any)[table] as any[]).filter(x => x[c] === v)) Object.assign(r, updated); return { error: null } }) } },
    upsert: async (row: any) => { DB.course_enrollments.push(row); return { error: null } },
    then: (resolve: (v: any) => void) => resolve({ data: api.rows(), error: null }),
  }
  return api
}
function thenable(run: () => Promise<any>) {
  return { then: (resolve: (v: any) => void) => run().then(resolve) }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeTable(table) }),
}))

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn(() => res)
  return res
}

let handler: typeof import('./class-students').default

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./class-students')).default
  authUserId = 't1'
  canTeach = true
  isLeader = false
  DB = {
    classes: [
      { id: 'c1', class_name: 'Grade 6B', school_id: 'SCH1', is_active: true, course_code: 'cym_for_eng' },
      { id: 'c2', class_name: 'Grade 7A', school_id: 'SCH1', is_active: true, course_code: 'cym_for_eng' },
    ],
    user_tags: [
      { id: 'tag-ana', user_id: 'u-ana', tag_type: 'class', tag_value: 'CLASS:c2', role_in_context: 'student', removed_at: null },
      { id: 'tag-sam', user_id: 'u-sam', tag_type: 'class', tag_value: 'CLASS:c1', role_in_context: 'student', removed_at: null },
    ],
    learners: [
      { id: 'L-ana', user_id: 'u-ana', display_name: 'Ana Lewis' },
      { id: 'L-sam', user_id: 'u-sam', display_name: 'Sam Pugh' },
      { id: 'L-out', user_id: 'u-outsider', display_name: 'Someone Else' },
    ],
    course_enrollments: [],
  }
})

const get = (class_id: string) => ({ method: 'GET', query: { class_id }, headers: { authorization: 'Bearer tok' } }) as unknown as VercelRequest
const post = (body: any) => ({ method: 'POST', body, headers: { authorization: 'Bearer tok' } }) as unknown as VercelRequest

describe('GET /api/teacher/class-students', () => {
  it('offers the school\'s pupils who are not already on this class', async () => {
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.candidates.map((c: any) => c.user_id)).toEqual(['u-ana'])
    // The class they are in now, so the teacher sees a move rather than a name.
    expect(res.body.candidates[0].current_class_name).toBe('Grade 7A')
  })

  it('refuses a caller who neither teaches the class nor leads above it', async () => {
    canTeach = false
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(403)
  })

  it('lets a leader above the class read it even if they do not teach it', async () => {
    canTeach = false
    isLeader = true
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /api/teacher/class-students', () => {
  it('puts a pupil from the school on the roster and enrols them in its course', async () => {
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(200)
    const tag = DB.user_tags.find(t => t.user_id === 'u-ana' && t.tag_value === 'CLASS:c1')
    expect(tag).toMatchObject({ role_in_context: 'student', removed_at: null })
    expect(DB.course_enrollments).toEqual([{ learner_id: 'L-ana', course_id: 'cym_for_eng' }])
  })

  it('reactivates a pupil who had been removed, rather than inserting a duplicate', async () => {
    DB.user_tags.push({ id: 'tag-old', user_id: 'u-ana', tag_type: 'class', tag_value: 'CLASS:c1', role_in_context: 'student', removed_at: '2026-01-01T00:00:00Z' })
    const before = DB.user_tags.length
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.user_tags.length).toBe(before)
    expect(DB.user_tags.find(t => t.id === 'tag-old')!.removed_at).toBeNull()
  })

  it('refuses a user id that is not in this class\'s school', async () => {
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-outsider' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags.some(t => t.user_id === 'u-outsider')).toBe(false)
  })

  it('refuses a caller who may not teach the class', async () => {
    canTeach = false
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags.some(t => t.user_id === 'u-ana' && t.tag_value === 'CLASS:c1')).toBe(false)
  })

  it('404s on a class that does not exist', async () => {
    const res = makeRes()
    await handler(post({ class_id: 'nope', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(404)
  })
})
