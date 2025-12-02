<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Session stats
  itemsPracticed: { type: Number, default: 0 },
  sessionSeconds: { type: Number, default: 0 },
  seedsEarned: { type: Number, default: 0 },

  // Belt progress
  currentBelt: { type: Object, required: true },
  beltProgress: { type: Number, default: 0 },
  completedSeeds: { type: Number, default: 0 },
  nextBelt: { type: Object, default: null },
})

const emit = defineEmits(['continue', 'finish'])

// Format session time
const formattedTime = computed(() => {
  const mins = Math.floor(props.sessionSeconds / 60)
  const secs = props.sessionSeconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

// Calculate seeds until next belt
const seedsToNextBelt = computed(() => {
  if (!props.nextBelt) return 0
  return props.nextBelt.seedsRequired - props.completedSeeds
})

// Performance rating based on items/minute
const performanceRating = computed(() => {
  if (props.sessionSeconds < 60) return 'Getting started'
  const itemsPerMinute = props.itemsPracticed / (props.sessionSeconds / 60)
  if (itemsPerMinute >= 3) return 'Excellent pace'
  if (itemsPerMinute >= 2) return 'Great work'
  if (itemsPerMinute >= 1) return 'Steady progress'
  return 'Taking it slow'
})

// CSS vars for belt colors
const beltCssVars = computed(() => ({
  '--belt-color': props.currentBelt.color,
  '--belt-color-dark': props.currentBelt.colorDark,
  '--belt-glow': props.currentBelt.glow,
}))
</script>

<template>
  <div class="session-complete" :style="beltCssVars">
    <!-- Background effects -->
    <div class="bg-gradient"></div>
    <div class="bg-celebration"></div>

    <!-- Header -->
    <header class="header">
      <h1 class="title">Session Complete</h1>
      <p class="subtitle">{{ performanceRating }}</p>
    </header>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
        </div>
        <div class="stat-value">{{ formattedTime }}</div>
        <div class="stat-label">Time Spent</div>
      </div>

      <div class="stat-card">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
          </svg>
        </div>
        <div class="stat-value">{{ itemsPracticed }}</div>
        <div class="stat-label">Items Practiced</div>
      </div>

      <div class="stat-card stat-card--highlight">
        <div class="stat-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="8" r="6"/>
            <path d="M12 14c-6 0-9 3-9 6v2h18v-2c0-3-3-6-9-6z"/>
          </svg>
        </div>
        <div class="stat-value">+{{ seedsEarned }}</div>
        <div class="stat-label">Seeds Earned</div>
      </div>
    </div>

    <!-- Belt Progress -->
    <div class="belt-section">
      <div class="belt-card">
        <div class="belt-header">
          <div class="belt-badge" :class="`belt-${currentBelt.name}`">
            <div class="belt-knot">
              <svg viewBox="0 0 32 16" class="belt-svg">
                <rect x="0" y="5" width="32" height="6" rx="1" class="belt-fabric"/>
                <circle cx="16" cy="8" r="4" class="belt-knot-center"/>
                <path d="M12 8 L8 14 L6 14" class="belt-tail"/>
                <path d="M20 8 L24 14 L26 14" class="belt-tail"/>
              </svg>
            </div>
            <span class="belt-name">{{ currentBelt.name }} Belt</span>
          </div>

          <div class="seeds-count">
            <span class="seeds-value">{{ completedSeeds }}</span>
            <span class="seeds-label">total seeds</span>
          </div>
        </div>

        <div class="belt-progress-bar">
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{ width: `${beltProgress}%` }"
            ></div>
          </div>
          <div class="progress-label" v-if="nextBelt">
            {{ seedsToNextBelt }} seeds to {{ nextBelt.name }} belt
          </div>
          <div class="progress-label progress-label--complete" v-else>
            Black belt achieved - mastery unlocked!
          </div>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions">
      <button class="btn btn--primary" @click="$emit('continue')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="6 3 20 12 6 21 6 3" fill="currentColor"/>
        </svg>
        Continue Learning
      </button>

      <button class="btn btn--secondary" @click="$emit('finish')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        Finish Session
      </button>
    </div>
  </div>
</template>

<style scoped>
.session-complete {
  --accent: #c23a3a;
  --accent-soft: rgba(194, 58, 58, 0.15);
  --gold: #d4a853;
  --success: #22c55e;

  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  background: var(--bg-primary);
  font-family: 'DM Sans', sans-serif;
  overflow-y: auto;
  z-index: 100;
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, var(--belt-glow) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 100%, var(--accent-soft) 0%, transparent 50%);
  pointer-events: none;
  z-index: 0;
}

.bg-celebration {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
  opacity: 0.5;
  pointer-events: none;
  z-index: 0;
}

/* Header */
.header {
  position: relative;
  z-index: 1;
  text-align: center;
  margin-bottom: 2rem;
}

.title {
  font-size: 2rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem;
  animation: slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.subtitle {
  font-size: 1.125rem;
  color: var(--belt-color);
  font-weight: 500;
  margin: 0;
  animation: slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both;
}

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Stats Grid */
.stats-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  width: 100%;
  max-width: 500px;
  margin-bottom: 2rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1.25rem 1rem;
  text-align: center;
  animation: pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both;
}

.stat-card:nth-child(2) { animation-delay: 0.3s; }
.stat-card:nth-child(3) { animation-delay: 0.4s; }

.stat-card--highlight {
  background: linear-gradient(135deg, var(--bg-card) 0%, rgba(74, 222, 128, 0.1) 100%);
  border-color: rgba(74, 222, 128, 0.3);
}

.stat-card--highlight .stat-value {
  color: var(--success);
}

@keyframes pop-in {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.stat-icon {
  width: 32px;
  height: 32px;
  margin: 0 auto 0.75rem;
  color: var(--text-muted);
}

.stat-icon svg {
  width: 100%;
  height: 100%;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'Space Mono', monospace;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Belt Section */
.belt-section {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 500px;
  margin-bottom: 2rem;
  animation: slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both;
}

.belt-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  padding: 1.5rem;
}

.belt-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.25rem;
}

.belt-badge {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.belt-knot {
  width: 40px;
  height: 20px;
}

.belt-svg {
  width: 100%;
  height: 100%;
}

.belt-fabric {
  fill: var(--belt-color);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
}

.belt-knot-center {
  fill: var(--belt-color-dark);
}

.belt-tail {
  stroke: var(--belt-color);
  stroke-width: 2;
  stroke-linecap: round;
  fill: none;
}

.belt-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  text-transform: capitalize;
}

.seeds-count {
  text-align: right;
}

.seeds-value {
  display: block;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--belt-color);
  font-family: 'Space Mono', monospace;
}

.seeds-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.belt-progress-bar {
  margin-top: 0.5rem;
}

.progress-track {
  height: 8px;
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--belt-color) 0%, var(--belt-color-dark) 100%);
  border-radius: 4px;
  transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 0 10px var(--belt-glow);
}

.progress-label {
  margin-top: 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  text-align: center;
}

.progress-label--complete {
  color: var(--gold);
}

/* Actions */
.actions {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 320px;
  animation: slide-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.6s both;
}

.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.btn svg {
  width: 20px;
  height: 20px;
}

.btn--primary {
  background: var(--accent);
  color: white;
  box-shadow: 0 4px 16px rgba(194, 58, 58, 0.4);
}

.btn--primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(194, 58, 58, 0.5);
}

.btn--secondary {
  background: var(--bg-card);
  color: var(--text-secondary);
  border: 1px solid var(--border-medium);
}

.btn--secondary:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  border-color: var(--text-muted);
}

/* Responsive */
@media (max-width: 480px) {
  .session-complete {
    padding: 1.5rem 1rem;
  }

  .title {
    font-size: 1.5rem;
  }

  .stats-grid {
    gap: 0.75rem;
  }

  .stat-card {
    padding: 1rem 0.75rem;
  }

  .stat-value {
    font-size: 1.25rem;
  }

  .stat-icon {
    width: 24px;
    height: 24px;
    margin-bottom: 0.5rem;
  }

  .belt-card {
    padding: 1.25rem;
  }
}
</style>
