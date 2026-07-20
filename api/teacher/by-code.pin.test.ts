/**
 * REGRESSION PIN — GET /api/teacher/by-code (student_join_code lookup).
 *
 * Pins CURRENT behaviour of the public class-join gateway that WithTeacher.vue
 * (route /with/:code) calls before a learner joins a class. No refactor, no
 * behaviour change — characterizes what ships today so THE-MODEL.md's group
 * unpick can be built against a known-good baseline (docs/THE-MODEL.md).
 *
 * Covers: school-class vs tutor-class branching, free vs paid course tier,
 * unavailable-vs-not-found distinction, seat accounting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

let responders: Record<string, (calls: any[][]) => any> = {}

function makeChainable(table: string) {
  const calls: any[][] = []
  const builder: any = {
    select: (cols: string) => { calls.push(['select', cols]); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    resolve: () => {
      const respond = responders[table]
      if (respond) {
        const r = respond(calls)
        if (r !== undefined) return r
      }
      return { data: null, error: null, count: 0 }
    },
    maybeSingle() { return Promise.resolve(this.resolve()) },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
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

function makeReq(code: string): VercelRequest {
  return { method: 'GET', query: { code } } as any
}

const SCHOOL_CLASS = {
  id: 'class-1', class_name: 'Beginners Welsh', course_code: 'cym_for_eng',
  teacher_user_id: 'teacher-auth-1', is_active: true, student_join_code: 'ABC-123',
  school_id: 'school-1',
}
const TUTOR_CLASS = {
  id: 'class-2', class_name: 'Tutor Spanish', course_code: 'spa_for_eng',
  teacher_user_id: 'teacher-auth-2', is_active: true, student_join_code: 'XYZ-789',
  school_id: null,
}

describe('GET /api/teacher/by-code (student_join_code lookup)', () => {
  let handler: typeof import('./by-code').default

  beforeEach(async () => {
    vi.resetModules()
    responders = {}
    handler = (await import('./by-code')).default
  })

  it('rejects a non-GET method', async () => {
    const res = makeRes()
    await handler({ method: 'POST', query: {} } as any, res)
    expect(res.status).toHaveBeenCalledWith(405)
  })

  it('404s reason=not_found for a code matching no class', async () => {
    responders.classes = () => ({ data: null, error: null })
    const res = makeRes()
    await handler(makeReq('NOPE-000'), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res._json.reason).toBe('not_found')
  })

  it('404s reason=unavailable for an inactive class (code is right, class is closed)', async () => {
    responders.classes = () => ({ data: { ...SCHOOL_CLASS, is_active: false }, error: null })
    const res = makeRes()
    await handler(makeReq('ABC-123'), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res._json.reason).toBe('unavailable')
  })

  it('school class: resolves teacher display name from the assigned teacher learner row, uncapped seats, school_id passed through', async () => {
    responders.classes = () => ({ data: SCHOOL_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'premium' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-1', display_name: 'Ms Jones' }, error: null })
    responders.schools = () => ({ data: { school_name: 'Ysgol Test', platform_status: 'active' }, error: null })
    responders.teacher_referrals = () => ({ count: 3, error: null })

    const res = makeRes()
    await handler(makeReq('ABC-123'), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res._json.class.school_id).toBe('school-1')
    expect(res._json.class.course_is_free).toBe(false)
    expect(res._json.teacher.display_name).toBe('Ms Jones')
    expect(res._json.seats_remaining).toBeNull()
    expect(res._json.is_full).toBe(false)
  })

  it('school class: falls back to the school name when the teacher learner has no display_name', async () => {
    responders.classes = () => ({ data: SCHOOL_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'premium' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-1', display_name: '' }, error: null })
    responders.schools = () => ({ data: { school_name: 'Ysgol Test', platform_status: 'active' }, error: null })
    responders.teacher_referrals = () => ({ count: 0, error: null })

    const res = makeRes()
    await handler(makeReq('ABC-123'), res)
    expect(res._json.teacher.display_name).toBe('Ysgol Test')
  })

  it('school class: 404s reason=unavailable when the owning school platform_status is expired', async () => {
    responders.classes = () => ({ data: SCHOOL_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'premium' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-1', display_name: 'Ms Jones' }, error: null })
    responders.schools = () => ({ data: { school_name: 'Ysgol Test', platform_status: 'expired' }, error: null })

    const res = makeRes()
    await handler(makeReq('ABC-123'), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res._json.reason).toBe('unavailable')
  })

  it('free-tier course sets course_is_free true (community pricing_tier)', async () => {
    responders.classes = () => ({ data: SCHOOL_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'community' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-1', display_name: 'Ms Jones' }, error: null })
    responders.schools = () => ({ data: { school_name: 'Ysgol Test', platform_status: 'active' }, error: null })
    responders.teacher_referrals = () => ({ count: 0, error: null })

    const res = makeRes()
    await handler(makeReq('ABC-123'), res)
    expect(res._json.class.course_is_free).toBe(true)
  })

  it('unknown pricing tier fails money-safe: course_is_free is false, not true', async () => {
    responders.classes = () => ({ data: SCHOOL_CLASS, error: null })
    responders.courses = () => ({ data: null, error: null })
    responders.learners = () => ({ data: { id: 'learner-1', display_name: 'Ms Jones' }, error: null })
    responders.schools = () => ({ data: { school_name: 'Ysgol Test', platform_status: 'active' }, error: null })
    responders.teacher_referrals = () => ({ count: 0, error: null })

    const res = makeRes()
    await handler(makeReq('ABC-123'), res)
    expect(res._json.class.course_is_free).toBe(false)
  })

  it('tutor class: 404s reason=unavailable when the teacher has no teachers row', async () => {
    responders.classes = () => ({ data: TUTOR_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'premium' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-2', display_name: 'Freelance Ana' }, error: null })
    responders.teachers = () => ({ data: null, error: null })

    const res = makeRes()
    await handler(makeReq('XYZ-789'), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res._json.reason).toBe('unavailable')
  })

  it('tutor class: 404s reason=unavailable when referral_active is false (paused link)', async () => {
    responders.classes = () => ({ data: TUTOR_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'premium' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-2', display_name: 'Freelance Ana' }, error: null })
    responders.teachers = () => ({ data: { id: 't-1', referral_active: false, display_name: 'Ana', photo_url: null, bio: null, country: null, teaching_languages: [] }, error: null })

    const res = makeRes()
    await handler(makeReq('XYZ-789'), res)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(res._json.reason).toBe('unavailable')
  })

  it('tutor class: seat cap is 20, seats_remaining and is_full computed from active teacher_referrals', async () => {
    responders.classes = () => ({ data: TUTOR_CLASS, error: null })
    responders.courses = () => ({ data: { pricing_tier: 'premium' }, error: null })
    responders.learners = () => ({ data: { id: 'learner-2', display_name: 'Freelance Ana' }, error: null })
    responders.teachers = () => ({ data: { id: 't-1', referral_active: true, display_name: 'Ana', photo_url: null, bio: null, country: null, teaching_languages: [] }, error: null })
    responders.teacher_referrals = () => ({ count: 20, error: null })

    const res = makeRes()
    await handler(makeReq('XYZ-789'), res)
    expect(res._json.seats_remaining).toBe(0)
    expect(res._json.is_full).toBe(true)
  })
})
