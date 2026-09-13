/**
 * EXPIRY IS CHECKED AGAINST THE CLOCK, NOT AGAINST THE LAST RECOMPUTE
 * (Astra refutation of job #378, re-checked and confirmed 2026-09-13).
 *
 * `isSubscribed` is a Vue computed. A computed re-evaluates only when a
 * REACTIVE dependency changes, and `new Date()` is not one — so a subscription
 * that read "active, period ends in 30 minutes" at boot stayed `true` for as
 * long as `subscription.value` was left alone. Offline that is forever: the
 * refresh fetch fails and never rewrites the ref, so a paid period that ended
 * while the app sat in the background kept serving paid content across
 * navigation, resume and every timer tick until the next full reload.
 *
 * The composable now owns a reactive clock, ticked on a coarse interval and on
 * visibility / focus / pageshow / online, and the computed depends on it while
 * comparing against `Date.now()` at read. These tests fail on the pre-fix code
 * (`isSubscribed` stays true after the period end) and pass after it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { Object.keys(store).forEach((k) => delete store[k]) }),
  },
  writable: true,
})

async function setupOffline() {
  const { setSchoolsClient } = await import('./schools/client')
  setSchoolsClient({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
  } as any)
  // Airplane mode: every fetch rejects at once, so the mirror is never rewritten.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
  const { useSubscription } = await import('./useSubscription')
  return useSubscription()
}

function mirror(periodEndMs: number, freeUntilMs: number | null = null) {
  store['ssi_subscription'] = JSON.stringify({
    subscription: {
      id: 'fam-1',
      learnerId: 'owner',
      status: 'active',
      planId: 'pri_family_monthly',
      planName: 'SSi Family',
      currentPeriodEnd: new Date(periodEndMs).toISOString(),
      cancelAtPeriodEnd: true,
      provider: 'paddle',
    },
    isSubscribed: true,
    freeAccess: freeUntilMs ? { until: new Date(freeUntilMs).toISOString(), orgName: 'Canolfan' } : null,
    cachedAt: periodEndMs - 60 * 60 * 1000,
  })
}

describe('useSubscription — a paid period that ends while the app is open fails closed', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
    vi.unstubAllGlobals()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a timer tick past the period end flips isSubscribed to false with no network', async () => {
    mirror(Date.now() + 30 * 60 * 1000)
    const sub = await setupOffline()
    await sub.initialize()
    expect(sub.isSubscribed.value).toBe(true)

    // The computed is now cached. Let 31 minutes pass with nothing else moving.
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

    expect(sub.isSubscribed.value).toBe(false)
  })

  it('an app resume (visibilitychange) past the period end re-checks at once', async () => {
    mirror(Date.now() + 30 * 60 * 1000)
    const sub = await setupOffline()
    await sub.initialize()
    expect(sub.isSubscribed.value).toBe(true)

    // The device slept: the wall clock jumps without any interval firing.
    vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(sub.isSubscribed.value).toBe(false)
  })

  it('a funded-org free year that ends mid-session stops suppressing prompts too', async () => {
    mirror(Date.now() + 365 * 24 * 60 * 60 * 1000, Date.now() + 10 * 60 * 1000)
    const sub = await setupOffline()
    await sub.initialize()
    expect(sub.hasFreeAccess.value).toBe(true)

    vi.setSystemTime(Date.now() + 11 * 60 * 1000)
    window.dispatchEvent(new Event('focus'))

    expect(sub.hasFreeAccess.value).toBe(false)
  })
})
