/**
 * useOfflineLease integration tests — vitest, fake-indexeddb + mocked fetch.
 *
 * Exercises the orchestration the pure config/offlineLease.ts tests don't:
 * grant → isCourseLeaseValid → simulated 31-day-offline expiry → LOCK →
 * simulated online renew (payer vs non-payer) → UNLOCK/stays-locked, plus the
 * clock-tamper and revocation paths. This is the "actually simulate expiry"
 * verification for the Spotify-style 30-day offline gate.
 */

import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEASE_DURATION_MS } from '../config/offlineLease'

const DAY = 24 * 60 * 60 * 1000

// grantLease() fires a background `void maybeRenew(true)` reconcile that isn't
// awaited by the caller. If a test's own explicit renewLeases(true) call lands
// while that background renew is still holding the module's isRenewing lock,
// maybeRenew's `if (isRenewing.value) return` guard makes the explicit call a
// silent no-op. Flush a real macrotask so the background reconcile (which
// itself resolves near-instantly against our mocked fetch) finishes first.
const flush = () => new Promise((resolve) => setTimeout(resolve, 10))
// vi.resetModules() re-evaluates the whole dependency graph (including
// useScriptCache) fresh for every test, so each test gets its own in-memory
// scriptDbPromise — but they all still share the ONE global fake-indexeddb
// instance installed by 'fake-indexeddb/auto'. A unique course code per test
// keeps their rows from colliding in that shared store.
let courseCounter = 0
function nextCourse(): string {
  courseCounter += 1
  return `fra_for_eng_test_${courseCounter}`
}

async function seedDownloadedCourse(setCachedScript: any, course: string) {
  await setCachedScript(course, {
    rounds: [{ roundNumber: 1, legoId: 'S0001L01', seedId: 'S0001', items: [] }],
    totalSeeds: 1,
    totalLegos: 1,
    totalCycles: 1,
    audioMapObj: {},
  } as any)
}

describe('useOfflineLease (integration)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function loadModule() {
    const mod = await import('./useOfflineLease')
    const scriptCache = await import('./useScriptCache')
    const { setSchoolsClient } = await import('./schools/client')
    setSchoolsClient({
      auth: {
        getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
      },
    } as any)
    return { lease: mod.useOfflineLease(), setCachedScript: scriptCache.setCachedScript }
  }

  it('grants a fresh lease that is valid immediately and locks after 31 simulated days with no renew', async () => {
    const { lease, setCachedScript } = await loadModule()
    const course = nextCourse()
    await seedDownloadedCourse(setCachedScript, course)

    // Server never reachable in this test (fetch rejects) — grantLease's
    // background reconcile fails open, so the LOCAL 30-day grant stands.
    fetchMock.mockRejectedValue(new Error('offline'))

    const now = Date.now()
    await lease.grantLease(course, null)
    expect(await lease.isCourseLeaseValid(course)).toBe(true)

    // Simulate 31 days offline: fast-forward the system clock (Date.now spy,
    // not vi.useFakeTimers — fake-indexeddb's internal scheduling hangs under
    // fake timers).
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * DAY)
    expect(await lease.isCourseLeaseValid(course)).toBe(false)
    expect(lease.statusFor(course)).toBe('expired')
    dateSpy.mockRestore()
  })

  it('a paid sign-in renew slides the lease forward and unlocks', async () => {
    const { lease, setCachedScript } = await loadModule()
    const course = nextCourse()
    await seedDownloadedCourse(setCachedScript, course)
    fetchMock.mockRejectedValue(new Error('offline'))
    const grantedAt = Date.now()
    await lease.grantLease(course, null)
    await flush()

    const serverNow = grantedAt + 31 * DAY
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(serverNow)
    expect(await lease.isCourseLeaseValid(course)).toBe(false)

    // Now the user comes online as a PAID subscriber — server renews +30d.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        blanket: true,
        stateful: true,
        leaseDays: 30,
        serverNow,
        subscriptionId: 'sub_123',
        courses: [
          {
            courseCode: course,
            entitlementExpiresAt: null,
            leaseExpiresAt: serverNow + LEASE_DURATION_MS,
            isTrial: false,
            revoked: false,
          },
        ],
      }),
    })

    await lease.renewLeases(true)
    expect(await lease.isCourseLeaseValid(course)).toBe(true)
    expect(lease.statusFor(course)).toBe('valid')
    dateSpy.mockRestore()
  })

  it('a lapsed non-payer trial does NOT renew and stays locked even when back online', async () => {
    const { lease, setCachedScript } = await loadModule()
    const course = nextCourse()
    await seedDownloadedCourse(setCachedScript, course)
    fetchMock.mockRejectedValue(new Error('offline'))
    const grantedAt = Date.now()
    await lease.grantLease(course, null)

    const serverNow = grantedAt + 31 * DAY
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(serverNow)

    // Server says: not entitled, trial already used, no stateful authority row
    // reported for this course (server only reports entitled/authoritative
    // courses in the stateless-fallback shape) — the renew must NOT extend it.
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: false,
        blanket: false,
        stateful: true,
        leaseDays: 30,
        serverNow,
        subscriptionId: null,
        courses: [
          {
            courseCode: course,
            entitlementExpiresAt: null,
            leaseExpiresAt: grantedAt + LEASE_DURATION_MS, // unchanged — no slide
            isTrial: true,
            revoked: false,
          },
        ],
      }),
    })

    await lease.renewLeases(true)
    expect(await lease.isCourseLeaseValid(course)).toBe(false)
    expect(lease.statusFor(course)).toBe('expired')
    dateSpy.mockRestore()
  })

  it('a server revocation (chargeback) locks regardless of remaining window', async () => {
    const { lease, setCachedScript } = await loadModule()
    const course = nextCourse()
    await seedDownloadedCourse(setCachedScript, course)
    fetchMock.mockRejectedValue(new Error('offline'))
    const grantedAt = Date.now()
    await lease.grantLease(course, null)
    await flush()
    expect(await lease.isCourseLeaseValid(course)).toBe(true)

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        valid: true,
        blanket: false,
        stateful: true,
        leaseDays: 30,
        serverNow: grantedAt,
        subscriptionId: null,
        courses: [
          {
            courseCode: course,
            entitlementExpiresAt: null,
            leaseExpiresAt: grantedAt + LEASE_DURATION_MS,
            isTrial: false,
            revoked: true,
          },
        ],
      }),
    })

    await lease.renewLeases(true)
    expect(await lease.isCourseLeaseValid(course)).toBe(false)
    expect(lease.statusFor(course)).toBe('revoked')
  })

  it('clock wound back after last validation is untrusted and locks', async () => {
    const { lease, setCachedScript } = await loadModule()
    const course = nextCourse()
    await seedDownloadedCourse(setCachedScript, course)
    fetchMock.mockRejectedValue(new Error('offline'))
    const grantedAt = Date.now()
    await lease.grantLease(course, null)
    expect(await lease.isCourseLeaseValid(course)).toBe(true)

    // Wind the clock back 5 days before the grant/validation instant — a
    // classic "reset the clock to keep the trial alive" tamper attempt.
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(grantedAt - 5 * DAY)
    expect(await lease.isCourseLeaseValid(course)).toBe(false)
    expect(lease.statusFor(course)).toBe('clock-untrusted')
    dateSpy.mockRestore()
  })
})
