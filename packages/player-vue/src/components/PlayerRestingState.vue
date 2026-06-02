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
  // Welcome banner — only true on the first-ever course a learner opens
  // when that course has welcome audio. Opt-in CTA; tapping Play below
  // ignores it and starts cycle 1 directly.
  showWelcomeBanner: { type: Boolean, default: false },
})

const emit = defineEmits(['start', 'change-course', 'play-welcome', 'dismiss-welcome'])

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

const handleChangeCourse = () => {
  emit('change-course')
}
</script>

<template>
  <!-- Full resting state (shown when paused) -->
  <div class="resting-state">
    <!-- Welcome banner — first-ever course only. Opt-in: dismissing or
         playing it both mark heard so the banner never returns. Sits
         above the resting content so it reads as a one-time offer, not
         part of the steady-state UI. -->
    <div v-if="showWelcomeBanner" class="welcome-banner" @click.stop="emit('play-welcome')">
      <div class="welcome-banner-icon">▶</div>
      <div class="welcome-banner-text">
        <div class="welcome-banner-title">{{ t('welcome.bannerTitle', 'Welcome — about your course') }}</div>
        <div class="welcome-banner-subtitle">{{ t('welcome.bannerSubtitle', 'about 1 min · tap to play') }}</div>
      </div>
      <button
        class="welcome-banner-dismiss"
        :aria-label="t('welcome.dismiss', 'Dismiss welcome')"
        @click.stop="emit('dismiss-welcome')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

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
