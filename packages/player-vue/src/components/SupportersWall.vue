<script setup>
import { computed, ref, onMounted } from 'vue'
import { useSharedSupporters } from '@/composables/useSupporters'
import { KOFI_PAGE_URL } from '@/config/supportConfig'
import { t } from '@/composables/useI18n'

const emit = defineEmits(['close'])

const { supporters, isLoading, fetchSupporters } = useSharedSupporters()

// Refresh on mount
onMounted(() => {
  fetchSupporters()
})

// Duplicate the list for seamless wrap-around scrolling
const tickerItems = computed(() => {
  if (supporters.value.length === 0) return []
  // Duplicate for seamless loop
  return [...supporters.value, ...supporters.value]
})

const openKofi = () => {
  window.open(KOFI_PAGE_URL, '_blank', 'noopener')
}

// Pause animation on touch
const isPaused = ref(false)
const handleTouchStart = () => { isPaused.value = true }
const handleTouchEnd = () => { isPaused.value = false }
</script>

<template>
  <div class="supporters-wall">
    <!-- Header -->
    <header class="wall-header">
      <button class="close-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5"/>
          <path d="M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1 class="wall-title">{{ t('support.wallTitle', 'Our Supporters') }}</h1>
      <div class="header-spacer"></div>
    </header>

    <!-- Content -->
    <div class="wall-content">
      <p class="wall-subtitle">{{ t('support.wallSubtitle', 'Thank you for keeping SSi free') }}</p>

      <!-- Loading state -->
      <div v-if="isLoading && supporters.length === 0" class="loading-state">
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
        <span class="loading-dot"></span>
      </div>

      <!-- Empty state -->
      <div v-else-if="supporters.length === 0" class="empty-state">
        <p>Be the first to support SSi!</p>
      </div>

      <!-- Scrolling ticker -->
      <div
        v-else
        class="ticker-container"
        @touchstart.passive="handleTouchStart"
        @touchend.passive="handleTouchEnd"
      >
        <div class="ticker-track" :class="{ 'is-paused': isPaused }">
          <div
            v-for="(supporter, i) in tickerItems"
            :key="i"
            class="ticker-item"
          >
            <span class="supporter-icon">{{ supporter.type === 'monthly' ? '\u2764\uFE0F' : '\u2615' }}</span>
            <span class="supporter-name">{{ supporter.display_name }}</span>
          </div>
        </div>
      </div>

      <!-- CTA -->
      <button class="support-cta" @click="openKofi">
        <span>\u2764\uFE0F</span>
        <span>{{ t('support.become', 'Become a Supporter') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.supporters-wall {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: var(--font-body);
}

/* Header */
.wall-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.close-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.close-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

.wall-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.header-spacer {
  width: 40px;
}

/* Content */
.wall-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 2rem 1.5rem;
  gap: 2rem;
}

.wall-subtitle {
  font-size: 0.9375rem;
  color: var(--text-muted);
  text-align: center;
  margin: 0;
}

/* Loading */
.loading-state {
  display: flex;
  gap: 0.5rem;
  padding: 2rem 0;
}

.loading-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: loading-pulse 1.4s ease-in-out infinite;
}

.loading-dot:nth-child(2) { animation-delay: 0.2s; }
.loading-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes loading-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

/* Empty state */
.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9375rem;
}

/* Ticker */
.ticker-container {
  width: 100%;
  overflow: hidden;
  padding: 1rem 0;
  mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
}

.ticker-track {
  display: flex;
  gap: 2rem;
  animation: ticker-scroll 30s linear infinite;
  width: max-content;
}

.ticker-track.is-paused {
  animation-play-state: paused;
}

@keyframes ticker-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}

.ticker-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
  white-space: nowrap;
  flex-shrink: 0;
}

.supporter-icon {
  font-size: 0.875rem;
}

.supporter-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

/* CTA */
.support-cta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.875rem 2rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 100px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.3);
  margin-top: auto;
}

.support-cta:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 28px rgba(194, 58, 58, 0.4);
}

.support-cta:active {
  transform: translateY(0);
}

/* Responsive */
@media (min-width: 768px) {
  .wall-content {
    max-width: 600px;
    margin: 0 auto;
    padding: 2.5rem;
  }

  .wall-subtitle {
    font-size: 1rem;
  }
}
</style>
