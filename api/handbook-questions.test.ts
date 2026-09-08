// The ask loop's route (job #386). What these prove: nobody anonymous can ask
// or read; the asker's identity comes from the token and never the body; a
// reader sees only their own rows; the daily throttle refuses the sixth ask;
// only a platform admin can answer.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authResult: { valid: boolean; userId?: string; error?: string }
let adminResult: { userId: string } | { error: string; status: number }
let inserted: any[]
let updated: { patch: any; id: string | null }[]
let recentCount: number
let selectFilters: Record<string, unknown>[]
let insertError: any

vi.mock('./_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => authResult),
  verifyAdmin: vi.fn(async () => adminResult),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      expect(table).toBe('handbook_questions')
      const filters: Record<string, unknown> = {}
      let mode: 'select' | 'count' | 'insert' | 'update' = 'select'
      let patch: any = null
      const b: any = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => { if (opts?.head) mode = 'count'; return b },
        eq: (k: string, v: unknown) => { filters[k] = v; return b },
        gte: (k: string, v: unknown) => { filters[k] = v; return b },
        order: () => b,
        limit: () => b,
        insert: (row: any) => { mode = 'insert'; inserted.push(row); return b },
        update: (p: any) => { mode = 'update'; patch = p; return b },
        single: async () => ({ data: inserted.at(-1) ?? null, error: insertError }),
        maybeSingle: async () => { updated.push({ patch, id: (filters.id as string) ?? null }); return { data: { id: filters.id, ...patch }, error: null } },
        then: (resolve: (v: any) => void) => {
          selectFilters.push({ mode, ...filters })
          if (mode === 'count') return resolve({ count: recentCount, error: null })
          return resolve({ data: [{ id: 'q1', question: 'How do I add a class?', status: 'new', auth_user_id: filters.auth_user_id }], error: null })
        },
      }
      return b
    },
  }),
}))

let handler: typeof import('./handbook-questions').default

function req(method: string, body?: any, query: Record<string, string> = {}, bearer = true): VercelRequest {
  return {
    method,
    headers: { host: 'staging.saysomethingin.app', ...(bearer ? { authorization: 'Bearer tok' } : {}) },
    query, body, cookies: {},
  } as any
}
function res(): VercelResponse & { statusCode?: number; body?: any } {
  const r: any = {}
  r.setHeader = vi.fn(); r.end = vi.fn(() => r)
  r.status = vi.fn((c: number) => { r.statusCode = c; return r })
  r.json = vi.fn((b: any) => { r.body = b; return r })
  return r
}

beforeEach(async () => {
  authResult = { valid: true, userId: 'auth-uid-1' }
  adminResult = { error: 'Forbidden', status: 403 }
  inserted = []; updated = []; selectFilters = []; recentCount = 0; insertError = null
  handler = (await import('./handbook-questions')).default
})

describe('POST — asking', () => {
  it('refuses an anonymous asker and writes nothing', async () => {
    authResult = { valid: false, error: 'no token' }
    const r = res(); await handler(req('POST', { question: 'How do I add a class?', persona: 'teacher' }, {}, false), r)
    expect(r.statusCode).toBe(401)
    expect(inserted).toEqual([])
  })
  it('stamps auth_user_id from the token, never from the body', async () => {
    const r = res()
    await handler(req('POST', { question: 'How do I add a class?', persona: 'teacher', auth_user_id: 'someone-else', route: '/schools/handbook' }), r)
    expect(r.statusCode).toBe(201)
    expect(inserted).toHaveLength(1)
    expect(inserted[0].auth_user_id).toBe('auth-uid-1')
    expect(inserted[0].env).toBe('staging')
    expect(inserted[0].question).toBe('How do I add a class?')
  })
  it('refuses a question too short to mean anything, and an unknown persona', async () => {
    let r = res(); await handler(req('POST', { question: 'no', persona: 'teacher' }), r)
    expect(r.statusCode).toBe(400)
    r = res(); await handler(req('POST', { question: 'How do I add a class?', persona: 'wizard' }), r)
    expect(r.statusCode).toBe(400)
    expect(inserted).toEqual([])
  })
  it('refuses the sixth ask in a day with 429 and writes nothing', async () => {
    recentCount = 5
    const r = res(); await handler(req('POST', { question: 'How do I add a class?', persona: 'teacher' }), r)
    expect(r.statusCode).toBe(429)
    expect(inserted).toEqual([])
    // …and the throttle was keyed on the verified person.
    expect(selectFilters.find((f) => f.mode === 'count')?.auth_user_id).toBe('auth-uid-1')
  })
})

describe('GET — reading back', () => {
  it('returns only the asker’s own rows', async () => {
    const r = res(); await handler(req('GET'), r)
    expect(r.statusCode).toBe(200)
    expect(selectFilters.at(-1)?.auth_user_id).toBe('auth-uid-1')
    expect(r.body.questions[0].question).toBe('How do I add a class?')
  })
  it('?all=1 is for platform admins only', async () => {
    let r = res(); await handler(req('GET', undefined, { all: '1' }), r)
    expect(r.statusCode).toBe(403)
    adminResult = { userId: 'auth-uid-1' }
    r = res(); await handler(req('GET', undefined, { all: '1' }), r)
    expect(r.statusCode).toBe(200)
    expect(selectFilters.at(-1)?.auth_user_id).toBeUndefined()
  })
})

describe('PATCH — answering', () => {
  it('a non-admin cannot answer', async () => {
    const r = res(); await handler(req('PATCH', { id: 'q1', status: 'answered', answer: 'Tap Add a class.' }), r)
    expect(r.statusCode).toBe(403)
    expect(updated).toEqual([])
  })
  it('an admin’s answer is dated and signed human', async () => {
    adminResult = { userId: 'admin-1' }
    const r = res(); await handler(req('PATCH', { id: 'q1', status: 'answered', answer: 'Tap **Add a class** on your school page.' }), r)
    expect(r.statusCode).toBe(200)
    expect(updated[0].id).toBe('q1')
    expect(updated[0].patch.status).toBe('answered')
    expect(updated[0].patch.answered_by).toBe('human')
    expect(typeof updated[0].patch.answered_at).toBe('string')
  })
  it('refuses a status the table does not know', async () => {
    adminResult = { userId: 'admin-1' }
    const r = res(); await handler(req('PATCH', { id: 'q1', status: 'sorted' }), r)
    expect(r.statusCode).toBe(400)
  })
})
