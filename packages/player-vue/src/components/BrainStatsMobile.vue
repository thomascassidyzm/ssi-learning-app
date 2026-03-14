<script setup lang="ts">
/**
 * BrainStatsMobile.vue - Mobile-Friendly Stats Dashboard
 *
 * A proud, celebration-worthy alternative to the 3D brain visualization.
 * This is NOT a fallback - it's a first-class mobile experience showing:
 * - Belt progress with color
 * - Big, proud achievement numbers
 * - Activity streak and weekly chart
 * - Top words (optional, tappable)
 *
 * Design: Dark theme with belt color as accent, spacious and celebratory.
 */

import { computed, ref, onMounted, inject } from 'vue'
import { BELTS } from '../composables/useBeltProgress'
import { useLearnerJourney } from '../composables/useLearnerJourney'
import EvolutionCard from './learner/EvolutionCard.vue'
import ContributionCounter from './learner/ContributionCounter.vue'
import TransformationTimeline from './learner/TransformationTimeline.vue'
import PercentileBadge from './learner/PercentileBadge.vue'

// ============================================================================
// PROPS & EMITS
// ============================================================================

interface TopWord {
  text: string
  count: number
}

const props = defineProps<{
  beltLevel: string
  beltProgress: number // 0-1 to next belt
  seedsToNextBelt: number
  wordsLearned: number
  phrasesPracticed: number
  totalMinutes: number
  currentStreak: number
  weekActivity: number[] // 7 values for each day
  topWords?: TopWord[]
  courseId?: string
}>()

const emit = defineEmits<{
  close: []
  playWord: [word: TopWord]
}>()

// ============================================================================
// COMPUTED
// ============================================================================

// Belt colors mapping
const beltColors: Record<string, { primary: string; glow: string; dark: string }> = {
  white:  { primary: '#f5f5f5', glow: 'rgba(245, 245, 245, 0.3)', dark: '#e0e0e0' },
  yellow: { primary: '#fcd34d', glow: 'rgba(252, 211, 77, 0.4)', dark: '#f59e0b' },
  orange: { primary: '#fb923c', glow: 'rgba(251, 146, 60, 0.4)', dark: '#ea580c' },
  green:  { primary: '#4ade80', glow: 'rgba(74, 222, 128, 0.4)', dark: '#16a34a' },
  blue:   { primary: '#60a5fa', glow: 'rgba(96, 165, 250, 0.4)', dark: '#2563eb' },
  purple: { primary: '#a78bfa', glow: 'rgba(167, 139, 250, 0.4)', dark: '#7c3aed' },
  brown:  { primary: '#a8856c', glow: 'rgba(168, 133, 108, 0.4)', dark: '#78350f' },
  black:  { primary: '#d4a853', glow: 'rgba(212, 168, 83, 0.4)', dark: '#b8860b' },
}

const beltColor = computed(() => beltColors[props.beltLevel] || beltColors.white)

const beltDisplayName = computed(() => {
  return props.beltLevel.charAt(0).toUpperCase() + props.beltLevel.slice(1)
})

// Find next belt info
const nextBeltInfo = computed(() => {
  const currentIndex = BELTS.findIndex(b => b.name === props.beltLevel)
  if (currentIndex === -1 || currentIndex >= BELTS.length - 1) {
    return null
  }
  return BELTS[currentIndex + 1]
})

// Format time as hours and minutes
const formattedTime = computed(() => {
  const hours = Math.floor(props.totalMinutes / 60)
  const mins = props.totalMinutes % 60
  if (hours === 0) {
    return { value: mins, unit: 'min' }
  }
  if (mins === 0) {
    return { value: hours, unit: hours === 1 ? 'hour' : 'hours' }
  }
  return { value: `${hours}h ${mins}m`, unit: '' }
})

// Day labels for week activity
const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// Calculate max activity for scaling the bars
const maxActivity = computed(() => {
  return Math.max(...props.weekActivity, 1)
})

// Get bar height as percentage
const getBarHeight = (value: number) => {
  return Math.max((value / maxActivity.value) * 100, 4) // Min 4% for visibility
}

// CSS variables for theming
const cssVars = computed(() => ({
  '--accent': beltColor.value.primary,
  '--accent-glow': beltColor.value.glow,
  '--accent-dark': beltColor.value.dark,
}))

// Hovered top word for haptic feedback
const hoveredWordIndex = ref<number | null>(null)

const handleWordTap = (word: TopWord) => {
  emit('playWord', word)
}

// Learner Journey
const supabaseRef = inject('supabase', ref(null)) as any
const journeyReady = ref(false)

const journeyComposable = computed(() => {
  const client = supabaseRef.value
  if (!client) return null
  return useLearnerJourney(client)
})

onMounted(async () => {
  const composable = journeyComposable.value
  if (composable && props.courseId) {
    await Promise.all([
      composable.fetchJourney(props.courseId),
      composable.fetchContribution(props.courseId),
    ])
    journeyReady.value = true
  }
})
</script>

<template>
  <div class="brain-stats-mobile" :style="cssVars">
    <!-- Background effects -->
    <div class="bg-gradient"></div>
    <div class="bg-noise"></div>

    <!-- Header -->
    <header class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1 class="title">Your Progress</h1>
      <div class="header-spacer"></div>
    </header>

    <!-- Content -->
    <main class="content">
      <!-- Belt Progress Section -->
      <section class="belt-section">
        <div class="belt-badge">
          <div class="belt-visual">
            <div class="belt-stripe" :style="{ backgroundColor: beltColor.primary }"></div>
          </div>
          <div class="belt-info">
            <span class="belt-label">Current Belt</span>
            <span class="belt-name" :style="{ color: beltColor.primary }">{{ beltDisplayName }}</span>
          </div>
        </div>

        <div class="progress-container">
          <div class="progress-track">
            <div
              class="progress-fill"
              :style="{
                width: `${beltProgress * 100}%`,
                backgroundColor: beltColor.primary,
                boxShadow: `0 0 20px ${beltColor.glow}`
              }"
            ></div>
          </div>
          <div class="progress-label" v-if="nextBeltInfo">
            <span class="seeds-count">{{ seedsToNextBelt }}</span>
            <span class="seeds-text">seeds to</span>
            <span class="next-belt-name" :style="{ color: beltColors[nextBeltInfo.name]?.primary || 'var(--text-primary)' }">
              {{ nextBeltInfo.name }}
            </span>
            <span class="seeds-text">belt</span>
          </div>
          <div class="progress-label" v-else>
            <span class="achievement-text">Maximum rank achieved!</span>
          </div>
        </div>
      </section>

      <!-- Big Numbers Section -->
      <section class="stats-section">
        <div class="stat-card hero">
          <div class="stat-value-large">{{ wordsLearned.toLocaleString() }}</div>
          <div class="stat-label">Words Learned</div>
          <div class="stat-icon-bg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
        </div>

        <div class="stat-row">
          <div class="stat-card">
            <div class="stat-value">{{ phrasesPracticed.toLocaleString() }}</div>
            <div class="stat-label">Phrases Practiced</div>
          </div>

          <div class="stat-card">
            <div class="stat-value">
              {{ typeof formattedTime.value === 'number' ? formattedTime.value : formattedTime.value }}
            </div>
            <div class="stat-label">
              {{ formattedTime.unit ? `Total ${formattedTime.unit}` : 'Total Time' }}
            </div>
          </div>
        </div>
      </section>

      <!-- Evolution & Contribution (replaces streak) -->
      <section v-if="journeyReady && journeyComposable?.journey.value" class="evolution-section">
        <EvolutionCard
          :score="journeyComposable.journey.value.evolution_score"
          :level="journeyComposable.journey.value.evolution_level"
          :name="journeyComposable.journey.value.evolution_name"
          :icon="journeyComposable.journey.value.evolution_icon"
          :next-threshold="journeyComposable.journey.value.next_level_threshold"
          :progress="journeyComposable.evolutionProgress.value"
        />
        <PercentileBadge
          v-if="journeyComposable.journey.value.percentile_this_week"
          :percentile="journeyComposable.journey.value.percentile_this_week"
          :language-name="journeyComposable.contribution.value?.language_name || ''"
        />
      </section>

      <!-- Contribution Counter -->
      <ContributionCounter
        v-if="journeyReady && journeyComposable?.contribution.value"
        :language-name="journeyComposable.contribution.value.language_name"
        :phrases-count="journeyComposable.contribution.value.phrases_count"
        :minutes-practiced="journeyComposable.contribution.value.minutes_practiced"
        :unique-speakers="journeyComposable.contribution.value.unique_speakers"
        :user-minutes="journeyComposable.contribution.value.user_minutes_today"
        :user-phrases="journeyComposable.contribution.value.user_phrases_today"
      />

      <!-- Activity Section (week chart kept, streak removed) -->
      <section class="activity-section activity-section--full">
        <div class="week-chart">
          <div class="chart-title">This Week</div>
          <div class="chart-bars">
            <div
              v-for="(value, index) in weekActivity"
              :key="index"
              class="bar-container"
            >
              <div
                class="bar"
                :style="{
                  height: `${getBarHeight(value)}%`,
                  backgroundColor: value > 0 ? beltColor.primary : 'var(--bg-elevated)',
                  boxShadow: value > 0 ? `0 0 8px ${beltColor.glow}` : 'none'
                }"
              ></div>
              <span class="bar-label">{{ dayLabels[index] }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Transformation Timeline -->
      <TransformationTimeline
        v-if="journeyReady && journeyComposable?.journey.value"
        :milestones="journeyComposable.journey.value.milestones"
      />

      <!-- Top Words Section (optional) -->
      <section v-if="topWords && topWords.length > 0" class="words-section">
        <h3 class="section-title">Your Most-Used Words</h3>
        <div class="words-list">
          <button
            v-for="(word, index) in topWords.slice(0, 10)"
            :key="word.text"
            class="word-chip"
            :class="{ active: hoveredWordIndex === index }"
            @click="handleWordTap(word)"
            @mouseenter="hoveredWordIndex = index"
            @mouseleave="hoveredWordIndex = null"
          >
            <span class="word-text">{{ word.text }}</span>
            <span class="word-count">{{ word.count }}x</span>
          </button>
        </div>
        <p class="words-hint">Tap a word to hear it</p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.brain-stats-mobile {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: var(--font-body);
  position: relative;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Background Effects */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 100% 60% at 50% 0%, var(--accent-glow, var(--border-subtle)) 0%, transparent 60%),
    linear-gradient(to bottom, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  pointer-events: none;
  z-index: 0;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.02;
  pointer-events: none;
  z-index: 0;
}

/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.5rem 1rem 1.5rem;
  gap: 1rem;
}

.back-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  background: var(--bg-overlay);
  backdrop-filter: blur(12px);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.back-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.back-btn:active {
  transform: scale(0.95);
}

.back-btn svg {
  width: 22px;
  height: 22px;
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.01em;
}

.header-spacer {
  width: 44px;
}

/* Content */
.content {
  flex: 1;
  padding: 0 1.5rem;
  padding-bottom: calc(2rem + env(safe-area-inset-bottom, 0px));
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Belt Section */
.belt-section {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  padding: 1.5rem;
}

.belt-badge {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.belt-visual {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  background: var(--bg-elevated);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}

.belt-stripe {
  width: 100%;
  height: 12px;
  border-radius: 6px;
  box-shadow: 0 0 20px var(--accent-glow);
}

.belt-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.belt-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.belt-name {
  font-size: 1.5rem;
  font-weight: 700;
  text-shadow: 0 0 30px var(--accent-glow);
}

.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.progress-track {
  height: 8px;
  background: var(--bg-elevated);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.5s ease-out;
}

.progress-label {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.seeds-count {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--accent);
}

.seeds-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.next-belt-name {
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: capitalize;
}

.achievement-text {
  font-size: 0.875rem;
  color: var(--accent);
  font-weight: 500;
}

/* Stats Section */
.stats-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1.25rem;
  position: relative;
  overflow: hidden;
}

.stat-card.hero {
  padding: 2rem 1.5rem;
  text-align: center;
  background: var(--bg-card-gradient);
}

.stat-value-large {
  font-family: 'Space Mono', monospace;
  font-size: 3.5rem;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
  text-shadow: 0 0 40px var(--accent-glow);
  margin-bottom: 0.5rem;
}

.stat-card.hero .stat-label {
  font-size: 1rem;
  color: var(--text-secondary);
}

.stat-icon-bg {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  width: 80px;
  height: 80px;
  color: var(--text-muted);
  opacity: 0.3;
}

.stat-icon-bg svg {
  width: 100%;
  height: 100%;
}

.stat-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Evolution Section */
.evolution-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

/* Activity Section */
.activity-section {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 0.75rem;
}

.activity-section--full {
  grid-template-columns: 1fr;
}

.week-chart {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem 1.25rem;
}

.chart-title {
  font-size: 0.6875rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

.chart-bars {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  height: 64px;
  gap: 6px;
}

.bar-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  height: 100%;
}

.bar {
  width: 100%;
  border-radius: 4px;
  transition: height 0.3s ease-out;
  min-height: 4px;
}

.bar-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  font-weight: 500;
}

/* Words Section */
.words-section {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1.25rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 1rem 0;
}

.words-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.word-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.word-chip:hover,
.word-chip.active {
  background: var(--accent-glow);
  border-color: var(--accent);
  transform: scale(1.02);
}

.word-chip:active {
  transform: scale(0.98);
}

.word-text {
  font-size: 0.875rem;
  color: var(--text-primary);
  font-weight: 500;
}

.word-count {
  font-size: 0.6875rem;
  color: var(--text-muted);
  background: var(--bg-elevated);
  padding: 2px 6px;
  border-radius: 8px;
}

.words-hint {
  margin: 0.75rem 0 0 0;
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-align: center;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════════════════════ */

/* Extra small phones */
@media (max-width: 360px) {
  .header {
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem 1rem;
  }

  .content {
    padding: 0 1rem;
    gap: 1rem;
  }

  .belt-section,
  .stat-card,
  .week-chart,
  .words-section {
    padding: 1rem;
    border-radius: 14px;
  }

  .belt-visual {
    width: 48px;
    height: 48px;
    border-radius: 12px;
  }

  .belt-name {
    font-size: 1.25rem;
  }

  .stat-value-large {
    font-size: 2.5rem;
  }

  .stat-value {
    font-size: 1.5rem;
  }

  .activity-section {
    grid-template-columns: 1fr;
  }
}

/* Tablets and larger */
@media (min-width: 768px) {
  .content {
    max-width: 540px;
    margin: 0 auto;
    gap: 2rem;
  }

  .belt-section {
    padding: 2rem;
    border-radius: 24px;
  }

  .belt-visual {
    width: 64px;
    height: 64px;
  }

  .belt-name {
    font-size: 1.75rem;
  }

  .progress-track {
    height: 10px;
  }

  .stat-card.hero {
    padding: 2.5rem 2rem;
  }

  .stat-value-large {
    font-size: 4rem;
  }

  .stat-value {
    font-size: 2rem;
  }

  .stat-card,
  .week-chart,
  .words-section {
    padding: 1.5rem;
    border-radius: 20px;
  }

  .chart-bars {
    height: 80px;
  }
}

/* Dark mode optimizations */
@media (prefers-color-scheme: dark) {
  .brain-stats-mobile {
    color-scheme: dark;
  }
}
</style>
