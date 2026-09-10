/**
 * Is this router error a route chunk that could not be loaded?
 *
 * A lazily-imported route lives in its own hashed chunk. After a deploy the
 * running tab still holds the OLD chunk names, and Vercel answers an unknown
 * `/assets/*.js` with the SPA fallback — `200 text/html` — rather than a 404.
 * So the browser never reports a fetch failure: it rejects the module on MIME
 * grounds, and vue-router surfaces the wrapped rejection as
 * `Couldn't resolve component "default" at "/admin"`.
 *
 * That message was NOT in the original list, which only knew the fetch-level
 * wordings. On this host the fetch-level wordings are the ones that never
 * fire — so recovery never fired either, and a tab one deploy behind simply
 * abandoned the navigation in silence. Tapping "Platform admin" in Settings
 * on 2026-09-08 did nothing at all for exactly this reason: reproduced on
 * staging by serving the admin chunk as the SPA fallback, the URL never
 * changed and the settings overlay stayed open.
 *
 * Matching is on the message text because that is all vue-router gives us.
 * A false positive costs one reload of the page the user was already asking
 * for, guarded to once per path per session by the caller; a false negative
 * costs a dead door with no way out.
 */
const CHUNK_LOAD_FAILURE_PATTERNS = [
  // Chrome / Firefox / Safari, fetch level — a genuine 404 or offline
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  // Chrome, MIME level — the SPA fallback served HTML for a missing chunk
  'failed to load module script',
  'expected a javascript-or-wasm module script',
  // Safari, same cause, its own wording
  'is not a valid javascript mime type',
  // vue-router's own wrapper around any of the above, and the one this host
  // actually produces
  "couldn't resolve component",
]

export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return CHUNK_LOAD_FAILURE_PATTERNS.some((p) => msg.includes(p))
}
