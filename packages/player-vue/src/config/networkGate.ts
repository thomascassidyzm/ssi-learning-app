/**
 * networkGate — the one place that decides how long the learner waits for the
 * network before we play what we already have.
 *
 * Tom's ruling, 2026-08-15:
 *
 *   "The heuristic is that the app should always play whatever it has. It
 *    should never allow a weak Internet connection to block the learner. …
 *    Play what you have. Verify access as and when you can. Never as a gate."
 *
 * Three things live here, and nothing else:
 *
 * 1. ONE timeout constant for every network call that sits between boot and
 *    first audio. Not five bespoke numbers in five files — one number, so
 *    "how long can a learner be made to wait" is a single decision.
 *
 * 2. `withNetworkTimeout` — race a promise against that budget and get a
 *    sentinel back instead of a hang. Callers fall to cache on the sentinel.
 *
 * 3. A `networkPresumedDown` signal, which is the honest replacement for
 *    `navigator.onLine`. `navigator.onLine` lies on weak signal and captive
 *    portals — the codebase already says so in two places — so we do not ask
 *    it whether the network works. We OBSERVE: a critical-path call that timed
 *    out means the network is not usable right now, whatever the browser
 *    claims, and cached content should be served. Any critical-path success
 *    clears it, as does a real `online` event.
 *
 * The deliberate offline toggle is NOT consulted here, by design. Since this
 * ruling the toggle expresses INTENT ("don't spend my data") and no longer
 * decides whether cached content is allowed to play. A learner who forgot to
 * flip it gets exactly the same playback behaviour as one who remembered.
 */

/**
 * How long anything on the boot→first-audio path may make the learner wait
 * before we stop waiting and serve the cache.
 *
 * 2500ms is chosen to sit above a normal cold mobile round-trip (a warm Lambda
 * answers /cycles in ~150-300ms; a cold one and a bad handshake together land
 * comfortably under 2s) and well below the point where a learner reads the
 * screen as broken. It replaces a 9000ms boot budget that let a weak signal
 * hold the player for nine seconds before falling back to a slow path that was
 * itself unbounded.
 */
export const CRITICAL_PATH_TIMEOUT_MS = 2500

/**
 * Background work — prefetch tiers, revalidation, telemetry — is NOT on the
 * critical path and gets a longer leash, because nothing is waiting on it.
 * It still needs a bound so a fire-and-forget fetch can't leak forever.
 */
export const BACKGROUND_FETCH_TIMEOUT_MS = 9000

/** Returned instead of a value when the network budget expired. */
export const NETWORK_TIMEOUT = Symbol('ssi-network-timeout')
export type NetworkTimeout = typeof NETWORK_TIMEOUT

/**
 * How long an observed stall keeps us in "presume the network is down" mode.
 * Short enough that a learner walking back into signal recovers quickly on
 * their own; long enough that a whole boot sequence behaves consistently
 * rather than half the calls waiting and half not.
 */
const STALL_TTL_MS = 60_000

let stalledAt = 0

/**
 * Record that a critical-path network call timed out or failed outright.
 * This is the evidence `isNetworkPresumedDown()` reports on.
 */
export function markNetworkStalled(): void {
  stalledAt = Date.now()
}

/** Record that a critical-path network call succeeded — the stall is over. */
export function clearNetworkStalled(): void {
  stalledAt = 0
}

/**
 * True when we have OBSERVED the network failing to serve the critical path
 * recently. Deliberately not a connectivity predicate: it never asks
 * `navigator.onLine`, it reports what actually happened.
 */
export function isNetworkPresumedDown(): boolean {
  if (!stalledAt) return false
  if (Date.now() - stalledAt > STALL_TTL_MS) {
    stalledAt = 0
    return false
  }
  return true
}

/**
 * The question every cache-first branch should ask instead of
 * `navigator.onLine === false`.
 *
 * `navigator.onLine === false` is trusted in ONE direction only: when the
 * browser says it is offline it really is (airplane mode), so skip the doomed
 * fetch. When it says it is online we do not believe it — we defer to what we
 * have observed.
 */
export function isOfflineish(): boolean {
  const browserSaysOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  return browserSaysOffline || isNetworkPresumedDown()
}

/**
 * Race `promise` against the critical-path budget.
 *
 * Resolves to the value, or to `NETWORK_TIMEOUT` if the budget expired — it
 * never rejects for the timeout, so callers read as
 * `const r = await withNetworkTimeout(p); if (r === NETWORK_TIMEOUT) useCache()`.
 * A rejection from `promise` itself still propagates: a real error is the
 * caller's to interpret (a 403 is not the same as a hang), and the caller is
 * responsible for falling to cache on it.
 *
 * Timing out marks the network stalled; completing clears it. That is the only
 * place the stall signal is written on the happy path, so the signal always
 * reflects real critical-path observations rather than guesses.
 */
export async function withNetworkTimeout<T>(
  // PromiseLike, not Promise: Supabase's query builders are thenables rather
  // than real promises, and they are precisely the unbounded calls this exists
  // to bound.
  promise: PromiseLike<T>,
  ms: number = CRITICAL_PATH_TIMEOUT_MS,
): Promise<T | NetworkTimeout> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      promise,
      new Promise<NetworkTimeout>((resolve) => {
        timer = setTimeout(() => resolve(NETWORK_TIMEOUT), ms)
      }),
    ])
    if (result === NETWORK_TIMEOUT) markNetworkStalled()
    else clearNetworkStalled()
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Wire the browser's own reconnect event to clear the stall signal, so a
 * learner who walks back into signal gets live content again without waiting
 * out the TTL. Idempotent; safe to call from app init.
 */
let onlineWired = false
export function wireNetworkRecovery(): void {
  if (onlineWired || typeof window === 'undefined') return
  onlineWired = true
  window.addEventListener('online', clearNetworkStalled)
}

/** Test seam — reset module state between cases. */
export function __resetNetworkGateForTests(): void {
  stalledAt = 0
}
