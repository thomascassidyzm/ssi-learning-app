/**
 * A RENEWING PAYER OFFLINE IS NOT LOCKED OUT AT THE BILLING ROLLOVER (job #549).
 *
 * Job #540 made `isSubscribed` follow the clock, so a paid period that ends
 * mid-session fails closed. Correct for a subscription that is ENDING. Wrong
 * for one that is RENEWING: `currentPeriodEnd` is only the end of the current
 * period, Paddle extends it by webhook at the rollover, and an offline device
 * cannot learn the new end — so the pre-fix computed dropped an auto-renewing
 * payer to the free preview the instant the old end passed. Tom's rulings:
 * 2026-07-10 "definitely do NOT favour security over paying user experience";
 * 2026-09-12 (job #378) "a payer offline stays a payer".
 *
 * Test (a) fails on the pre-fix code and passes after it. (c) guards the #540
 * behaviour for the cancelling case; (d) proves an online answer still wins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const DAY_MS = 24 * 60 * 60 * 1000

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

async function setup(fetchImpl: () => Promise<unknown>) {
  const { setSchoolsClient } = await import('./schools/client')
  setSchoolsClient({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
    },
  } as any)
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  const { useSubscription } = await import('./useSubscription')
  return useSubscription()
}

// Airplane mode: every fetch rejects at once, so the mirror is never rewritten.
const offline = () => Promise.reject(new TypeError('Failed to fetch'))

function subRecord(periodEndMs: number, cancelAtPeriodEnd: boolean) {
  return {
    id: 'sub-1',
    learnerId: 'payer',
    status: 'active',
    planId: 'pri_premium_monthly',
    planName: 'SSi Premium',
    currentPeriodEnd: new Date(periodEndMs).toISOString(),
    cancelAtPeriodEnd,
    provider: 'paddle',
  }
}

function mirror(periodEndMs: number, cancelAtPeriodEnd: boolean) {
  store['ssi_subscription'] = JSON.stringify({
    subscription: subRecord(periodEndMs, cancelAtPeriodEnd),
    isSubscribed: true,
    freeAccess: null,
    cachedAt: periodEndMs - 60 * 60 * 1000,
  })
}

describe('useSubscription — renewal grace past the billing rollover', () => {
  beforeEach(() => {
    vi.resetModules()
    Object.keys(store).forEach((k) => delete store[k])
    vi.unstubAllGlobals()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('(a) a renewing subscription is still paid one day past its recorded period end, offline', async () => {
    mirror(Date.now() + 30 * 60 * 1000, false)
    const sub = await setup(offline)
    await sub.initialize()
    expect(sub.isSubscribed.value).toBe(true)

    // The rollover passes with the device offline: the server has renewed,
    // the mirror still says the old end.
    vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 1 * DAY_MS)
    window.dispatchEvent(new Event('online'))

    expect(sub.isSubscribed.value).toBe(true)
  })

  it('(b) a renewing subscription is no longer paid eight days past its recorded period end', async () => {
    mirror(Date.now() + 30 * 60 * 1000, false)
    const sub = await setup(offline)
    await sub.initialize()
    expect(sub.isSubscribed.value).toBe(true)

    vi.setSystemTime(Date.now() + 30 * 60 * 1000 + 8 * DAY_MS)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(sub.isSubscribed.value).toBe(false)
  })

  it('(c) a subscription set to cancel at period end is not paid one minute past it (job #540 stands)', async () => {
    mirror(Date.now() + 30 * 60 * 1000, true)
    const sub = await setup(offline)
    await sub.initialize()
    expect(sub.isSubscribed.value).toBe(true)

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000)

    expect(sub.isSubscribed.value).toBe(false)
  })

  it('(d) an online refresh that returns a new period end overwrites the mirror', async () => {
    const oldEnd = Date.now() + 30 * 60 * 1000
    const newEnd = oldEnd + 30 * DAY_MS
    mirror(oldEnd, false)
    const answer = {
      subscription: subRecord(newEnd, false),
      isSubscribed: true,
      freeAccess: null,
    }
    const sub = await setup(() => Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(answer),
    }))
    await sub.initialize()

    expect(sub.subscription.value?.currentPeriodEnd).toBe(new Date(newEnd).toISOString())
    const persisted = JSON.parse(store['ssi_subscription'])
    expect(persisted.subscription.currentPeriodEnd).toBe(new Date(newEnd).toISOString())

    // Well past the old end plus the whole grace, but inside the new period.
    vi.setSystemTime(oldEnd + 10 * DAY_MS)
    window.dispatchEvent(new Event('focus'))
    expect(sub.isSubscribed.value).toBe(true)
  })
})
