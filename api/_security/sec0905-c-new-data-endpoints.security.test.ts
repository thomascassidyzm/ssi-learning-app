/**
 * SEC0905 Area C — the new and rewritten data/money-adjacent endpoints,
 * delta 8755d4c8..origin/main:
 *   api/me/threads.ts (new), api/courses/[code]/sectors.ts (new),
 *   api/_utils/rebateRegion.ts (new), api/audio/batch-urls.ts (rewritten),
 *   api/teacher/paddle-webhook.ts (+44), api/player-events.ts (+35).
 *
 * Full narrative in docs/security-audit-2026-09-05/area-c-new-money-endpoints.md.
 * This file pins:
 *
 *   SEC0905-C-01 (MEDIUM, CONFIRMED) — sectors.ts has NO entitlement gate at
 *     all and returns a real lego's known_text/target_text (the anchor) for
 *     ANY registered sector on ANY course, including seeds past the Yellow
 *     Belt free-preview boundary (seed 19) that every sibling course endpoint
 *     (bundle.ts, cycles.ts, infplay-cycles.ts) enforces via
 *     resolveServerCourseAccess. Characterized, not fixed.
 *
 *   SEC0905-C-02 (LOW, CONFIRMED) — api/me/threads.ts returns raw
 *     `error.message` (PostgREST/Postgres detail) to the caller on every
 *     failure path, matching the SEC0901-C-03 shape in a file that predates
 *     none of the prior sweeps (it is brand new).
 *
 *   SEC0905-C-03 (SECURE, CONFIRMED) — api/me/threads.ts never accepts a
 *     caller-supplied learner/enrolment id; every scope is derived from the
 *     verified bearer token. No IDOR.
 *
 *   SEC0905-C-04 (SECURE, CONFIRMED) — SEC0901-D-01 is CLOSED. batch-urls.ts
 *     now gates a `gated` audio id on `resolveServerCourseAccess(...).canAccess`
 *     (the same DB-resolved entitlement bundle.ts/cycles.ts use), fails
 *     CLOSED on a lookup error, and keeps batch size (500) and presign TTL
 *     (300s) bounded.
 *
 *   SEC0905-C-05 (SECURE, CONFIRMED) — rebateRegion.ts derives the billing
 *     country from a server-side Paddle address lookup keyed off the
 *     webhook's own transaction/address id, never from a client header or a
 *     browser-composed `customData` field. Not caller-steerable.
 *
 *   SEC0905-C-06 (SECURE, CONFIRMED) — player-events.ts's new
 *     `acting_learner_id` body channel is authorised through the exact same
 *     `isAuthorisedClassLearner` gate as the pre-existing cookie channel
 *     (SEC0901-C-02), and is only reachable after a verified bearer.
 *
 *   SEC0905-C-07 (LOW, PLAUSIBLE) — paddle-webhook.ts's adjustment-path
 *     region check silently resolves to "not excluded" (rather than the
 *     documented fail-closed throw) when `data.transactionId` is absent, so
 *     an adjustment whose region cannot be established is money-adjacent but
 *     not proven exploitable (not caller-controlled; a Paddle payload-shape
 *     question, not an attacker lever).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const __dirname = dirname(fileURLToPath(import.meta.url))
const apiRoot = join(__dirname, '..')

function read(relPath: string): string {
  return readFileSync(join(apiRoot, relPath), 'utf-8')
}

describe('SEC0905-C-01 — sectors.ts ships real course content with no entitlement gate', () => {
  it('the handler never imports or calls resolveServerCourseAccess / verifyAuthToken, unlike its bundle/cycles siblings', () => {
    const sectors = read('courses/[code]/sectors.ts')
    const bundle = read('courses/[code]/bundle.ts')
    expect(sectors).not.toMatch(/resolveServerCourseAccess/)
    expect(sectors).not.toMatch(/verifyAuthToken/)
    // The sibling this endpoint sits next to DOES gate on it — proving the
    // gate exists in this codebase and was available to reuse.
    expect(bundle).toMatch(/resolveServerCourseAccess/)
  })

  it('CHARACTERIZATION: returns a past-preview lego\'s known+target text to a totally anonymous caller', async () => {
    vi.resetModules()
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

    const DB: Record<string, any[]> = {
      course_sectors: [
        {
          base_course_code: 'spa_for_eng',
          sector_slug: 'health',
          sector_course_code: 'spa_for_eng_health',
          roles: ['general'],
          // Seed 42 — well past PREMIUM_PREVIEW_MAX_SEED (19, Yellow Belt).
          // See api/_utils/audioAccess.ts:422.
          core_anchor_lego_id: 'S0042L03',
          status: 'live',
        },
      ],
      course_legos: [
        {
          course_code: 'spa_for_eng',
          lego_id: 'S0042L03',
          known_text: 'I wanted to speak to you',
          target_text: 'quería hablar contigo',
        },
      ],
    }

    function makeChainable(table: string) {
      let rows: any[] = [...((DB as any)[table] ?? [])]
      let single = false
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
        in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
        order: () => builder,
        maybeSingle: () => { single = true; return builder },
        then: (resolve: any) =>
          Promise.resolve({ data: single ? (rows[0] ?? null) : rows, error: null }).then(resolve),
      }
      return builder
    }

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ from: (table: string) => makeChainable(table) }),
    }))

    const handler = (await import('../courses/[code]/sectors')).default
    const res: any = { headers: {} }
    res.status = vi.fn((code: number) => { res.statusCode = code; return res })
    res.json = vi.fn((body: any) => { res.body = body; return res })
    res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v; return res })
    // No Authorization header. No cookie. No entitlement token anywhere.
    const req = { method: 'GET', query: { code: 'spa_for_eng' }, headers: {} } as unknown as VercelRequest

    await handler(req, res as unknown as VercelResponse)

    expect(res.statusCode).toBe(200)
    // This is the finding: real, past-preview premium teaching content,
    // handed to a caller who presented no credential of any kind.
    expect(res.body.sectors[0].anchor).toEqual({
      legoId: 'S0042L03',
      known: 'I wanted to speak to you',
      target: 'quería hablar contigo',
    })

    vi.doUnmock('@supabase/supabase-js')
  })
})

describe('SEC0905-C-02 — me/threads.ts leaks raw DB error detail (SEC0901-C-03 shape, new file)', () => {
  it('every error branch responds with the literal PostgREST/Postgres `error.message`, never a generic string', () => {
    const src = read('me/threads.ts')
    // Five call sites return `{ error: error.message }` / `{ error: ...Error.message }`
    // straight from a Supabase response, plus the catch-all uses `error?.message`.
    const rawMessageSites = src.match(/res\.status\(500\)\.json\(\{\s*error:\s*[a-zA-Z]+(Error)?\.message/g) || []
    expect(rawMessageSites.length).toBeGreaterThanOrEqual(4)
    expect(src).toMatch(/error\?\.message \|\| 'Internal server error'/)
  })
})

describe('SEC0905-C-03 — me/threads.ts derives every scope from the verified bearer, never from the request', () => {
  it('learnerId comes only from resolveLearnerId(authUid) — no req.query/req.body learner or enrolment id is ever read', () => {
    const src = read('me/threads.ts')
    expect(src).toMatch(/verifyAuthToken\(req\)/)
    expect(src).toMatch(/resolveLearnerId\(supabase, authResult\.userId\)/)
    // The only client-controlled identifiers accepted anywhere in the file.
    expect(src).not.toMatch(/req\.(query|body)\.(learnerId|learner_id|enrollmentId|enrollment_id)/)
  })
})

describe('SEC0905-C-04 — SEC0901-D-01 is CLOSED: batch-urls.ts now gates on real entitlement', () => {
  it('a gated id is checked against resolveServerCourseAccess(...).canAccess, not just verifyAuthToken', () => {
    const src = read('audio/batch-urls.ts')
    // verifyAuthToken is no longer imported at all — only mentioned in the
    // header comment recording the CLOSED finding's history.
    expect(src).not.toMatch(/import\s*\{[^}]*verifyAuthToken/)
    expect(src).toMatch(/resolveServerCourseAccess/)
    expect(src).toMatch(/access\.canAccess/)
  })

  it('fails CLOSED on an entitlement-lookup error (denies, does not default to allowed)', () => {
    const src = read('audio/batch-urls.ts')
    const catchBlock = src.slice(src.indexOf('entitlement lookup failed'), src.indexOf('entitlement lookup failed') + 300)
    expect(catchBlock).toMatch(/return false/)
  })

  it('batch size and presign TTL stay bounded', () => {
    const src = read('audio/batch-urls.ts')
    expect(src).toMatch(/MAX_IDS_PER_REQUEST\s*=\s*500/)
    expect(src).toMatch(/TTL_SECONDS\s*=\s*300/)
    expect(src).toMatch(/audioIds\.length > MAX_IDS_PER_REQUEST/)
  })
})

describe('SEC0905-C-05 — rebateRegion.ts resolves country server-side, never from a caller header', () => {
  it('resolveTransactionCountry never reads a request header, only the Paddle txn payload / Paddle API', () => {
    const src = read('_utils/rebateRegion.ts')
    expect(src).not.toMatch(/req\.headers/)
    expect(src).not.toMatch(/accept-language/i)
    expect(src).not.toMatch(/x-vercel-ip-country/i)
    expect(src).toMatch(/paddle\.addresses\.get/)
  })

  it('explicitly excludes customData as a signal, because the browser composes it', () => {
    const src = read('_utils/rebateRegion.ts')
    expect(src).toMatch(/never trusted from custom[\s*]+data/i)
    expect(src).not.toMatch(/customData/)
  })

  it('India exclusion is a hardcoded constant, not solely env-configurable', () => {
    const src = read('_utils/rebateRegion.ts')
    expect(src).toMatch(/RULED_EXCLUDED_COUNTRIES = \['IN'\]/)
  })
})

describe('SEC0905-C-06 — player-events.ts acting_learner_id rides the same authz gate as the cookie', () => {
  it('the body claim only overrides identity after isAuthorisedClassLearner, exactly like the cookie path', () => {
    const src = read('player-events.ts')
    const claimIdx = src.indexOf('const claimedId =')
    const authIdx = src.indexOf('isAuthorisedClassLearner(supabase, result.userId, claimedId)')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(authIdx).toBeGreaterThan(claimIdx)
    // Unreachable without a verified bearer resolved earlier in the same function.
    const verifyIdx = src.indexOf('await verifyAuthToken(req)')
    expect(verifyIdx).toBeGreaterThan(-1)
    expect(verifyIdx).toBeLessThan(claimIdx)
  })

  it('isAuthorisedClassLearner only matches a class pseudo-identity, never an arbitrary individual learner id', () => {
    const src = read('player-events.ts')
    expect(src).toMatch(/\.eq\('class_learner_id', classLearnerId\)/)
    expect(src).toMatch(/scope\.classIds\.includes\(cls\.id/)
  })
})

describe('SEC0905-C-07 — paddle-webhook.ts adjustment region check can silently resolve "not excluded"', () => {
  it('CHARACTERIZATION: no transactionId on the adjustment payload skips the address lookup without throwing', () => {
    const src = read('teacher/paddle-webhook.ts')
    const block = src.slice(
      src.indexOf('REGION EXCLUSION mirror'),
      src.indexOf('Resolve teacher via class.teacher_user_id → learners.id.', src.indexOf('REGION EXCLUSION mirror')),
    )
    // `data.transactionId ? ... : null` — a missing id yields `adjustedTxn = null`
    // and `rebateRegionDecision(null)` resolves (not excluded, reason "region
    // unknown") without ever entering the catch/throw path documented as the
    // fail-closed guarantee.
    expect(block).toMatch(/data\.transactionId \? await paddle\.transactions\.get\(data\.transactionId\) : null/)
    expect(block).toMatch(/catch \(e: any\)/)
  })
})
