/**
 * `Vary: Authorization` for the entitlement-personalised content endpoints.
 *
 * WHY THIS EXISTS (2026-09-06, job #676). `/api/courses/:code/bundle` answers
 * `private, max-age=300`. A PRIVATE response is still cacheable — by the
 * browser's own HTTP cache — and Chromium keys that cache by URL alone. The
 * bundle URL is identical for every caller; only the Authorization header
 * decides whether the body is the whole course or the 19-seed free preview.
 * With no `Vary`, nothing told the cache those are different responses, so:
 *
 *   1. the app boots and fetches the bundle before Supabase has restored the
 *      session (or the learner browsed the course signed out) → the server
 *      correctly returns the 19-seed PREVIEW;
 *   2. seconds later the same tab re-fetches the same URL WITH the bearer
 *      token → the browser serves the cached preview body instead;
 *   3. the player builds a 57-round, seed-1-to-19 script from it and writes
 *      that to `ssi-script-cache`, which is keyed by course code with no TTL.
 *
 * From then on the payer's Orange Belt is permanently "not on this device
 * yet" on that course. Reproduced against the deployed dev build on 2026-09-06
 * (`e2e/_676-vary-proof.mjs`): anonymous fetch → 57 legos; the SAME url fetched
 * with a valid premium bearer → 57 legos; the same again with `cache: 'reload'`
 * → 1102 legos. The server was right every time; the cache was the liar.
 *
 * Set this on EVERY response of a handler whose body depends on the caller's
 * entitlement, including the error paths — a cached 403 is the same class of
 * bug in the other direction.
 */
import type { VercelResponse } from '@vercel/node'

export function setEntitlementVary(res: VercelResponse): void {
  // `getHeader` is defensive: several handler tests in this repo pass a stub
  // response that only implements setHeader/status/json, and a caching header
  // is never worth failing a request over.
  const existing = typeof res.getHeader === 'function' ? res.getHeader('Vary') : undefined
  const parts = String(existing ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.some((p) => p.toLowerCase() === 'authorization')) parts.push('Authorization')
  res.setHeader('Vary', parts.join(', '))
}
