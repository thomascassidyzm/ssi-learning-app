<script setup>
import { computed } from 'vue'
import { BELTS } from '@/composables/useBeltProgress'
import { getLanguageName, t } from '@/composables/useI18n'
import LanguageFlag from '@/components/schools/shared/LanguageFlag.vue'

const props = defineProps({
  course: { type: Object, default: null },
  completedSeeds: { type: Number, default: 0 },
  totalSeeds: { type: Number, default: 668 },
  currentBeltName: { type: String, default: 'white' },
  isPlayerReady: { type: Boolean, default: false },
  // Round-cursor pair for the journey-bar / jump-back UX. When the cursor
  // is behind the ceiling (the learner has revisited earlier content),
  // we surface a visual showing both positions along the course and a
  // single CTA to jump back to their furthest. Both null for guests /
  // fresh enrollments.
  currentRound: { type: Number, default: null },
  highestRound: { type: Number, default: null },
})

const emit = defineEmits(['start', 'change-course', 'jump-to-furthest'])

const showJumpChoice = computed(() => {
  if (!props.isPlayerReady) return false
  const c = props.currentRound
  const h = props.highestRound
  return typeof c === 'number' && typeof h === 'number' && c < h
})

// Estimate course length in rounds. Each seed produces roughly three
// rounds of practice, so the journey-bar uses totalSeeds * 3 as the scale.
// It's deliberately rough — we just want a "this is where you are along
// the course" sense, not pixel-precision.
const ROUNDS_PER_SEED = 3
const totalRoundsEstimate = computed(() => Math.max(1, props.totalSeeds * ROUNDS_PER_SEED))

const cursorPercent = computed(() => {
  if (typeof props.currentRound !== 'number') return 0
  return Math.min(100, Math.max(0, (props.currentRound / totalRoundsEstimate.value) * 100))
})

const highestPercent = computed(() => {
  if (typeof props.highestRound !== 'number') return 0
  return Math.min(100, Math.max(0, (props.highestRound / totalRoundsEstimate.value) * 100))
})

const courseName = computed(() => {
  if (!props.course) return 'Loading...'
  // Always use the target language name in the known language (via locale)
  // e.g., for eus_for_spa: "Euskera" (Basque in Spanish), not "Basque" or "Euskara"
  return getLanguageName(props.course.target_lang)
})

const courseSubtitle = computed(() => {
  if (!props.course?.known_lang) return ''
  // Fully localized: "for English Speakers" / "para hablantes de Español" / "i siaradwyr Saesneg"
  const knownName = getLanguageName(props.course.known_lang)
  return t('courseSelector.forSpeakers', `for ${knownName} Speakers`).replace('{lang}', knownName)
})

const belt = computed(() => {
  return BELTS.find(b => b.name === props.currentBeltName) || BELTS[0]
})

const beltDisplay = computed(() => {
  const colorName = t(`belt.${props.currentBeltName}`, props.currentBeltName)
  return t('belt.label', `${colorName} Belt`).replace('{color}', colorName)
})

const progressPercent = computed(() => {
  if (props.totalSeeds === 0) return 0
  return Math.min(100, Math.round((props.completedSeeds / props.totalSeeds) * 100))
})

const greeting = computed(() => {
  if (!props.isPlayerReady) return t('resting.loading', 'Loading...')
  if (props.completedSeeds === 0) return t('resting.readyWhenYouAre', 'Ready when you are')
  if (props.completedSeeds < 10) return t('resting.greatStart', 'Great start — keep going')
  if (props.completedSeeds < 50) return t('resting.buildingMomentum', 'Building momentum')
  if (props.completedSeeds < 150) return t('resting.youreOnARoll', "You're on a roll")
  if (props.completedSeeds < 300) return t('resting.impressiveProgress', 'Impressive progress')
  return t('resting.nearlyThere', 'Nearly there')
})

const handleChangeCourse = () => {
  emit('change-course')
}
</script>

<template>
  <!-- Full resting state (shown when paused) -->
  <div class="resting-state">
    <div class="resting-content">
      <!-- Course identity -->
      <LanguageFlag :code="course?.target_lang || ''" :size="48" class="course-flag" />
      <h2 class="course-name course-name--tappable" @click.stop="handleChangeCourse">
        {{ courseName }}
        <svg class="course-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </h2>
      <p v-if="courseSubtitle" class="course-subtitle">{{ courseSubtitle }}</p>

      <!-- Belt badge -->
      <div class="belt-badge" :style="{ '--belt-accent': belt.color }">
        <div class="belt-dot"></div>
        <span class="belt-name">{{ beltDisplay }}</span>
      </div>

      <!-- Progress -->
      <div class="progress-section">
        <div class="progress-bar-track" :style="{ background: belt.color + '26' }">
          <div
            class="progress-bar-fill"
            :style="{ width: progressPercent + '%', background: belt.color }"
          ></div>
        </div>
        <span class="progress-label">{{ progressPercent }}%</span>
      </div>

      <!-- Cursor < ceiling: show the journey-bar + a single CTA to jump
           back to the furthest. Surfaces only when the learner has
           revisited earlier content. Doing nothing (just tapping play)
           is the implicit "stay here" — no second button needed. -->
      <div v-if="showJumpChoice" class="journey">
        <p class="journey-prompt">{{ t('resting.youHaveBeenFurther', "you've been further than this") }}</p>
        <div class="journey-bar" :style="{ '--belt-accent': belt.color }">
          <div class="journey-track"></div>
          <div
            class="journey-trail"
            :style="{ left: cursorPercent + '%', width: Math.max(1, highestPercent - cursorPercent) + '%' }"
          ></div>
          <div
            class="journey-marker journey-marker--current"
            :style="{ left: cursorPercent + '%' }"
            :aria-label="t('resting.youAreHere', 'you are here')"
          >
            <span class="journey-marker-label">{{ t('resting.you', 'you') }}</span>
          </div>
          <div
            class="journey-marker journey-marker--highest"
            :style="{ left: highestPercent + '%' }"
            :aria-label="t('resting.yourFurthest', 'your furthest point')"
          >
            <span class="journey-marker-label journey-marker-label--right">{{ t('resting.furthest', 'furthest') }}</span>
          </div>
        </div>
        <button
          class="journey-cta"
          :style="{ '--belt-accent': belt.color }"
          @click.stop="emit('jump-to-furthest')"
        >
          {{ t('resting.jumpForward', 'pick up where you got to') }}
        </button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ===== Full resting state (when paused) ===== */
.resting-state {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  pointer-events: none;
  background: transparent;
  -webkit-tap-highlight-color: transparent;
  animation: resting-fade-in 0.4s ease;
}

@keyframes resting-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.resting-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 24px;
  text-align: center;
  pointer-events: auto;
}

.course-flag {
  line-height: 1;
}

.course-name {
  font-family: var(--font-display, var(--font-body));
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.01em;
}

.course-name--tappable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.2s ease;
}

.course-name--tappable:hover {
  color: var(--text-secondary);
}

.course-chevron {
  width: 16px;
  height: 16px;
  opacity: 0.5;
  flex-shrink: 0;
}

.course-subtitle {
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-muted);
  margin: -4px 0 0;
}

.belt-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border-radius: 20px;
  background: color-mix(in srgb, var(--belt-accent, #ffffff) 15%, transparent);
  border: 1.5px solid color-mix(in srgb, var(--belt-accent, #ffffff) 40%, transparent);
}

.belt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--belt-accent, #ffffff);
  box-shadow: 0 0 6px var(--belt-accent, #ffffff);
}

.belt-name {
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.progress-section {
  width: 100%;
  max-width: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.progress-bar-track {
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-interactive-disabled, rgba(255,255,255,0.1));
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.progress-label {
  font-family: var(--font-body);
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.greeting {
  font-family: var(--font-body);
  font-size: 16px;
  color: var(--text-secondary);
  margin: 8px 0 0;
  font-style: italic;
}

/* ===== Journey bar ===== */
.journey {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  margin-top: 20px;
  width: 100%;
  max-width: 320px;
}

.journey-prompt {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  font-style: italic;
  text-align: center;
}

.journey-bar {
  position: relative;
  height: 36px;
  margin: 0 12px;
}

.journey-track {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--belt-accent, #ffffff) 18%, transparent);
  transform: translateY(-50%);
}

.journey-trail {
  position: absolute;
  top: 50%;
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--belt-accent, #ffffff) 55%, transparent);
  transform: translateY(-50%);
  transition: left 0.3s ease, width 0.3s ease;
}

.journey-marker {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--belt-accent, #ffffff);
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--belt-accent, #ffffff) 25%, transparent);
  transition: left 0.3s ease;
}

.journey-marker--highest {
  width: 14px;
  height: 14px;
  background: var(--belt-accent, #ffffff);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--belt-accent, #ffffff) 25%, transparent),
    0 0 8px color-mix(in srgb, var(--belt-accent, #ffffff) 50%, transparent);
}

.journey-marker-label {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  pointer-events: none;
}

.journey-marker-label--right {
  /* keep it centred on the marker; CSS clamp prevents it overflowing */
  left: 50%;
}

.journey-cta {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  padding: 11px 20px;
  border-radius: 22px;
  border: 1.5px solid color-mix(in srgb, var(--belt-accent, #ffffff) 50%, transparent);
  background: color-mix(in srgb, var(--belt-accent, #ffffff) 18%, transparent);
  color: var(--text-primary);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.2s ease, border-color 0.2s ease;
  text-align: center;
  text-transform: lowercase;
  letter-spacing: 0.01em;
  margin-top: 4px;
}

.journey-cta:hover {
  background: color-mix(in srgb, var(--belt-accent, #ffffff) 28%, transparent);
}

.tap-hint {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
  margin: 16px 0 0;
  opacity: 0.6;
  animation: hint-pulse 2s ease-in-out infinite;
}

@keyframes hint-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
</style>

<!-- Mist theme overrides -->
<style>
:root[data-theme="mist"] .resting-state {
  background: transparent;
}

:root[data-theme="mist"] .belt-badge {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.25);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.08);
}

:root[data-theme="mist"] .progress-bar-track {
  background: rgba(0, 0, 0, 0.06);
}

</style>
