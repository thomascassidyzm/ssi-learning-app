/**
 * Offline-lease config + pure helpers — the 30-day "Spotify handshake".
 *
 * Downloads are a PREMIUM perk (gated at the trigger in LearningPlayer). On top
 * of that gate, downloaded content carries a LEASE: a record of the last time we
 * confirmed — online, against the server — that the user is still entitled. The
 * app re-validates online; every successful check slides the lease +30 days. If
 * the user never comes online (or the subscription has genuinely lapsed) for 30
 * days, offline playback LOCKS — the bytes stay on disk, one reconnect unlocks.
 *
 * Design notes (the cardinal sins, from build-plan §2B):
 *   - Locking an ACTIVE subscriber is the cardinal sin. Renewal must FAIL-OPEN on
 *     infra failure (network/5xx → keep the existing expiry, retry later) and
 *     fail-closed only on an explicit server `{ valid:false }` (sub genuinely
 *     lapsed) — and even then GRACEFULLY: the lapsed-but-not-yet-expired lease
 *     runs out its remaining days, it does not instant-cut (§5 default a).
 *   - Clock-tamper is mitigated, not eliminated: we never trust a device clock
 *     that reads EARLIER than the last validation (a regression = a wound-back
 *     clock trying to keep an expired lease alive → treat as untrustworthy →
 *     lock). The server's `serverNow` is the real anchor used when renewing.
 *   - Entitlement-code users: a lease can never outlive the code, so the grant
 *     clamps `expiresAt` to `min(now + 30d, entitlement.expiresAt)`.
 *
 * Everything here is pure (no Vue, no IO) so it's trivially unit-testable and
 * shared by both the client lease composable and any future server consumer.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Days a download stays playable offline before it must be re-validated. */
export const LEASE_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** A full lease window, in ms. */
export const LEASE_DURATION_MS = LEASE_DAYS * MS_PER_DAY

/**
 * How often the running app *considers* sliding the lease forward while open.
 * 6h — the long-session backstop. Each tick is GATED (see leaseShouldRevalidate
 * + the throttle): it only actually hits the network when a lease is near expiry
 * or hasn't been checked in a day, so most ticks are a no-op.
 */
export const RENEW_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Only proactively re-validate a lease when it's within this of expiry. A user
 * with 25 days of runway makes ZERO lease network calls — the whole point is the
 * check is invisible until it's actually needed. Each successful check buys
 * another 30 days, so a regular user is topped up long before the edge.
 */
export const RENEW_AHEAD_MS = 7 * MS_PER_DAY

/**
 * Re-validate at most ~once a day even when there's plenty of runway, so a
 * server-side REVOCATION (chargeback/refund kill-switch) is discovered within a
 * day without nagging the network on every app open.
 */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Throttle: never fire two validations within this window, whatever the trigger
 * (boot / reconnect / timer). Stops a flaky connection that flaps online/offline
 * from spamming the endpoint — the Spotify "weak signal gets bent out of shape"
 * failure mode.
 */
export const MIN_RENEW_INTERVAL_MS = 60 * 60 * 1000

/**
 * Abort the validation fetch after this long. On a WEAK signal the request must
 * fail FAST and fail OPEN (keep the existing lease) rather than hang the app —
 * airplane mode is fine (we don't even try); it's the half-connected case that
 * annoys, so we cap how long we'll ever wait on it.
 */
export const VALIDATE_TIMEOUT_MS = 5000

// ============================================================================
// TYPES
// ============================================================================

/**
 * Per-course lease, persisted on the CachedScript IndexedDB row.
 * All timestamps are epoch-ms. `grantedAt`/`lastValidatedAt` are server-anchored
 * where possible (the validate endpoint returns `serverNow`); a download made
 * offline uses the device clock and is reconciled on the first online check.
 */
export interface OfflineLease {
  /** When this download was first leased (epoch ms). */
  grantedAt: number
  /** Hard expiry — offline play locks at/after this instant (epoch ms). */
  expiresAt: number
  /** Last successful online validation (epoch ms; server-anchored when online). */
  lastValidatedAt: number
  /** Subscription id at last validation (diagnostic; not load-bearing). */
  subscriptionId?: string | null
  /**
   * Server-set REVOCATION flag (chargeback/refund kill-switch). When the server
   * reports the lease revoked, offline locks regardless of expiry. Sticky on the
   * client until a successful validate clears it.
   */
  revoked?: boolean
  /**
   * Whether this is a free 30-day TASTE (non-payer) vs a renewing entitlement.
   * Server-anchored where possible; diagnostic for the lock UI copy.
   */
  isTrial?: boolean
  /**
   * Opaque hash of the entitlement shape at grant/renew time — lets us notice
   * a materially-changed entitlement later if we ever want to. Diagnostic only.
   */
  entitlementHash?: string | null
}

/** Why a lease is or isn't currently valid — drives UI + telemetry. */
export type LeaseStatus =
  | 'valid' // within the window, clock trustworthy
  | 'none' // never leased (free user, or download predates leasing)
  | 'expired' // window elapsed — locked until a successful online renew
  | 'revoked' // server kill-switch (chargeback/refund) — locked
  | 'clock-untrusted' // device clock wound back behind lastValidatedAt — locked

// ============================================================================
// PURE HELPERS
// ============================================================================

/**
 * Compute a fresh expiry from a (server-anchored) "now", clamped so a lease can
 * never outlive an entitlement code's own expiry.
 *
 * @param nowMs       Anchor instant (prefer the server's `serverNow`).
 * @param entitlementExpiresAtMs  If the access comes from a time-boxed code,
 *        its expiry in epoch ms — the lease is clamped to min(now+30d, this).
 *        Pass null/undefined for an open-ended subscription/admin grant.
 */
export function computeExpiry(
  nowMs: number,
  entitlementExpiresAtMs?: number | null,
): number {
  const standard = nowMs + LEASE_DURATION_MS
  if (entitlementExpiresAtMs != null && Number.isFinite(entitlementExpiresAtMs)) {
    return Math.min(standard, entitlementExpiresAtMs)
  }
  return standard
}

/**
 * Is the device clock trustworthy relative to a lease?
 *
 * The only tamper we can cheaply detect offline is a clock wound BACKWARDS to
 * before our last validation — the move that would keep an expired lease alive
 * ("it's still last week"). A small skew tolerance avoids false positives from
 * benign NTP corrections. Forward jumps just expire the lease sooner (harmless,
 * fail-safe). If we have no validation timestamp we can't judge → trust by
 * default (a never-validated lease is governed by `expiresAt` alone).
 */
export function isClockTrustworthy(
  lease: Pick<OfflineLease, 'lastValidatedAt'>,
  nowMs: number = Date.now(),
  skewToleranceMs: number = 60 * 60 * 1000, // 1h benign skew allowance
): boolean {
  if (!lease.lastValidatedAt || !Number.isFinite(lease.lastValidatedAt)) return true
  return nowMs >= lease.lastValidatedAt - skewToleranceMs
}

/** Detailed lease status — the single decision function the gate consults. */
export function leaseStatus(
  lease: OfflineLease | null | undefined,
  nowMs: number = Date.now(),
): LeaseStatus {
  if (!lease || !Number.isFinite(lease.expiresAt)) return 'none'
  if (lease.revoked) return 'revoked'
  if (!isClockTrustworthy(lease, nowMs)) return 'clock-untrusted'
  if (nowMs >= lease.expiresAt) return 'expired'
  return 'valid'
}

/**
 * Is it worth hitting the network to re-validate this lease right now? True only
 * when there's a real reason — near expiry, already expired, or not checked in a
 * day (to catch a revocation). A healthy lease with lots of runway returns false,
 * so the common case makes NO network call (esp. on first load). Revoked is left
 * to the daily/near-expiry cadence — we don't poll aggressively for it.
 */
export function leaseShouldRevalidate(
  lease: OfflineLease | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lease || !Number.isFinite(lease.expiresAt)) return false
  if (lease.expiresAt - nowMs <= RENEW_AHEAD_MS) return true
  const lastValidated = Number.isFinite(lease.lastValidatedAt) ? lease.lastValidatedAt : 0
  return nowMs - lastValidated >= STALE_AFTER_MS
}

/**
 * Boolean gate for the playback hot path: may this leased content play offline
 * right now? True only when the lease exists, the window hasn't elapsed, and the
 * clock isn't wound back. A `'none'` lease (free/legacy download) is NOT valid —
 * the lease is the offline-entitlement proof, so absence = no offline right.
 */
export function isLeaseValid(
  lease: OfflineLease | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return leaseStatus(lease, nowMs) === 'valid'
}

/** Human "offline works until <date>" string for the UI (local date). */
export function leaseExpiryLabel(lease: OfflineLease | null | undefined): string | null {
  if (!lease || !Number.isFinite(lease.expiresAt)) return null
  try {
    return new Date(lease.expiresAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return null
  }
}

/** Whole days remaining before lock (floored, never negative). */
export function leaseDaysRemaining(
  lease: OfflineLease | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!lease || !Number.isFinite(lease.expiresAt)) return 0
  return Math.max(0, Math.floor((lease.expiresAt - nowMs) / MS_PER_DAY))
}
