/**
 * authHandoff — carry a signed-in session across the iOS Safari →
 * Home Screen PWA boundary.
 *
 * iOS isolates cookies / localStorage / IndexedDB between Safari and a
 * standalone (Home Screen) web app, so the Supabase session a user
 * established in Safari is invisible to the installed app — they land on
 * the sign-in screen after "Add to Home Screen". The one thing iOS DOES
 * share across that boundary is CacheStorage (and the SW registration).
 *
 * So: Safari writes the current session tokens into a dedicated cache;
 * on first standalone launch with no local session, the installed app
 * reads them once, restores the session, and deletes the bridge entry.
 * If anything fails (no entry, eviction, expired refresh token), callers
 * fall back to the normal sign-in flow — this is strictly never worse
 * than the previous behaviour.
 *
 * Security: CacheStorage is same-origin, the same exposure surface as the
 * localStorage token Supabase already persists — no new blast radius.
 *
 * NOTE: the cache name `ssi-auth-handoff` must be in App.vue's
 * invalidateStaleCaches PRESERVE set, or a deploy would wipe the bridge.
 */

const CACHE_NAME = 'ssi-auth-handoff'
// Synthetic same-origin key — never hits the network, just a cache handle.
const HANDOFF_KEY = '/__ssi_auth_handoff__'
// Ignore a bridge older than this (stale tokens / abandoned installs).
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

export interface HandoffTokens {
  access_token: string
  refresh_token: string
}

/** True when running as an installed/standalone PWA (iOS or Chromium). */
export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (navigator as { standalone?: boolean }).standalone === true
    )
  } catch {
    return false
  }
}

/**
 * Seed (or clear) the hand-off bridge. Called from the BROWSER context
 * (Safari) whenever auth state is known. Passing null clears it — so a
 * sign-out can't leak a session into a future install. No-ops in
 * standalone mode (the installed app is the consumer, not the source).
 */
export async function writeAuthHandoff(tokens: HandoffTokens | null): Promise<void> {
  if (!('caches' in window)) return
  if (isStandalone()) return
  try {
    const cache = await caches.open(CACHE_NAME)
    if (!tokens?.access_token || !tokens?.refresh_token) {
      await cache.delete(HANDOFF_KEY)
      return
    }
    const body = JSON.stringify({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      ts: Date.now(),
    })
    await cache.put(
      HANDOFF_KEY,
      new Response(body, { headers: { 'Content-Type': 'application/json' } }),
    )
  } catch {
    // best-effort; never block auth on a cache write
  }
}

/**
 * Read the hand-off tokens and delete the entry (consume-once). Returns
 * null if there's nothing usable. Intended to run only on first
 * standalone launch when no local session exists.
 */
export async function readAndConsumeAuthHandoff(): Promise<HandoffTokens | null> {
  if (!('caches' in window)) return null
  try {
    const cache = await caches.open(CACHE_NAME)
    const res = await cache.match(HANDOFF_KEY)
    // Consume regardless of validity so a stale token isn't left behind.
    await cache.delete(HANDOFF_KEY)
    if (!res) return null
    const data = (await res.json()) as Partial<HandoffTokens> & { ts?: number }
    if (!data?.access_token || !data?.refresh_token) return null
    if (typeof data.ts === 'number' && Date.now() - data.ts > MAX_AGE_MS) return null
    return { access_token: data.access_token, refresh_token: data.refresh_token }
  } catch {
    return null
  }
}
