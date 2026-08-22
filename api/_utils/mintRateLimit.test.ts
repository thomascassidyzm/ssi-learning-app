/**
 * Tests for the join-code MINT throttle (SEC22-01 part 3).
 *
 * Every insert into `classes` or `schools` fires a BEFORE-INSERT trigger that
 * calls public.generate_join_code(), so the self-serve routes that insert are
 * mint faucets. What must hold:
 *   - under the limit, the mint proceeds and the attempt is audited
 *   - at/over either limit, 429 and NO mint
 *   - the limiter never counts its own refusals (a retrying client would
 *     otherwise keep its window permanently full — the live 2026-07-20 bug
 *     next door in possession-redeem)
 *   - mint rows are invisible to the redemption limiters, and vice versa
 *
 * Supabase mock modelled on api/code/validate.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest } from '@vercel/node'
import { createHash } from 'crypto'

let writes: any[] = []
// (calls) => { data?, count?, error? } | undefined
let respond: (calls: any[][]) => any = () => undefined
// Every count SELECT's call log, in order, for assertions on the filters used.
let countCallLogs: any[][][] = []

function makeChainable() {
  const calls: any[][] = []
  const builder: any = {
    select: (cols: string, opts?: unknown) => { calls.push(['select', cols, opts]); return builder },
    insert: (obj: unknown) => { calls.push(['insert', obj]); writes.push(obj); return builder },
    eq: (col: string, val: unknown) => { calls.push(['eq', col, val]); return builder },
    neq: (col: string, val: unknown) => { calls.push(['neq', col, val]); return builder },
    gte: (col: string, val: unknown) => { calls.push(['gte', col, val]); return builder },
    resolve: () => {
      if (!calls.some((c) => c[0] === 'insert')) countCallLogs.push(calls)
      const r = respond(calls)
      if (r !== undefined) return r
      return { data: null, error: null, count: 0 }
    },
    then(onF: any, onR: any) { return Promise.resolve(this.resolve()).then(onF, onR) },
  }
  return builder
}

const supabase: any = { from: () => makeChainable() }

function makeReq(ip = '1.2.3.4'): VercelRequest {
  return { method: 'POST', query: {}, headers: { 'x-forwarded-for': ip }, body: {} } as unknown as VercelRequest
}

/** Responder that reports the same windowed count for every count SELECT. */
function counting(n: number) {
  return (calls: any[][]) => {
    if (calls.some((c) => c[0] === 'insert')) return { error: null }
    return { count: n, error: null }
  }
}

let mod: typeof import('./mintRateLimit')

beforeEach(async () => {
  vi.resetModules()
  writes = []
  countCallLogs = []
  respond = () => undefined
  mod = await import('./mintRateLimit')
})

describe('enforceMintRateLimit', () => {
  it('passes under the limit and audits the attempt', async () => {
    respond = counting(0)
    const result = await mod.enforceMintRateLimit(supabase, makeReq(), 'user-1', mod.CLASS_MINT_OUTCOME)

    expect(result.ok).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({
      outcome: 'class_mint_attempt',
      auth_user_id: 'user-1',
      invite_code_id: null,
    })
  })

  it('429s once the per-USER window is at the limit, and mints nothing', async () => {
    respond = counting(mod.MINT_PER_USER_LIMIT)
    const result = await mod.enforceMintRateLimit(supabase, makeReq(), 'user-1', mod.CLASS_MINT_OUTCOME)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(429)
    // Only the refusal was logged — no class_mint_attempt row was written.
    expect(writes).toHaveLength(1)
    expect(writes[0].outcome).toBe('rate_limited_mint_user')
  })

  it('429s on the per-IP window even when the user key is unknown', async () => {
    respond = counting(mod.MINT_PER_IP_LIMIT)
    const result = await mod.enforceMintRateLimit(supabase, makeReq(), null, mod.SCHOOL_MINT_OUTCOME)

    expect(result.ok).toBe(false)
    expect(writes).toHaveLength(1)
    expect(writes[0].outcome).toBe('rate_limited_mint_ip')
  })

  it('a per-user count just under the limit still passes', async () => {
    respond = counting(mod.MINT_PER_USER_LIMIT - 1)
    const result = await mod.enforceMintRateLimit(supabase, makeReq(), 'user-1', mod.CLASS_MINT_OUTCOME)
    expect(result.ok).toBe(true)
  })

  // The house rule from api/code/validate.ts: a limiter counts ACTIONS, not
  // its own REFUSALS. Counting them makes a block self-perpetuating — a client
  // that retries keeps its own window permanently full and the limit never
  // drains (live repro next door, 2026-07-20).
  it('excludes its own refusals from both counts', async () => {
    respond = counting(0)
    await mod.enforceMintRateLimit(supabase, makeReq(), 'user-1', mod.CLASS_MINT_OUTCOME)

    expect(countCallLogs).toHaveLength(2) // per-user, then per-IP
    for (const calls of countCallLogs) {
      const excluded = calls.filter((c) => c[0] === 'neq').map((c) => c[2])
      expect(excluded).toContain('rate_limited_mint_ip')
      expect(excluded).toContain('rate_limited_mint_user')
      // The mint attempts themselves — the actual signal — still count.
      expect(excluded).not.toContain('class_mint_attempt')
      expect(excluded).not.toContain('school_mint_attempt')
      // Windowed, not all-time.
      expect(calls.some((c) => c[0] === 'gte' && c[1] === 'created_at')).toBe(true)
    }
  })

  it('keys the two counts on auth_user_id and ip_hash respectively', async () => {
    respond = counting(0)
    await mod.enforceMintRateLimit(supabase, makeReq(), 'user-1', mod.CLASS_MINT_OUTCOME)

    const userFilters = countCallLogs[0].filter((c) => c[0] === 'eq').map((c) => c[1])
    const ipFilters = countCallLogs[1].filter((c) => c[0] === 'eq').map((c) => c[1])
    expect(userFilters).toEqual(['auth_user_id'])
    expect(ipFilters).toEqual(['ip_hash'])
  })

  // Isolation from the REDEMPTION limiters (api/code/validate.ts,
  // api/auth/possession-redeem.ts). Both count rows by plain
  // sha256(ip).slice(0,16) and filter outcomes only to drop two known
  // classes, so a mint row written against the plain hash WOULD be counted by
  // them — a teacher creating classes would eat their own students' 10
  // redemption attempts on a shared school NAT. Namespacing the hash keeps
  // the two keyspaces disjoint. Those files are out of scope, so this side
  // must be the one that isolates.
  it('mint rows live in a keyspace the redemption limiters cannot see', async () => {
    const ip = '1.2.3.4'
    const redemptionHash = createHash('sha256').update(ip).digest('hex').slice(0, 16)
    const mintHash = mod.mintIpHash(makeReq(ip))

    expect(mintHash).not.toBe(redemptionHash)
    expect(mintHash).toMatch(/^[0-9a-f]{16}$/)

    // And a mint row carries no invite_code_id, so the per-CODE redemption
    // limiter (which filters `invite_code_id`) cannot match it either.
    respond = counting(0)
    await mod.enforceMintRateLimit(supabase, makeReq(ip), 'user-1', mod.CLASS_MINT_OUTCOME)
    expect(writes[0].invite_code_id).toBeNull()
    expect(writes[0].ip_hash).toBe(mintHash)
  })

  it('mint outcome values are distinct from every redemption outcome', () => {
    const redemptionOutcomes = [
      'validate_attempt', 'personal_signin', 'rate_limited_ip', 'rate_limited_code',
      'invalid_code', 'expired', 'exhausted', 'unsupported_code_type',
    ]
    for (const o of [mod.CLASS_MINT_OUTCOME, mod.SCHOOL_MINT_OUTCOME, mod.RATE_LIMITED_MINT_IP, mod.RATE_LIMITED_MINT_USER]) {
      expect(redemptionOutcomes).not.toContain(o)
    }
  })

  // A blip on the audit table must never stop a teacher creating a class.
  it('fails OPEN when the count query errors', async () => {
    respond = (calls) => {
      if (calls.some((c) => c[0] === 'insert')) return { error: null }
      return { count: null, error: { message: 'connection reset' } }
    }
    const result = await mod.enforceMintRateLimit(supabase, makeReq(), 'user-1', mod.CLASS_MINT_OUTCOME)
    expect(result.ok).toBe(true)
  })

  // Generosity is the whole point: a real teacher must never be blocked.
  it('limits sit well beyond any real sitting', () => {
    expect(mod.MINT_PER_USER_LIMIT).toBeGreaterThanOrEqual(20) // 2x TEACHER_CLASS_CAP
    expect(mod.MINT_PER_IP_LIMIT).toBeGreaterThanOrEqual(100) // a whole staffroom on one NAT
    expect(mod.MINT_RATE_WINDOW_MS).toBe(15 * 60 * 1000) // house window
  })
})
