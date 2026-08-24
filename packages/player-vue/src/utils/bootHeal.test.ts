/**
 * bootHeal — the never-wedge boot ladder's decision logic (Stage 1,
 * docs/pwa-lifecycle-design.md §2.1). Enumerates the live states the inline
 * watchdog in index.html hand-mirrors, per the 5f4a8b1d lesson (verify every
 * state a sweep/ladder touches, don't just eyeball the happy path).
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  nextHealDecision,
  cachesToClear,
  shouldArmBootWatchdog,
  shouldHealOnBootFailure,
  shouldServeCachedShell,
  isDeployFatalResourceUrl,
  shouldReloadForPreloadError,
  PRESERVE_CACHE_NAMES,
  HEAL_DEADLINE_MS,
  RELOAD_WEDGE_MS,
  CACHED_SHELL_FALLBACK_MS,
  isSwapGuardActive,
  SWAP_GUARD_MS,
} from './bootHeal'

describe('nextHealDecision', () => {
  it('heals on the first failure', () => {
    expect(nextHealDecision(0, 2)).toEqual({ action: 'heal', nextAttempts: 1 })
  })

  it('heals on the second failure', () => {
    expect(nextHealDecision(1, 2)).toEqual({ action: 'heal', nextAttempts: 2 })
  })

  it('drops to the floor once max attempts is reached', () => {
    expect(nextHealDecision(2, 2)).toEqual({ action: 'floor' })
  })

  it('stays at the floor beyond max attempts (never reload-loops)', () => {
    expect(nextHealDecision(3, 2)).toEqual({ action: 'floor' })
  })
})

describe('cachesToClear', () => {
  it('removes every cache except the preserve list', () => {
    expect(cachesToClear(['workbox-precache-v2', 'ssi-auth-handoff', 'navigation-cache'])).toEqual([
      'workbox-precache-v2',
      'navigation-cache',
    ])
  })

  it('returns empty when there is nothing to clear', () => {
    expect(cachesToClear([])).toEqual([])
  })

  it('returns empty when only the preserved cache exists', () => {
    expect(cachesToClear(['ssi-auth-handoff'])).toEqual([])
  })

  it('defaults to PRESERVE_CACHE_NAMES', () => {
    expect(PRESERVE_CACHE_NAMES).toContain('ssi-auth-handoff')
  })

  it('respects a custom preserve list', () => {
    expect(cachesToClear(['a', 'b'], ['a'])).toEqual(['b'])
  })
})

describe('shouldArmBootWatchdog', () => {
  it('arms when a service worker already controls the page', () => {
    expect(shouldArmBootWatchdog(true)).toBe(true)
  })

  it('never arms on a first-ever visit (no controller yet)', () => {
    expect(shouldArmBootWatchdog(false)).toBe(false)
  })
})

describe('inline watchdog lockstep (index.html hand-mirrors this module)', () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
    'utf8',
  )

  it('mirrors HEAL_DEADLINE_MS', () => {
    expect(html).toContain(`var HEAL_DEADLINE_MS = ${HEAL_DEADLINE_MS};`)
  })

  it('mirrors RELOAD_WEDGE_MS', () => {
    expect(html).toContain(`var RELOAD_WEDGE_MS = ${RELOAD_WEDGE_MS};`)
  })

  it('mirrors the preserve list', () => {
    expect(html).toContain(`var PRESERVE_CACHES = ${JSON.stringify(PRESERVE_CACHE_NAMES).replace(/"/g, "'")};`)
  })

  it('never leaves the heal screen without a reload path (deadline armed before cleanup)', () => {
    // The deadline reload must be scheduled BEFORE the cleanup promises are
    // awaited — a hanging Cache API promise must not delay it.
    const deadlineIdx = html.indexOf('setTimeout(reloadOnce, HEAL_DEADLINE_MS)')
    const cleanupIdx = html.indexOf('Promise.all([unregister, clearCaches])')
    expect(deadlineIdx).toBeGreaterThan(-1)
    expect(cleanupIdx).toBeGreaterThan(deadlineIdx)
  })

  it('escalates a wedged reload to a tap-to-relaunch affordance', () => {
    expect(html).toContain('setTimeout(showRelaunch, RELOAD_WEDGE_MS)')
    expect(html).toContain('Tap to relaunch')
  })
})

describe('shouldHealOnBootFailure — the live-network guard (always-play invariant)', () => {
  it('heals when the network actually answered (a genuine broken deploy)', () => {
    expect(shouldHealOnBootFailure(true)).toBe(true)
  })

  it('NEVER heals offline — healing deletes the SW + precache, the only thing that makes offline work', () => {
    expect(shouldHealOnBootFailure(false)).toBe(false)
  })

  it('NEVER heals on lie-fi — a weak signal claims to be online but never answers', () => {
    // The 2026-08-16 white screen: navigator.onLine === true, every request
    // hangs. The guard takes "did the network answer", not "does the browser
    // claim to be online", precisely so this case cannot nuke the install.
    const claimsOnline = true
    const networkAnswered = false
    expect(shouldHealOnBootFailure(networkAnswered)).toBe(false)
    expect(claimsOnline).toBe(true)
  })
})

describe('shouldServeCachedShell — the weak-signal recovery', () => {
  it('serves the cached shell when the boot stalled and we hold one', () => {
    expect(shouldServeCachedShell(false, true, false)).toBe(true)
  })

  it('does nothing once the app has booted', () => {
    expect(shouldServeCachedShell(true, true, false)).toBe(false)
  })

  it('does nothing on a first visit — there is no cached shell to fall back to', () => {
    expect(shouldServeCachedShell(false, false, false)).toBe(false)
  })

  it('does not swap twice without a successful boot in between — no loop', () => {
    expect(shouldServeCachedShell(false, true, true)).toBe(false)
  })

  it('rescues a SECOND reload on a weak signal, because a boot clears the guard', () => {
    // The guard is cleared on mount, so the next stalled boot sees false and
    // is rescued again. Without this, reload two was Tom's permanent white
    // screen.
    const guardAfterASuccessfulBoot = false
    expect(shouldServeCachedShell(false, true, guardAfterASuccessfulBoot)).toBe(true)
  })

  it('suppresses a re-swap that comes straight back — the loop case', () => {
    expect(isSwapGuardActive(1_000_000, 1_003_000)).toBe(true)
  })

  it('expires, so a later reload on the same bad signal is rescued again', () => {
    expect(isSwapGuardActive(1_000_000, 1_000_000 + SWAP_GUARD_MS + 1)).toBe(false)
  })

  it('is inactive when nothing was ever swapped', () => {
    expect(isSwapGuardActive(null, 1_000_000)).toBe(false)
    expect(isSwapGuardActive(NaN, 1_000_000)).toBe(false)
  })

  it('gives the network less time than the deploy-broken deadline', () => {
    expect(CACHED_SHELL_FALLBACK_MS).toBeLessThan(15000)
    // Inside the "3/4 secs" airplane-mode experience Tom calls good.
    expect(CACHED_SHELL_FALLBACK_MS).toBeLessThanOrEqual(4000)
  })
})

describe('isDeployFatalResourceUrl — fast-path scope', () => {
  const origin = 'https://saysomethingin.app'

  it('same-origin entry-graph failures are deploy-fatal', () => {
    expect(isDeployFatalResourceUrl('https://saysomethingin.app/assets/index-abc.js', origin)).toBe(true)
  })

  it('cross-origin failures (Google Fonts, ad-blocked CDNs) never nuke the install', () => {
    expect(isDeployFatalResourceUrl('https://fonts.googleapis.com/css2?family=Arsenal', origin)).toBe(false)
  })

  it('a lookalike origin prefix does not count as same-origin', () => {
    expect(isDeployFatalResourceUrl('https://saysomethingin.app.evil.com/x.js', origin)).toBe(false)
  })
})

describe('inline watchdog mirrors the live-network + same-origin guards', () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../index.html'),
    'utf8',
  )

  it('proves a live network by asking for an answer, not by asking navigator.onLine', () => {
    expect(html).toContain('function networkAnswers()')
    expect(html).toContain("cache: 'no-store'")
    // The flag that lied on a weak signal must not gate anything in the
    // watchdog's CODE any more. It still appears in the comments explaining
    // why, so strip those before asserting.
    const code = html.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toContain('navigator.onLine')
  })

  it('fast path heals only when the network answered, and falls back to cache when it did not', () => {
    expect(html).toContain('if (answered) heal();')
    expect(html).toContain('else serveCachedShell();')
  })

  it('fast path only heals same-origin resources', () => {
    expect(html).toContain("url.indexOf(window.location.origin + '/') !== 0")
  })

  it('slow path requires a network answer before healing', () => {
    expect(html).toContain('if (!window.__SSI_BOOTED && answered) heal();')
  })

  it('serves the precached shell when the boot stalls, ignoring the revision query', () => {
    expect(html).toContain("caches.match('/index.html', { ignoreSearch: true })")
  })

  it('uses the same stall budget as CACHED_SHELL_FALLBACK_MS', () => {
    expect(html).toContain(`}, ${CACHED_SHELL_FALLBACK_MS});`)
  })

  it('clears the swap guard once the app mounts, so a second bad reload is rescued too', () => {
    expect(html).toContain('sessionStorage.removeItem(SWAP_KEY)')
  })

  it('expires the swap guard on the same window as SWAP_GUARD_MS', () => {
    expect(html).toContain(`var SWAP_GUARD_MS = ${SWAP_GUARD_MS};`)
  })
})

describe('shouldReloadForPreloadError', () => {
  it('reloads on the first stale-chunk error this session', () => {
    expect(shouldReloadForPreloadError(false)).toBe(true)
  })

  it('does not reload a second time this session', () => {
    expect(shouldReloadForPreloadError(true)).toBe(false)
  })
})
