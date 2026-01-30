<script setup lang="ts">
import { computed } from 'vue'
import { useDrivingMode, type DrivingModeOptions } from '../composables/useDrivingMode'
import type { Cycle } from '../types/Cycle'
import type { GetAudioSourceFn } from '../playback/types'

const props = defineProps<{
  getCyclesForRound: (roundIndex: number) => Cycle[]
  getTotalRounds: () => number
  getAudioSource: GetAudioSourceFn
  currentRoundIndex: number
}>()

const emit = defineEmits<{
  resume: [roundIndex: number, cycleIndex: number]
}>()

// Initialize driving mode with props
const drivingMode = useDrivingMode({
  getCyclesForRound: props.getCyclesForRound,
  getTotalRounds: props.getTotalRounds,
  getAudioSource: props.getAudioSource,
  onRoundChange: (roundIndex) => {
    console.log(`[DrivingMode] Now playing round ${roundIndex + 1}`)
  },
})

// Computed helpers for template
const isPreparing = computed(() => drivingMode.state.value === 'preparing')
const isPlaying = computed(() => drivingMode.state.value === 'playing')
const isPaused = computed(() => drivingMode.state.value === 'paused')
const isActive = computed(() => isPreparing.value || isPlaying.value || isPaused.value)

const progressPercent = computed(() => {
  if (!isPreparing.value) return 0
  return Math.round(drivingMode.prepProgress.value * 100)
})

const currentRoundDisplay = computed(() => {
  if (!isActive.value) return ''
  return `Round ${drivingMode.currentRound.value + 1} of ${props.getTotalRounds()}`
})

const playbackStatus = computed(() => {
  if (isPlaying.value) return 'Playing'
  if (isPaused.value) return 'Paused'
  return ''
})

async function handleToggle() {
  if (drivingMode.isActive.value) {
    const position = drivingMode.exit()
    if (position) {
      emit('resume', position.roundIndex, position.cycleIndex)
    }
  } else {
    await drivingMode.enter(props.currentRoundIndex)
  }
}
</script>

<template>
  <div class="driving-mode-toggle">
    <!-- Main toggle button -->
    <button
      class="toggle-btn"
      :class="{ active: isActive, preparing: isPreparing }"
      @click="handleToggle"
      :disabled="isPreparing"
    >
      <!-- Inactive state -->
      <template v-if="!isActive">
        <svg class="icon car-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
          <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/>
          <path d="M5 11h14"/>
          <path d="M9 17h6"/>
        </svg>
        <span class="label">Driving Mode</span>
      </template>

      <!-- Preparing state -->
      <template v-else-if="isPreparing">
        <div class="spinner"></div>
        <span class="label">Preparing... {{ progressPercent }}%</span>
      </template>

      <!-- Active state (playing/paused) -->
      <template v-else>
        <svg class="icon exit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
        <span class="label">Exit Driving Mode</span>
      </template>
    </button>

    <!-- Active state info panel -->
    <div v-if="isActive && !isPreparing" class="info-panel">
      <div class="round-info">
        <span class="status" :class="{ playing: isPlaying, paused: isPaused }">
          {{ playbackStatus }}
        </span>
        <span class="round">{{ currentRoundDisplay }}</span>
      </div>
      <div class="hint">
        Use lock screen or car controls to navigate
      </div>
    </div>
  </div>
</template>

<style scoped>
.driving-mode-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  font-family: 'DM Sans', -apple-system, sans-serif;
}

/* Main toggle button - pill shape */
.toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  min-height: 44px;
  background: transparent;
  border: 1.5px solid var(--belt-color, #d4a853);
  border-radius: 24px;
  color: var(--belt-color, #d4a853);
  font-family: inherit;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-btn:hover:not(:disabled) {
  background: var(--belt-color, #d4a853);
  color: #0a0a0f;
}

.toggle-btn:disabled {
  opacity: 0.8;
  cursor: wait;
}

/* Active state - filled with belt color */
.toggle-btn.active {
  background: var(--belt-color, #d4a853);
  color: #0a0a0f;
}

.toggle-btn.active:hover:not(:disabled) {
  background: color-mix(in srgb, var(--belt-color, #d4a853) 85%, white);
}

/* Preparing state - pulsing border */
.toggle-btn.preparing {
  background: transparent;
  color: var(--belt-color, #d4a853);
  animation: pulse-border 1.5s ease-in-out infinite;
}

@keyframes pulse-border {
  0%, 100% {
    border-color: var(--belt-color, #d4a853);
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--belt-color, #d4a853) 40%, transparent);
  }
  50% {
    border-color: var(--belt-color, #d4a853);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--belt-color, #d4a853) 0%, transparent);
  }
}

/* Icons */
.icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}

.car-icon {
  stroke-linecap: round;
  stroke-linejoin: round;
}

.exit-icon {
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Loading spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid color-mix(in srgb, var(--belt-color, #d4a853) 30%, transparent);
  border-top-color: var(--belt-color, #d4a853);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Label */
.label {
  white-space: nowrap;
}

/* Info panel - shown when active */
.info-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  text-align: center;
}

.round-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.status {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
}

.status.playing {
  background: color-mix(in srgb, var(--belt-color, #d4a853) 15%, transparent);
  color: var(--belt-color, #d4a853);
}

.status.paused {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.5);
}

.round {
  font-size: 0.8125rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.8);
}

.hint {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.4);
  opacity: 0.8;
}
</style>
