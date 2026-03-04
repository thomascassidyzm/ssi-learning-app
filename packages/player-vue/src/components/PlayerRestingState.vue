<script setup>
import { computed } from 'vue'
import { BELTS } from '@/composables/useBeltProgress'

const LANGUAGE_META = {
  cym: { name: 'Welsh', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  spa: { name: 'Spanish', flag: '🇪🇸' },
  fra: { name: 'French', flag: '🇫🇷' },
  deu: { name: 'German', flag: '🇩🇪' },
  ita: { name: 'Italian', flag: '🇮🇹' },
  por: { name: 'Portuguese', flag: '🇵🇹' },
  jpn: { name: 'Japanese', flag: '🇯🇵' },
  kor: { name: 'Korean', flag: '🇰🇷' },
  cmn: { name: 'Chinese', flag: '🇨🇳' },
  zho: { name: 'Chinese', flag: '🇨🇳' },
  ara: { name: 'Arabic', flag: '🇸🇦' },
  nld: { name: 'Dutch', flag: '🇳🇱' },
  rus: { name: 'Russian', flag: '🇷🇺' },
  pol: { name: 'Polish', flag: '🇵🇱' },
}

const getLangMeta = (code) => LANGUAGE_META[code] || { name: code?.toUpperCase() || '?', flag: '🌐' }

const props = defineProps({
  course: { type: Object, default: null },
  completedSeeds: { type: Number, default: 0 },
  totalSeeds: { type: Number, default: 668 },
  currentBeltName: { type: String, default: 'white' },
  minimized: { type: Boolean, default: false },
})

const emit = defineEmits(['start', 'change-course'])

const courseName = computed(() => {
  if (!props.course) return 'Loading...'
  if (props.course.display_name) {
    return props.course.display_name.replace(/\s+for\s+.+$/i, '')
  }
  return getLangMeta(props.course.target_lang).name
})

const courseSubtitle = computed(() => {
  if (!props.course?.known_lang) return ''
  const knownMeta = getLangMeta(props.course.known_lang)
  return `for ${knownMeta.name} Speakers`
})

const courseFlag = computed(() => {
  if (!props.course) return '🌐'
  return getLangMeta(props.course.target_lang).flag
})

const belt = computed(() => {
  return BELTS.find(b => b.name === props.currentBeltName) || BELTS[0]
})

const progressPercent = computed(() => {
  if (props.totalSeeds === 0) return 0
  return Math.min(100, Math.round((props.completedSeeds / props.totalSeeds) * 100))
})

const greeting = computed(() => {
  if (props.completedSeeds === 0) return 'Ready when you are'
  if (props.completedSeeds < 10) return 'Great start — keep going'
  if (props.completedSeeds < 50) return 'Building momentum'
  if (props.completedSeeds < 150) return 'You\'re on a roll'
  if (props.completedSeeds < 300) return 'Impressive progress'
  return 'Nearly there'
})

const handleChangeCourse = () => {
  emit('change-course')
}
</script>

<template>
  <!-- Minimised: compact strip at top during playback -->
  <div v-if="minimized" class="resting-mini">
    <span class="mini-flag">{{ courseFlag }}</span>
    <span class="mini-name">{{ courseName }}</span>
    <span v-if="courseSubtitle" class="mini-subtitle">{{ courseSubtitle }}</span>
    <span class="mini-belt-dot" :style="{ background: belt.color, boxShadow: '0 0 6px ' + belt.color }"></span>
    <div class="mini-progress-track" :style="{ background: belt.color + '26' }">
      <div class="mini-progress-fill" :style="{ width: progressPercent + '%', background: belt.color }"></div>
    </div>
    <span class="mini-progress-label">{{ completedSeeds }}/{{ totalSeeds }}</span>
  </div>

  <!-- Full resting state when paused -->
  <div v-else class="resting-state">
    <div class="resting-content">
      <!-- Course identity -->
      <div class="course-flag">{{ courseFlag }}</div>
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
        <span class="belt-name">{{ currentBeltName }} belt</span>
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

    </div>
  </div>
</template>

<style scoped>
/* ===== Minimised strip (during playback) ===== */
.resting-mini {
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-radius: 20px;
  pointer-events: none;
  opacity: 0.7;
  transition: opacity 0.3s ease;
  white-space: nowrap;
}

.mini-flag {
  font-size: 16px;
  line-height: 1;
}

.mini-name {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
}

.mini-subtitle {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.45);
}

.mini-belt-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mini-progress-track {
  width: 40px;
  height: 3px;
  border-radius: 1.5px;
  background: rgba(255, 255, 255, 0.15);
  overflow: hidden;
}

.mini-progress-fill {
  height: 100%;
  border-radius: 1.5px;
  transition: width 0.5s ease;
}

.mini-progress-label {
  font-family: var(--font-body);
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  font-variant-numeric: tabular-nums;
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
  /* Translucent — let constellation/particles show through */
  background: radial-gradient(
    ellipse at center 60%,
    color-mix(in srgb, var(--bg-primary) 70%, transparent) 0%,
    color-mix(in srgb, var(--bg-primary) 40%, transparent) 100%
  );
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
  font-size: 48px;
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
  background: color-mix(in srgb, var(--belt-accent, #f5f5f5) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--belt-accent, #f5f5f5) 30%, transparent);
}

.belt-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--belt-accent, #f5f5f5);
  box-shadow: 0 0 6px var(--belt-accent, #f5f5f5);
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
  background: radial-gradient(
    ellipse at center 60%,
    color-mix(in srgb, var(--bg-primary) 30%, transparent) 0%,
    transparent 100%
  );
}

:root[data-theme="mist"] .belt-badge {
  background: #ffffff;
  border-color: rgba(0, 0, 0, 0.06);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.08);
}

:root[data-theme="mist"] .progress-bar-track {
  background: rgba(0, 0, 0, 0.06);
}

:root[data-theme="mist"] .resting-mini {
  background: rgba(255, 255, 255, 0.7);
}

:root[data-theme="mist"] .mini-name {
  color: rgba(0, 0, 0, 0.7);
}

:root[data-theme="mist"] .mini-subtitle {
  color: rgba(0, 0, 0, 0.35);
}

:root[data-theme="mist"] .mini-progress-track {
  background: rgba(0, 0, 0, 0.08);
}

:root[data-theme="mist"] .mini-progress-label {
  color: rgba(0, 0, 0, 0.4);
}
</style>
