/**
 * THE MOMENT AFTER SOMEBODY PAYS.
 *
 * Tom bought SSi Family on staging for £25 on 2026-09-07 (Paddle
 * txn_01m1z3xvyb4btxapme2v3mnrxx). Paddle took the money and emailed him a
 * confirmation. For several minutes the app showed him NOTHING — Settings went
 * on offering him the Upgrade row as though he had no subscription — and when
 * he tried again he was put into an endless spinner. His words: "its a shitty
 * process, race condition, looks like nothing has happened, then spins
 * endlessly".
 *
 * These are the four claims the fix makes. Every one of them fails on the
 * pre-fix code, where the client had only two states — subscribed and
 * not-subscribed — and a person who had just paid spent the gap in the second.
 *
 *   1. The purchase is acknowledged the instant Paddle says the payment
 *      succeeded, not when our webhook lands.
 *   2. It resolves: the poll runs, and the wording escalates honestly rather
 *      than spinning without end.
 *   3. The buy path is shut while it is in flight — no second purchase.
 *   4. It survives a reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, computed } from 'vue'

// The shared subscription, faked. `subscribed` is the webhook landing.
const subscribed = ref(false)
const refresh = vi.fn(async () => {})
vi.mock('./useSubscription', () => ({
  useSharedSubscription: () => ({
    isSubscribed: computed(() => subscribed.value),
    refresh,
  }),
}))

const openFamilyModal = vi.fn()
vi.mock('./useFamilyModal', () => ({ openFamilyModal: () => openFamilyModal() }))

import {
  usePendingPurchase,
  beginPendingPurchase,
  resumePendingPurchase,
  landPendingPurchase,
  dismissPendingPurchase,
  checkAgain,
  SLOW_AFTER_MS,
  STALLED_AFTER_MS,
} from './usePendingPurchase'
import { readPendingPurchase, savePendingPurchase } from '@/checkout/pendingPurchase'

beforeEach(() => {
  localStorage.clear()
  subscribed.value = false
  // Reset the module-level state between cases the way the app does when a
  // purchase resolves — BEFORE clearing the spies, since landing a Family
  // purchase legitimately opens the family screen.
  landPendingPurchase()
  refresh.mockClear()
  openFamilyModal.mockClear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the moment after somebody pays', () => {
  it('acknowledges the payment at once, without waiting on the webhook', () => {
    const state = usePendingPurchase()
    expect(state.isPending.value).toBe(false)

    beginPendingPurchase({ plan: 'family', billingPeriod: 'monthly', transactionId: 'txn_test_001' })

    // The webhook has NOT landed — this is exactly Tom's several minutes.
    expect(subscribed.value).toBe(false)
    // …and the app already knows a purchase happened, names it, and holds the
    // payment reference a support message would need.
    expect(state.isPending.value).toBe(true)
    expect(state.showOverlay.value).toBe(true)
    expect(state.phase.value).toBe('confirming')
    expect(state.pending.value?.plan).toBe('family')
    expect(state.pending.value?.transactionId).toBe('txn_test_001')
  })

  it('resolves rather than spinning: the wording escalates, then the plan lands', async () => {
    const state = usePendingPurchase()
    beginPendingPurchase({ plan: 'family', billingPeriod: 'monthly', transactionId: 'txn_test_002' })

    await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS + 1_000)
    expect(state.phase.value).toBe('slow')
    // It is genuinely asking, not decorating a wait.
    expect(refresh.mock.calls.length).toBeGreaterThan(1)

    await vi.advanceTimersByTimeAsync(STALLED_AFTER_MS)
    expect(state.phase.value).toBe('stalled')

    // The webhook finally lands. The wait ends by itself.
    subscribed.value = true
    await checkAgain()
    expect(state.phase.value).toBe('arrived')
  })

  it('lands a Family buyer on the screen where they add their family', () => {
    beginPendingPurchase({ plan: 'family', billingPeriod: 'monthly', transactionId: 'txn_test_003' })
    landPendingPurchase()
    expect(openFamilyModal).toHaveBeenCalledTimes(1)
    expect(readPendingPurchase()).toBeNull()
  })

  it('survives a reload — a refresh lands back in the waiting state', () => {
    beginPendingPurchase({ plan: 'family', billingPeriod: 'annual', transactionId: 'txn_test_004' })
    // The page goes away. Module memory goes with it; the record does not.
    dismissPendingPurchase()
    const onDisk = readPendingPurchase()
    expect(onDisk?.plan).toBe('family')
    expect(onDisk?.transactionId).toBe('txn_test_004')

    // A fresh boot picks it up rather than showing the not-subscribed state.
    const state = usePendingPurchase()
    resumePendingPurchase('')
    expect(state.isPending.value).toBe(true)
    expect(state.showOverlay.value).toBe(true)
  })

  it('picks up a success landing that arrived with no record at all', () => {
    const state = usePendingPurchase()
    resumePendingPurchase('?family=1&just_subscribed=1')
    expect(state.isPending.value).toBe(true)
    expect(state.pending.value?.plan).toBe('family')
  })

  it('stepping out of the waiting room does not un-buy anything', () => {
    const state = usePendingPurchase()
    beginPendingPurchase({ plan: 'premium', billingPeriod: 'monthly', transactionId: 'txn_test_005' })
    dismissPendingPurchase()
    // The overlay is down…
    expect(state.showOverlay.value).toBe(false)
    // …and the purchase is still in flight, so the buy path stays shut.
    expect(state.isPending.value).toBe(true)
  })

  it('refuses a stale record rather than trapping somebody in a waiting screen', () => {
    savePendingPurchase(
      { plan: 'family', billingPeriod: 'monthly', transactionId: 'txn_old' },
      Date.now() - 25 * 60 * 60 * 1000,
    )
    expect(readPendingPurchase()).toBeNull()
  })
})
