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

// Expose the update action so the blue dot can trigger it
setApplyUpdate(() => {
  console.log('[PWA] Updating via blue dot...')
  updateAvailable.value = false
  updateServiceWorker(true)
  setTimeout(() => window.location.reload(), 100)
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
