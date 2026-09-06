/**
 * #676 — the entitlement-personalised content endpoints must carry
 * `Vary: Authorization`.
 *
 * Without it, a cache keyed on the URL alone (the browser's own HTTP cache —
 * these bodies go out `private`, which is cacheable there) can serve the
 * anonymous 19-seed free-preview body to the very next request for the same
 * URL carrying a premium bearer token. Proven against the deployed dev build on
 * 2026-09-06: anonymous `/api/courses/zho_for_eng/bundle` → 57 legos; the same
 * URL fetched seconds later WITH a valid premium token → 57 legos; the same
 * again with `cache: 'reload'` → 1102 legos.
 *
 * Downstream that preview body is written into `ssi-script-cache`, which is
 * keyed by course code and has no TTL, so the payer's Orange Belt stays
 * unreachable on that course permanently.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { setEntitlementVary } from '../_utils/entitlementVary'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

/** Minimal VercelResponse stand-in — only the two header methods are used. */
function fakeRes(initial?: Record<string, string>) {
  const headers = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getHeader: (k: string) => headers.get(k),
    setHeader: (k: string, v: string) => { headers.set(k, v) },
    read: (k: string) => headers.get(k),
  }
}

describe('setEntitlementVary', () => {
  it('adds Authorization when there is no Vary yet', () => {
    const res = fakeRes()
    setEntitlementVary(res as never)
    expect(res.read('Vary')).toBe('Authorization')
  })

  it('preserves an existing Vary and appends Authorization once', () => {
    const res = fakeRes({ Vary: 'Origin' })
    setEntitlementVary(res as never)
    setEntitlementVary(res as never)
    expect(res.read('Vary')).toBe('Origin, Authorization')
  })

  it('is idempotent and case-insensitive about an already-present Authorization', () => {
    const res = fakeRes({ Vary: 'authorization' })
    setEntitlementVary(res as never)
    expect(res.read('Vary')).toBe('authorization')
  })
})

describe('#676: every entitlement-personalised course endpoint sets it', () => {
  // These three slice or refuse their body based on resolveServerCourseAccess,
  // and all three answer with a cacheable Cache-Control. round-map is NOT here
  // on purpose: it reads no auth at all, so its body cannot vary by caller.
  const handlers = ['[code]/bundle.ts', '[code]/cycles.ts', '[code]/infplay-cycles.ts']

  for (const rel of handlers) {
    it(`${rel} imports and calls setEntitlementVary before any body is written`, () => {
      const text = src(rel)
      expect(text).toContain("from '../../_utils/entitlementVary'")
      expect(text).toContain('setEntitlementVary(res)')
      // It must run at the top of the handler, not on one branch — the error
      // paths are cacheable responses too.
      const corsAt = text.indexOf("applyCors(req, res, { methods: 'GET' })")
      const varyAt = text.indexOf('setEntitlementVary(res)')
      const firstStatus = text.indexOf('res.status(')
      expect(corsAt).toBeGreaterThan(-1)
      expect(varyAt).toBeGreaterThan(corsAt)
      expect(varyAt).toBeLessThan(firstStatus)
    })

    it(`${rel} still slices on the server, so the header is a cache fix and not the paywall`, () => {
      expect(src(rel)).toContain('resolveServerCourseAccess')
    })
  }
})
