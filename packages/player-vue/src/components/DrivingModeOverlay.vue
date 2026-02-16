<script setup lang="ts">
import { computed } from 'vue'
import type { AudioSegment } from '../utils/audioConcatenator'

// ============================================================================
// DrivingModeOverlay - Full-screen launchpad + glance-back view
//
// The learner sees this briefly before switching to Maps,
// and when they glance back at the app. Media Session lock screen
// controls are the primary UI during actual driving.
// ============================================================================

const props = defineProps<{
  // From useDrivingMode
  state: string                    // 'preparing' | 'playing' | 'paused' | 'loading-next'
  currentRoundIndex: number
  totalRounds: number
  prepProgress: number
  currentSegment: AudioSegment | null
  // From SimplePlayer's rounds
  currentKnownText: string
  currentTargetText: string
  showTargetText: boolean          // true only during voice2 phase
  cycleCount: number               // total cycles in current round
  currentCycleIndex: number
  // Belt info
  beltColor: string
  beltName: string
}>()

const emit = defineEmits<{
  exit: []
  togglePlayPause: []
  skipNext: []
  skipPrev: []
}>()

// ============================================================================
// Computed
// ============================================================================

const isPreparing = computed(() => props.state === 'preparing')
const isPaused = computed(() => props.state === 'paused')
const isPlaying = computed(() => props.state === 'playing' || props.state === 'loading-next')

const prepPercent = computed(() => Math.round(props.prepProgress * 100))

const roundDisplay = computed(() => `${props.currentRoundIndex + 1} / ${props.totalRounds}`)

const currentPhase = computed(() => props.currentSegment?.phase ?? 'known')

/** Belt name with first letter capitalized */
const beltLabel = computed(() => {
  const name = props.beltName || 'white'
  return name.charAt(0).toUpperCase() + name.slice(1) + ' Belt'
})

/** Cycle dots: array of { active, current } for rendering */
const cycleDots = computed(() => {
  const count = Math.min(props.cycleCount, 20) // cap dots to avoid overflow
  return Array.from({ length: count }, (_, i) => ({
    completed: i < props.currentCycleIndex,
    current: i === props.currentCycleIndex,
  }))
})

/** Subtle phase label for accessibility */
const phaseLabel = computed(() => {
  switch (currentPhase.value) {
    case 'known': return 'Prompt'
    case 'pause': return 'Your turn'
    case 'voice1': return 'Listen'
    case 'voice2': return 'Listen & read'
    default: return ''
  }
})
</script>

<template>
  <div class="driving-overlay">
    <!-- Top bar -->
    <div class="driving-top-bar">
      <button class="driving-exit-btn" @click="$emit('exit')" title="Exit Driving Mode">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <span v-if="!isPreparing" class="driving-round-counter">
        Round {{ roundDisplay }}
      </span>
    </div>

    <!-- Preparing state -->
    <div v-if="isPreparing" class="driving-preparing">
      <div class="driving-prep-spinner">
        <svg viewBox="0 0 50 50" class="driving-spinner-svg">
          <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"/>
          <circle cx="25" cy="25" r="20" fill="none" :stroke="beltColor" stroke-width="3"
                  stroke-linecap="round" stroke-dasharray="80 126"
                  :style="{ '--prep-offset': `${126 - (prepPercent / 100) * 126}px` }"/>
        </svg>
        <span class="driving-prep-percent">{{ prepPercent }}%</span>
      </div>
      <p class="driving-prep-label">Preparing audio...</p>
    </div>

    <!-- Main content (playing/paused) -->
    <div v-else class="driving-content">
      <!-- Phase label -->
      <p class="driving-phase-label" :class="`driving-phase--${currentPhase}`">
        {{ phaseLabel }}
      </p>

      <!-- Known text - always visible -->
      <p class="driving-known-text">{{ currentKnownText }}</p>

      <!-- Target text - voice2 only -->
      <Transition name="driving-text-reveal">
        <p v-if="showTargetText" class="driving-target-text" :style="{ color: beltColor }">
          {{ currentTargetText }}
        </p>
      </Transition>

      <!-- Cycle dots -->
      <div v-if="cycleCount > 0" class="driving-cycle-dots">
        <span
          v-for="(dot, i) in cycleDots"
          :key="i"
          class="driving-dot"
          :class="{
            'driving-dot--completed': dot.completed,
            'driving-dot--current': dot.current,
          }"
          :style="dot.current ? { background: beltColor, boxShadow: `0 0 8px ${beltColor}` } : {}"
        />
      </div>

      <!-- Transport controls -->
      <div class="driving-transport">
        <button class="driving-transport-btn" @click="$emit('skipPrev')" title="Previous round">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
          </svg>
        </button>

        <button
          class="driving-transport-btn driving-transport-btn--play"
          @click="$emit('togglePlayPause')"
          :title="isPaused ? 'Play' : 'Pause'"
        >
          <svg v-if="isPaused" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z"/>
          </svg>
        </button>

        <button class="driving-transport-btn" @click="$emit('skipNext')" title="Next round">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 18h2V6h-2zM6 18l8.5-6L6 6z"/>
          </svg>
        </button>
      </div>

      <!-- Belt indicator -->
      <div class="driving-belt-indicator">
        <div class="driving-belt-line" :style="{ background: beltColor }"/>
        <span class="driving-belt-label">{{ beltLabel }}</span>
        <div class="driving-belt-line" :style="{ background: beltColor }"/>
      </div>

      <!-- Switch to Maps prompt -->
      <p v-if="isPlaying" class="driving-maps-hint">
        Switch to Maps &mdash; audio continues
      </p>
    </div>
  </div>
</template>

<style scoped>
/* ============================================================================
   Driving Mode Overlay
   Full-screen, near-black background matching Moonlit Dojo
   ============================================================================ */

.driving-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  font-family: var(--font-body);
  user-select: none;
  -webkit-user-select: none;
}

/* ── Top Bar ── */

.driving-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  padding-top: max(16px, env(safe-area-inset-top));
}

.driving-exit-btn {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: none;
  border-radius: var(--radius-lg);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.driving-exit-btn:active {
  background: var(--border-medium);
  color: var(--text-primary);
}

.driving-exit-btn svg {
  width: 20px;
  height: 20px;
}

.driving-round-counter {
  font-size: 0.85rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Preparing State ── */

.driving-preparing {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.driving-prep-spinner {
  position: relative;
  width: 80px;
  height: 80px;
}

.driving-spinner-svg {
  width: 100%;
  height: 100%;
  animation: driving-spin 2s linear infinite;
}

.driving-spinner-svg circle:last-child {
  stroke-dashoffset: var(--prep-offset, 126px);
  transition: stroke-dashoffset 0.3s ease;
}

@keyframes driving-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.driving-prep-percent {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.driving-prep-label {
  font-size: 1rem;
  color: var(--text-muted);
  margin: 0;
}

/* ── Main Content ── */

.driving-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  gap: 16px;
}

/* ── Phase Label ── */

.driving-phase-label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin: 0;
  min-height: 1.2em;
  transition: color 0.3s;
}

.driving-phase--pause {
  color: var(--text-secondary);
}

/* ── Text Display ── */

.driving-known-text {
  font-size: 1.6rem;
  font-weight: 500;
  text-align: center;
  line-height: 1.4;
  margin: 0;
  min-height: 2.4em;
  display: flex;
  align-items: center;
}

.driving-target-text {
  font-size: 1.6rem;
  font-weight: 500;
  text-align: center;
  line-height: 1.4;
  margin: 0;
  min-height: 2.4em;
  display: flex;
  align-items: center;
}

/* ── Cycle Dots ── */

.driving-cycle-dots {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  flex-wrap: wrap;
  max-width: 280px;
}

.driving-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-medium);
  transition: all 0.3s ease;
}

.driving-dot--completed {
  background: var(--text-muted);
}

.driving-dot--current {
  width: 10px;
  height: 10px;
  /* background and box-shadow set via inline style */
}

/* ── Transport Controls ── */

.driving-transport {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 16px 0;
}

.driving-transport-btn {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: none;
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.driving-transport-btn:active {
  background: var(--border-medium);
  transform: scale(0.95);
}

.driving-transport-btn svg {
  width: 24px;
  height: 24px;
}

.driving-transport-btn--play {
  width: 72px;
  height: 72px;
  background: var(--border-medium);
  color: var(--text-primary);
}

.driving-transport-btn--play:active {
  background: var(--border-strong);
}

.driving-transport-btn--play svg {
  width: 32px;
  height: 32px;
}

/* ── Belt Indicator ── */

.driving-belt-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 280px;
  padding: 8px 0;
}

.driving-belt-line {
  flex: 1;
  height: 1px;
  opacity: 0.4;
}

.driving-belt-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}

/* ── Maps Hint ── */

.driving-maps-hint {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 0;
  padding-top: 0.5rem;
}

/* ── Text Reveal Transition ── */

.driving-text-reveal-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.driving-text-reveal-leave-active {
  transition: opacity 0.2s ease;
}

.driving-text-reveal-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.driving-text-reveal-leave-to {
  opacity: 0;
}
</style>
