/**
 * SEC0901-D — Area D (2026-09-01 security audit): edge/CDN caching on the
 * course-content endpoints.
 *
 * Source-based structural checks, in the house idiom (compare
 * `roundMap.security.test.ts`). Live behaviour was independently verified
 * against the deployed `dev` branch (ssi-learning-app-git-dev-zenjin.vercel.app)
 * during this audit — see docs/security-audit-2026-09-01/area-d-cache-and-entitlement.md
 * for the raw `curl` transcripts. That live probe confirmed:
 *   - `round-map` (`public, max-age=0, must-revalidate` as sent, but Vercel's
 *     edge honours the source's `s-maxage=31536000` internally): x-vercel-cache
 *     goes MISS → HIT → HIT across repeat calls.
 *   - `cycles.ts` within the universal preview window, anonymous: MISS → HIT →
 *     HIT. The same URL with ANY Authorization header (even an invalid bearer):
 *     x-vercel-cache: BYPASS, `private, max-age=60` — Vercel's platform-level
 *     behaviour of never caching a request that carries Authorization is the
 *     second half of the belt-and-braces here, on top of the app's own
 *     `isAnonymousRequest` gate.
 *   - `cycles.ts` past the preview ceiling, anonymous: 403, `no-store`, MISS —
 *     never enters the shared cache.
 *   - `bundle.ts` (main + head-probe): both come back `private, ...` and
 *     x-vercel-cache: MISS on every repeat call — Vercel strips the `s-maxage`/
 *     `stale-while-revalidate` tokens the source sets alongside `private` and
 *     does not cache the response at its edge. That is Vercel's documented
 *     behaviour (a `private` token anywhere in Cache-Control suppresses shared
 *     caching regardless of any `s-maxage` also present), not an app-level
 *     control — which is exactly why this suite pins the app-level invariant
 *     (bundle.ts must ALWAYS emit `private` on its personalised bodies) rather
 *     than relying on the platform behaviour alone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

const cycles = src('[code]/cycles.ts')
const bundle = src('[code]/bundle.ts')
const audioAccess = src('../_utils/audioAccess.ts')

describe('SEC0901-D: cycles.ts R1 edge-cache — the two conditions both hold in source', () => {
  it('the public-cache branch requires BOTH no-Authorization AND a window at/below the preview ceiling', () => {
    // The exact boolean gate the handler computes right before setHeader.
    expect(cycles).toContain('const isAnonymousRequest = !req.headers.authorization')
    expect(cycles).toMatch(
      /const windowIsUniversal =\s*\n?\s*maxEmittedSeed > 0 && maxEmittedSeed <= PREMIUM_PREVIEW_MAX_SEED/
    )
    expect(cycles).toMatch(
      /isAnonymousRequest && windowIsUniversal\s*\n?\s*\?\s*'public, s-maxage=300, stale-while-revalidate=3600'\s*\n?\s*:\s*'private, max-age=60'/
    )
  })

  it('every early-return path (404/403/500) sets no-store, so an error is never cached', () => {
    // Every res.setHeader('Cache-Control', ...) call that precedes the final
    // decision must be 'no-store' — an error response entering a shared cache
    // (even briefly) would serve a 403/404 to a caller who might otherwise
    // have succeeded, or worse, would need to be distinguished from a
    // deliberate paywall response by callers that can't see the body.
    const literalHeaderCalls = [...cycles.matchAll(/res\.setHeader\('Cache-Control', '([^']+)'\)/g)].map((m) => m[1])
    // Every literal (non-ternary) Cache-Control set in this file is an
    // early-return error path — the one success-path header is built from
    // the isAnonymousRequest/windowIsUniversal ternary, not a plain literal.
    expect(literalHeaderCalls.length).toBeGreaterThan(0)
    for (const v of literalHeaderCalls) {
      expect(v, `expected an early-return Cache-Control literal to be 'no-store', got '${v}'`).toBe('no-store')
    }
  })

  it('PREMIUM_PREVIEW_MAX_SEED is imported from the shared module, not re-declared', () => {
    // A local re-declaration here could drift from @ssi/core's belt table
    // (the value the actual entitlement decision is built on) without any
    // test noticing. cycles.ts must import the one true constant.
    expect(cycles).toMatch(/import\s*\{[^}]*PREMIUM_PREVIEW_MAX_SEED[^}]*\}\s*from\s*'\.\.\/\.\.\/_utils\/audioAccess'/)
    expect(cycles).not.toMatch(/const PREMIUM_PREVIEW_MAX_SEED\s*=/)
  })

  it("audioAccess's PREMIUM_PREVIEW_MAX_SEED is pinned to the belt this comment claims (Yellow = 19)", () => {
    // The comment says "keep in sync with @ssi/core PREMIUM_PREVIEW_MAX_SEED".
    // That sync is manual (a literal, not an import — see the comment in
    // audioAccess.ts itself explaining why). This test is the tripwire: a
    // change to @ssi/core's BELT_MAX_SEEDS.yellow without a matching edit
    // here would silently widen or shrink the free-preview / paywall boundary
    // that gates both the edge-cache decision and every audio entitlement
    // check on this surface.
    expect(audioAccess).toMatch(/export const PREMIUM_PREVIEW_MAX_SEED = 19/)
  })
})

describe('SEC0901-D: bundle.ts — the personalised sibling must never advertise a shared-cacheable body', () => {
  it('the full (non-head-probe) bundle response always includes the private token', () => {
    // bundle.ts's main response body differs by entitlement (previewOnly,
    // scopedLegoRows/scopedPhraseRows, pods only for entitled callers) and has
    // NO anonymous/universal-window carve-out the way cycles.ts does — so it
    // must be unconditionally private. It is, today; this pins it.
    const idx = bundle.indexOf("'private, max-age=300, s-maxage=86400, stale-while-revalidate=86400'")
    expect(idx, 'bundle.ts must set an explicit private Cache-Control on its personalised body').toBeGreaterThan(0)
  })

  it('the head-probe response is also private, even though its payload is course-level (non-personal)', () => {
    // contentVersion/scriptShapeVersion are NOT gated by entitlement (the
    // handler's own comment says so), so this could safely be public+s-maxage
    // the way cycles.ts's R1 window is. It isn't — it is 'private, max-age=60,
    // s-maxage=300, stale-while-revalidate=300' — which is conservative
    // (leaves perf on the table) but not a security defect. This test exists
    // to make a future change to that header a deliberate one: if someone
    // widens it to `public`, they should also re-verify (as this audit did
    // live) that Vercel's edge really does strip s-maxage when `private` is
    // present, rather than assuming it from this file alone.
    expect(bundle).toContain("res.setHeader('Cache-Control', 'private, max-age=60, s-maxage=300, stale-while-revalidate=300')")
  })

  it('bundle.ts never emits a bare `public` Cache-Control anywhere', () => {
    expect(bundle).not.toMatch(/Cache-Control',\s*'public/)
  })
})
