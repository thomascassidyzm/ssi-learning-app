/**
 * Boot heal ladder — decision logic for the inline watchdog in index.html.
 *
 * The watchdog itself must be plain, import-free script (it has to run even
 * when every module fetch has failed), so it cannot import this file. This
 * module is the importable, unit-tested twin of that inline logic — keep the
 * two in lockstep by hand; this is the source of truth for what the numbers
 * and cache-preserve list mean.
 */

/** Cache Storage entries the heal ladder must never touch. `ssi-auth-handoff`
 * carries the iOS Safari → installed-PWA sign-in bridge (utils/authHandoff.ts)
 * across the exact SW-unregister + cache-wipe this ladder performs. */
export const PRESERVE_CACHE_NAMES = ['ssi-auth-handoff']

/** Hard deadline on the heal's SW-unregister + cache-clear work. On iOS
 * standalone PWAs those promises can simply never settle (observed in the
 * founder's stuck "Updating the app…" field report, 2026-07-30) — the heal
 * reloads when the FIRST of {cleanup done, this deadline} arrives. */
export const HEAL_DEADLINE_MS = 4000

/** How long after calling location.reload() the watchdog waits before
 * concluding the reload silently didn't take (a known iOS-standalone wedge)
 * and painting the "Update ready — tap to relaunch" button. The tap is a
 * user gesture, which is exactly what unsticks a wedged webview. If the
 * reload DID take, the page unloaded and this timer never fires. */
export const RELOAD_WEDGE_MS = 2500

export type HealDecision =
  | { action: 'heal'; nextAttempts: number }
  | { action: 'floor' }

/**
 * A boot failure (fast-path script error or slow-path 15s timeout) always
 * calls this. `currentAttempts` is read from sessionStorage so it survives
 * the reload but not a fresh tab/session — each new session gets its own
 * two auto-heals before the floor, so a genuinely broken deploy can't
 * reload-loop a learner forever.
 */
export function nextHealDecision(currentAttempts: number, maxAttempts: number): HealDecision {
  if (currentAttempts >= maxAttempts) {
    return { action: 'floor' }
  }
  return { action: 'heal', nextAttempts: currentAttempts + 1 }
}

/**
 * Which Cache Storage entries a heal (or the floor's "Fix the app" button,
 * or the /reset alias) should delete. IndexedDB and localStorage are never
 * passed through this function — boot failures live in HTML/JS/CSS, which
 * live exclusively in these caches; audio downloads and progress are
 * innocent by construction.
 */
export function cachesToClear(allCacheNames: string[], preserve: string[] = PRESERVE_CACHE_NAMES): string[] {
  const preserveSet = new Set(preserve)
  return allCacheNames.filter((name) => !preserveSet.has(name))
}

/** First-ever visits (no SW yet) must never be watched — a slow first load
 * over 2G is not a wedge. */
export function shouldArmBootWatchdog(hasServiceWorkerController: boolean): boolean {
  return hasServiceWorkerController === true
}

/** `vite:preloadError` fires on a stale-chunk dynamic import after a deploy
 * rotates hashed chunks mid-session. Reload exactly once per session — a
 * second failure means something else is wrong and reload-looping won't fix it. */
export function shouldReloadForPreloadError(alreadyReloadedThisSession: boolean): boolean {
  return alreadyReloadedThisSession !== true
}
