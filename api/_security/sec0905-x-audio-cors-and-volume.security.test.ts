/**
 * SEC0905-X-07 — the `/api/audio/*` endpoints versus the new CORS layer.
 * (docs/security-audit-2026-09-05/area-x-coordinator.md)
 *
 * `api/_utils/cors.ts` calls itself "the ONE place that decides whether a
 * cross-origin caller may read an API response". Three places do. The other
 * two are the audio endpoints, and both say `*`.
 *
 * CHARACTERISATION specs — green today, written to go red when the situation
 * changes. Three separate things are pinned, deliberately kept apart because
 * they have three different verdicts:
 *
 *   (a) the wildcard is DEFENSIBLE and this audit does not ask for its
 *       removal — but only while nothing under /api/audio trusts a cookie.
 *       That precondition is what the spec actually guards.
 *   (b) vercel.json sets the SAME header a second time. Latent defect: a
 *       response with two ACAO headers is rejected by every browser, which
 *       would break the very WebView cors.ts was written for.
 *   (c) batch-urls mints up to 500 presigned S3 URLs per call, needs no token
 *       at all on the free/preview path, and has NO rate limit of any kind.
 *       This is the part worth acting on.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = process.cwd()
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const BATCH = 'api/audio/batch-urls.ts'
const PROXY = 'api/audio/[audioId].ts'

describe('SEC0905-X-07(a) — the wildcard, and the precondition that makes it safe', () => {
  it('CHARACTERISATION: neither audio endpoint routes through the new cors.ts layer', () => {
    // 32 handlers adopted applyCors. These two did not. Goes red if they do.
    expect(read(BATCH)).not.toContain('applyCors')
    expect(read(PROXY)).not.toContain('applyCors')
  })

  it('CHARACTERISATION: both hand-roll `Access-Control-Allow-Origin: *`', () => {
    expect(read(BATCH)).toContain("res.setHeader('Access-Control-Allow-Origin', '*')")
    expect(read(PROXY)).toContain("res.setHeader('Access-Control-Allow-Origin', '*')")
  })

  it('SECURE-ASSERTION: the wildcard is safe only because no audio endpoint trusts a cookie', () => {
    // This is the ENTIRE argument. `*` plus `Allow-Headers: Authorization`
    // costs nothing while there is no ambient credential to send. The day an
    // audio endpoint reads req.headers.cookie, it becomes a live hole — so
    // that, not the wildcard, is what is pinned here.
    for (const f of [BATCH, PROXY]) {
      const src = read(f)
      expect(src).not.toMatch(/req\.headers\.cookie/)
      expect(src).not.toMatch(/\bcookies?\s*\[/)
      expect(src).not.toContain('Access-Control-Allow-Credentials')
    }
  })

  it('documents that batch-urls additionally allows the Authorization request header', () => {
    expect(read(BATCH)).toContain("'Access-Control-Allow-Headers', 'Content-Type, Authorization'")
  })
})

describe('SEC0905-X-07(b) — vercel.json sets the same header a second time', () => {
  const cfg = JSON.parse(read('vercel.json')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[]
  }

  it('CHARACTERISATION: a platform header rule duplicates ACAO on /api/audio/(.*)', () => {
    const rule = cfg.headers.find((h) => h.source === '/api/audio/(.*)')
    expect(rule).toBeDefined()
    const acao = rule!.headers.find((h) => h.key === 'Access-Control-Allow-Origin')
    expect(acao?.value).toBe('*')
    // …and the handlers set it too (asserted above). Delete the vercel.json
    // rule — the handlers are the ones that answer OPTIONS — and this goes red.
  })
})

describe('SEC0905-X-07(c) — 500 presigns per call, no token needed, no rate limit', () => {
  const src = read(BATCH)

  it('CHARACTERISATION: the batch cap is 500 and the presign TTL is 300s', () => {
    expect(src).toContain('const MAX_IDS_PER_REQUEST = 500')
    expect(src).toContain('const TTL_SECONDS = 300')
  })

  it('CHARACTERISATION: there is no rate limit, throttle or bucket of any kind', () => {
    // The repo HAS this machinery and does not use it here. Wire in
    // mintRateLimit / codeAttemptThrottle and this goes red — which is the
    // signal that the finding is closed.
    expect(src).not.toMatch(/mintRateLimit|codeAttemptThrottle|rateLimit|throttle/i)
  })

  it('SECURE-ASSERTION: the premium entitlement gate IS present (SEC0901-D-01 stayed fixed)', () => {
    // The volume finding must not be read as an entitlement finding. Paid
    // audio is resolved server-side and fails closed; that is correct and is
    // re-asserted here so a future reader does not conflate the two.
    expect(src).toContain('resolveServerCourseAccess')
    expect(src).toContain('resolveAudioEntitlement')
  })
})
