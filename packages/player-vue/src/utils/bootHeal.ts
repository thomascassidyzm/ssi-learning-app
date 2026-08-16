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

/**
 * A boot failure while the network is missing is a missing network, not a
 * broken deploy — and the heal ladder deletes the SW + precache, i.e. the
 * only thing that lets the app work offline at all. Found 2026-07-31 chasing
 * the always-play invariant: airplane-mode cold start served the precached
 * shell fine, then the fonts.googleapis stylesheet failed (cross-origin,
 * never cached), the fast-path watchdog "healed", and the SW-less reload
 * landed on the browser "No internet" page with every cache gone.
 *
 * This used to take `navigator.onLine`, which is why it did not save Tom on a
 * weak cellular signal (2026-08-16, white screen). Lie-fi is not offline: the
 * radio is up, `navigator.onLine` stays TRUE, and requests are accepted and
 * then hang instead of failing. So the old guard read "online", concluded the
 * deploy was broken, deleted the service worker and the precache, and reloaded
 * into a network that could not serve index.html — a white screen that
 * survives reloads, because there is no longer anything to serve it from.
 *
 * The only honest test is whether the network ACTUALLY ANSWERED — a cheap
 * same-origin request that came back inside a short deadline. A claim of being
 * online is not evidence; a response is.
 */
export function shouldHealOnBootFailure(networkAnswered: boolean): boolean {
  return networkAnswered === true
}

/**
 * How long a returning learner's boot may stall before we stop waiting for the
 * network and start the copy of the app we already hold. A healthy boot mounts
 * in ~150ms, and airplane mode — the experience Tom calls good — reaches
 * ready-to-play in "3/4 secs", so 3s spends nothing a healthy network needs
 * while staying inside the budget he already accepts.
 */
export const CACHED_SHELL_FALLBACK_MS = 3000

/**
 * The weak-signal recovery, and the reason the 2026-08-16 white screen was
 * possible at all. Navigations are NetworkFirst (so fresh deploys propagate),
 * and on a weak signal an 11 KB index.html can squeak through inside the
 * service worker's 3s navigation timeout while the 400 KB of hashed chunks it
 * names cannot. Those sub-resource fetches have NO timeout: the shell paints
 * and the app never mounts. Reproduced in e2e/lie-fi-shell-boot-probe.mjs.
 *
 * So when the boot stalls and we hold a precached shell, we swap that shell in
 * rather than keep waiting — its chunk hashes are precached by construction,
 * so it mounts immediately. One build behind is not a cost a learner can
 * detect; a white screen is. Fresh code still arrives through the normal
 * service-worker update cycle on a network that can carry it.
 *
 * The guard is "already swapped WITHOUT then reaching mount", not "already
 * swapped this session": it exists only to stop a cached shell that also fails
 * from swapping itself in forever, so a successful boot clears it. A learner
 * who reloads twice on a weak signal must be rescued twice — otherwise the
 * second reload is a white screen again, which is exactly the "permanent" in
 * Tom's field report.
 */
export function shouldServeCachedShell(
  booted: boolean,
  hasCachedShell: boolean,
  alreadySwappedWithoutBooting: boolean,
): boolean {
  if (booted === true) return false
  if (hasCachedShell !== true) return false
  return alreadySwappedWithoutBooting !== true
}

/**
 * How long the swap guard holds. A cached shell that also fails to mount would
 * re-swap in seconds, so a short window stops the loop; anything later is a
 * learner reloading again on the same bad signal, and they must be rescued
 * again rather than handed the white screen back.
 */
export const SWAP_GUARD_MS = 30000

/**
 * Whether a previous swap still suppresses the next one.
 *
 * This is time-based rather than cleared-on-success ALONE because of the CSP:
 * `vercel.json` pins a sha256 hash of the inline watchdog, so after a real
 * deploy the CACHED shell's inline script hashes differently from the live
 * header and is blocked in the swapped-in document. The app still mounts (its
 * entry is an external module, allowed by script-src 'self') — but the blocked
 * watchdog cannot clear its own guard. The guard therefore has to expire on
 * its own, and clearing on a successful boot is the belt to this braces.
 */
export function isSwapGuardActive(swappedAtMs: number | null, nowMs: number, guardMs = SWAP_GUARD_MS): boolean {
  if (swappedAtMs === null || !Number.isFinite(swappedAtMs)) return false
  return nowMs - swappedAtMs < guardMs
}

/**
 * Fast-path scope: only SAME-ORIGIN script/link failures indicate a broken
 * deploy — the entry graph lives entirely on our origin (it's what the SW
 * precaches). A cross-origin resource failing (Google Fonts down, an
 * ad-blocker, a captive portal) must never nuke the install.
 */
export function isDeployFatalResourceUrl(resourceUrl: string, origin: string): boolean {
  return resourceUrl.indexOf(origin + '/') === 0
}

/** `vite:preloadError` fires on a stale-chunk dynamic import after a deploy
 * rotates hashed chunks mid-session. Reload exactly once per session — a
 * second failure means something else is wrong and reload-looping won't fix it. */
export function shouldReloadForPreloadError(alreadyReloadedThisSession: boolean): boolean {
  return alreadyReloadedThisSession !== true
}
