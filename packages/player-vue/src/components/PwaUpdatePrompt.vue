<script setup lang="ts">
/**
 * PwaUpdatePrompt - Service worker update notification
 *
 * Shows a banner when a new version of the app is available.
 * User must approve the update (registerType: 'prompt' in vite.config.js).
 *
 * This prevents mid-session surprises during learning.
 *
 * Android fix: Check for updates periodically since Android Chrome
 * doesn't always detect service worker updates reliably.
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { ref, onMounted, onUnmounted } from 'vue'

const isUpdating = ref(false)
let updateCheckInterval: ReturnType<typeof setInterval> | null = null

// Timeout fallback - if update takes too long, force reload anyway
let updateTimeout: ReturnType<typeof setTimeout> | null = null

function startUpdateTimeout() {
  updateTimeout = setTimeout(() => {
    if (isUpdating.value) {
      console.warn('[PWA] Update timed out after 3s, forcing reload...')
      forceHardReload()
    }
  }, 3000)  // 3 second timeout (reduced from 5)
}

// Force reload with aggressive cache bypass
function forceHardReload() {
  console.log('[PWA] Forcing hard reload...')
  // Clear the timeout flag
  isUpdating.value = false

  // Try to clear caches in background, but don't wait for it
  if ('caches' in window) {
    caches.keys().then(names => {
      names.forEach(name => caches.delete(name).catch(() => {}))
    }).catch(() => {})
  }

  // Reload immediately - don't wait for cache clearing
  // Add cache-busting query param to force fresh fetch
  const url = new URL(window.location.href)
  url.searchParams.set('_reload', Date.now().toString())
  window.location.href = url.toString()
}

const {
  needRefresh,
  updateServiceWorker,
} = useRegisterSW({
  immediate: true,  // Register immediately
  onRegistered(registration) {
    console.log('[PWA] Service worker registered:', registration)

    // Android fix: Check for updates periodically (every 60 seconds when app is open)
    // This helps detect updates that Android Chrome might miss
    if (registration) {
      updateCheckInterval = setInterval(() => {
        console.log('[PWA] Checking for updates...')
        registration.update().catch((err) => {
          console.warn('[PWA] Update check failed:', err)
        })
      }, 60 * 1000)  // Check every minute
    }
  },
  onRegisterError(error) {
    console.error('[PWA] Service worker registration error:', error)
  },
  onNeedRefresh() {
    console.log('[PWA] New content available, showing update prompt')
  },
})

async function onUpdate() {
  console.log('[PWA] User clicked update, applying...')
  isUpdating.value = true
  startUpdateTimeout()  // Fallback if update gets stuck (3 seconds)

  // Fire-and-forget: try to update SW, but don't wait
  updateServiceWorker(true).catch(err => {
    console.warn('[PWA] updateServiceWorker error (non-fatal):', err)
  })

  // Also try to message the service worker directly
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' })
  }

  // Clear caches in background (don't await)
  if ('caches' in window) {
    caches.keys().then(names => {
      console.log('[PWA] Clearing caches:', names)
      names.forEach(name => caches.delete(name).catch(() => {}))
    }).catch(() => {})
  }

  // Quick delay then reload - don't wait for anything
  setTimeout(() => {
    console.log('[PWA] Reloading...')
    forceHardReload()
  }, 300)
}

function onDismiss() {
  needRefresh.value = false
}

onUnmounted(() => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval)
  }
  if (updateTimeout) {
    clearTimeout(updateTimeout)
  }
})
</script>

<template>
  <Transition name="slide-up">
    <div v-if="needRefresh" class="pwa-update-banner">
      <div class="pwa-update-content">
        <span class="pwa-update-text">{{ isUpdating ? 'Updating...' : 'New version available' }}</span>
        <div class="pwa-update-actions">
          <button class="pwa-update-dismiss" @click="onDismiss" :disabled="isUpdating">
            Later
          </button>
          <button class="pwa-update-button" @click="onUpdate" :disabled="isUpdating">
            {{ isUpdating ? 'Please wait' : 'Update' }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-update-banner {
  position: fixed;
  /* Position above BottomNav (68px + safe area + breathing room) */
  bottom: calc(68px + env(safe-area-inset-bottom, 0px) + 16px);
  left: 0;
  right: 0;
  z-index: 10000;
  padding: 0 16px;
  pointer-events: none;
}

.pwa-update-content {
  background: var(--color-surface, #1a1a2e);
  border: 1px solid var(--color-border, #2a2a4a);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  max-width: 400px;
  margin: 0 auto;
}

.pwa-update-text {
  color: var(--color-text, #e0e0e0);
  font-size: 14px;
  font-weight: 500;
}

.pwa-update-actions {
  display: flex;
  gap: 8px;
}

.pwa-update-dismiss {
  background: transparent;
  border: 1px solid var(--color-border, #2a2a4a);
  color: var(--color-text-muted, #888);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-dismiss:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text, #e0e0e0);
}

.pwa-update-button {
  background: var(--color-accent, #4a90d9);
  border: none;
  color: white;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-button:hover {
  background: var(--color-accent-hover, #5a9fe9);
  transform: translateY(-1px);
}

.pwa-update-button:active {
  transform: translateY(0);
}

.pwa-update-button:disabled,
.pwa-update-dismiss:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none;
}

/* Transition animations */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
