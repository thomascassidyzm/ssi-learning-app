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
  /** Active learning mode — 'easy' or 'fast'. Fast is the default. */
  learningMode: { type: String, default: 'fast' },
})

const emit = defineEmits(['start', 'change-course', 'set-learning-mode'])

const courseName = computed(() => {
  // Defensive fallback for the brief window before course resolves —
  // the parent v-if already gates the whole resting state on
  // activeCourse, so this rarely shows, but if it does we'd rather a
  // quiet "…" than an over-emphatic "Loading...".
  if (!props.course) return '…'
  // Always use the target language name in the known language (via locale)
  // e.g., for eus_for_spa: "Euskera" (Basque in Spanish), not "Basque" or "Euskara"
  // A course object can arrive without target_lang (a class whose course_code
  // the catalogue can't resolve) — fall back to its display name, then the
  // code prefix, rather than rendering a blank title.
  return (
    getLanguageName(props.course.target_lang) ||
    props.course.learner_display_name ||
    props.course.display_name ||
    getLanguageName(String(props.course.course_code || '').split('_')[0]) ||
    '…'
  )
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

const handleChangeCourse = () => {
  emit('change-course')
}

// Easy / Fast — the mode you pick BEFORE you start, which is why it lives on
// the resting screen rather than in the mid-session mode tray. Fast is the
// default and is the long-standing pace; Easy gives roughly double the
// thinking time and double the repetitions.
const setMode = (mode) => {
  if (mode === props.learningMode) return
  emit('set-learning-mode', mode)
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

      <!-- Learning mode: easy / fast. Pointer events are re-enabled here
           because .resting-state itself is pointer-events:none (taps fall
           through to the play surface behind it). -->
      <div
        v-if="isPlayerReady"
        class="mode-switch"
        role="group"
        :aria-label="t('modes.learningModeLabel', 'Learning mode')"
      >
        <button
          type="button"
          class="mode-switch-btn"
          :class="{ active: learningMode === 'easy' }"
          :aria-pressed="learningMode === 'easy'"
          @click.stop="setMode('easy')"
        >{{ t('modes.easy', 'Easy') }}</button>
        <button
          type="button"
          class="mode-switch-btn"
          :class="{ active: learningMode === 'fast' }"
          :aria-pressed="learningMode === 'fast'"
          @click.stop="setMode('fast')"
        >{{ t('modes.fast', 'Fast') }}</button>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* ===== Learning-mode switch (easy / fast) ===== */
.mode-switch {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  /* .resting-state is pointer-events:none so taps reach the play surface;
     this control has to opt back in. */
  pointer-events: auto;
}

.mode-switch-btn {
  appearance: none;
  border: 0;
  background: transparent;
  border-radius: 999px;
  /* 44px is the thumb-target floor, asserted directly rather than left to
     padding arithmetic — the rendered height moves with the font, and the
     padding-only version measured 41px on dev. */
  min-height: 44px;
  padding: 12px 22px;
  line-height: 1.25;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-secondary, #6b6560);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.mode-switch-btn.active {
  /* Deliberately NOT the belt accent: at White Belt that is near-white, and
     the selected label vanished into its own pill (caught on dev, 2026-08-06).
     The dark ink reads at every belt. */
  background: var(--text-primary, #2f2b28);
  color: var(--bg-primary, #fff);
}

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

/* ===== Welcome banner (first-ever-course CTA) ===== */
.welcome-banner {
  position: absolute;
  top: max(24px, env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: min(340px, calc(100vw - 32px));
  padding: 12px 14px 12px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  color: var(--text-primary);
  cursor: pointer;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.2s ease, transform 0.15s ease;
  animation: welcome-banner-in 0.4s ease-out;
}

.welcome-banner:hover {
  background: rgba(255, 255, 255, 0.18);
}

.welcome-banner:active {
  transform: translateX(-50%) scale(0.98);
}

.welcome-banner-icon {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.18);
  font-size: 12px;
  padding-left: 2px;
}

.welcome-banner-text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
}

.welcome-banner-title {
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.2;
}

.welcome-banner-subtitle {
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.2;
}

.welcome-banner-dismiss {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease, color 0.15s ease;
}

.welcome-banner-dismiss:hover {
  background: rgba(255, 255, 255, 0.12);
  color: var(--text-primary);
}

.welcome-banner-dismiss svg {
  width: 14px;
  height: 14px;
}

@keyframes welcome-banner-in {
  from { opacity: 0; transform: translate(-50%, -8px); }
  to { opacity: 1; transform: translate(-50%, 0); }
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

/* Prominent, on-brand "tap to change language" affordance: bigger, SSi-red,
 * with a soft glow and a gentle downward pulse. No words — the motion + colour
 * carry the "you can change this" message. */
.course-chevron {
  width: 22px;
  height: 22px;
  opacity: 1;
  flex-shrink: 0;
  color: var(--ssi-red, #c23a3a);
  filter: drop-shadow(0 0 5px rgba(194, 58, 58, 0.45));
  animation: course-chevron-pulse 2.4s ease-in-out infinite;
}

@keyframes course-chevron-pulse {
  0%, 100% { transform: translateY(0); opacity: 0.8; }
  50% { transform: translateY(2px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .course-chevron { animation: none; }
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
