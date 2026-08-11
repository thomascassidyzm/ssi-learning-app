/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`, finding TENANCY-06 (medium).
 *
 * GET /api/teacher/by-code?code=ABC-123 is unauthenticated by design (the public
 * join page) and looks a class up by `classes.student_join_code` with no
 * throttle and no attempt logging (api/teacher/by-code.ts:31-56).
 *
 * The keyspace is generateCode()'s ABC-123: 24 consonants^3 x 10^3 = 13,824,000.
 * The repo already treats that space as brute-forceable and built the
 * countermeasure — api/code/validate.ts:79-117 enforces 10 attempts per hashed
 * IP per 15 minutes and writes every attempt to `possession_mint_attempts` "so
 * abuse is observable", with a comment requiring api/auth/possession-redeem.ts
 * to share the same window. by-code.ts looks up codes in the same space and
 * does neither.
 *
 * Enumeration yields a tenant-structure map (class name, course, teacher name,
 * school name) and — the material harm — WORKING student join codes, which let
 * an outsider enrol into a real school's class.
 *
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateCode } from '../_utils/codeGen'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let queriedCodes: string[] = []

function makeSupabase() {
  const from = (table: string) => {
    const eqs: [string, unknown][] = []
    const builder: any = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      eqs.push([col, val])
      if (table === 'classes' && col === 'student_join_code') queriedCodes.push(String(val))
      return builder
    }
    builder.is = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.maybeSingle = () => {
      if (table === 'classes') {
        const code = eqs.find(([c]) => c === 'student_join_code')?.[1]
        // One code in the whole space is live — the needle a brute-forcer hunts.
        if (code === 'BCD-742') {
          return Promise.resolve({
            data: {
              id: 'class-9', class_name: 'Year 7 Welsh', course_code: 'cym_for_eng',
              teacher_user_id: 'teacher-uid', is_active: true, student_join_code: 'BCD-742',
              school_id: 'school-9', group_id: null,
            },
            error: null,
          })
        }
        return Promise.resolve({ data: null, error: null })
      }
      if (table === 'courses') return Promise.resolve({ data: { pricing_tier: 'free' }, error: null })
      if (table === 'schools') return Promise.resolve({ data: { school_name: 'Hillside School', platform_status: 'active' }, error: null })
      if (table === 'learners') return Promise.resolve({ data: { id: 'l-1', display_name: 'Ms Rao' }, error: null })
      return Promise.resolve({ data: null, error: null })
    }
    builder.single = builder.maybeSingle
    builder.then = (resolve: any) => resolve({ data: [], error: null })
    return builder
  }
  return { from } as any
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => makeSupabase() }))

let handler: typeof import('./by-code').default

function makeReq(code: string): VercelRequest {
  // Note the absence of any Authorization header — the endpoint requires none.
  return { method: 'GET', query: { code }, headers: { host: 'app.example.com' } } as any
}

function makeRes(): VercelResponse & { statusCode?: number; body?: any } {
  const res: any = {}
  res.status = vi.fn((code: number) => { res.statusCode = code; return res })
  res.json = vi.fn((body: any) => { res.body = body; return res })
  res.setHeader = vi.fn()
  return res
}

beforeEach(async () => {
  queriedCodes = []
  handler = (await import('./by-code')).default
})

describe('CONTROL — the join-code keyspace and the limiter that exists elsewhere', () => {
  it('generateCode() produces the ABC-123 shape this endpoint reads', () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^[A-HJ-NP-Z]{3}-\d{3}$/)
  })

  it('api/code/validate.ts throttles the same keyspace per IP, and logs attempts', () => {
    const src = readFileSync(join(__dirname, '..', 'code', 'validate.ts'), 'utf8')
    expect(src).toMatch(/PER_IP_LIMIT\s*=\s*10/)
    expect(src).toMatch(/RATE_WINDOW_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/)
    expect(src).toContain('possession_mint_attempts')
  })
})

/**
 * SECURITY FINDING TENANCY-06: by-code.ts accepts unlimited unauthenticated
 * guesses. The loop below is 60 requests from one caller with no credentials;
 * every one reaches the database, none is throttled, none is logged, and the
 * single live code is returned in full when it is hit.
 *
 * WHAT SHOULD HAPPEN INSTEAD: reuse api/code/validate.ts's limiter — same
 * 10-per-15-minutes window, same sha256-truncated IP hashing, same
 * `possession_mint_attempts` logging — so one IP's guesses across all three
 * code-lookup endpoints throttle jointly and are observable. The 60th call
 * below should be a 429.
 */
describe('SECURITY FINDING TENANCY-06 — unauthenticated, unthrottled join-code oracle', () => {
  it('serves 60 consecutive unauthenticated guesses without throttling (current behaviour)', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 60; i++) {
      const res = makeRes()
      await handler(makeReq(`ZZZ-${String(i).padStart(3, '0')}`), res)
      statuses.push(res.statusCode!)
    }
    expect(queriedCodes).toHaveLength(60)           // every guess hit the DB
    expect(statuses.every((s) => s !== 429)).toBe(true) // ← the defect: no 429, ever
  })

  it('a hit discloses the class, course, teacher and school to an anonymous caller (current behaviour)', async () => {
    const res = makeRes()
    await handler(makeReq('BCD-742'), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.class?.class_name ?? res.body.className ?? JSON.stringify(res.body)).toBeTruthy()
    // The response body identifies a real tenant's class to someone who merely guessed.
    expect(JSON.stringify(res.body)).toContain('Year 7 Welsh')
  })

  it.todo('TENANCY-06: by-code.ts must apply the api/code/validate.ts per-IP limiter and return 429')
  it.todo('TENANCY-06: by-code.ts must log attempts to possession_mint_attempts so enumeration is observable')
})
