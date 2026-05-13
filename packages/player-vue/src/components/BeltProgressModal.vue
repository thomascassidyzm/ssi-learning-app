<script setup>
import { computed, watch, onMounted, onUnmounted, ref } from 'vue'
import { BELTS } from '@/composables/useBeltProgress'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  currentBelt: {
    type: Object,
    required: true
    // Belt at current playing position. Shape: { name, color, seedsRequired, glow }
  },
  sessionSeconds: {
    type: Number,
    default: 0
  },
  isSkipping: {
    type: Boolean,
    default: false
  },
  availableBelts: {
    type: Array,
    default: () => BELTS
  },
  // Round-cursor pair driving the map markers. Both 1-based for display.
  // Both null for guests / fresh enrollments — markers don't render then.
  currentRound: {
    type: Number,
    default: null
  },
  highestRound: {
    type: Number,
    default: null
  },
  // Belt index for each marker. Derived upstream from the actual lego id
  // so it always agrees with the belt label. Avoids the round÷3 estimate
  // putting the marker over the wrong chip when the round-to-seed ratio
  // isn't clean (intros, build phases inflate early-course round counts).
  currentBeltIndex: {
    type: Number,
    default: null
  },
  highestBeltIndex: {
    type: Number,
    default: null
  }
})

const emit = defineEmits(['close', 'skipToBelt'])

const formattedSessionTime = computed(() => {
  const mins = Math.floor(props.sessionSeconds / 60)
  const secs = props.sessionSeconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
})

// Belt indices come straight from the parent (computed from real lego
// ids upstream). Fall back to 0 if not provided so the markers still
// render somewhere sensible.
const currentBeltIndexFromRound = computed(() => props.currentBeltIndex ?? 0)
const highestBeltIndexFromRound = computed(() => props.highestBeltIndex ?? 0)

// Centre of belt chip i along the row, as a percentage. The belt row is
// drawn as N equal segments; markers sit at chip centres.
const chipCenterPercent = (idx) => {
  const total = props.availableBelts.length || BELTS.length
  return ((idx + 0.5) / total) * 100
}

const nowMarkerLeft = computed(() => chipCenterPercent(currentBeltIndexFromRound.value))
const furthestMarkerLeft = computed(() => chipCenterPercent(highestBeltIndexFromRound.value))

const showFurthestMarker = computed(() => {
  return typeof props.highestRound === 'number'
    && typeof props.currentRound === 'number'
    && highestBeltIndexFromRound.value > currentBeltIndexFromRound.value
})

const furthestBeltName = computed(() => {
  const idx = highestBeltIndexFromRound.value
  return BELTS[idx]?.name ?? null
})

const beltCssVars = computed(() => ({
  '--belt-color': props.currentBelt.color,
  '--belt-glow': props.currentBelt.glow || props.currentBelt.color,
}))

const handleBeltClick = (belt) => {
  if (belt.name === props.currentBelt.name) return
  emit('skipToBelt', belt)
}

const isCurrent = (belt) => belt.name === props.currentBelt.name

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

            <!-- Course map: belts are stations. Tap any belt to jump there.
                 Belt at current position is the only thing called "your belt"
                 — no "earned" gating, no progress percentages. -->
            <div class="course-map">
              <p class="course-map-prompt">
                you're working on
                <strong :style="{ color: currentBelt.color }">{{ currentBelt.name }} belt</strong>
              </p>
              <p v-if="showFurthestMarker" class="course-map-furthest-note">
                you've been as far as <strong>{{ furthestBeltName }} belt</strong>
              </p>

              <div class="map-row">
                <button
                  v-for="(belt, i) in availableBelts"
                  :key="belt.name"
                  class="map-chip"
                  :class="{
                    'map-chip--current': isCurrent(belt),
                    'is-skipping': isSkipping
                  }"
                  :style="{ '--chip-color': belt.color }"
                  :disabled="isCurrent(belt) || isSkipping"
                  @click="handleBeltClick(belt)"
                  :title="`Jump to ${belt.name} belt`"
                >
                  <span class="map-chip-dot"></span>
                  <span class="map-chip-label">{{ belt.name }}</span>
                </button>

                <!-- Markers float above the chip row to indicate position -->
                <div
                  v-if="typeof currentRound === 'number'"
                  class="map-marker map-marker--now"
                  :style="{ left: nowMarkerLeft + '%' }"
                >
                  <span class="map-marker-label">now</span>
                </div>
                <div
                  v-if="showFurthestMarker"
                  class="map-marker map-marker--furthest"
                  :style="{ left: furthestMarkerLeft + '%' }"
                >
                  <span class="map-marker-label">furthest</span>
                </div>
              </div>

              <p class="course-map-hint">tap a belt to jump there</p>
            </div>
          </div>
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

/* Course map (replaces the old belt-progress + jump sections) */
.course-map {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.course-map-prompt {
  margin: 0;
  font-size: 0.9375rem;
  color: var(--text-secondary);
  text-align: center;
}

.course-map-prompt strong {
  font-weight: 600;
  text-transform: capitalize;
}

.course-map-furthest-note {
  margin: -0.25rem 0 0;
  font-size: 0.8125rem;
  color: var(--text-muted);
  text-align: center;
  font-style: italic;
}

.course-map-furthest-note strong {
  font-weight: 500;
  text-transform: capitalize;
  color: var(--text-secondary);
}

.course-map-hint {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--text-muted);
  text-align: center;
  letter-spacing: 0.02em;
}

.map-row {
  position: relative;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 0.25rem;
  padding-top: 22px; /* room for markers above */
}

.map-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.125rem;
  background: var(--bg-card);
  border: 1px solid var(--border-medium);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.map-chip:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--chip-color);
  box-shadow: 0 0 12px color-mix(in srgb, var(--chip-color) 35%, transparent);
  transform: translateY(-1px);
}

.map-chip:disabled {
  cursor: default;
}

.map-chip--current {
  background: var(--bg-card-hover);
  border-color: var(--chip-color);
  box-shadow: 0 0 8px color-mix(in srgb, var(--chip-color) 40%, transparent);
}

.map-chip.is-skipping {
  animation: map-chip-pulse 0.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes map-chip-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.map-chip-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--chip-color);
  box-shadow: 0 0 4px color-mix(in srgb, var(--chip-color) 50%, transparent);
}

.map-chip-label {
  font-size: 0.625rem;
  text-transform: capitalize;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

/* Markers above the chip row, positioned by left % */
.map-marker {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.map-marker-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.map-marker--now .map-marker-label::before {
  content: "▼ ";
  color: var(--belt-color);
}

.map-marker--furthest {
  top: -2px;
}

.map-marker--furthest .map-marker-label::before {
  content: "▽ ";
  color: var(--text-muted);
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
