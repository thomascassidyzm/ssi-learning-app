<script setup lang="ts">
/**
 * PwaUpdatePrompt - Headless SW update manager
 *
 * No UI — just registers the SW, checks for updates, and sets shared state.
 * The blue dot on the SaySomethingin logo (in LearningPlayer) is the only indicator.
 * Clicking the dot triggers the update via applyUpdate().
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { onUnmounted, watch } from 'vue'
import { updateAvailable, setApplyUpdate } from '@/composables/usePwaUpdate'

let updateCheckInterval: ReturnType<typeof setInterval> | null = null

const {
  needRefresh,
  updateServiceWorker,
} = useRegisterSW({
  immediate: true,
  onRegistered(registration) {
    console.log('[PWA] Service worker registered')

    // Check for updates every 60 seconds
    if (registration) {
      updateCheckInterval = setInterval(() => {
        registration.update().catch(() => {})
      }, 60 * 1000)
    }
  },
  onRegisterError(error) {
    console.error('[PWA] Service worker registration error:', error)
  },
})

// Sync shared state so the blue dot shows anywhere in the app
watch(needRefresh, (v) => { updateAvailable.value = v }, { immediate: true })

// Expose the update action so the blue dot can trigger it.
//
// How vite-plugin-pwa's updateServiceWorker actually works (v1.2.0):
//   1. Posts SKIP_WAITING to the waiting service worker.
//   2. The library has already registered a 'controlling' event listener
//      that calls window.location.reload() once the new SW takes control.
//   3. The returned Promise resolves as soon as the message is posted —
//      it does NOT wait for the SW to claim clients.
//
// So we just call it (no await helps) and let the library handle the
// reload at the right moment. A 3s safety fallback forces a reload if
// the 'controlling' event never fires — e.g. a stuck SW or a misbehaving
// extension blocking the message.
setApplyUpdate(() => {
  console.log('[PWA] Updating via blue dot...')
  updateAvailable.value = false
  // The library reloads the page itself when the new SW takes control.
  // If that doesn't happen within 3s, force a reload as last resort.
  const fallback = setTimeout(() => {
    console.warn('[PWA] SW controlling event did not fire within 3s, forcing reload')
    window.location.reload()
  }, 3000)
  // Prevent a double reload: if the library reloads first, clear the
  // fallback when the page is about to unload.
  window.addEventListener('beforeunload', () => clearTimeout(fallback), { once: true })
  updateServiceWorker(true).catch((err) => {
    console.warn('[PWA] updateServiceWorker threw, forcing reload:', err)
    clearTimeout(fallback)
    window.location.reload()
  })
})

onUnmounted(() => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval)
  }
})
</script>

<template>
  <!-- Headless — no UI, blue dot is in LearningPlayer -->
</template>
