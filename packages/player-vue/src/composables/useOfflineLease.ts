/**
 * useOfflineLease — the running side of the 30-day offline handshake.
 *
 * Responsibilities (build-plan §2B "The lease"):
 *   1. RENEW. On boot (after useSubscription.initialize), on `window 'online'`,
 *      and on a ~6h timer, call /api/entitlement/offline-lease. On a valid
 *      response, slide every downloaded course's lease `expiresAt` to
 *      serverNow + 30d (clamped to an entitlement-code expiry). Renewing on
 *      EVERY successful check means an active user never approaches the edge.
 *   2. LOCK / UNLOCK. Expose `isCourseLeaseValid(courseCode)` for the offline
 *      playback gate. Locking is a soft state — the bytes stay, a successful
 *      renew flips it straight back.
 *
 * Cardinal-sin guards:
 *   - FAIL-OPEN on infra failure. Network error / 5xx / 401 → keep the existing
 *     lease untouched and retry later. We fail-CLOSED (mark expired by leaving
 *     the lease to run down) ONLY on an explicit { valid:false } — the sub has
 *     genuinely lapsed — and even then GRACEFULLY: we do NOT cut the lease, we
 *     stop renewing it, so the remaining days run out (§5 default a).
 *   - DEV/DEMO bypass. ssi-demo-tier / dev flags get a far-future "infinite"
 *     lease so demos never lock after 30 days.
 *   - CLOCK-TAMPER handled in config/offlineLease.ts (server serverNow is the
 *     renew anchor; a wound-back clock locks via isClockTrustworthy).
 *
 * Module-level shared state (same pattern as usePwaUpdate / the offline status)
 * so the lock signal reaches LearningPlayer + ModeTray without prop-drilling and
 * the timer/listeners are wired exactly once app-wide.
 */

import { ref, computed } from 'vue'
import { resolveSupabase } from './schools/client'
import {
  getAllOfflineLeases,
  setOfflineLease,
  getOfflineLease,
} from './useScriptCache'
import {
  LEASE_DAYS,
  RENEW_INTERVAL_MS,
  computeExpiry,
  isLeaseValid,
  leaseStatus,
  leaseExpiryLabel,
  leaseDaysRemaining,
  type OfflineLease,
  type LeaseStatus,
} from '../config/offlineLease'

// A lease ~100 years out — used for dev/demo/privileged so offline never locks.
const INFINITE_EXPIRY_MS = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000

interface LeaseValidationResult {
  valid: boolean
  blanket: boolean
  reason?: string
  leaseDays: number
  serverNow: number
  subscriptionId: string | null
  courses: Array<{ courseCode: string; entitlementExpiresAt: number | null }>
}

// ── Shared state ────────────────────────────────────────────────────────────
// Map of courseCode → cached lease status, refreshed by the gate + renewals so
// the UI can reactively show locked/expiry without re-reading IndexedDB.
const leaseStatuses = ref<Record<string, LeaseStatus>>({})
const lastRenewAt = ref<number>(0)
const isRenewing = ref(false)

let renewTimer: ReturnType<typeof setInterval> | null = null
let onlineHandler: (() => void) | null = null
let supabaseRef: { value: any } | null = null
let initialized = false

// ── Dev / demo bypass ───────────────────────────────────────────────────────
// Mirror useEntitlement.checkDevPaidStatus: a demo/dev "paid" session must never
// lock its downloads. These get an infinite lease on grant + always pass the gate.
function isDevOrDemoBypass(): boolean {
  try {
    if (sessionStorage.getItem('ssi-demo-tier') === 'paid') return true
    if (import.meta.env.PROD) return false
    if (localStorage.getItem('ssi-dev-tier') === 'paid') return true
    return localStorage.getItem('ssi-dev-paid-user') === 'true'
  } catch {
    return false
  }
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
 * Hit the server. Returns the validation result, or null on an infra/auth
 * failure (network/5xx/401/no-token) — null means "couldn't check, fail open".
 */
async function fetchValidation(): Promise<LeaseValidationResult | null> {
  const token = await getAuthToken()
  if (!token) return null // not signed in / offline → fail-open
  try {
    const res = await fetch('/api/entitlement/offline-lease', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    // Auth/infra problems → fail-open (null). Only a 200 with an explicit body
    // is an authoritative answer.
    if (!res.ok) return null
    const data = (await res.json()) as LeaseValidationResult
    return data
  } catch {
    // Offline or transient — fail-open.
    return null
  }
}

/**
 * Renew leases against the server. Idempotent + safe to call often.
 *
 *  - infra failure (null) → leave every lease as-is, refresh local statuses only.
 *  - { valid:true }       → slide each matching downloaded course's lease +30d.
 *  - { valid:false }      → do NOT touch leases (graceful run-out); refresh
 *                           statuses so any already-expired course shows locked.
 */
async function renewLeases(): Promise<void> {
  if (isRenewing.value) return
  isRenewing.value = true
  try {
    // Dev/demo: blanket-renew everything downloaded to an infinite lease.
    if (isDevOrDemoBypass()) {
      const leases = await getAllOfflineLeases()
      for (const { courseCode, lease } of leases) {
        await setOfflineLease(courseCode, {
          ...lease,
          expiresAt: INFINITE_EXPIRY_MS,
          lastValidatedAt: Date.now(),
        })
      }
      await refreshAllStatuses()
      lastRenewAt.value = Date.now()
      return
    }

    const result = await fetchValidation()
    if (!result) {
      // Fail-open: keep leases, just recompute statuses from the device clock.
      await refreshAllStatuses()
      return
    }

    if (result.valid) {
      const serverNow = Number.isFinite(result.serverNow) ? result.serverNow : Date.now()
      const codeExpiry = new Map(
        result.courses.map((c) => [c.courseCode, c.entitlementExpiresAt]),
      )
      const leases = await getAllOfflineLeases()
      for (const { courseCode, lease } of leases) {
        // Blanket (sub/full/admin) renews everything downloaded; otherwise only
        // courses the server explicitly listed as entitled.
        const explicit = codeExpiry.has(courseCode)
        if (!result.blanket && !explicit) continue
        const entExpiry = explicit ? codeExpiry.get(courseCode) ?? null : null
        await setOfflineLease(courseCode, {
          ...lease,
          expiresAt: computeExpiry(serverNow, entExpiry),
          lastValidatedAt: serverNow,
          subscriptionId: result.subscriptionId,
        })
      }
    }
    // valid:false → graceful: do nothing to leases (they run out naturally).

    await refreshAllStatuses()
    lastRenewAt.value = Date.now()
  } finally {
    isRenewing.value = false
  }
}

/** Recompute the cached status map for every leased course. */
async function refreshAllStatuses(): Promise<void> {
  const leases = await getAllOfflineLeases()
  const next: Record<string, LeaseStatus> = {}
  for (const { courseCode, lease } of leases) {
    next[courseCode] = leaseStatus(lease)
  }
  leaseStatuses.value = next
}

/**
 * Stamp a fresh lease at the end of a deliberate download. Called by
 * LearningPlayer's downloadForOffline once the bytes + script are persisted.
 *
 * @param courseCode             course just downloaded
 * @param entitlementExpiresAtMs if access is from a time-boxed code, its expiry
 *        (epoch ms) so the lease can't outlive the code; null otherwise.
 */
async function grantLease(
  courseCode: string,
  entitlementExpiresAtMs?: number | null,
): Promise<void> {
  const now = Date.now()
  const expiresAt = isDevOrDemoBypass()
    ? INFINITE_EXPIRY_MS
    : computeExpiry(now, entitlementExpiresAtMs)
  const lease: OfflineLease = {
    grantedAt: now,
    expiresAt,
    lastValidatedAt: now,
    subscriptionId: null,
  }
  const ok = await setOfflineLease(courseCode, lease)
  if (ok) {
    leaseStatuses.value = { ...leaseStatuses.value, [courseCode]: leaseStatus(lease) }
  }
}

/**
 * Is this course's downloaded content currently playable offline? The offline
 * playback gate calls this. Reads IndexedDB fresh (the cached status map is a
 * convenience for UI; the gate must not trust a stale map).
 */
async function isCourseLeaseValid(courseCode: string): Promise<boolean> {
  if (isDevOrDemoBypass()) return true
  const lease = await getOfflineLease(courseCode)
  const ok = isLeaseValid(lease)
  // Keep the reactive map in step for any UI that's watching.
  leaseStatuses.value = { ...leaseStatuses.value, [courseCode]: leaseStatus(lease) }
  return ok
}

/** Status for the UI ('valid' | 'none' | 'expired' | 'clock-untrusted'). */
function statusFor(courseCode: string): LeaseStatus {
  return leaseStatuses.value[courseCode] ?? 'none'
}

async function expiryLabelFor(courseCode: string): Promise<string | null> {
  return leaseExpiryLabel(await getOfflineLease(courseCode))
}

async function daysRemainingFor(courseCode: string): Promise<number> {
  return leaseDaysRemaining(await getOfflineLease(courseCode))
}

/**
 * Wire boot + reconnect + timer. Call ONCE from App.vue after
 * useSubscription.initialize. Idempotent.
 */
function initialize(injectedSupabase?: { value: any } | null): void {
  supabaseRef = injectedSupabase ?? supabaseRef
  if (initialized) return
  initialized = true

  // Boot renew (best-effort; offline → fail-open, statuses still refresh).
  void renewLeases()

  // Reconnect → immediate renew (the Spotify "you're back online" moment).
  onlineHandler = () => {
    void renewLeases()
  }
  window.addEventListener('online', onlineHandler)

  // Long-session backstop.
  renewTimer = setInterval(() => {
    if (navigator.onLine) void renewLeases()
  }, RENEW_INTERVAL_MS)
}

function teardown(): void {
  if (onlineHandler) window.removeEventListener('online', onlineHandler)
  if (renewTimer) clearInterval(renewTimer)
  onlineHandler = null
  renewTimer = null
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
    renewLeases,
    grantLease,
    isCourseLeaseValid,
    statusFor,
    expiryLabelFor,
    daysRemainingFor,
  }
}

export type OfflineLeaseComposable = ReturnType<typeof useOfflineLease>
