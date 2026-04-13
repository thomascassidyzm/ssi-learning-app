<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps<{
  languageName: string
  globalMinutes: number
  userPhrases: number
  isPlaying: boolean
}>()

const emit = defineEmits<{
  expand: []
}>()

// Fade out after 5s of playing, show on pause/idle
const isFaded = ref(false)
let fadeTimer: ReturnType<typeof setTimeout> | null = null

function resetFadeTimer() {
  isFaded.value = false
  if (fadeTimer) clearTimeout(fadeTimer)
  if (props.isPlaying) {
    fadeTimer = setTimeout(() => { isFaded.value = true }, 5000)
  }
}

watch(() => props.isPlaying, () => resetFadeTimer())
onMounted(() => resetFadeTimer())
onUnmounted(() => { if (fadeTimer) clearTimeout(fadeTimer) })

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}
</script>

<template>
  <button
    class="contribution-counter"
    :class="{ faded: isFaded && isPlaying }"
    @click="emit('expand')"
    @mouseenter="isFaded = false"
    :title="`${languageName} spoken today — tap for details`"
  >
    <span class="counter-number">{{ formatNumber(globalMinutes) }}</span>
    <span class="counter-label">mins of {{ languageName }} today</span>
  </button>
</template>

<style scoped>
.contribution-counter {
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 10px);
  left: 16px;
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  z-index: 100;
  transition: opacity 0.6s ease;
  -webkit-tap-highlight-color: transparent;
}

.contribution-counter:hover {
  opacity: 1 !important;
}

.contribution-counter.faded {
  opacity: 0;
}

.counter-number {
  font-family: 'Space Mono', 'SF Mono', monospace;
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgba(44, 38, 34, 0.5);
}

.counter-label {
  font-size: 0.6875rem;
  font-weight: 400;
  color: rgba(44, 38, 34, 0.35);
  letter-spacing: 0.01em;
}

@media (max-width: 480px) {
  .contribution-counter {
    left: 12px;
  }
  .counter-number {
    font-size: 0.75rem;
  }
  .counter-label {
    font-size: 0.625rem;
  }
}
</style>
