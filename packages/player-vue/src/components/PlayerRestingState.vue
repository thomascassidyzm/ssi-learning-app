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
})

const emit = defineEmits(['start', 'change-course'])

const courseName = computed(() => {
  if (!props.course) return 'Loading...'
  if (props.course.display_name) {
    return props.course.display_name.replace(/\s+for\s+.+$/i, '')
  }
  return getLangMeta(props.course.target_lang).name
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

const handleChangeCourse = (e) => {
  e.stopPropagation()
  emit('change-course')
}
</script>

<template>
  <div class="resting-state" @click="emit('start')">
    <div class="resting-content">
      <!-- Course identity -->
      <div class="course-flag">{{ courseFlag }}</div>
      <h2 class="course-name">{{ courseName }}</h2>

      <!-- Course switcher pill -->
      <button class="course-switcher" @click="handleChangeCourse">
        <span>Change course</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      <!-- Belt badge -->
      <div class="belt-badge" :style="{ '--belt-accent': belt.color }">
        <div class="belt-dot"></div>
        <span class="belt-name">{{ currentBeltName }} belt</span>
      </div>

      <!-- Progress -->
      <div class="progress-section">
        <div class="progress-bar-track">
          <div
            class="progress-bar-fill"
            :style="{ width: progressPercent + '%', background: belt.color }"
          ></div>
        </div>
        <span class="progress-label">{{ completedSeeds }} / {{ totalSeeds }} seeds</span>
      </div>

      <!-- Greeting -->
      <p class="greeting">{{ greeting }}</p>

      <!-- Tap hint -->
      <p class="tap-hint">Tap anywhere or press play</p>
    </div>
  </div>
</template>

<style scoped>
.resting-state {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
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

.course-switcher {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-body);
  font-size: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: color 0.2s ease;
}

.course-switcher:hover {
  color: var(--text-secondary);
}

.course-switcher svg {
  width: 14px;
  height: 14px;
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
