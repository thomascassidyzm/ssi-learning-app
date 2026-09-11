/**
 * Tests for GET /api/org/intel — the org intelligence read, scoped on the
 * server to the caller's own subtree.
 *
 * THE PIN that matters is the NEGATIVE one: a school leader who names a node
 * OUTSIDE their own subtree gets 403 and not one figure. Seen RED with the
 * callerCanSeeGroup gate bypassed (200, the other school's classes in the
 * body) and GREEN with it in place. A test that only proves the happy path
 * proves nothing about a leak.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let verifyAdminResult: any
let verifyAuthTokenResult: any
vi.mock('../_utils/auth', () => ({
  verifyAdmin: vi.fn(async () => verifyAdminResult),
  verifyAuthToken: vi.fn(async () => verifyAuthTokenResult),
}))

const DAY = 86400000
const iso = (daysAgo: number, offsetMs = 0) => new Date(Date.now() - daysAgo * DAY + offsetMs).toISOString()
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10)

const clip = (learner: string, daysAgo: number, audio: string, i = 0) => ({
  learner_id: learner, event_type: 'audio_play', 'payload->>role': 'target2',
  occurred_at: iso(daysAgo, -i * 1000),
  payload: { role: 'target2', url: `/api/audio/${audio}` },
})

let TABLES: Record<string, any[]>
function resetTables(): void {
  TABLES = {
    groups: [
      { id: 'programme', name: 'Programme', type: 'programme', parent_id: null },
      { id: 'school-node', name: 'Ysgol A', type: 'school', parent_id: 'programme' },
      { id: 'other-node', name: 'Ysgol B', type: 'school', parent_id: 'programme' },
    ],
    schools: [
      { id: 'school-1', school_name: 'Ysgol A', group_id: null, node_group_id: 'school-node', admin_user_id: 'leader-1', platform_status: 'active', platform_expires_at: null, created_at: iso(100) },
      { id: 'school-2', school_name: 'Ysgol B', group_id: null, node_group_id: 'other-node', admin_user_id: 'leader-2', platform_status: 'active', platform_expires_at: null, created_at: iso(100) },
    ],
    classes: [
      { id: 'class-1', class_name: '7C', course_code: 'cym_s_for_eng', school_id: 'school-1', group_id: 'school-node', teacher_user_id: 'teacher-1', class_learner_id: 'cl-1', is_active: true },
      { id: 'class-2', class_name: '8P', course_code: 'cym_s_for_eng', school_id: 'school-1', group_id: 'school-node', teacher_user_id: 'teacher-2', class_learner_id: 'cl-2', is_active: true },
      { id: 'class-3', class_name: '9E', course_code: 'cym_s_for_eng', school_id: 'school-1', group_id: 'school-node', teacher_user_id: 'teacher-3', class_learner_id: 'cl-3', is_active: true },
      { id: 'class-x', class_name: 'Other school class', course_code: 'cym_s_for_eng', school_id: 'school-2', group_id: 'other-node', teacher_user_id: 'teacher-x', class_learner_id: 'cl-x', is_active: true },
    ],
    // class-1: three phrases this week, two last week. class-2: quiet for ten
    // days (last week only). class-3: never. class-x: the OTHER school, busy.
    player_events: [
      clip('cl-1', 1, 'a-1', 0), clip('cl-1', 1, 'a-2', 1), clip('cl-1', 2, 'a-1', 2),
      clip('cl-1', 9, 'a-1', 0), clip('cl-1', 10, 'a-3', 1),
      clip('cl-2', 10, 'a-1', 0),
      clip('cl-x', 1, 'a-1', 0), clip('cl-x', 1, 'a-1', 1), clip('cl-x', 1, 'a-1', 2), clip('cl-x', 1, 'a-1', 3), clip('cl-x', 1, 'a-1', 4),
    ],
    course_enrollments: [
      { learner_id: 'cl-1', course_id: 'cym_s_for_eng', highest_completed_lego_id: null, last_completed_lego_id: 'S0008L01', last_practiced_at: iso(1) },
      { learner_id: 'cl-2', course_id: 'cym_s_for_eng', highest_completed_lego_id: null, last_completed_lego_id: 'S0003L01', last_practiced_at: iso(10) },
      { learner_id: 'cl-x', course_id: 'cym_s_for_eng', highest_completed_lego_id: 'S0021L02', last_completed_lego_id: 'S0021L02', last_practiced_at: iso(1) },
    ],
    course_legos: [
      { lego_id: 'S0002L01', course_code: 'cym_s_for_eng', seed_number: 2, known_text: 'I want', target_text: 'dw i’n moyn' },
      { lego_id: 'S0003L01', course_code: 'cym_s_for_eng', seed_number: 3, known_text: 'I’m going to', target_text: 'dw i’n mynd i' },
      { lego_id: 'S0005L01', course_code: 'cym_s_for_eng', seed_number: 5, known_text: 'to say', target_text: 'dweud' },
      { lego_id: 'S0008L01', course_code: 'cym_s_for_eng', seed_number: 8, known_text: 'I still want', target_text: 'dw i dal yn moyn' },
      { lego_id: 'S0013L01', course_code: 'cym_s_for_eng', seed_number: 13, known_text: 'thirteen', target_text: 'tri ar ddeg' },
      { lego_id: 'S0334L01', course_code: 'cym_s_for_eng', seed_number: 334, known_text: 'the end', target_text: 'y diwedd' },
    ],
    user_tags: [
      { tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'admin', user_id: 'leader-1', removed_at: null },
      { tag_type: 'school', tag_value: 'SCHOOL:school-1', role_in_context: 'teacher', user_id: 'teacher-1', removed_at: null },
      { tag_type: 'school', tag_value: 'SCHOOL:school-2', role_in_context: 'admin', user_id: 'leader-2', removed_at: null },
      { tag_type: 'school', tag_value: 'SCHOOL:school-2', role_in_context: 'teacher', user_id: 'teacher-x', removed_at: null },
    ],
    learners: [
      { id: 'L-leader-1', user_id: 'leader-1', educational_role: 'school_admin', display_name: 'Angharad' },
      { id: 'L-teacher-1', user_id: 'teacher-1', educational_role: 'teacher', display_name: 'Mr Lloyd' },
      { id: 'L-teacher-2', user_id: 'teacher-2', educational_role: 'teacher', display_name: 'Ms Rhys' },
      { id: 'L-teacher-3', user_id: 'teacher-3', educational_role: 'teacher', display_name: 'Mr Price' },
      { id: 'L-leader-2', user_id: 'leader-2', educational_role: 'school_admin', display_name: 'Other Head' },
      { id: 'L-teacher-x', user_id: 'teacher-x', educational_role: 'teacher', display_name: 'Other Teacher' },
    ],
    learner_speaking_opportunities: [
      { learner_id: 'L-teacher-1', day: day(1), play_seconds: 600 },
      { learner_id: 'L-teacher-1', day: day(9), play_seconds: 300 },
      { learner_id: 'L-teacher-2', day: day(12), play_seconds: 120 },
      { learner_id: 'L-teacher-x', day: day(1), play_seconds: 6000 },
    ],
    govt_admins: [],
    course_practice_phrases: [],
  }
}

function applyFilters(rows: any[], calls: { method: string; args: any[] }[]): any[] {
  let result = rows
  for (const c of calls) {
    if (c.method === 'eq') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'in') result = result.filter((r) => (c.args[1] as any[]).includes(r[c.args[0]]))
    else if (c.method === 'is') result = result.filter((r) => r[c.args[0]] === c.args[1])
    else if (c.method === 'gte') result = result.filter((r) => String(r[c.args[0]]) >= String(c.args[1]))
    else if (c.method === 'order') {
      const [col, opts] = c.args
      const asc = (opts?.ascending ?? true) !== false
      result = [...result].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
    }
    else if (c.method === 'limit') result = result.slice(0, c.args[0])
    else if (c.method === 'range') result = result.slice(c.args[0], c.args[1] + 1)
  }
  return result
}

const reads: string[] = []
function makeChainable(table: string) {
  reads.push(table)
  const calls: { method: string; args: any[] }[] = []
  const builder: any = {}
  const chain = (method: string) => (...args: any[]) => { calls.push({ method, args }); return builder }
  for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lt', 'lte', 'like', 'order', 'limit', 'range', 'insert']) builder[m] = chain(m)
  builder.single = builder.maybeSingle = () => {
    const rows = applyFilters(TABLES[table] || [], calls)
    return Promise.resolve({ data: rows[0] || null, error: null })
  }
  builder.then = (resolve: any) => resolve({ data: applyFilters(TABLES[table] || [], calls), error: null })
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeChainable(table) }),
}))

function makeReq(nodeId: string): VercelRequest {
  return { method: 'GET', query: { nodeId }, headers: { authorization: 'Bearer tok' } } as any
}
function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn(() => res)
  return res
}

let handler: typeof import('./intel').default
let pure: typeof import('./intel')

beforeEach(async () => {
  resetTables()
  reads.length = 0
  verifyAdminResult = { error: 'Requires SSi admin access', status: 403 }
  verifyAuthTokenResult = { valid: true, userId: 'leader-1' }
  vi.resetModules()
  pure = await import('./intel')
  handler = pure.default
})

describe('GET /api/org/intel — scope', () => {
  it('SCOPE PIN, negative: a school leader naming a node OUTSIDE their subtree gets 403 and no figures', async () => {
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body).toEqual({ error: 'You do not have access to this group' })
    expect(res.body.classes).toBeUndefined()
    expect(res.body.practising).toBeUndefined()
    // Not one practice row was read for the other school: the gate runs
    // before the diary, the enrollments or the ledger are touched.
    expect(reads).not.toContain('player_events')
    expect(reads).not.toContain('course_enrollments')
    expect(reads).not.toContain('learner_speaking_opportunities')
  })

  it('the same leader naming the other school by its NODE id is refused the same way', async () => {
    const res = makeRes()
    await handler(makeReq('other-node'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.classes).toBeUndefined()
  })

  it('a teacher is not a leader and gets 403 from the caller resolver', async () => {
    verifyAuthTokenResult = { valid: true, userId: 'teacher-1' }
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.classes).toBeUndefined()
  })

  it('no token → 401', async () => {
    verifyAuthTokenResult = { valid: false, error: 'no token' }
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.statusCode).toBe(401)
  })

  it('positive: the leader sees their own school, and only their own classes and people', async () => {
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.node).toEqual({ id: 'school-node', name: 'Ysgol A', kind: 'school' })
    const names = res.body.classes.map((c: any) => c.name)
    expect(names).toEqual(['7C', '8P', '9E'])
    expect(names).not.toContain('Other school class')
    const people = res.body.people.map((p: any) => p.name)
    expect(people).not.toContain('Other Teacher')
    expect(people).not.toContain('Other Head')
  })

  it('an ssi_admin sees any node', async () => {
    verifyAdminResult = { userId: 'admin-1' }
    verifyAuthTokenResult = { valid: true, userId: 'admin-1' }
    const res = makeRes()
    await handler(makeReq('school-2'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.classes.map((c: any) => c.name)).toEqual(['Other school class'])
  })

  it('a lapsed school goes dark with coverage_expired, as rate-compare does', async () => {
    TABLES.schools[0].platform_status = 'expired'
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toBe('coverage_expired')
  })
})

describe('GET /api/org/intel — the three answers', () => {
  it('PRACTISING counts classes and phrases this week against last week, by the same timestamp rule as the node home', async () => {
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.body.practising).toMatchObject({
      classCount: 3, classesThisWeek: 1, classesLastWeek: 2, phrasesThisWeek: 3, phrasesLastWeek: 3,
      peopleCount: 4, peopleThisWeek: 1, peopleLastWeek: 2, ownMinutesThisWeek: 10, ownMinutesLastWeek: 7,
    })
    expect(res.body.byDay).toHaveLength(28)
    expect(res.body.byDay.reduce((n: number, d: any) => n + d.phrases, 0)).toBe(6)
    const c1 = res.body.classes.find((c: any) => c.id === 'class-1')
    expect(c1).toMatchObject({ phrasesThisWeek: 3, phrasesLastWeek: 2, daysSincePractice: 1 })
    // Position is the LEGO last played, as its own text — never a bare number.
    expect(c1.position).toEqual({ legoId: 'S0008L01', sentence: 8, knownText: 'I still want', targetText: 'dw i dal yn moyn' })
    const t1 = res.body.people.find((p: any) => p.name === 'Mr Lloyd')
    expect(t1).toMatchObject({ minutesThisWeek: 10, minutesLastWeek: 5, lastPractisedDay: day(1) })
  })

  it('QUIET names the classes that have gone quiet and the ones that never started', async () => {
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.body.quiet).toMatchObject({ quietCount: 1, neverCount: 1 })
    const b = Object.fromEntries(res.body.quiet.buckets.map((x: any) => [x.id, x.classes]))
    expect(b).toEqual({ 'this-week': 1, 'gone-a-week': 1, 'gone-two-weeks': 0, 'gone-three-weeks': 0, 'gone-a-month': 0, never: 1 })
  })

  it('JOURNEY is a cumulative funnel of sentences reached, stopping at the first milestone nobody has reached', async () => {
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.body.journey.courses).toEqual([{ code: 'cym_s_for_eng', sentences: 334 }])
    expect(res.body.journey.stages.map((s: any) => [s.id, s.classes])).toEqual([
      ['started', 2], ['sentence-2', 2], ['sentence-3', 2], ['sentence-5', 1], ['sentence-8', 1], ['sentence-13', 0],
    ])
    expect(res.body.journey.stages[4].label).toMatchObject({ knownText: 'I still want', targetText: 'dw i dal yn moyn' })
  })

  it('a class with a cursor but no practice is NOT started: QUIET and JOURNEY agree on it', async () => {
    // Opening the class player writes a live position without a practice
    // stamp (LearningPlayer persistLivePositionToDb(undefined, false) on init).
    // Nine of Chepstow's classes are in exactly this state: a cursor at
    // sentence 1, no diary clip, no last_practiced_at. Seen RED before the fix:
    // Quiet said 2 never started and Journey said 3 of 4 started — 5 of 4.
    TABLES.classes.push({ id: 'class-4', class_name: '10T', course_code: 'cym_s_for_eng', school_id: 'school-1', group_id: 'school-node', teacher_user_id: 'teacher-3', class_learner_id: 'cl-4', is_active: true })
    TABLES.course_enrollments.push({ learner_id: 'cl-4', course_id: 'cym_s_for_eng', highest_completed_lego_id: null, last_completed_lego_id: 'S0001L01', last_practiced_at: null })
    const res = makeRes()
    await handler(makeReq('school-1'), res)
    expect(res.statusCode).toBe(200)
    const started = res.body.journey.stages[0].classes
    const { neverCount } = res.body.quiet
    // The two questions partition the school: every class has either
    // practised or it has not.
    expect(started + neverCount).toBe(res.body.practising.classCount)
    expect(neverCount).toBe(2)
    expect(started).toBe(2)
    // And the class row itself says the same thing: no practice, no position.
    const c4 = res.body.classes.find((c: any) => c.id === 'class-4')
    expect(c4.lastPractisedAt).toBeNull()
    expect(c4.position).toBeNull()
  })

  it('the pure rules: quiet buckets and journey stages', () => {
    const now = Date.now()
    expect(pure.quietBucket(null, now)).toBe('never')
    expect(pure.quietBucket(iso(2), now)).toBe('this-week')
    expect(pure.quietBucket(iso(8), now)).toBe('gone-a-week')
    expect(pure.quietBucket(iso(15), now)).toBe('gone-two-weeks')
    expect(pure.quietBucket(iso(22), now)).toBe('gone-three-weeks')
    expect(pure.quietBucket(iso(40), now)).toBe('gone-a-month')
    expect(pure.journeyStages([null, null], 334)).toEqual([{ sentence: null, classes: 0 }])
    expect(pure.journeyStages([1, 1], 334)).toEqual([{ sentence: null, classes: 2 }, { sentence: 2, classes: 0 }])
    // Never a milestone beyond the course's own length.
    expect(pure.journeyStages([3], 3).map((s) => s.sentence)).toEqual([null, 2, 3])
  })
})
