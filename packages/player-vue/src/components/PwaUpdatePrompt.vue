<script setup lang="ts">
/**
 * PwaUpdatePrompt - Service worker update notification
 *
 * Shows a banner when a new version of the app is available.
 * Simplified: just reload the page when user clicks update.
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { onUnmounted, watch } from 'vue'
import { updateAvailable } from '@/composables/usePwaUpdate'

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

// Sync shared state so the blue dot can show anywhere in the app
watch(needRefresh, (v) => { updateAvailable.value = v }, { immediate: true })

function onUpdate() {
  console.log('[PWA] Updating...')
  updateAvailable.value = false
  // Tell SW to skip waiting, then reload
  updateServiceWorker(true)
  setTimeout(() => window.location.reload(), 100)
}

function onDismiss() {
  needRefresh.value = false
  // Keep updateAvailable true — blue dot persists until they actually update
}

onUnmounted(() => {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval)
  }
})
</script>

<template>
  <Transition name="slide-up">
    <div v-if="needRefresh" class="pwa-update-banner" @click="onUpdate">
      <div class="pwa-update-content">
        <span class="pwa-update-text">New version available</span>
        <div class="pwa-update-actions">
          <button class="pwa-update-dismiss" @click.stop="onDismiss">
            Later
          </button>
          <button class="pwa-update-button">
            Update
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-update-banner {
  position: fixed;
  bottom: calc(68px + env(safe-area-inset-bottom, 0px) + 16px);
  left: 0;
  right: 0;
  z-index: 10000;
  padding: 0 16px;
  pointer-events: none;
  cursor: pointer;
}

.pwa-update-content {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  pointer-events: auto;
  max-width: 400px;
  margin: 0 auto;
}

.pwa-update-text {
  color: #333;
  font-size: 14px;
  font-weight: 500;
}

.pwa-update-actions {
  display: flex;
  gap: 8px;
}

.pwa-update-dismiss {
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: #888;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-dismiss:hover {
  background: rgba(0, 0, 0, 0.04);
  color: #333;
}

.pwa-update-button {
  background: #007AFF;
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
  background: #0066DD;
}

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
