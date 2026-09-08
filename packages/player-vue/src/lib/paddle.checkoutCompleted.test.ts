/**
 * ONE HOOK, TWO LISTENERS — AND IT MUST STAY THAT WAY.
 *
 * Paddle accepts exactly ONE `eventCallback`, handed to it at initialisation.
 * Two jobs landed on the same night both needing to know the moment a checkout
 * completes:
 *
 *   #360 — useSubscription drops its cached pre-purchase answer and converges,
 *          so a buyer stops being shown the Upgrade row they have just paid to
 *          be rid of.
 *   #361 — useCheckout puts the buyer into a waiting state that says the
 *          payment is confirmed, and shows the payment reference.
 *
 * #361 first shipped its own fan-out on `eventCallback`. That REPLACED #360's
 * callback, silently: a paying customer would have seen the Upgrade row again,
 * and no test on either branch would have gone red, because each branch only
 * had its own. Caught in review before either merged.
 *
 * So the contract is here, in one test, on the module that owns the hook.
 * Anything that wants the signal listens for the DOM event; nothing else ever
 * takes `eventCallback` again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { initializePaddle } = vi.hoisted(() => ({ initializePaddle: vi.fn() }))
vi.mock('@paddle/paddle-js', () => ({ initializePaddle }))

import { CHECKOUT_COMPLETED_EVENT } from './checkoutEvents'

/** The one callback Paddle was handed at initialisation. */
let eventCallback: ((event: unknown) => void) | undefined

beforeEach(async () => {
  vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', 'test_token')
  initializePaddle.mockImplementation(async (opts: any) => {
    eventCallback = opts.eventCallback
    return { Checkout: { open: vi.fn(), close: vi.fn() } }
  })
  // Imported dynamically, AFTER the env stub: paddleConfig reads the client
  // token at module load, so a static import would evaluate it too early.
  const { getPaddle } = await import('./paddle')
  await getPaddle()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the single Paddle completion hook', () => {
  it('is taken by lib/paddle and re-broadcast, so more than one listener can have it', () => {
    expect(eventCallback).toBeTypeOf('function')

    // Two independent listeners, exactly as #360 and #361 are in the app.
    const converge = vi.fn()
    const acknowledge = vi.fn()
    window.addEventListener(CHECKOUT_COMPLETED_EVENT, converge)
    window.addEventListener(CHECKOUT_COMPLETED_EVENT, acknowledge)

    eventCallback!({ name: 'checkout.completed', data: { transaction_id: 'txn_shared' } })

    // BOTH hear it. This is the assertion that a second eventCallback would
    // have broken, and the reason the fan-out lives on the DOM event.
    expect(converge).toHaveBeenCalledTimes(1)
    expect(acknowledge).toHaveBeenCalledTimes(1)

    window.removeEventListener(CHECKOUT_COMPLETED_EVENT, converge)
    window.removeEventListener(CHECKOUT_COMPLETED_EVENT, acknowledge)
  })

  it('carries the transaction id, so the waiting state can show a payment reference', () => {
    let detail: any = null
    const listener = (e: Event) => { detail = (e as CustomEvent).detail }
    window.addEventListener(CHECKOUT_COMPLETED_EVENT, listener)

    eventCallback!({ name: 'checkout.completed', data: { transaction_id: 'txn_01m1z3xvyb4btxapme2v3mnrxx' } })

    expect(detail?.transactionId).toBe('txn_01m1z3xvyb4btxapme2v3mnrxx')
    window.removeEventListener(CHECKOUT_COMPLETED_EVENT, listener)
  })

  it('says nothing on any other Paddle event', () => {
    const listener = vi.fn()
    window.addEventListener(CHECKOUT_COMPLETED_EVENT, listener)

    eventCallback!({ name: 'checkout.loaded' })
    eventCallback!({ name: 'checkout.payment.failed' })

    expect(listener).not.toHaveBeenCalled()
    window.removeEventListener(CHECKOUT_COMPLETED_EVENT, listener)
  })
})
