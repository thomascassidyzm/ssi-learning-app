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
  // LEGO IDs at cursor and ceiling. These are the CANONICAL position
  // markers — round_index can lag behind the LEGO position by several
  // rounds (e.g. INF PLAY substitutes the LEGO but the round_index
  // advances per-round), so showJumpChoice must compare LEGO IDs not
  // round indices. Null for guests / fresh enrollments.
  currentLegoId: { type: String, default: null },
  highestLegoId: { type: String, default: null },
  // Playback mode. INF PLAY = "you're at the furthest by definition,
  // no jump-back UX makes sense". The warning is suppressed entirely
  // for mode='infplay'.
  currentMode: { type: String, default: 'main' },
  // Belt colours for the two journey-bar markers. Derived upstream from
  // the actual lego IDs (which encode the seed — S0042L05 → seed 42),
  // so they match the belt label exactly. Pre-computed here rather than
  // estimated from the round number.
  cursorBeltColor: { type: String, default: null },
  highestBeltColor: { type: String, default: null },
})

const emit = defineEmits(['start', 'change-course', 'jump-to-furthest'])

const showJumpChoice = computed(() => {
  if (!props.isPlayerReady) return false

  // INF PLAY: by definition the learner is at their furthest point.
  // No "you've been further than this" makes sense in this mode —
  // there IS nothing further. Suppress unconditionally.
  if (props.currentMode === 'infplay') return false

  // Main mode: compare LEGO IDs (canonical position). If either is
  // missing, suppress — the round-index fallback was misleading
  // (round_index can lag legoId during the resting-state render
  // window) and caused the "flash then settle" effect on every
  // course. Wait until we have definitive data.
  const cur = props.currentLegoId
  const hi = props.highestLegoId
  if (typeof cur !== 'string' || typeof hi !== 'string') return false
  return cur < hi  // lex compare on SNNNNLNN
})

// Three-zone schematic: "now" anchored on the left, "furthest" sits at a
// fixed midpoint, and the area after "furthest" is the "rest of course"
// — visually deemphasised so the eye is drawn to the actionable gap
// between now and furthest. Positions are intentionally non-proportional;
// this is a logical scrubber, not a real-distance indicator.
const CURSOR_ANCHOR_PCT = 10
const HIGHEST_ANCHOR_PCT = 62

const cursorPercent = computed(() => CURSOR_ANCHOR_PCT)
const highestPercent = computed(() => HIGHEST_ANCHOR_PCT)

// Belt colours for the two markers. Both come from the parent (LearningPlayer
// derives them from the actual lego IDs, which is the same source the belt
// label uses — guarantees the marker colour matches the badge). Fall back
// to the current belt's colour if the parent hasn't supplied them.
const cursorBeltColorFinal = computed(() => props.cursorBeltColor ?? belt.value.color)
const furthestBeltColorFinal = computed(() => props.highestBeltColor ?? props.cursorBeltColor ?? belt.value.color)

const courseName = computed(() => {
  // Defensive fallback for the brief window before course resolves —
  // the parent v-if already gates the whole resting state on
  // activeCourse, so this rarely shows, but if it does we'd rather a
  // quiet "…" than an over-emphatic "Loading...".
  if (!props.course) return '…'
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

// `greeting` is defined but not currently rendered in this template; it's
// kept so a future revision can reuse the band-stage messaging here. The
// active loading copy lives in LearningPlayer.vue's awakening typewriter
// (AWAKENING_MESSAGES + COURSE_AWAKENING_TEMPLATES), which is what fills
// the hero-known slot during cold-start.
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

      <!-- Belt badge — purely a label of where they are right now, no
           "X% to next belt" gating. Belt is derived from current playing
           position via beltProgress.playingBelt.
           Gated on isPlayerReady so we never flash a misleading "White
           Belt" default for an established learner during the brief
           window between activeCourse loading and progress data
           computing. Course identity (flag + name) above renders
           immediately because it depends only on the Supabase row. -->
      <div v-if="isPlayerReady" class="belt-badge" :style="{ '--belt-accent': belt.color }">
        <div class="belt-dot"></div>
        <span class="belt-name">{{ beltDisplay }}</span>
      </div>

      <!-- Cursor < ceiling: show the journey-bar + a single CTA to jump
           back to the furthest. Surfaces only when the learner has
           revisited earlier content. Doing nothing (just tapping play)
           is the implicit "stay here" — no second button needed. -->
      <div v-if="showJumpChoice" class="journey">
        <p class="journey-prompt">{{ t('resting.youHaveBeenFurther', "you've been further than this") }}</p>
        <div
          class="journey-bar"
          :style="{
            '--belt-accent': belt.color,
            '--cursor-color': cursorBeltColorFinal,
            '--furthest-color': furthestBeltColorFinal,
          }"
        >
          <div
            class="journey-track journey-track--solid"
            :style="{
              left: cursorPercent + '%',
              width: (highestPercent - cursorPercent) + '%',
              background: `linear-gradient(to right, ${cursorBeltColorFinal}, ${furthestBeltColorFinal})`
            }"
          ></div>
          <div
            class="journey-track journey-track--rest"
            :style="{ left: highestPercent + '%', width: (100 - highestPercent) + '%' }"
          ></div>
          <div
            class="journey-marker journey-marker--current"
            :style="{ left: cursorPercent + '%', background: cursorBeltColorFinal }"
            :aria-label="t('resting.youAreHere', 'you are here')"
          >
            <span class="journey-marker-label">{{ t('resting.now', 'now') }}</span>
          </div>
          <div
            class="journey-marker journey-marker--highest"
            :style="{ left: highestPercent + '%', background: furthestBeltColorFinal }"
            :aria-label="t('resting.yourFurthest', 'your furthest point')"
          >
            <span class="journey-marker-label">{{ t('resting.furthest', 'furthest') }}</span>
          </div>
          <span class="journey-rest-label">{{ t('resting.restOfCourse', 'rest of course') }}</span>
        </div>
        <button
          class="journey-cta"
          :style="{ '--belt-accent': belt.color }"
          @click.stop="emit('jump-to-furthest')"
        >
          {{ t('resting.jumpForward', 'pick up where you got to') }}
        </button>
      </div>

      <!-- Pricing CTA — Paddle's domain-approval review wants pricing
           accessible via navigation from the home page. Doubles as a
           genuine product CTA for signed-out visitors landing on the
           player. Routes to /premium where the £15/mo + 7-day-trial
           detail, included-courses grid, and legal footer all live. -->
      <a href="/premium" class="resting-premium-cta">
        Try Premium — 7-day free trial
      </a>

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
  /* Matches the backdrop's crossfade timing so the course identity
     settles in alongside its landscape rather than snapping in on
     top of a still-resolving background. */
  animation: resting-fade-in 1.2s ease;
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
  height: 3px;
  border-radius: 2px;
  transform: translateY(-50%);
}

/* Now → furthest: the actionable gap, drawn solid */
.journey-track--solid {
  background: color-mix(in srgb, var(--belt-accent, #ffffff) 55%, transparent);
}

/* Past furthest: dotted, deemphasised */
.journey-track--rest {
  background: linear-gradient(
    to right,
    color-mix(in srgb, var(--belt-accent, #ffffff) 30%, transparent) 0,
    color-mix(in srgb, var(--belt-accent, #ffffff) 30%, transparent) 4px,
    transparent 4px,
    transparent 8px
  );
  background-size: 8px 3px;
  opacity: 0.7;
}

.journey-rest-label {
  position: absolute;
  top: calc(100% + 18px); /* below the now/furthest labels so they don't collide */
  right: 0;
  font-family: var(--font-body);
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  opacity: 0.6;
  pointer-events: none;
}

.journey-marker {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  /* background is set inline per marker via the belt color */
  transform: translate(-50%, -50%);
  transition: left 0.3s ease;
}

.journey-marker--current {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--cursor-color, #ffffff) 25%, transparent);
}

.journey-marker--highest {
  width: 14px;
  height: 14px;
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--furthest-color, #ffffff) 25%, transparent),
    0 0 8px color-mix(in srgb, var(--furthest-color, #ffffff) 50%, transparent);
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

.resting-premium-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 18px;
  padding: 10px 22px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-primary, rgba(0, 0, 0, 0.85));
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 999px;
  text-decoration: none;
  pointer-events: auto;
  transition: background 0.15s ease, transform 0.15s ease;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.resting-premium-cta:hover {
  background: rgba(255, 255, 255, 0.92);
  transform: translateY(-1px);
}

.resting-premium-cta:active {
  transform: translateY(0);
}

:root[data-theme="mist"] .resting-premium-cta {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.25);
}

</style>
