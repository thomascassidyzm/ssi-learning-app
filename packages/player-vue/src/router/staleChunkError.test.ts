/**
 * THE DEAD DOOR (Tom, 2026-09-08): "the link to the platform admin doesn't
 * work. The link just doesn't open anything."
 *
 * Reproduced on staging as a real ssi_admin, by serving the /admin route's
 * chunk the way the host actually serves a chunk that is no longer there.
 * Vercel answers an unknown /assets/*.js with the SPA fallback — 200
 * text/html — so the browser rejects the module on MIME grounds and
 * vue-router reports the wrapped rejection as:
 *
 *   Error: Couldn't resolve component "default" at "/admin"
 *
 * The recovery in router/index.ts matched three fetch-level wordings, none of
 * which this host ever produces, so it never fired: the URL stayed put, the
 * settings overlay stayed open, nothing happened. These are the exact strings
 * that probe captured, plus the wordings the other engines use for the same
 * cause.
 */
import { describe, it, expect } from 'vitest'
import { isChunkLoadError } from './staleChunkError'

const REAL_MESSAGES = [
  // Captured verbatim from staging, 2026-09-08, admin chunk served as HTML
  'Couldn\'t resolve component "default" at "/admin"',
  'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.',
  // The fetch-level wordings, which the original list already knew
  'Failed to fetch dynamically imported module: https://staging.saysomethingin.app/assets/AdminContainer-BnWijSnj.js',
  'error loading dynamically imported module',
  'Importing a module script failed.',
  // Safari, same cause
  "Refused to execute script because its MIME type ('text/html') is not a valid JavaScript MIME type.",
]

describe('the stale-chunk detector', () => {
  it.each(REAL_MESSAGES)('recognises %s', (msg) => {
    expect(isChunkLoadError(new Error(msg))).toBe(true)
  })

  it('takes a bare string as well as an Error', () => {
    expect(isChunkLoadError('Couldn\'t resolve component "default" at "/admin"')).toBe(true)
  })

  it('leaves an ordinary navigation error alone, so no reload loop is invented', () => {
    expect(isChunkLoadError(new Error('Redirected when going from "/" to "/admin"'))).toBe(false)
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
