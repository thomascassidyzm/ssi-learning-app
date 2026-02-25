<script setup>
import { computed, inject, ref } from 'vue'
import AuthPrompt from './AuthPrompt.vue'
import { useAuthModal } from '@/composables/useAuthModal'

// Get auth state from App
const auth = inject('auth')

// Local state for auth modal
const showAuthModal = ref(false)

const props = defineProps({
  // Stats from this learning period
  itemsPracticed: { type: Number, default: 0 },
  timeSpentSeconds: { type: Number, default: 0 },

  // Belt progress (overall, not session-specific)
  currentBelt: { type: Object, required: true },
  beltProgress: { type: Number, default: 0 },
  completedRounds: { type: Number, default: 0 },
  nextBelt: { type: Object, default: null },

  // Time estimate (from useBeltProgress composable)
  timeToNextBelt: { type: String, default: '' },

  // Belt journey (all 8 belts with progress)
  beltJourney: { type: Array, default: () => [] },
})

const emit = defineEmits(['resume'])

// Format time spent
const formattedTime = computed(() => {
  const mins = Math.floor(props.timeSpentSeconds / 60)
  const secs = props.timeSpentSeconds % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
})

// Calculate seeds until next belt
const seedsToNextBelt = computed(() => {
  if (!props.nextBelt) return 0
  return props.nextBelt.seedsRequired - props.completedRounds
})

// Progress percentage within current belt tier
const progressPercent = computed(() => {
  return Math.round(props.beltProgress)
})

// Encouragement based on progress
const encouragement = computed(() => {
  if (props.itemsPracticed === 0) return 'Ready when you are'
  if (props.itemsPracticed < 5) return 'Good start'
  if (props.itemsPracticed < 15) return 'Nice flow'
  if (props.itemsPracticed < 30) return 'Great session'
  return 'On fire'
})

// CSS vars for belt colors
const beltCssVars = computed(() => ({
  '--belt-color': props.currentBelt.color,
  '--belt-color-dark': props.currentBelt.colorDark,
  '--belt-glow': props.currentBelt.glow,
}))

// Show auth prompt for guests after first session
const shouldShowAuthPrompt = computed(() => {
  if (!auth) return false
  return auth.isGuest.value
    && auth.completedSessionsCount.value >= 1
    && !auth.hasSeenSignupPrompt.value
    && props.itemsPracticed > 0
})

// Handle signup click
const handleSignup = () => {
  // Use global auth modal
  const { open } = useAuthModal()
  open()
}

// Handle dismiss
const handleDismiss = () => {
  if (auth) {
    auth.markSignupPromptSeen()
  }
}
</script>

<template>
  <div class="session-summary" :style="beltCssVars">
    <!-- Background effects -->
    <div class="bg-gradient"></div>

    <!-- Simple summary -->
    <div class="summary-content">
      <!-- Circular progress with belt knot center -->
      <div class="belt-progress-ring">
        <svg viewBox="0 0 120 120" class="progress-ring-svg">
          <!-- Background ring -->
          <circle
            cx="60" cy="60" r="52"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            stroke-width="8"
          />
          <!-- Progress ring -->
          <circle
            cx="60" cy="60" r="52"
            fill="none"
            :stroke="currentBelt.color"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="327"
            :stroke-dashoffset="327 - (327 * beltProgress / 100)"
            transform="rotate(-90 60 60)"
            class="progress-ring-fill"
          />
        </svg>
        <!-- Belt knot in center -->
        <div class="belt-knot-center-icon">
          <svg viewBox="0 0 48 28" class="belt-knot-svg">
            <rect x="0" y="8" width="48" height="12" rx="2" :fill="currentBelt.color"/>
            <circle cx="24" cy="14" r="7" :fill="currentBelt.colorDark"/>
            <circle cx="24" cy="14" r="4" :fill="currentBelt.color"/>
            <path d="M18 14 L12 24 L8 24" :stroke="currentBelt.color" stroke-width="3" fill="none" stroke-linecap="round"/>
            <path d="M30 14 L36 24 L40 24" :stroke="currentBelt.color" stroke-width="3" fill="none" stroke-linecap="round"/>
          </svg>
        </div>
      </div>

      <!-- Belt name and progress -->
      <div class="belt-info">
        <span class="belt-name">{{ currentBelt.name }} Belt</span>
        <span class="belt-progress-text" v-if="nextBelt">{{ progressPercent }}% to {{ nextBelt.name }}</span>
        <span class="belt-progress-text belt-progress-text--mastery" v-else>Mastery achieved</span>
      </div>

      <!-- Time estimate - prominent -->
      <div class="time-to-next" v-if="nextBelt && timeToNextBelt">
        <span class="time-estimate-label">{{ timeToNextBelt }}</span>
      </div>

      <!-- Belt journey visualization -->
      <div class="belt-journey" v-if="beltJourney.length > 0">
        <div
          v-for="belt in beltJourney"
          :key="belt.name"
          class="journey-dot"
          :class="{
            'journey-dot--complete': belt.isComplete,
            'journey-dot--current': belt.isCurrent,
            'journey-dot--next': belt.isNext
          }"
          :style="{ '--dot-color': belt.color }"
          :title="`${belt.name} belt (${belt.seedsRequired} seeds)`"
        >
          <span class="journey-dot-inner"></span>
        </div>
      </div>

      <!-- Quick stats (if they practiced anything) -->
      <div class="quick-stats" v-if="itemsPracticed > 0">
        <span class="stat">{{ itemsPracticed }} items</span>
        <span class="stat-divider">·</span>
        <span class="stat">{{ formattedTime }}</span>
        <span class="stat-divider">·</span>
        <span class="stat stat--encouragement">{{ encouragement }}</span>
      </div>

      <!-- Auth prompt for guests (after first session) -->
      <AuthPrompt
        v-if="shouldShowAuthPrompt"
        @signup="handleSignup"
        @dismiss="handleDismiss"
      />

      <!-- Single action - just resume -->
      <button class="resume-btn" @click="$emit('resume')">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6 3 20 12 6 21 6 3"/>
        </svg>
        <span>Continue</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.session-summary {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  font-family: var(--font-body);
  z-index: 100;
}

/* Background */
.bg-gradient {
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse 80% 60% at 50% 30%, var(--belt-glow) 0%, transparent 60%);
  pointer-events: none;
  z-index: 0;
}

/* Content */
.summary-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 2rem;
  animation: fade-in 0.4s ease;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Circular Progress Ring */
.belt-progress-ring {
  position: relative;
  width: 120px;
  height: 120px;
}

.progress-ring-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 12px var(--belt-glow));
}

.progress-ring-fill {
  transition: stroke-dashoffset 0.8s ease;
}

.belt-knot-center-icon {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 56px;
  height: 32px;
}

.belt-knot-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}

/* Belt Info */
.belt-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.belt-name {
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.belt-progress-text {
  font-size: 1rem;
  color: var(--belt-color);
  font-weight: 500;
}

.belt-progress-text--mastery {
  color: var(--ssi-gold);
}

/* Time Estimate */
.time-to-next {
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.time-estimate-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-style: italic;
}

/* Belt Journey Visualization */
.belt-journey {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.journey-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 2px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  cursor: help;
}

.journey-dot--complete {
  background: var(--dot-color);
  border-color: var(--dot-color);
  box-shadow: 0 0 4px var(--dot-color);
}

.journey-dot--current {
  width: 16px;
  height: 16px;
  background: var(--dot-color);
  border-color: var(--dot-color);
  box-shadow: 0 0 8px var(--dot-color), 0 0 16px var(--dot-color);
  animation: pulse-current 2s ease-in-out infinite;
}

.journey-dot--next {
  border-color: var(--dot-color);
  opacity: 0.6;
}

.journey-dot-inner {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.8);
  opacity: 0;
}

.journey-dot--current .journey-dot-inner {
  opacity: 1;
}

@keyframes pulse-current {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* Quick Stats */
.quick-stats {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.stat-divider {
  opacity: 0.5;
}

.stat--encouragement {
  color: var(--belt-color);
}

/* Resume Button */
.resume-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem 2.5rem;
  margin-top: 1rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 100px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.4);
}

.resume-btn svg {
  width: 20px;
  height: 20px;
  margin-left: 2px; /* optical centering for play icon */
}

.resume-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 28px rgba(194, 58, 58, 0.5);
}

.resume-btn:active {
  transform: translateY(0);
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE - Simplified 2-breakpoint system
   Base: Mobile (0-767px)
   768px+: Tablet/Desktop
   ═══════════════════════════════════════════════════════════════ */

/* Tablet and Desktop (768px+) */
@media (min-width: 768px) {
  .summary-content {
    padding: 2.5rem;
    gap: 1.75rem;
    max-width: 480px;
  }

  .belt-progress-ring {
    width: 130px;
    height: 130px;
  }

  .belt-knot-center-icon {
    width: 64px;
    height: 36px;
  }

  .belt-name {
    font-size: 1.75rem;
  }

  .belt-progress-text {
    font-size: 1.125rem;
  }

  .time-estimate-label {
    font-size: 1rem;
  }

  .belt-journey {
    gap: 0.75rem;
  }

  .journey-dot {
    width: 14px;
    height: 14px;
  }

  .journey-dot--current {
    width: 18px;
    height: 18px;
  }

  .quick-stats {
    font-size: 0.9375rem;
    gap: 0.75rem;
  }

  .resume-btn {
    padding: 1.125rem 2.75rem;
    font-size: 1.0625rem;
  }

  .resume-btn svg {
    width: 22px;
    height: 22px;
  }
}

/* Landscape phones - compact layout */
@media (orientation: landscape) and (max-height: 500px) {
  .session-summary {
    overflow-y: auto;
  }

  .summary-content {
    padding: 1rem 2rem;
    gap: 0.75rem;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    max-width: none;
  }

  .belt-progress-ring {
    width: 80px;
    height: 80px;
  }

  .belt-knot-center-icon {
    width: 36px;
    height: 20px;
  }

  .belt-info {
    text-align: left;
  }

  .belt-name {
    font-size: 1.25rem;
  }

  .belt-progress-text {
    font-size: 0.875rem;
  }

  .time-to-next {
    order: 3;
  }

  .belt-journey {
    order: 4;
    width: 100%;
  }

  .quick-stats {
    order: 5;
    width: 100%;
  }

  .resume-btn {
    order: 6;
    padding: 0.625rem 1.5rem;
    font-size: 0.875rem;
    margin-top: 0;
    min-height: 44px;
  }

  .bg-gradient {
    opacity: 0.5;
  }
}

/* ═══════════════════════════════════════════════════════════════
   WASHI PAPER DOJO THEME — Session complete overrides
   ═══════════════════════════════════════════════════════════════ */
:root[data-theme="mist"] .session-summary {
  background: #D9D6D2;
}

:root[data-theme="mist"] .bg-gradient {
  background: radial-gradient(ellipse 80% 60% at 50% 30%, rgba(var(--belt-color-r, 194), var(--belt-color-g, 58), var(--belt-color-b, 58), 0.08) 0%, transparent 60%);
}

:root[data-theme="mist"] .belt-name {
  color: #1A1614;
}

:root[data-theme="mist"] .time-to-next {
  background: rgba(122, 110, 98, 0.06);
  border-color: rgba(122, 110, 98, 0.12);
}

:root[data-theme="mist"] .time-estimate-label {
  color: #2C2622;
}

:root[data-theme="mist"] .journey-dot {
  background: #F2F0ED;
  border-color: rgba(122, 110, 98, 0.22);
}

:root[data-theme="mist"] .journey-dot-inner {
  background: rgba(26, 22, 20, 0.65);
}

:root[data-theme="mist"] .quick-stats {
  color: #7A6E62;
}

:root[data-theme="mist"] .progress-ring-svg {
  filter: none;
}

:root[data-theme="mist"] .progress-ring-svg circle:first-child {
  stroke: rgba(122, 110, 98, 0.12);
}

:root[data-theme="mist"] .resume-btn {
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.2);
}
</style>
