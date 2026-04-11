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
  top: calc(env(safe-area-inset-top, 0px) + 8px);
  left: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(0, 0, 0, 0.12);
  border-radius: 20px;
  color: #6B6560;
  font-size: 0.6875rem;
  cursor: pointer;
  z-index: 100;
  transition: opacity 0.5s ease, transform 0.2s ease, box-shadow 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.contribution-badge:hover {
  opacity: 1 !important;
  background: rgba(255, 255, 255, 0.98);
  border-color: rgba(0, 0, 0, 0.2);
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.contribution-badge.faded {
  opacity: 0.4;
}

.badge-icon {
  font-size: 0.875rem;
  line-height: 1;
}

.badge-text {
  font-family: 'Space Mono', monospace;
  white-space: nowrap;
  font-weight: 500;
}

.badge-yours {
  color: #A09A94;
  font-weight: 400;
}

@media (max-width: 480px) {
  .contribution-badge {
    top: calc(env(safe-area-inset-top, 0px) + 8px);
    left: 8px;
    padding: 5px 10px;
    font-size: 0.625rem;
  }
}
</style>
