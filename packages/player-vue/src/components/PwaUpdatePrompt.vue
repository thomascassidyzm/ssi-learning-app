<script setup lang="ts">
/**
 * PwaUpdatePrompt - Service worker update notification
 *
 * Shows a banner when a new version of the app is available.
 * User must approve the update (registerType: 'prompt' in vite.config.js).
 *
 * This prevents mid-session surprises during learning.
 */
import { useRegisterSW } from 'virtual:pwa-register/vue'

const {
  needRefresh,
  updateServiceWorker,
} = useRegisterSW({
  onRegistered(registration) {
    console.log('[PWA] Service worker registered:', registration)
  },
  onRegisterError(error) {
    console.error('[PWA] Service worker registration error:', error)
  },
})

function onUpdate() {
  updateServiceWorker(true)
}

function onDismiss() {
  needRefresh.value = false
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="needRefresh" class="pwa-update-banner">
      <div class="pwa-update-content">
        <span class="pwa-update-text">New version available</span>
        <div class="pwa-update-actions">
          <button class="pwa-update-dismiss" @click="onDismiss">
            Later
          </button>
          <button class="pwa-update-button" @click="onUpdate">
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
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10000;
  padding: 0 16px 16px;
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
