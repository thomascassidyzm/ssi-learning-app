import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'auth-1' })),
}))

let learnerRow: { id: string } | null
let enrollmentRows: { data: any[] | null; error: any }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'learners') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: learnerRow, error: null }) }) }) }
      }
      // course_enrollments
      return { select: () => ({ eq: async () => enrollmentRows }) }
    },
  }),
}))

import handler, {
  MIN_COHORT,
  seedFromCursor,
  quarterOf,
  placeInCohort,
  chooseCohort,
} from './standing'

function mockRes() {
  const res: any = { statusCode: 0, body: undefined }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  return res as VercelResponse & { statusCode: number; body: any }
}

const req = (course?: string) =>
  ({ method: 'GET', query: course === undefined ? {} : { course }, headers: {} }) as unknown as VercelRequest

/** A cohort of n members whose positions are 1..n, so percentiles are exact. */
const ladder = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ learner_id: `L${i}`, seed: i + 1 }))

describe('seedFromCursor', () => {
  it('parses a lego cursor to its seed number', () => {
    expect(seedFromCursor('S0280L01')).toBe(280)
    expect(seedFromCursor('S0001L12')).toBe(1)
  })
  it('returns null for anything that is not a cursor', () => {
    for (const bad of [null, undefined, '', 'nonsense', 'S280L01', 'L01']) {
      expect(seedFromCursor(bad as any)).toBeNull()
    }
  })
})

describe('quarterOf', () => {
  it('maps a timestamp to its UTC calendar quarter', () => {
    expect(quarterOf('2026-01-15T00:00:00Z')).toBe('2026Q1')
    expect(quarterOf('2026-04-01T00:00:00Z')).toBe('2026Q2')
    expect(quarterOf('2026-12-31T23:59:59Z')).toBe('2026Q4')
  })
  it('returns null for missing or unparseable timestamps', () => {
    expect(quarterOf(null)).toBeNull()
    expect(quarterOf('not-a-date')).toBeNull()
  })
})

describe('placeInCohort — the k-anonymity floor', () => {
  it('refuses to produce a number below the floor', () => {
    const result = placeInCohort(10, ladder(MIN_COHORT - 1))
    expect(result).toEqual({ gap: 'cohort-too-small' })
  })

  it('produces a number exactly at the floor', () => {
    const result = placeInCohort(10, ladder(MIN_COHORT))
    expect('gap' in result).toBe(false)
  })

  it('an empty cohort yields nothing rather than 100%', () => {
    expect(placeInCohort(10, [])).toEqual({ gap: 'cohort-too-small' })
  })
})

describe('placeInCohort — the arithmetic', () => {
  it('counts only those strictly behind, over the whole cohort', () => {
    // 40 members at seeds 1..40; a learner at seed 21 is ahead of 20 of them.
    const r = placeInCohort(21, ladder(40)) as any
    expect(r.aheadOfPct).toBe(50)
    expect(r.cohortSize).toBe(40)
  })

  it('does not flatter a learner tied with everybody', () => {
    const tied = Array.from({ length: 30 }, (_, i) => ({ learner_id: `L${i}`, seed: 5 }))
    const r = placeInCohort(5, tied) as any
    expect(r.aheadOfPct).toBe(0)
  })

  it('the furthest learner is ahead of everyone except themselves', () => {
    const r = placeInCohort(40, ladder(40)) as any
    // 39 of the 40 are strictly behind — never 100%, because you are in your own cohort.
    expect(r.aheadOfPct).toBe(98)
  })

  it('a learner at the very start is ahead of nobody, and is not shamed for it', () => {
    const r = placeInCohort(1, ladder(40)) as any
    expect(r.aheadOfPct).toBe(0)
    // The payload has no rank and no "behind" figure to render.
    expect(r).not.toHaveProperty('rank')
    expect(r).not.toHaveProperty('behindPct')
  })

  it('reports the cohort median so the UI can say where most people are', () => {
    const r = placeInCohort(21, ladder(40)) as any
    expect(r.medianSeed).toBe(21)
  })
})

describe('chooseCohort — the two-rung ladder', () => {
  const peers = (quarterCount: number, otherCount: number) => [
    ...Array.from({ length: quarterCount }, (_, i) => ({ learner_id: `Q${i}`, seed: i + 1, quarter: '2026Q2' })),
    ...Array.from({ length: otherCount }, (_, i) => ({ learner_id: `O${i}`, seed: i + 1, quarter: '2026Q1' })),
  ]

  it('prefers the tighter same-quarter cohort when it clears the floor', () => {
    const r = chooseCohort({ seed: 10, quarter: '2026Q2' }, peers(MIN_COHORT, 50)) as any
    expect(r.cohortKind).toBe('quarter')
    expect(r.cohortQuarter).toBe('2026Q2')
    expect(r.cohortSize).toBe(MIN_COHORT)
  })

  it('falls back to the whole course when the quarter is too thin', () => {
    const r = chooseCohort({ seed: 10, quarter: '2026Q2' }, peers(5, 40)) as any
    expect(r.cohortKind).toBe('course')
    expect(r.cohortQuarter).toBeNull()
    expect(r.cohortSize).toBe(45)
  })

  it('refuses when even the whole course is too thin — it never pools further', () => {
    const r = chooseCohort({ seed: 10, quarter: '2026Q2' }, peers(3, 4))
    expect(r).toEqual({ gap: 'cohort-too-small' })
  })

  it('still places a learner whose enrolment date is unknown, via the course rung', () => {
    const r = chooseCohort({ seed: 10, quarter: null }, peers(30, 30)) as any
    expect(r.cohortKind).toBe('course')
  })
})

describe('GET /api/me/standing — the eligibility gate', () => {
  const person = (id: string, seed: number, extra: Record<string, any> = {}) => ({
    learner_id: id,
    enrolled_at: '2026-04-10T00:00:00Z',
    highest_completed_lego_id: `S${String(seed).padStart(4, '0')}L01`,
    learners: { is_demo: false, is_internal: false, is_class_entity: false, platform_role: null, ...extra },
  })

  beforeEach(() => {
    learnerRow = { id: 'me' }
    enrollmentRows = { data: null, error: null }
  })

  it('requires a course', async () => {
    const res = mockRes()
    await handler(req(), res)
    expect(res.body).toEqual({ standing: null, reason: 'no-course' })
  })

  it('places the learner when the cohort is real and large enough', async () => {
    enrollmentRows = {
      data: [person('me', 21), ...Array.from({ length: 39 }, (_, i) => person(`p${i}`, i + 1))],
      error: null,
    }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    expect(res.body.standing.cohortSize).toBe(40)
    expect(res.body.standing.aheadOfPct).toBe(50)
    expect(res.body.standing.cohortKind).toBe('quarter')
  })

  it.each([
    ['demo rows', { is_demo: true }],
    ['class entities', { is_class_entity: true }],
    ['internal staff', { is_internal: true }],
    ['testers', { platform_role: 'tester' }],
    ['ssi admins', { platform_role: 'ssi_admin' }],
  ])('excludes %s from the cohort entirely', async (_label, flag) => {
    // 19 real peers + 40 excluded ones. Real cohort = 20 (me + 19), which clears
    // the floor; if the excluded rows leaked in, cohortSize would be 60.
    enrollmentRows = {
      data: [
        person('me', 21),
        ...Array.from({ length: 19 }, (_, i) => person(`real${i}`, i + 1)),
        ...Array.from({ length: 40 }, (_, i) => person(`x${i}`, i + 1, flag)),
      ],
      error: null,
    }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    expect(res.body.standing.cohortSize).toBe(20)
  })

  it('returns nothing — not a number — when the real cohort is under the floor', async () => {
    // The shape of the live database today: a handful of real learners buried
    // in a large demo population.
    enrollmentRows = {
      data: [
        person('me', 21),
        ...Array.from({ length: 5 }, (_, i) => person(`real${i}`, i + 1)),
        ...Array.from({ length: 200 }, (_, i) => person(`d${i}`, i + 1, { is_demo: true })),
      ],
      error: null,
    }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    expect(res.body).toEqual({ standing: null, reason: 'cohort-too-small' })
  })

  it('ignores enrolments that have never reached a position', async () => {
    enrollmentRows = {
      data: [
        person('me', 21),
        ...Array.from({ length: 19 }, (_, i) => person(`real${i}`, i + 1)),
        ...Array.from({ length: 30 }, (_, i) => ({ ...person(`n${i}`, 1), highest_completed_lego_id: null })),
      ],
      error: null,
    }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    expect(res.body.standing.cohortSize).toBe(20)
  })

  it('says nothing when the caller has not started the course', async () => {
    enrollmentRows = {
      data: Array.from({ length: 40 }, (_, i) => person(`p${i}`, i + 1)),
      error: null,
    }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    expect(res.body).toEqual({ standing: null, reason: 'no-position' })
  })

  it('fails soft to a blank space when the read errors', async () => {
    enrollmentRows = { data: null, error: { message: 'boom' } }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    expect(res.body.standing).toBeNull()
    expect(res.statusCode).toBe(200)
  })

  it('never returns a rank, a streak, or anything that could express absence', async () => {
    enrollmentRows = {
      data: [person('me', 21), ...Array.from({ length: 39 }, (_, i) => person(`p${i}`, i + 1))],
      error: null,
    }
    const res = mockRes()
    await handler(req('cym_n_for_eng'), res)
    const keys = Object.keys(res.body.standing)
    for (const forbidden of ['rank', 'position', 'streak', 'days', 'behindPct', 'lastSeen', 'minutes']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})
