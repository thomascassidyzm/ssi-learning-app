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
      console.warn('[SW Safety] Kill switch ACTIVATED - unregistering service workers')

      // Show message if provided
      if (config.message) {
        console.warn('[SW Safety] Message:', config.message)
      }

      await unregisterAllServiceWorkers()
      await clearAllCaches()

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
 * Does NOT clear IndexedDB (audio cache) - use useOfflineCache.clearCache() for that.
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

/**
 * Get service worker status.
 */
export async function getServiceWorkerStatus(): Promise<{
  supported: boolean
  registered: boolean
  active: boolean
  waiting: boolean
  scope?: string
}> {
  if (!('serviceWorker' in navigator)) {
    return { supported: false, registered: false, active: false, waiting: false }
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()

    if (registrations.length === 0) {
      return { supported: true, registered: false, active: false, waiting: false }
    }

    const registration = registrations[0]
    return {
      supported: true,
      registered: true,
      active: !!registration.active,
      waiting: !!registration.waiting,
      scope: registration.scope,
    }
  } catch (error) {
    console.error('[SW Safety] Failed to get status:', error)
    return { supported: true, registered: false, active: false, waiting: false }
  }
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useServiceWorkerSafety() {
  return {
    // State
    isCheckingKillSwitch,
    killSwitchError,

    // Actions
    checkKillSwitch,
    unregisterAllServiceWorkers,
    clearAllCaches,
    triggerServiceWorkerUpdate,
    getServiceWorkerStatus,
  }
}

export type ServiceWorkerSafetyComposable = ReturnType<typeof useServiceWorkerSafety>
