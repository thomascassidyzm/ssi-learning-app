/**
 * LOAD TIME 2026-09-17 (job #117). Tom: "the app is taking a very long time to
 * load. Is it looking to download everything every time?"
 *
 * Vercel's default for Vite static output is `public, max-age=0,
 * must-revalidate`, and vercel.json never overrode it — so a learner whose
 * browser already held the entire app still opened one conditional request per
 * hashed chunk, on every single load, before anything rendered. Measured on
 * staging: /assets/index-*.js, vendor-vue, core and every font all carried it.
 *
 * The bundle file names ARE content hashes, so a changed chunk is a different
 * URL and a year of `immutable` cannot serve stale code. The unhashed static
 * dirs (/fonts, /design, /icons) get a month with ordinary revalidation after
 * it, never `immutable`, because their names do not change when they do.
 *
 * What must NOT gain a long max-age: index.html, sw.js, manifest.webmanifest
 * and version.json. Those are the entry points a new deploy propagates
 * through; cache one of them and the app stops being able to update itself.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(__dirname, '../../../..')

interface Rule { source: string; headers: { key: string; value: string }[] }

function cacheControlFor(source: string): string | undefined {
  const cfg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'vercel.json'), 'utf8')) as { headers?: Rule[] }
  const rule = (cfg.headers ?? []).find((r) => r.source === source)
  return rule?.headers.find((h) => h.key.toLowerCase() === 'cache-control')?.value
}

describe('vercel.json — static asset caching', () => {
  it('serves the content-hashed bundles immutably for a year', () => {
    const cc = cacheControlFor('/assets/(.*)')
    expect(cc, '/assets/(.*) must carry a Cache-Control header').toBeDefined()
    expect(cc).toContain('immutable')
    expect(cc).toContain('max-age=31536000')
  })

  it.each(['/fonts/(.*)', '/design/(.*)', '/icons/(.*)'])(
    'caches %s for a month, but never immutably — these names are not content hashes',
    (source) => {
      const cc = cacheControlFor(source)
      expect(cc, `${source} must carry a Cache-Control header`).toBeDefined()
      expect(cc).toContain('max-age=2592000')
      expect(cc).not.toContain('immutable')
    },
  )

  it('leaves the entry points revalidating, so a deploy still reaches a learner', () => {
    // version.json is explicitly no-store; the rest inherit Vercel's
    // max-age=0, must-revalidate default by carrying no rule of their own.
    expect(cacheControlFor('/version.json')).toBe('no-store')
    for (const source of ['/(.*)', '/index.html', '/sw.js', '/manifest.webmanifest']) {
      const cc = cacheControlFor(source)
      expect(cc === undefined || cc.includes('max-age=0'), `${source} must not be long-cached`).toBe(true)
    }
  })
})
