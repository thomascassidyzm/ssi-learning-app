<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const installPrompt = inject<ReturnType<typeof ref<any>>>('installPrompt', ref(null))

const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream

const visible = ref(false)

onMounted(() => {
  if (isStandalone) return

  const dismissed = localStorage.getItem('ssi-install-dismissed')
  if (!dismissed) return

  const dismissedAt = parseInt(dismissed, 10)
  const sevenDays = 7 * 24 * 60 * 60 * 1000
  if (Date.now() - dismissedAt > sevenDays) return

  visible.value = true
})

function handleInstall() {
  if (isIOS || !installPrompt?.value) {
    router.push('/install')
    return
  }
  const prompt = installPrompt.value as any
  prompt.prompt()
  prompt.userChoiceResult?.then(() => {
    visible.value = false
  })
}

function dismiss() {
  visible.value = false
  localStorage.setItem('ssi-install-dismissed', Date.now().toString())
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="visible" class="install-banner">
      <div class="install-banner-content">
        <span class="install-banner-text">Install for a better experience</span>
        <div class="install-banner-actions">
          <button class="install-banner-cta" @click="handleInstall">Install</button>
          <button class="install-banner-dismiss" @click="dismiss" aria-label="Dismiss">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.install-banner {
  position: fixed;
  bottom: calc(var(--nav-height-safe, 100px) + 12px);
  left: 0;
  right: 0;
  z-index: 9999;
  padding: 0 16px;
  pointer-events: none;
}

.install-banner-content {
  background: var(--color-surface, #1a1a2e);
  border: 1px solid var(--color-border, #2a2a4a);
  border-radius: 12px;
  padding: 10px 12px 10px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  max-width: 400px;
  margin: 0 auto;
}

.install-banner-text {
  font-size: 14px;
  color: var(--text-primary, #e8e3dd);
  font-weight: 500;
}

.install-banner-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.install-banner-cta {
  background: var(--ssi-red, #c23a3a);
  color: #fff;
  border: none;
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
  font-family: inherit;
}
.install-banner-cta:hover {
  background: var(--ssi-red-light, #e54545);
}

.install-banner-dismiss {
  background: none;
  border: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 4px;
  display: flex;
  border-radius: 50%;
}
.install-banner-dismiss:hover {
  color: var(--text-primary, #e8e3dd);
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
