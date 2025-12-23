<script setup>
/**
 * ProgressDemo.vue
 *
 * Demo page for exploring progress visualization variations.
 * Accessible from Settings for QA/design review.
 *
 * For meeting with Aran - January 2025
 */
import { ref, computed } from 'vue'
import ProgressVariations from './ProgressVariations.vue'

const emit = defineEmits(['close'])

// Current variation being viewed
const currentVariation = ref('emergence')

const variations = [
  {
    id: 'emergence',
    name: 'Emergence',
    subtitle: 'Organic growth',
    description: 'No numbers. A seed becomes a tree. Patient, natural. "Your language is taking root."',
    personality: 'Subtle, patient, nature-focused'
  },
  {
    id: 'flow',
    name: 'Flow',
    subtitle: 'Speed & rhythm',
    description: 'Wave visualization. No right/wrong, just rhythm. "Feel the flow."',
    personality: 'Calm, meditative, focused'
  },
  {
    id: 'constellation',
    name: 'Constellation',
    subtitle: 'Collective journey',
    description: 'You\'re one star among many. Community. Not alone. "847 others learning right now."',
    personality: 'Connected, inspiring, communal'
  },
  {
    id: 'minimal',
    name: 'Minimal',
    subtitle: 'Almost nothing',
    description: 'Pure learning. The content IS the experience. No chrome, no distraction.',
    personality: 'Zen, focused, trusting'
  },
  {
    id: 'momentum',
    name: 'Momentum',
    subtitle: 'Energy & movement',
    description: 'Orb that grows with practice. Kinetic energy. "Every word adds momentum."',
    personality: 'Energetic, building, unstoppable'
  }
]

const currentVariationData = computed(() =>
  variations.find(v => v.id === currentVariation.value)
)

// Simulated progress state (would come from real learner data)
const simulatedProgress = ref({
  completedSeeds: 12,
  totalSeeds: 668,
  itemsPracticed: 23,
  timeSpentSeconds: 847,
  currentStreak: 3
})

// Control simulation
const seedPresets = [
  { label: 'Brand new', seeds: 0, items: 0 },
  { label: 'First session', seeds: 3, items: 8 },
  { label: '10 seeds', seeds: 10, items: 25 },
  { label: '30 seeds', seeds: 30, items: 78 },
  { label: '100 seeds', seeds: 100, items: 280 },
  { label: '250 seeds', seeds: 250, items: 700 },
]

const applyPreset = (preset) => {
  simulatedProgress.value.completedSeeds = preset.seeds
  simulatedProgress.value.itemsPracticed = preset.items
  simulatedProgress.value.timeSpentSeconds = preset.items * 35 // ~35s per item
}

// Key questions for discussion
const discussionPoints = [
  'Does this feel "naff" (tacky, trying too hard)?',
  'Would a 7-year-old roll their eyes at this?',
  'Would a 50-year-old feel patronized?',
  'Does it celebrate that learning is HARD?',
  'Does it feel encouraging without measuring correctness?',
  'Would you want to see this after 30 minutes of hard work?'
]
</script>

<template>
  <div class="progress-demo">
    <!-- Background -->
    <div class="demo-bg"></div>

    <!-- Header -->
    <header class="demo-header">
      <button class="back-btn" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <div class="header-content">
        <h1>Progress Variations</h1>
        <p>First 30 mins UX exploration</p>
      </div>
    </header>

    <!-- Main content -->
    <main class="demo-main">

      <!-- Variation selector -->
      <section class="variation-selector">
        <div class="variation-tabs">
          <button
            v-for="v in variations"
            :key="v.id"
            :class="['variation-tab', { active: currentVariation === v.id }]"
            @click="currentVariation = v.id"
          >
            <span class="tab-name">{{ v.name }}</span>
            <span class="tab-subtitle">{{ v.subtitle }}</span>
          </button>
        </div>
      </section>

      <!-- Preview area -->
      <section class="preview-area">
        <div class="preview-card">
          <div class="preview-label">Preview</div>
          <ProgressVariations
            :variation="currentVariation"
            :completedSeeds="simulatedProgress.completedSeeds"
            :totalSeeds="simulatedProgress.totalSeeds"
            :itemsPracticed="simulatedProgress.itemsPracticed"
            :timeSpentSeconds="simulatedProgress.timeSpentSeconds"
            :currentStreak="simulatedProgress.currentStreak"
          />
        </div>
      </section>

      <!-- Variation description -->
      <section class="variation-info" v-if="currentVariationData">
        <h2>{{ currentVariationData.name }}</h2>
        <p class="variation-desc">{{ currentVariationData.description }}</p>
        <p class="variation-personality">
          <strong>Personality:</strong> {{ currentVariationData.personality }}
        </p>
      </section>

      <!-- Simulation controls -->
      <section class="simulation-controls">
        <h3>Simulate Progress</h3>
        <div class="preset-buttons">
          <button
            v-for="preset in seedPresets"
            :key="preset.label"
            class="preset-btn"
            @click="applyPreset(preset)"
          >
            {{ preset.label }}
          </button>
        </div>
        <div class="current-values">
          <span>{{ simulatedProgress.completedSeeds }} seeds</span>
          <span class="divider">|</span>
          <span>{{ simulatedProgress.itemsPracticed }} items</span>
        </div>
      </section>

      <!-- Discussion points -->
      <section class="discussion">
        <h3>For Discussion (Aran meeting)</h3>
        <ul class="discussion-list">
          <li v-for="point in discussionPoints" :key="point">
            {{ point }}
          </li>
        </ul>
      </section>

      <!-- Key philosophy -->
      <section class="philosophy">
        <h3>Core Philosophy</h3>
        <div class="philosophy-points">
          <div class="philosophy-point">
            <span class="point-icon">&#x2715;</span>
            <span>Not measuring correctness</span>
          </div>
          <div class="philosophy-point">
            <span class="point-icon">&#x2713;</span>
            <span>Measuring speed & confidence</span>
          </div>
          <div class="philosophy-point">
            <span class="point-icon">&#x2715;</span>
            <span>Not making them love it</span>
          </div>
          <div class="philosophy-point">
            <span class="point-icon">&#x2713;</span>
            <span>Celebrating that it's hard</span>
          </div>
          <div class="philosophy-point">
            <span class="point-icon">&#x2715;</span>
            <span>Not trying too hard</span>
          </div>
          <div class="philosophy-point">
            <span class="point-icon">&#x2713;</span>
            <span>Brain is wired for this</span>
          </div>
        </div>
      </section>

    </main>
  </div>
</template>

<style scoped>
.progress-demo {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary, #0f1419);
  color: var(--text-primary, #e8e6e3);
  font-family: 'DM Sans', -apple-system, sans-serif;
  position: relative;
  overflow-x: hidden;
}

.demo-bg {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 100% 60% at 50% -20%, rgba(194, 58, 58, 0.08) 0%, transparent 50%),
    linear-gradient(to bottom, #1a1f26 0%, #0f1419 100%);
  pointer-events: none;
}

/* Header */
.demo-header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-muted, #8b9ab0);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary, #e8e6e3);
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.header-content h1 {
  font-size: 1.25rem;
  font-weight: 600;
  margin: 0;
}

.header-content p {
  font-size: 0.8125rem;
  color: var(--text-muted, #8b9ab0);
  margin: 0.25rem 0 0 0;
}

/* Main */
.demo-main {
  position: relative;
  z-index: 10;
  padding: 1.5rem;
  max-width: 600px;
  margin: 0 auto;
}

/* Variation selector */
.variation-selector {
  margin-bottom: 2rem;
}

.variation-tabs {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.5rem;
  -webkit-overflow-scrolling: touch;
}

.variation-tab {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.2s ease;
}

.variation-tab:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.12);
}

.variation-tab.active {
  background: rgba(194, 58, 58, 0.1);
  border-color: rgba(194, 58, 58, 0.3);
}

.tab-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary, #e8e6e3);
}

.tab-subtitle {
  font-size: 0.6875rem;
  color: var(--text-muted, #8b9ab0);
  margin-top: 0.125rem;
}

/* Preview area */
.preview-area {
  margin-bottom: 2rem;
}

.preview-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 1.5rem;
  min-height: 220px;
  display: flex;
  flex-direction: column;
}

.preview-label {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted, #8b9ab0);
  margin-bottom: 1rem;
}

/* Variation info */
.variation-info {
  margin-bottom: 2rem;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 12px;
}

.variation-info h2 {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
}

.variation-desc {
  font-size: 0.875rem;
  color: var(--text-secondary, #c8c6c4);
  margin: 0 0 0.75rem 0;
  line-height: 1.5;
}

.variation-personality {
  font-size: 0.8125rem;
  color: var(--text-muted, #8b9ab0);
  margin: 0;
}

.variation-personality strong {
  color: var(--text-secondary, #c8c6c4);
}

/* Simulation controls */
.simulation-controls {
  margin-bottom: 2rem;
}

.simulation-controls h3 {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
}

.preset-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.preset-btn {
  padding: 0.5rem 0.875rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-secondary, #c8c6c4);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #e8e6e3);
}

.current-values {
  font-size: 0.8125rem;
  color: var(--text-muted, #8b9ab0);
  font-family: 'Space Mono', monospace;
}

.current-values .divider {
  margin: 0 0.5rem;
  opacity: 0.5;
}

/* Discussion */
.discussion {
  margin-bottom: 2rem;
  padding: 1rem;
  background: rgba(212, 168, 83, 0.05);
  border: 1px solid rgba(212, 168, 83, 0.15);
  border-radius: 12px;
}

.discussion h3 {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0 0 0.75rem 0;
  color: #d4a853;
}

.discussion-list {
  margin: 0;
  padding-left: 1.25rem;
}

.discussion-list li {
  font-size: 0.8125rem;
  color: var(--text-secondary, #c8c6c4);
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

.discussion-list li:last-child {
  margin-bottom: 0;
}

/* Philosophy */
.philosophy {
  margin-bottom: 2rem;
}

.philosophy h3 {
  font-size: 0.875rem;
  font-weight: 600;
  margin: 0 0 1rem 0;
}

.philosophy-points {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.philosophy-point {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary, #c8c6c4);
}

.point-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 0.625rem;
  font-weight: 700;
}

.philosophy-point:nth-child(odd) .point-icon {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.philosophy-point:nth-child(even) .point-icon {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

/* Responsive */
@media (max-width: 480px) {
  .demo-main {
    padding: 1rem;
  }

  .philosophy-points {
    grid-template-columns: 1fr;
  }

  .variation-tabs {
    margin: 0 -1rem;
    padding: 0 1rem 0.5rem 1rem;
  }
}
</style>
</script>
