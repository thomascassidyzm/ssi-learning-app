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
// updateServiceWorker(true) tells the waiting SW to skipWaiting and
// resolves once the new SW has claimed clients (Workbox is configured
// with clientsClaim: true). Awaiting it means the reload serves fresh
// content from the new SW — no race, no stale-old-SW-for-100ms window.
// A 1.5s safety fallback guarantees we reload even if the SW update
// promise hangs (misconfigured CDN, extension interference, etc.).
setApplyUpdate(async () => {
  console.log('[PWA] Updating via blue dot...')
  updateAvailable.value = false
  let reloaded = false
  const reload = () => {
    if (reloaded) return
    reloaded = true
    window.location.reload()
  }
  const fallback = setTimeout(reload, 1500)
  try {
    await updateServiceWorker(true)
  } catch (err) {
    console.warn('[PWA] updateServiceWorker threw, reloading anyway:', err)
  } finally {
    clearTimeout(fallback)
    reload()
  }
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
