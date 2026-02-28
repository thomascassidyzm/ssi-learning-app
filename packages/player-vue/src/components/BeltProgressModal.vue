<script setup>
import { computed, watch, onMounted, onUnmounted, ref } from 'vue'

// All belt levels in order
// Belt colors must match useBeltProgress.ts BELTS array (single source of truth)
const ALL_BELTS = [
  { name: 'white', color: '#f5f5f5', seedsRequired: 0, glow: 'rgba(245, 245, 245, 0.3)' },
  { name: 'yellow', color: '#fcd34d', seedsRequired: 8, glow: 'rgba(252, 211, 77, 0.4)' },
  { name: 'orange', color: '#fb923c', seedsRequired: 20, glow: 'rgba(251, 146, 60, 0.4)' },
  { name: 'green', color: '#4ade80', seedsRequired: 40, glow: 'rgba(74, 222, 128, 0.4)' },
  { name: 'blue', color: '#60a5fa', seedsRequired: 80, glow: 'rgba(96, 165, 250, 0.4)' },
  { name: 'purple', color: '#a78bfa', seedsRequired: 150, glow: 'rgba(167, 139, 250, 0.4)' },
  { name: 'brown', color: '#a8856c', seedsRequired: 280, glow: 'rgba(168, 133, 108, 0.4)' },
  { name: 'black', color: '#1a1a1a', seedsRequired: 400, glow: 'rgba(255, 255, 255, 0.3)' },
]

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  currentBelt: {
    type: Object,
    required: true
    // Shape: { name, color, seedsRequired, glow }
  },
  nextBelt: {
    type: Object,
    default: null
    // Shape: { name, color, seedsRequired, glow } or null if at black belt
  },
  completedRounds: {
    type: Number,
    default: 0
  },
  sessionSeconds: {
    type: Number,
    default: 0
  },
  lifetimeLearningMinutes: {
    type: Number,
    default: 0
  },
  isSkipping: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'viewProgress', 'skipToBelt'])

// Format session time as MM:SS
const formattedSessionTime = computed(() => {
  const mins = Math.floor(props.sessionSeconds / 60)
  const secs = props.sessionSeconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

// Format lifetime learning time
const formattedLifetimeTime = computed(() => {
  const hours = Math.floor(props.lifetimeLearningMinutes / 60)
  const mins = props.lifetimeLearningMinutes % 60
  if (hours === 0) {
    return `${mins}m`
  }
  return `${hours}h ${mins}m`
})

// Progress toward next belt
const progressToNextBelt = computed(() => {
  if (!props.nextBelt) return 100
  const currentRequired = props.currentBelt.seedsRequired || 0
  const nextRequired = props.nextBelt.seedsRequired
  const progressInTier = props.completedRounds - currentRequired
  const tierSize = nextRequired - currentRequired
  return Math.min(100, Math.max(0, (progressInTier / tierSize) * 100))
})

// Seeds display text
const seedsProgressText = computed(() => {
  if (!props.nextBelt) {
    return 'Black belt achieved!'
  }
  return `${props.completedRounds} / ${props.nextBelt.seedsRequired} seeds to ${props.nextBelt.name} belt`
})

// CSS variables for belt colors
const beltCssVars = computed(() => ({
  '--belt-color': props.currentBelt.color,
  '--belt-glow': props.currentBelt.glow || props.currentBelt.color,
  '--next-belt-color': props.nextBelt?.color || props.currentBelt.color
}))

// Handle clicking on a belt to skip to it
const handleBeltClick = (belt) => {
  // Don't allow skipping to current belt
  if (belt.name === props.currentBelt.name) return
  emit('skipToBelt', belt)
}

// Check if a belt is the current belt
const isCurrent = (belt) => belt.name === props.currentBelt.name

// Check if a belt is "completed" (past current)
const isCompleted = (belt) => belt.seedsRequired < props.currentBelt.seedsRequired

// Close on escape key
const handleKeydown = (e) => {
  if (e.key === 'Escape' && props.isOpen) {
    emit('close')
  }
}

// Close on backdrop click
const handleBackdropClick = (e) => {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

// Lock body scroll when modal is open
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="isOpen"
        class="modal-backdrop"
        :style="beltCssVars"
        @click="handleBackdropClick"
      >
        <!-- Modal container -->
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <!-- Header -->
          <header class="modal-header">
            <h2 id="modal-title" class="modal-title">Your Progress</h2>
            <button class="modal-close" @click="emit('close')" aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </header>

          <!-- Content -->
          <div class="modal-content">
            <!-- Session Time Display -->
            <div class="session-time-section">
              <div class="time-display">{{ formattedSessionTime }}</div>
              <div class="time-label">This session</div>
            </div>

            <!-- Belt Progress Section -->
            <div class="belt-progress-section">
              <!-- Current belt indicator -->
              <div class="current-belt">
                <span class="belt-dot" :style="{ background: currentBelt.color }"></span>
                <span class="belt-name">{{ currentBelt.name }} Belt</span>
              </div>

              <!-- Progress bar -->
              <div class="progress-bar-container">
                <div class="progress-bar-bg">
                  <div
                    class="progress-bar-fill"
                    :style="{ width: `${progressToNextBelt}%` }"
                  ></div>
                </div>
              </div>

              <!-- Progress text -->
              <div class="progress-text" :class="{ 'progress-text--complete': !nextBelt }">
                {{ seedsProgressText }}
              </div>
            </div>

            <!-- Jump to Belt Section -->
            <div class="belt-jump-section">
              <div class="belt-jump-label">Jump to belt:</div>
              <div class="belt-grid">
                <button
                  v-for="belt in ALL_BELTS"
                  :key="belt.name"
                  class="belt-chip"
                  :class="{
                    'belt-chip--current': isCurrent(belt),
                    'belt-chip--completed': isCompleted(belt),
                    'is-skipping': isSkipping
                  }"
                  :style="{ '--chip-color': belt.color, '--chip-glow': belt.glow }"
                  :disabled="isCurrent(belt) || isSkipping"
                  @click="handleBeltClick(belt)"
                  :title="`Jump to ${belt.name} belt (seed ${belt.seedsRequired})`"
                >
                  <span class="belt-chip-dot"></span>
                  <span class="belt-chip-name">{{ belt.name }}</span>
                </button>
              </div>
            </div>

            <!-- Lifetime Stats -->
            <div class="lifetime-stats">
              <svg class="stats-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>Total learning: {{ formattedLifetimeTime }}</span>
            </div>
          </div>

          <!-- Footer with action button -->
          <footer class="modal-footer">
            <button class="view-progress-btn" @click="emit('viewProgress')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>View Full Progress</span>
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
  /* iOS safe areas */
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  padding-left: max(1rem, env(safe-area-inset-left));
  padding-right: max(1rem, env(safe-area-inset-right));
}

.modal {
  position: relative;
  width: 100%;
  max-width: 380px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 24px;
  overflow: hidden;
  box-shadow:
    0 0 0 1px var(--border-subtle),
    0 25px 80px rgba(0, 0, 0, 0.5),
    0 0 60px var(--belt-glow);
}

/* Header */
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
}

.modal-title {
  font-family: var(--font-body);
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.modal-close {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close svg {
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.modal-close:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-strong);
}

.modal-close:hover svg {
  color: var(--text-primary);
}

/* Content */
.modal-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Session Time */
.session-time-section {
  text-align: center;
}

.time-display {
  font-family: var(--font-body);
  font-size: 3rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
  letter-spacing: -0.02em;
  text-shadow: 0 0 30px var(--belt-glow);
}

.time-label {
  font-size: 0.875rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

/* Belt Progress */
.belt-progress-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.current-belt {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.belt-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow: 0 0 8px var(--belt-color);
}

.belt-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.progress-bar-container {
  width: 100%;
}

.progress-bar-bg {
  width: 100%;
  height: 8px;
  background: var(--bg-interactive, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--belt-color), var(--next-belt-color));
  border-radius: 4px;
  transition: width 0.5s ease;
  box-shadow: 0 0 10px var(--belt-glow);
}

.progress-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.progress-text--complete {
  color: var(--ssi-gold);
  font-weight: 500;
}

/* Jump to Belt Section */
.belt-jump-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.belt-jump-label {
  font-size: 0.8125rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.belt-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}

.belt-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.25rem;
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.belt-chip:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--chip-color);
  box-shadow: 0 0 12px var(--chip-glow);
  transform: translateY(-1px);
}

.belt-chip:disabled {
  cursor: default;
}

.belt-chip--current {
  background: var(--bg-card-hover);
  border-color: var(--chip-color);
  box-shadow: 0 0 8px var(--chip-glow);
}

.belt-chip--completed {
  opacity: 0.5;
}

.belt-chip--completed:hover:not(:disabled) {
  opacity: 0.8;
}

.belt-chip.is-skipping {
  animation: belt-chip-pulse 0.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes belt-chip-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.belt-chip-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--chip-color);
  box-shadow: 0 0 6px var(--chip-glow);
}

.belt-chip-name {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  text-transform: capitalize;
  font-weight: 500;
}

.belt-chip--current .belt-chip-name {
  color: var(--text-primary);
}

/* Lifetime Stats */
.lifetime-stats {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  font-size: 0.9375rem;
  color: var(--text-secondary);
}

.stats-icon {
  width: 18px;
  height: 18px;
  color: var(--belt-color);
}

/* Footer */
.modal-footer {
  padding: 0 1.5rem 1.5rem;
}

.view-progress-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  background: var(--belt-color);
  border: none;
  border-radius: 12px;
  font-family: var(--font-body);
  font-size: 1rem;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 20px var(--belt-glow);
}

.view-progress-btn svg {
  width: 20px;
  height: 20px;
}

.view-progress-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 28px var(--belt-glow);
}

.view-progress-btn:active {
  transform: translateY(0);
}

/* Modal transitions */
.modal-enter-active {
  transition: opacity 0.3s ease;
}

.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(20px) scale(0.95);
}

/* Responsive */
@media (max-width: 480px) {
  .modal {
    margin: 0.5rem;
    border-radius: 20px;
  }

  .modal-header {
    padding: 1rem 1.25rem;
  }

  .modal-content {
    padding: 1.25rem;
    gap: 1.25rem;
  }

  .time-display {
    font-size: 2.5rem;
  }

  .modal-footer {
    padding: 0 1.25rem 1.25rem;
  }

  .view-progress-btn {
    min-height: 52px;
  }
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .modal {
    animation: none;
  }

  .progress-bar-fill {
    transition: none;
  }

  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .modal,
  .modal-leave-active .modal {
    transition: none;
  }
}
</style>

<!-- Mist theme: paper surfaces instead of glass -->
<style>
:root[data-theme="mist"] .modal-backdrop {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  background: rgba(240, 236, 231, 0.6);
}

:root[data-theme="mist"] .modal {
  background: #ffffff;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.14),
              0 8px 24px rgba(44, 38, 34, 0.12),
              0 24px 64px rgba(44, 38, 34, 0.08);
}
</style>
