/**
 * The payment-route seam. Two things this pins:
 *
 *  1. The route is DERIVED from the shell, and nothing else. Change the shell,
 *     every affordance changes with it — that is the whole point of there
 *     being one declaration.
 *  2. A store shell cannot take money until STORE_BILLING_WIRED flips (part 2),
 *     and institutional/seat purchase is gone from that BUILD entirely.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurePlatform, resetPlatform } from './capabilities'
import {
  INSTITUTIONAL_PURCHASE_IN_BUILD,
  STORE_BILLING_WIRED,
  canTakePayment,
  institutionalPurchaseAvailable,
  paddleBillingAvailable,
  paymentRoute,
} from './paymentRoute'

afterEach(() => {
  resetPlatform()
})

describe('paymentRoute', () => {
  it('is paddle on the web — today’s behaviour, unchanged', () => {
    resetPlatform()
    expect(paymentRoute()).toBe('paddle')
    expect(canTakePayment()).toBe(true)
    expect(paddleBillingAvailable()).toBe(true)
  })

  it('is store inside a native shell', () => {
    configurePlatform({ shell: 'webview' })
    expect(paymentRoute()).toBe('store')
  })

  it('cannot take payment in a native shell until Play Billing is wired', () => {
    configurePlatform({ shell: 'webview' })
    expect(STORE_BILLING_WIRED).toBe(false)
    expect(canTakePayment()).toBe(false)
  })

  it('never offers Paddle account machinery inside a native shell', () => {
    configurePlatform({ shell: 'webview' })
    expect(paddleBillingAvailable()).toBe(false)
  })

  it('never offers institutional/seat purchase inside a native shell', () => {
    configurePlatform({ shell: 'webview' })
    expect(institutionalPurchaseAvailable()).toBe(false)
  })

  it('keeps institutional purchase on a web build', () => {
    resetPlatform()
    expect(INSTITUTIONAL_PURCHASE_IN_BUILD).toBe(true)
    expect(institutionalPurchaseAvailable()).toBe(true)
  })
})

describe('a webview BUILD (not merely a webview runtime)', () => {
  it('drops institutional purchase from the build constant', async () => {
    vi.stubEnv('VITE_APP_SHELL', 'webview')
    vi.resetModules()
    const mod = await import('./paymentRoute')
    expect(mod.INSTITUTIONAL_PURCHASE_IN_BUILD).toBe(false)
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('registers no upgrade route in that build', async () => {
    vi.stubEnv('VITE_APP_SHELL', 'webview')
    vi.resetModules()
    const { default: router } = await import('@/router/index')
    const names = router.getRoutes().map((r) => r.name)
    expect(names).not.toContain('schools-upgrade')
    expect(names).not.toContain('org-upgrade')
    expect(names).not.toContain('teach-upgrade')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})
