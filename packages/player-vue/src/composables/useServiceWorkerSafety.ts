/**
 * useServiceWorkerSafety - Service worker safety controls
 *
 * Implements safety features for the PWA service worker:
 * 1. Remote kill switch - unregister SW if server flag is set
 * 2. Manual unregister - for debugging/support
 * 3. Cache clear - remove all cached content
 *
 * The kill switch is checked on app init. If enabled, the SW is
 * unregistered and the page reloads to serve fresh content.
 */

import { ref } from 'vue'

// ============================================================================
// TYPES
// ============================================================================

export interface ServiceWorkerConfig {
  /** Kill switch - unregister all service workers */
  killSwitch: boolean
  /** Force update - skip waiting and activate immediately */
  forceUpdate: boolean
  /** Message to show users (optional) */
  message?: string
}

// ============================================================================
// STATE
// ============================================================================

const isCheckingKillSwitch = ref(false)
const killSwitchError = ref<string | null>(null)
/** Set immediately before the kill switch unregisters/reloads — App.vue renders
 * this as an overlay so the reload isn't silent (trinity ledger LA offline #6). */
export const killSwitchMessage = ref<string | null>(null)

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Check the remote kill switch.
 *
 * Fetches /api/sw-config and if killSwitch is true:
 * 1. Unregisters all service workers
 * 2. Clears all caches
 * 3. Reloads the page
 *
 * Safe to call even if offline - catches errors silently.
 */
export async function checkKillSwitch(): Promise<boolean> {
  isCheckingKillSwitch.value = true
  killSwitchError.value = null

  try {
    // Fetch config with short timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const res = await fetch('/api/sw-config', {
      signal: controller.signal,
      cache: 'no-store', // Always fetch fresh
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      // Server returned error - assume no kill switch
      console.log('[SW Safety] Config endpoint returned', res.status, '- no action')
      return false
    }

    const config: ServiceWorkerConfig = await res.json()

    if (config.killSwitch) {
      // Guard against an infinite reload loop. The kill switch stays true until
      // an operator flips it off, but once we've unregistered + reloaded, the
      // page is already serving fresh content — re-running cleanup+reload on the
      // next mount would brick every client in a reload loop. sessionStorage
      // survives the reload (same tab session) but not a fresh visit, so each
      // new session still gets exactly one clean recovery pass.
      const GUARD_KEY = 'ssi-sw-killswitch-handled'
      let alreadyHandled = false
      try { alreadyHandled = sessionStorage.getItem(GUARD_KEY) === '1' } catch { /* storage blocked */ }

      if (alreadyHandled) {
        console.warn('[SW Safety] Kill switch already handled this session - not reloading again')
        return false
      }

      console.warn('[SW Safety] Kill switch ACTIVATED - unregistering service workers')

      // Show message if provided
      if (config.message) {
        console.warn('[SW Safety] Message:', config.message)
      }
      killSwitchMessage.value = config.message || 'Updating the app — this page will reload in a moment.'

      await unregisterAllServiceWorkers()
      await clearAllCaches()

      try { sessionStorage.setItem(GUARD_KEY, '1') } catch { /* storage blocked */ }

      // Give the overlay a moment to actually be seen before the reload
      // unmounts everything.
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Reload to get fresh content
      window.location.reload()
      return true
    }

    if (config.forceUpdate) {
      console.log('[SW Safety] Force update requested - triggering update')
      await triggerServiceWorkerUpdate()
    }

    return false
  } catch (error) {
    // Offline or network error - continue normally
    if ((error as Error).name === 'AbortError') {
      console.log('[SW Safety] Config check timed out - continuing normally')
    } else {
      console.log('[SW Safety] Config check failed (likely offline) - continuing normally')
    }
    return false
  } finally {
    isCheckingKillSwitch.value = false
  }
}

/**
 * Unregister all service workers.
 *
 * Use this for:
 * - Kill switch activation
 * - Manual recovery from SW issues
 * - Development/debugging
 */
export async function unregisterAllServiceWorkers(): Promise<number> {
  if (!('serviceWorker' in navigator)) {
    return 0
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    let unregistered = 0

    for (const registration of registrations) {
      const success = await registration.unregister()
      if (success) {
        unregistered++
        console.log('[SW Safety] Unregistered:', registration.scope)
      }
    }

    console.log(`[SW Safety] Unregistered ${unregistered} service workers`)
    return unregistered
  } catch (error) {
    console.error('[SW Safety] Failed to unregister service workers:', error)
    killSwitchError.value = (error as Error).message
    throw error
  }
}

/**
 * Clear all browser caches (Cache API).
 *
 * This removes:
 * - Workbox precache
 * - Runtime caches
 * - Any other Cache API storage
 *
 * Does NOT clear IndexedDB (audio cache). The ?reset=1 recovery path in
 * App.vue enumerates `indexedDB.databases()` and deletes each one — that
 * covers AudioCache (ssi-audio-cache-v2) and the bundle store
 * (ssi-course-bundles-v1) automatically.
 */
export async function clearAllCaches(): Promise<number> {
  if (!('caches' in window)) {
    return 0
  }

  try {
    const cacheNames = await caches.keys()
    let cleared = 0

    for (const cacheName of cacheNames) {
      const success = await caches.delete(cacheName)
      if (success) {
        cleared++
        console.log('[SW Safety] Deleted cache:', cacheName)
      }
    }

    console.log(`[SW Safety] Cleared ${cleared} caches`)
    return cleared
  } catch (error) {
    console.error('[SW Safety] Failed to clear caches:', error)
    killSwitchError.value = (error as Error).message
    throw error
  }
}

/**
 * Trigger service worker update.
 *
 * Asks the SW to check for updates and apply them.
 */
export async function triggerServiceWorkerUpdate(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }

  try {
    const registration = await navigator.serviceWorker.ready

    // Ask SW to check for updates
    await registration.update()

    // If there's a waiting worker, tell it to activate
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'SKIP_WAITING' })
    }
  } catch (error) {
    console.error('[SW Safety] Failed to trigger update:', error)
  }
}

