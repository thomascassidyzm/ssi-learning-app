<script setup lang="ts">
/**
 * PwaUpdatePrompt — Banner shown when a new service worker is waiting.
 *
 * Update button activates the new SW and reloads; Dismiss hides the banner
 * until the next SW update notification arrives.
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

// vite-plugin-pwa's updateServiceWorker(true) posts SKIP_WAITING and the
// library reloads on controllerchange. The 3s fallback covers a stuck SW
// or a misbehaving extension blocking the message.
function onUpdate() {
  console.log('[PWA] Updating...')
  needRefresh.value = false
  const fallback = setTimeout(() => {
    console.warn('[PWA] SW controlling event did not fire within 3s, forcing reload')
    window.location.reload()
  }, 3000)
  window.addEventListener('beforeunload', () => clearTimeout(fallback), { once: true })
  updateServiceWorker(true).catch((err) => {
    console.warn('[PWA] updateServiceWorker threw, forcing reload:', err)
    clearTimeout(fallback)
    window.location.reload()
  })
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
    <div v-if="needRefresh" class="pwa-update-banner" role="status" aria-live="polite">
      <div class="pwa-update-content">
        <span class="pwa-update-text">New version available</span>
        <div class="pwa-update-actions">
          <button class="pwa-update-dismiss" @click="onDismiss">
            Dismiss
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
  bottom: calc(68px + env(safe-area-inset-bottom, 0px) + 16px);
  left: 0;
  right: 0;
  z-index: 10000;
  padding: 0 16px;
  pointer-events: none;
}

.pwa-update-content {
  background: #1a1a2e;
  border: 1px solid #2a2a4a;
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
  color: #e0e0e0;
  font-size: 14px;
  font-weight: 500;
}

.pwa-update-actions {
  display: flex;
  gap: 8px;
}

.pwa-update-dismiss {
  background: transparent;
  border: 1px solid #2a2a4a;
  color: #888;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-dismiss:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
}

.pwa-update-button {
  background: var(--info, #60a5fa);
  border: none;
  color: #0b1220;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pwa-update-button:hover {
  filter: brightness(1.1);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(calc(100% + 32px));
  opacity: 0;
}
</style>
