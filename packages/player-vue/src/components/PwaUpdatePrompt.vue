<script setup lang="ts">
/**
 * PwaUpdatePrompt - Service worker update notification
 *
 * Shows a banner when a new version of the app is available.
 * Simplified: just reload the page when user clicks update.
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { onUnmounted } from 'vue'

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

function onUpdate() {
  console.log('[PWA] Updating...')
  // Tell SW to skip waiting, then reload
  updateServiceWorker(true)
  // Reload after a brief moment
  setTimeout(() => window.location.reload(), 100)
}

function onDismiss() {
  needRefresh.value = false
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
