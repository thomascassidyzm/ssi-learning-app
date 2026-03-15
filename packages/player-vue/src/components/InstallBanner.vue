<script setup lang="ts">
import { ref, inject, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const installPrompt = inject<ReturnType<typeof ref<any>>>('installPrompt', ref(null))

const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream

const visible = ref(false)

const DISMISS_KEY = 'ssi-install-dismissed'
const DISMISS_COUNT_KEY = 'ssi-install-dismiss-count'
const MAX_DISMISSALS = 3
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function shouldShow(): boolean {
  // Already installed — never show
  if (isStandalone) return false

  // Check permanent dismiss (user said no 3+ times)
  const dismissCount = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10)
  if (dismissCount >= MAX_DISMISSALS) return false

  // Check cooldown from last dismissal
  const dismissedAt = localStorage.getItem(DISMISS_KEY)
  if (dismissedAt) {
    const elapsed = Date.now() - parseInt(dismissedAt, 10)
    if (elapsed < COOLDOWN_MS) return false
  }

  return true
}

// Show after first round completes (user is invested)
function onRoundComplete() {
  if (shouldShow()) {
    visible.value = true
    // Only need to show once per session
    window.removeEventListener('ssi-round-complete', onRoundComplete)
  }
}

onMounted(() => {
  if (!shouldShow()) return

  // Listen for first round completion
  window.addEventListener('ssi-round-complete', onRoundComplete)
})

onUnmounted(() => {
  window.removeEventListener('ssi-round-complete', onRoundComplete)
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
  localStorage.setItem(DISMISS_KEY, Date.now().toString())
  const count = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) || '0', 10) + 1
  localStorage.setItem(DISMISS_COUNT_KEY, count.toString())
}
</script>

<template>
  <Transition name="slide-up">
    <div v-if="visible" class="install-banner">
      <div class="install-banner-content">
        <div class="install-banner-left">
          <img src="/icons/icon-192.png" alt="" width="36" height="36" class="install-banner-icon" />
          <div class="install-banner-text">
            <span class="install-banner-title">Add to Home Screen</span>
            <span class="install-banner-subtitle">Faster, offline, full-screen</span>
          </div>
        </div>
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
  padding: 10px 12px 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
  max-width: 420px;
  margin: 0 auto;
}

.install-banner-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.install-banner-icon {
  border-radius: 8px;
  flex-shrink: 0;
}

.install-banner-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.install-banner-title {
  font-size: 14px;
  color: var(--text-primary, #e8e3dd);
  font-weight: 600;
  white-space: nowrap;
}

.install-banner-subtitle {
  font-size: 12px;
  color: var(--text-secondary, #888);
  white-space: nowrap;
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
