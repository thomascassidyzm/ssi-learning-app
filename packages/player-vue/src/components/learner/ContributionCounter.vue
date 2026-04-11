<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

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

onMounted(() => resetFadeTimer())
onUnmounted(() => { if (fadeTimer) clearTimeout(fadeTimer) })

// Watch playing state changes via the prop
const watchPlaying = computed(() => props.isPlaying)

// Reset fade when playing state changes
let lastPlaying = props.isPlaying
const checkPlaying = () => {
  if (props.isPlaying !== lastPlaying) {
    lastPlaying = props.isPlaying
    resetFadeTimer()
  }
}
// Use polling since we can't watch props reactively in setup without a watcher
const pollInterval = setInterval(checkPlaying, 500)
onUnmounted(() => clearInterval(pollInterval))

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}
</script>

<template>
  <button
    class="contribution-badge"
    :class="{ faded: isFaded && isPlaying }"
    @click="emit('expand')"
    @mouseenter="isFaded = false"
    :title="`${languageName} spoken today — tap for details`"
  >
    <span class="badge-icon">🗣️</span>
    <span class="badge-text">
      {{ formatNumber(globalMinutes) }} mins today
      <span v-if="userPhrases > 0" class="badge-yours">(+{{ userPhrases }} yours)</span>
    </span>
  </button>
</template>

<style scoped>
.contribution-badge {
  position: fixed;
  top: 12px;
  left: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  font-size: 0.6875rem;
  cursor: pointer;
  z-index: 100;
  transition: opacity 0.5s ease, transform 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.contribution-badge:hover {
  opacity: 1 !important;
  background: rgba(0, 0, 0, 0.75);
  border-color: rgba(255, 255, 255, 0.15);
  transform: scale(1.02);
}

.contribution-badge.faded {
  opacity: 0.3;
}

.badge-icon {
  font-size: 0.875rem;
  line-height: 1;
}

.badge-text {
  font-family: 'Space Mono', monospace;
  white-space: nowrap;
}

.badge-yours {
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
}

@media (max-width: 480px) {
  .contribution-badge {
    top: 8px;
    left: 8px;
    padding: 5px 10px;
    font-size: 0.625rem;
  }
}
</style>
