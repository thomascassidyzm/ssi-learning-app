/**
 * Tests for GET/POST /api/teacher/class-students — the write that puts a pupil
 * on a class roster.
 *
 * This route exists because `user_tags_insert` lets a signed-in user tag only
 * THEMSELVES: the client literally cannot write a class/student row for
 * somebody else, so before this endpoint the class page had no way to add a
 * student at all.
 *
 * WHY THIS HARNESS LOOKS LIKE THIS. The first version of these tests passed
 * against three real defects, because of two shortcuts:
 *   - it mocked `canTeachClass`/`isLeaderAboveClass` to BOOLEANS, so it could
 *     assert that a flag was consulted but never that the right people are let
 *     in. The predicate is now REAL and reads the fake tables, so a test can
 *     say "the co-teacher may, the teacher next door may not" and mean it.
 *   - it implemented `upsert` as an unconditional array push, so an enrolment
 *     that already existed appeared to be overwritten and no test could tell
 *     the difference. The fake now honours `onConflict` + `ignoreDuplicates`,
 *     which is what makes "a pupil brings their progress with them" a claim
 *     the suite can actually fail on.
 * It can also be told to FAIL a named read, which is how the honest-empty-state
 * rule is held down: a lookup that breaks must never render as "nobody".
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
// classTeacherAuth is deliberately NOT mocked — see the note above.

interface Tag { id: string; user_id: string; tag_type: string; tag_value: string; role_in_context: string; removed_at: string | null }
interface Enrolment { learner_id: string; course_id: string; enrolled_at?: string }
let DB: {
  classes: Array<{ id: string; class_name: string; school_id: string; group_id: string | null; teacher_user_id: string | null; is_active: boolean; course_code: string | null }>
  schools: Array<{ id: string; admin_user_id: string | null; group_id: string | null; node_group_id: string | null }>
  govt_admins: Array<{ user_id: string; group_id: string }>
  user_tags: Tag[]
  learners: Array<{ id: string; user_id: string; display_name: string; platform_role?: string; educational_role?: string }>
  course_enrollments: Enrolment[]
  seed_progress: Array<{ learner_id: string; course_id: string; seed_position: number }>
}

/** Reads that should come back as errors, keyed by table name. */
let failing: Partial<Record<string, string>>

/**
 * A deliberately small Supabase stand-in: it records the filters as they are
 * chained and applies them at await time, which is enough to tell a correct
 * query from one that would return the wrong people — and, when the table is
 * on the failing list, to answer the way PostgREST answers when it cannot.
 */
function makeTable(table: string) {
  const filters: Array<(r: any) => boolean> = []
  let updated: any = null
  const fail = () => (failing[table] ? { message: failing[table] as string } : null)
  const api: any = {
    select: () => api,
    eq: (c: string, v: unknown) => { filters.push(r => r[c] === v); return api },
    in: (c: string, vs: unknown[]) => { filters.push(r => vs.includes(r[c])); return api },
    is: (c: string, v: unknown) => { filters.push(r => (r[c] ?? null) === v); return api },
    rows: () => ((DB as any)[table] as any[]).filter(r => filters.every(f => f(r))),
    maybeSingle: async () => (fail() ? { data: null, error: fail() } : { data: api.rows()[0] ?? null, error: null }),
    insert: (row: any) => thenable(async () => {
      const e = fail(); if (e) return { error: e }
      ;(DB as any)[table].push({ id: `${table}-${((DB as any)[table] as any[]).length + 1}`, removed_at: null, ...row })
      return { error: null }
    }),
    update: (patch: any) => { updated = patch; return { eq: (c: string, v: unknown) => thenable(async () => {
      const e = fail(); if (e) return { error: e }
      for (const r of ((DB as any)[table] as any[]).filter(x => x[c] === v)) Object.assign(r, updated)
      return { error: null }
    }) } },
    /**
     * Real upsert semantics. `onConflict` names the key; with
     * `ignoreDuplicates` a row that already matches that key is LEFT ALONE —
     * not replaced, not merged, not touched. Without it, the existing row is
     * merged into. This is the whole point of the fake: the old push-always
     * version could not fail on a regression that started rewriting live
     * enrolments.
     */
    upsert: async (row: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      const e = fail(); if (e) return { error: e }
      const keys = (opts?.onConflict ?? 'id').split(',').map(k => k.trim())
      const rows = (DB as any)[table] as any[]
      const hit = rows.find(r => keys.every(k => r[k] === row[k]))
      if (hit) {
        if (!opts?.ignoreDuplicates) Object.assign(hit, row)
        return { error: null }
      }
      rows.push({ ...row })
      return { error: null }
    },
    then: (resolve: (v: any) => void) => resolve(fail() ? { data: null, error: fail() } : { data: api.rows(), error: null }),
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

const tag = (id: string, user_id: string, classId: string, role = 'student', removed_at: string | null = null): Tag =>
  ({ id, user_id, tag_type: 'class', tag_value: `CLASS:${classId}`, role_in_context: role, removed_at })

beforeEach(async () => {
  vi.resetModules()
  handler = (await import('./class-students')).default
  authUserId = 't-lead'
  failing = {}
  DB = {
    classes: [
      { id: 'c1', class_name: 'Grade 6B', school_id: 'SCH1', group_id: null, teacher_user_id: 't-lead', is_active: true, course_code: 'cym_for_eng' },
      { id: 'c2', class_name: 'Grade 7A', school_id: 'SCH1', group_id: null, teacher_user_id: 't-other', is_active: true, course_code: 'cym_for_eng' },
      { id: 'c9', class_name: 'Other School 1', school_id: 'SCH2', group_id: null, teacher_user_id: 't-far', is_active: true, course_code: 'spa_for_eng' },
    ],
    schools: [
      { id: 'SCH1', admin_user_id: 'a-founder', group_id: null, node_group_id: null },
      { id: 'SCH2', admin_user_id: 'a-far', group_id: null, node_group_id: null },
    ],
    govt_admins: [],
    user_tags: [
      tag('tag-ana', 'u-ana', 'c2'),
      tag('tag-sam', 'u-sam', 'c1'),
      tag('tag-co', 't-co', 'c1', 'teacher'),
      tag('tag-far-stu', 'u-far', 'c9'),
    ],
    learners: [
      { id: 'L-ana', user_id: 'u-ana', display_name: 'Ana Lewis' },
      { id: 'L-sam', user_id: 'u-sam', display_name: 'Sam Pugh' },
      { id: 'L-out', user_id: 'u-outsider', display_name: 'Someone Else' },
      { id: 'L-far', user_id: 'u-far', display_name: 'Far Away' },
    ],
    course_enrollments: [],
    seed_progress: [],
  }
})

const get = (class_id: string) => ({ method: 'GET', query: { class_id }, headers: { authorization: 'Bearer tok' } }) as unknown as VercelRequest
const post = (body: any) => ({ method: 'POST', body, headers: { authorization: 'Bearer tok' } }) as unknown as VercelRequest

describe('who may use it — the real predicate, not a mocked boolean', () => {
  it('lets the class\'s lead teacher in', async () => {
    authUserId = 't-lead'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
  })

  it('lets an active co-teacher of the class in — the same set that mints its join code', async () => {
    authUserId = 't-co'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
  })

  it('shuts out a co-teacher whose tag has been removed', async () => {
    DB.user_tags.find(t => t.id === 'tag-co')!.removed_at = '2026-01-01T00:00:00Z'
    authUserId = 't-co'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(403)
  })

  it('lets the school admin in under the founding-pointer spelling', async () => {
    authUserId = 'a-founder'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
  })

  it('lets the school admin in under the admin-tag spelling', async () => {
    DB.user_tags.push({ id: 'tag-adm', user_id: 'a-tagged', tag_type: 'school', tag_value: 'SCHOOL:SCH1', role_in_context: 'admin', removed_at: null })
    authUserId = 'a-tagged'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
  })

  it('shuts out the teacher of the class next door', async () => {
    authUserId = 't-other'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(403)
  })

  it('shuts out another school\'s admin, and writes nothing', async () => {
    authUserId = 'a-far'
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(403)
    expect(DB.user_tags.some(t => t.user_id === 'u-ana' && t.tag_value === 'CLASS:c1')).toBe(false)
  })
})

describe('GET /api/teacher/class-students', () => {
  it('offers the school\'s pupils who are not already on this class', async () => {
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.candidates.map((c: any) => c.user_id)).toEqual(['u-ana'])
    // The classes they are in now, so the teacher sees what the tap leaves behind.
    expect(res.body.candidates[0].current_classes).toEqual([{ id: 'c2', name: 'Grade 7A' }])
  })

  it('never offers a pupil from another school', async () => {
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.body.candidates.map((c: any) => c.user_id)).not.toContain('u-far')
  })

  it('still offers a pupil who was removed from the only class they were in', async () => {
    // Ana is taken off Grade 7A and is now in no class at all.
    DB.user_tags.find(t => t.id === 'tag-ana')!.removed_at = '2026-02-01T00:00:00Z'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(200)
    const ana = res.body.candidates.find((c: any) => c.user_id === 'u-ana')
    expect(ana).toBeTruthy()
    expect(ana.current_classes).toEqual([])
  })

  it('shows a pupil who is in two classes as being in both', async () => {
    DB.classes.push({ id: 'c3', class_name: 'Spanish Set 2', school_id: 'SCH1', group_id: null, teacher_user_id: 't-other', is_active: true, course_code: 'spa_for_eng' })
    DB.user_tags.push(tag('tag-ana2', 'u-ana', 'c3'))
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.body.candidates[0].current_classes.map((c: any) => c.name)).toEqual(['Grade 7A', 'Spanish Set 2'])
  })
})

describe('a failed lookup is never an empty list', () => {
  it('500s rather than reporting that everyone is already in the class', async () => {
    failing.user_tags = 'connection reset'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.candidates).toBeUndefined()
    expect(res.body.error).toMatch(/could not read/i)
  })

  it('500s when the school\'s class list cannot be read', async () => {
    failing.classes = 'timeout'
    const res = makeRes()
    await handler(get('c1'), res)
    expect(res.statusCode).toBe(500)
  })

  it('500s when the pupils\' names cannot be read', async () => {
    failing.learners = 'timeout'
    const res = makeRes()
    await handler(get('c1'), res)
    // learners is also read by the auth predicate, so the failure surfaces as
    // a refusal to answer either way — what must never happen is a 200 with [].
    expect(res.statusCode).not.toBe(200)
  })
})

describe('POST /api/teacher/class-students', () => {
  it('puts a pupil from the school on the roster and enrols them in its course', async () => {
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(200)
    const t = DB.user_tags.find(x => x.user_id === 'u-ana' && x.tag_value === 'CLASS:c1')
    expect(t).toMatchObject({ role_in_context: 'student', removed_at: null })
    expect(DB.course_enrollments).toEqual([{ learner_id: 'L-ana', course_id: 'cym_for_eng' }])
  })

  it('reactivates a pupil who had been removed, rather than inserting a duplicate', async () => {
    DB.user_tags.push(tag('tag-old', 'u-ana', 'c1', 'student', '2026-01-01T00:00:00Z'))
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

  it('404s on a class that does not exist', async () => {
    const res = makeRes()
    await handler(post({ class_id: 'nope', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(404)
  })

  it('says which classes the pupil is still in, because an add is not a move', async () => {
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.body.still_in).toEqual([{ id: 'c2', name: 'Grade 7A' }])
    // and the old membership is genuinely untouched — the response is not lying
    expect(DB.user_tags.find(t => t.id === 'tag-ana')!.removed_at).toBeNull()
  })
})

describe('the two writes cannot report a success that only half happened', () => {
  it('reports failure and writes NO membership when the enrolment fails', async () => {
    failing.course_enrollments = 'deadlock detected'
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(500)
    expect(DB.user_tags.some(t => t.user_id === 'u-ana' && t.tag_value === 'CLASS:c1')).toBe(false)
  })

  it('lets an existing member through, so a retry repairs a missing enrolment', async () => {
    // The state the old route could leave behind: in the class, not enrolled.
    DB.user_tags.push(tag('tag-half', 'u-ana', 'c1'))
    expect(DB.course_enrollments).toEqual([])
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.already_member).toBe(true)
    expect(DB.course_enrollments).toEqual([{ learner_id: 'L-ana', course_id: 'cym_for_eng' }])
    // repairing did not duplicate the membership
    expect(DB.user_tags.filter(t => t.user_id === 'u-ana' && t.tag_value === 'CLASS:c1')).toHaveLength(1)
  })

  it('is safe to run twice in a row', async () => {
    const a = makeRes(); await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), a)
    const b = makeRes(); await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), b)
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
    expect(DB.user_tags.filter(t => t.user_id === 'u-ana' && t.tag_value === 'CLASS:c1')).toHaveLength(1)
    expect(DB.course_enrollments).toHaveLength(1)
  })
})

describe('a pupil brings every minute they have practised with them', () => {
  it('leaves an existing enrolment exactly as it stands', async () => {
    // Ana has been playing this course for weeks under another class.
    DB.course_enrollments.push({ learner_id: 'L-ana', course_id: 'cym_for_eng', enrolled_at: '2026-01-05T09:00:00Z' })
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(200)
    expect(DB.course_enrollments).toEqual([
      { learner_id: 'L-ana', course_id: 'cym_for_eng', enrolled_at: '2026-01-05T09:00:00Z' },
    ])
  })

  it('writes nothing at all to any record of progress', async () => {
    DB.seed_progress.push({ learner_id: 'L-ana', course_id: 'cym_for_eng', seed_position: 214 })
    const snapshot = JSON.stringify(DB.seed_progress)
    const res = makeRes()
    await handler(post({ class_id: 'c1', target_user_id: 'u-ana' }), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.stringify(DB.seed_progress)).toBe(snapshot)
  })
})
