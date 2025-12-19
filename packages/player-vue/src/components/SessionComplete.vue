<script setup>
import { computed, inject, ref } from 'vue'
import AuthPrompt from './AuthPrompt.vue'

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
  completedSeeds: { type: Number, default: 0 },
  nextBelt: { type: Object, default: null },
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
  return props.nextBelt.seedsRequired - props.completedSeeds
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
  if (auth) {
    auth.openSignIn()
  }
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
      <!-- Belt badge - prominent -->
      <div class="belt-display">
        <div class="belt-knot-large">
          <svg viewBox="0 0 64 32" class="belt-svg">
            <rect x="0" y="10" width="64" height="12" rx="2" class="belt-fabric"/>
            <circle cx="32" cy="16" r="8" class="belt-knot-center"/>
            <path d="M24 16 L16 28 L12 28" class="belt-tail"/>
            <path d="M40 16 L48 28 L52 28" class="belt-tail"/>
          </svg>
        </div>
        <div class="belt-info">
          <span class="belt-name">{{ currentBelt.name }} belt</span>
          <span class="seed-count">{{ completedSeeds }} seeds</span>
        </div>
      </div>

      <!-- Progress to next belt -->
      <div class="progress-section" v-if="nextBelt">
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${beltProgress}%` }"></div>
        </div>
        <span class="progress-label">{{ seedsToNextBelt }} to {{ nextBelt.name }}</span>
      </div>
      <div class="progress-section" v-else>
        <span class="progress-label progress-label--mastery">Mastery achieved</span>
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
  --accent: #c23a3a;
  --gold: #d4a853;

  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary);
  font-family: 'DM Sans', sans-serif;
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

/* Belt Display */
.belt-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.belt-knot-large {
  width: 80px;
  height: 40px;
}

.belt-svg {
  width: 100%;
  height: 100%;
}

.belt-fabric {
  fill: var(--belt-color);
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}

.belt-knot-center {
  fill: var(--belt-color-dark);
}

.belt-tail {
  stroke: var(--belt-color);
  stroke-width: 3;
  stroke-linecap: round;
  fill: none;
}

.belt-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.belt-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: capitalize;
}

.seed-count {
  font-size: 0.875rem;
  color: var(--belt-color);
  font-family: 'Space Mono', monospace;
}

/* Progress */
.progress-section {
  width: 200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.progress-track {
  width: 100%;
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--belt-color) 0%, var(--belt-color-dark) 100%);
  border-radius: 3px;
  transition: width 0.8s ease;
  box-shadow: 0 0 8px var(--belt-glow);
}

.progress-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.progress-label--mastery {
  color: var(--gold);
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

/* Responsive */
@media (max-width: 480px) {
  .summary-content {
    padding: 1.5rem;
    gap: 1.25rem;
  }

  .belt-knot-large {
    width: 64px;
    height: 32px;
  }

  .belt-name {
    font-size: 1.125rem;
  }

  .progress-section {
    width: 180px;
  }

  .resume-btn {
    padding: 0.875rem 2rem;
    font-size: 0.9375rem;
  }
}
</style>
