/**
 * useOfflineLease — the running side of the 30-day offline handshake.
 *
 * Responsibilities:
 *   1. RENEW — but LAZILY. We do NOT phone home on first load. A check only fires
 *      when it's actually worth it (a lease is near expiry, stale > a day, or just
 *      granted) AND we're online AND we haven't checked recently. A user with
 *      plenty of runway makes ZERO lease network calls. Every validation has a
 *      hard timeout and FAILS OPEN, so a weak signal can never hang the app (the
 *      Spotify "half-connected gets bent out of shape" failure mode).
 *   2. LOCK / UNLOCK — expose isCourseLeaseValid(courseCode) for the offline
 *      playback gate. Locking is soft: the bytes stay, a successful renew flips
 *      it straight back.
 *
 * The server (/api/entitlement/offline-lease, backed by the offline_leases table)
 * is the AUTHORITY: we POST the courses we have downloaded and it returns each
 * one's authoritative expiry + revoked flag. Payers renew (+30d); a non-payer's
 * free 30-day taste does not renew (and is remembered server-side, so a storage
 * wipe + re-download doesn't mint a fresh taste); a revoked lease (chargeback)
 * locks. If the table is absent (pre-migration) the server returns the old
 * stateless shape and we keep computing the lease locally — safe either way.
 *
 * Cardinal-sin guards: fail-open on infra/auth/timeout; graceful lapse tail (a
 * lapsed sub stops renewing, the remaining days run out, no instant cut);
 * dev/demo → infinite lease; clock-tamper handled in config/offlineLease.ts.
 *
 * Module-level shared state (same pattern as usePwaUpdate) so the lock signal
 * reaches LearningPlayer + ModeTray without prop-drilling and the timer/listeners
 * are wired exactly once app-wide.
 */

import { ref, computed } from 'vue'
import { hasTryEntitlement } from './useEntitlement'
import { resolveSupabase } from './schools/client'
import {
  getAllOfflineLeases,
  setOfflineLease,
  getOfflineLease,
} from './useScriptCache'
import {
  LEASE_DAYS,
  RENEW_INTERVAL_MS,
  MIN_RENEW_INTERVAL_MS,
  VALIDATE_TIMEOUT_MS,
  computeExpiry,
  isLeaseValid,
  leaseStatus,
  leaseShouldRevalidate,
  leaseExpiryLabel,
  leaseDaysRemaining,
  type OfflineLease,
  type LeaseStatus,
} from '../config/offlineLease'

// A lease ~100 years out — used for dev/demo/privileged so offline never locks.
const INFINITE_EXPIRY_MS = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000

// Defer the first opportunistic check well past the busy boot — we have enough
// going on at first load. Gated, so it usually no-ops anyway.
const BOOT_DEFER_MS = 45 * 1000

interface LeaseCourseAuthority {
  courseCode: string
  entitlementExpiresAt: number | null
  leaseExpiresAt: number | null
  isTrial: boolean
  revoked: boolean
}

interface LeaseValidationResult {
  valid: boolean
  blanket: boolean
  stateful: boolean
  leaseDays: number
  serverNow: number
  subscriptionId: string | null
  courses: LeaseCourseAuthority[]
}

// ── Shared state ────────────────────────────────────────────────────────────
const leaseStatuses = ref<Record<string, LeaseStatus>>({})
const lastRenewAt = ref<number>(0) // last ATTEMPT (success or fail) — drives the throttle
const isRenewing = ref(false)

let renewTimer: ReturnType<typeof setInterval> | null = null
let bootTimer: ReturnType<typeof setTimeout> | null = null
let onlineHandler: (() => void) | null = null
let supabaseRef: { value: any } | null = null
// Auth user id, injected from useAuth (App.vue) — read at call-time (not
// snapshotted) so a sign-out/sign-in flip is picked up without re-init. The
// lease is per-learner-on-this-device, not per-device (shared-iPad fix).
let userIdRef: { value: string | null } | null = null
let initialized = false

/** 'anon' for signed-out — never let a lease silently write to no bucket. */
function currentUserId(): string {
  return userIdRef?.value || 'anon'
}

// ── Dev / demo / try-link bypass ────────────────────────────────────────────
// PROD honours only a server-minted try-link token; DEV keeps the raw flags.
// (Shared with useEntitlement so the rule lives in one place.)
function isDevOrDemoBypass(): boolean {
  return hasTryEntitlement()
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine
}

async function getAuthToken(): Promise<string | null> {
  const client = resolveSupabase(supabaseRef)
  if (!client) return null
  try {
    const { data: { session } } = await client.auth.getSession()
    return session?.access_token || null
  } catch {
    return null
  }
}

/**
 * Hit the server with the downloaded course list. Returns the authority, or null
 * on any infra/auth/timeout failure — null means "couldn't check, fail open".
 * Hard timeout via AbortController so a weak signal fails FAST, never hangs.
 */
async function fetchValidation(courses: string[]): Promise<LeaseValidationResult | null> {
  const token = await getAuthToken()
  if (!token) return null // not signed in / offline → fail-open
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), VALIDATE_TIMEOUT_MS)
  try {
    const res = await fetch('/api/entitlement/offline-lease', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ courses }),
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!res.ok) return null // auth/infra → fail-open
    return (await res.json()) as LeaseValidationResult
  } catch {
    return null // offline / transient / aborted (timeout) → fail-open
  } finally {
    clearTimeout(timer)
  }
}

/** Recompute the cached status map for every leased course. */
async function refreshAllStatuses(): Promise<void> {
  const leases = await getAllOfflineLeases(currentUserId())
  const next: Record<string, LeaseStatus> = {}
  for (const { courseCode, lease } of leases) {
    next[courseCode] = leaseStatus(lease)
  }
  leaseStatuses.value = next
}

/**
 * Do the actual renew against the server. Assumes the caller already decided it's
 * worth it (online + worthwhile + not throttled). Idempotent.
 */
async function doRenew(): Promise<void> {
  if (isRenewing.value) return
  isRenewing.value = true
  try {
    const userId = currentUserId()

    // Dev/demo: blanket-renew everything downloaded to an infinite lease.
    if (isDevOrDemoBypass()) {
      const leases = await getAllOfflineLeases(userId)
      for (const { courseCode, lease } of leases) {
        await setOfflineLease(courseCode, userId, {
          ...lease,
          expiresAt: INFINITE_EXPIRY_MS,
          lastValidatedAt: Date.now(),
          revoked: false,
        })
      }
      await refreshAllStatuses()
      return
    }

    const leases = await getAllOfflineLeases(userId)
    if (!leases.length) {
      await refreshAllStatuses()
      return
    }

    const result = await fetchValidation(leases.map((l) => l.courseCode))
    if (!result) {
      // Fail-open: keep leases, just recompute statuses from the device clock.
      await refreshAllStatuses()
      return
    }

    const serverNow = Number.isFinite(result.serverNow) ? result.serverNow : Date.now()
    const authority = new Map(result.courses.map((c) => [c.courseCode, c]))

    for (const { courseCode, lease } of leases) {
      const a = authority.get(courseCode)
      if (a && a.leaseExpiresAt != null) {
        // Stateful authority — the server's word is final.
        await setOfflineLease(courseCode, userId, {
          ...lease,
          expiresAt: a.leaseExpiresAt,
          lastValidatedAt: serverNow,
          revoked: !!a.revoked,
          isTrial: !!a.isTrial,
          subscriptionId: result.subscriptionId,
        })
      } else if (result.blanket || a) {
        // Stateless fallback (table absent) and entitled → renew locally (v1 path).
        await setOfflineLease(courseCode, userId, {
          ...lease,
          expiresAt: computeExpiry(serverNow, a?.entitlementExpiresAt ?? null),
          lastValidatedAt: serverNow,
          revoked: false,
          subscriptionId: result.subscriptionId,
        })
      }
      // else: not entitled & no authority (fallback trial) → leave as-is (runs out).
    }

    await refreshAllStatuses()
  } finally {
    isRenewing.value = false
  }
}

/**
 * Gated renew. `force` (explicit reconnect, grant, boot self-heal) skips the
 * worthwhile/online/throttle gates; otherwise we only touch the network when
 * there's a real reason — which is most of the point.
 */
async function maybeRenew(force = false): Promise<void> {
  if (isRenewing.value) return
  if (!force) {
    if (!isOnline()) return // offline → don't even try (airplane mode is fine)
    if (Date.now() - lastRenewAt.value < MIN_RENEW_INTERVAL_MS) return // throttle
    if (isDevOrDemoBypass()) {
      // dev leases are already infinite; nothing to revalidate.
    } else {
      const leases = await getAllOfflineLeases(currentUserId())
      if (!leases.some(({ lease }) => leaseShouldRevalidate(lease))) return // plenty of runway
    }
  }
  lastRenewAt.value = Date.now() // stamp the ATTEMPT (throttle counts failures too)
  await doRenew()
}

/**
 * Stamp a fresh lease at the end of a deliberate download, then force a server
 * validate (downloads need the network anyway, so this is never a "first load"
 * cost). The validate creates the server row + returns the authoritative expiry
 * (and, for a non-payer who's already used their taste, will lock it).
 */
async function grantLease(
  courseCode: string,
  entitlementExpiresAtMs?: number | null,
): Promise<void> {
  const now = Date.now()
  const bypass = isDevOrDemoBypass()
  const lease: OfflineLease = {
    grantedAt: now,
    expiresAt: bypass ? INFINITE_EXPIRY_MS : computeExpiry(now, entitlementExpiresAtMs),
    lastValidatedAt: now,
    subscriptionId: null,
    revoked: false,
  }
  const ok = await setOfflineLease(courseCode, currentUserId(), lease)
  if (ok) {
    leaseStatuses.value = { ...leaseStatuses.value, [courseCode]: leaseStatus(lease) }
  }
  // Reconcile with the server authority in the background (best-effort).
  void maybeRenew(true)
}

/**
 * Is this course's downloaded content currently playable offline? Reads IndexedDB
 * fresh (the cached status map is a convenience for UI; the gate must not trust a
 * stale map).
 */
async function isCourseLeaseValid(courseCode: string): Promise<boolean> {
  if (isDevOrDemoBypass()) return true
  const lease = await getOfflineLease(courseCode, currentUserId())
  const ok = isLeaseValid(lease)
  leaseStatuses.value = { ...leaseStatuses.value, [courseCode]: leaseStatus(lease) }
  return ok
}

function statusFor(courseCode: string): LeaseStatus {
  return leaseStatuses.value[courseCode] ?? 'none'
}

async function expiryLabelFor(courseCode: string): Promise<string | null> {
  return leaseExpiryLabel(await getOfflineLease(courseCode, currentUserId()))
}

async function daysRemainingFor(courseCode: string): Promise<number> {
  return leaseDaysRemaining(await getOfflineLease(courseCode, currentUserId()))
}

/**
 * Wire reconnect + timer + a deferred boot tick. Call ONCE from App.vue after
 * useSubscription.initialize. Idempotent. Note: NO eager network call here — the
 * boot tick is deferred and gated, so first load stays quiet.
 *
 * `injectedUserId` is useAuth's `userId` computed ref — read at call-time on
 * every lease op (never snapshotted), so a sign-out/sign-in flip on a shared
 * device is picked up without re-initializing.
 */
function initialize(
  injectedSupabase?: { value: any } | null,
  injectedUserId?: { value: string | null } | null,
): void {
  supabaseRef = injectedSupabase ?? supabaseRef
  userIdRef = injectedUserId ?? userIdRef
  if (initialized) return
  initialized = true

  // Refresh local statuses immediately (no network) so the UI is correct at once.
  void refreshAllStatuses()

  // Reconnect → opportunistic (gated) renew.
  onlineHandler = () => {
    void maybeRenew(false)
  }
  window.addEventListener('online', onlineHandler)

  // Long-session backstop (gated).
  renewTimer = setInterval(() => {
    if (isOnline()) void maybeRenew(false)
  }, RENEW_INTERVAL_MS)

  // One deferred, gated check after the busy boot settles. Tops up a near-edge
  // user shortly after open; a no-op for everyone with runway.
  bootTimer = setTimeout(() => {
    void maybeRenew(false)
  }, BOOT_DEFER_MS)
}

function teardown(): void {
  if (onlineHandler) window.removeEventListener('online', onlineHandler)
  if (renewTimer) clearInterval(renewTimer)
  if (bootTimer) clearTimeout(bootTimer)
  onlineHandler = null
  renewTimer = null
  bootTimer = null
  userIdRef = null
  initialized = false
}

export function useOfflineLease() {
  return {
    LEASE_DAYS,
    leaseStatuses,
    lastRenewAt,
    isRenewing: computed(() => isRenewing.value),
    initialize,
    teardown,
    // Public forced renew (explicit reconnect / grant / self-heal). Background
    // triggers (timer/online/boot) use the gated path internally.
    renewLeases: (force = true) => maybeRenew(force),
    grantLease,
    isCourseLeaseValid,
    statusFor,
    expiryLabelFor,
    daysRemainingFor,
  }
}

export type OfflineLeaseComposable = ReturnType<typeof useOfflineLease>
