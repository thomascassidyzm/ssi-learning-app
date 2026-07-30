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
  shouldReloadForPreloadError,
  PRESERVE_CACHE_NAMES,
  HEAL_DEADLINE_MS,
  RELOAD_WEDGE_MS,
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

describe('shouldReloadForPreloadError', () => {
  it('reloads on the first stale-chunk error this session', () => {
    expect(shouldReloadForPreloadError(false)).toBe(true)
  })

  it('does not reload a second time this session', () => {
    expect(shouldReloadForPreloadError(true)).toBe(false)
  })
})
