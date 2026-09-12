import { describe, it, expect } from 'vitest'
import { navigationRoute } from './navigationRoute.js'
import { precachedShellPlugin } from './precachedShellPlugin.js'

// Pins the navigation policy the redeploy probe (e2e/sw-stale-shell-redeploy-probe.mjs)
// proved: the only cached shell is the precached one. A runtime copy in
// navigation-cache outlives a redeploy and, served once on a slow network,
// takes the whole offline install down with it (job #377).
describe('service worker navigation route', () => {
  it('matches document navigations only', () => {
    expect(navigationRoute.urlPattern({ request: { mode: 'navigate' } } as any)).toBe(true)
    expect(navigationRoute.urlPattern({ request: { mode: 'cors' } } as any)).toBe(false)
  })

  it('is NetworkFirst with a short timeout so deploys propagate and a slow network cannot strand the boot', () => {
    expect(navigationRoute.handler).toBe('NetworkFirst')
    expect(navigationRoute.options.networkTimeoutSeconds).toBe(3)
  })

  it('falls back to the precached shell on both paths, and never keeps a runtime copy', () => {
    expect(navigationRoute.options.plugins).toContain(precachedShellPlugin)
    expect(navigationRoute.options.precacheFallback).toEqual({ fallbackURL: 'index.html' })
    // An expiration policy would mean something is being stored. Nothing is.
    expect((navigationRoute.options as any).expiration).toBeUndefined()
  })
})
