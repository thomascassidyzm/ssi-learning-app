<script setup lang="ts">
/**
 * Unified Progress modal — opens from both the top-left contribution
 * timer and the belt pill on the resting state. Replaces the
 * separate ContributionExpanded + BeltProgressModal that used to
 * cover overlapping ground.
 *
 * Content, top to bottom:
 *   1. Flag + language name + "for X speakers" header
 *   2. Today / 7d / 30d / All-time tabs
 *   3. Big global minutes + community context line
 *   4. Your-contribution chip (only when the learner has any)
 *   5. Belt strip — tap a belt to jump there, with now/furthest markers
 *   6. View Full Progress → opens the brain view
 *
 * Deliberately drops the old "00:00 / this session" header — the
 * modal opens with the player paused, so the session counter sits
 * at zero and reads as misleading.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { ContributionData } from '@/composables/useContribution'
import { BELTS } from '@/composables/useBeltProgress'
import { t, getLanguageName } from '@/composables/useI18n'
import LanguageFlag from '@/components/schools/shared/LanguageFlag.vue'

type Belt = { name: string; color: string; seedsRequired: number; glow?: string }

const props = defineProps<{
  isOpen: boolean
  data: ContributionData
  // Course identity for the "for English speakers" subtitle. The
  // ContributionData only carries the *target* language, but the
  // modal reads more cleanly if we name who the course is for too.
  knownLang?: string
  currentBelt: Belt
  availableBelts?: Belt[]
  currentBeltIndex?: number | null
  highestBeltIndex?: number | null
  currentRound?: number | null
  highestRound?: number | null
  isSkipping?: boolean
}>()

const emit = defineEmits<{
  close: []
  skipToBelt: [belt: Belt]
}>()

// --- Time / community tabs ------------------------------------

type TabKey = 'today' | 'days7' | 'days30' | 'allTime'
const activeTab = ref<TabKey>('today')

const tabs = computed(() => [
  { key: 'today' as const, label: t('contribution.today', 'Today') },
  { key: 'days7' as const, label: t('contribution.7days', '7 days') },
  { key: 'days30' as const, label: t('contribution.30days', '30 days') },
  { key: 'allTime' as const, label: t('contribution.allTime', 'All time') },
])

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000) return (n / 1_000).toFixed(0) + 'K'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}

const globalMinutes = computed(() => props.data.global[activeTab.value].minutes)
const speakers = computed(() => props.data.global[activeTab.value].speakers || 0)
const userMinutes = computed(() => props.data.user[activeTab.value].minutes)
const userPhrases = computed(() => props.data.user[activeTab.value].phrases)

const contextMessage = computed(() => {
  const lang = props.data.languageName
  const mins = formatNumber(globalMinutes.value)
  const sp = speakers.value
  const userMins = userMinutes.value
  const fmtUserMins = formatNumber(userMins)

  switch (activeTab.value) {
    case 'today':
      if (userMins > 0 && sp > 1) {
        return t('contribution.joinedToday', 'Your {mins} mins joined {count} other speaker(s) today keeping {language} alive.')
          .replace('{mins}', String(userMins))
          .replace('{count}', String(sp - 1))
          .replace('{language}', lang)
      }
      if (userMins > 0) {
        return t('contribution.keptAliveToday', 'You kept {language} alive today.')
          .replace('{language}', lang)
      }
      if (sp > 0) {
        return t('contribution.speakersToday', '{count} speaker(s) kept {language} alive today. Add your voice.')
          .replace('{count}', String(sp))
          .replace('{language}', lang)
      }
      return t('contribution.needsVoice', '{language} needs your voice today.')
        .replace('{language}', lang)
    case 'days7':
      if (userMins > 0) {
        return t('contribution.contributedWeek', 'You contributed {userMins} of {mins} minutes of {language} this week.')
          .replace('{userMins}', fmtUserMins).replace('{mins}', mins).replace('{language}', lang)
      }
      return t('contribution.weekMinutes', 'SSi learners spoke {mins} minutes of {language} this week.')
        .replace('{mins}', mins).replace('{language}', lang)
    case 'days30':
      if (userMins > 0) {
        return t('contribution.contributedMonth', 'You contributed {userMins} of {mins} minutes of {language} this month.')
          .replace('{userMins}', fmtUserMins).replace('{mins}', mins).replace('{language}', lang)
      }
      return t('contribution.monthMinutes', '{mins} minutes of {language} spoken this month by SSi learners worldwide.')
        .replace('{mins}', mins).replace('{language}', lang)
    case 'allTime':
      if (userMins > 0) {
        return t('contribution.contributedAllTime', '{mins} minutes of {language} on SSi. You contributed {userMins} of them.')
          .replace('{mins}', mins).replace('{language}', lang).replace('{userMins}', fmtUserMins)
      }
      return t('contribution.allTimeMinutes', '{mins} minutes of {language} spoken on SSi so far.')
        .replace('{mins}', mins).replace('{language}', lang)
  }
})

// --- Belt strip -----------------------------------------------

const belts = computed<Belt[]>(() => props.availableBelts ?? (BELTS as Belt[]))

const currentIdx = computed(() => props.currentBeltIndex ?? 0)
const highestIdx = computed(() => props.highestBeltIndex ?? 0)

const chipCenterPercent = (idx: number) => {
  const total = belts.value.length || 1
  return ((idx + 0.5) / total) * 100
}

const nowMarkerLeft = computed(() => chipCenterPercent(currentIdx.value))
const furthestMarkerLeft = computed(() => chipCenterPercent(highestIdx.value))

const showFurthestMarker = computed(() => {
  return typeof props.highestRound === 'number'
    && typeof props.currentRound === 'number'
    && highestIdx.value > currentIdx.value
})

const furthestBeltName = computed(() => belts.value[highestIdx.value]?.name ?? null)

const beltCssVars = computed(() => ({
  '--belt-color': props.currentBelt.color,
  '--belt-glow': props.currentBelt.glow || props.currentBelt.color,
}))

const isCurrentBelt = (belt: Belt) => belt.name === props.currentBelt.name

function handleBeltClick(belt: Belt) {
  if (isCurrentBelt(belt)) return
  emit('skipToBelt', belt)
}

// --- Subtitle "for X speakers" --------------------------------

const subtitle = computed(() => {
  if (!props.knownLang) return ''
  const knownName = getLanguageName(props.knownLang)
  return t('courseSelector.forSpeakers', 'for {lang} Speakers').replace('{lang}', knownName)
})

// --- Lifecycle ------------------------------------------------

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.isOpen) emit('close')
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) emit('close')
}

watch(() => props.isOpen, (open) => {
  if (open) document.body.style.overflow = 'hidden'
  else document.body.style.overflow = ''
})

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="progress-modal">
      <div
        v-if="isOpen"
        class="modal-backdrop"
        :style="beltCssVars"
        @click="handleBackdropClick"
      >
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="progress-modal-lang">
          <button class="modal-close" @click="emit('close')" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>

          <!-- Header: flag + language name + subtitle -->
          <header class="modal-header">
            <LanguageFlag :code="data.targetLanguage" :size="44" class="header-flag" />
            <h2 id="progress-modal-lang" class="header-lang">{{ data.languageName }}</h2>
            <p v-if="subtitle" class="header-subtitle">{{ subtitle }}</p>
          </header>

          <!-- Time tabs -->
          <div class="tab-bar">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              class="tab-btn"
              :class="{ active: activeTab === tab.key }"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- Global minutes -->
          <div class="global-total">
            <span class="total-number">{{ formatNumber(globalMinutes) }}</span>
            <span class="total-label">{{ t('contribution.minutes', 'Minutes') }}</span>
          </div>

          <!-- Community context -->
          <p class="context-message">{{ contextMessage }}</p>

          <!-- Your contribution (only when present) -->
          <div v-if="userMinutes > 0 || userPhrases > 0" class="user-contribution">
            <div class="user-stat">
              <span class="user-value">+{{ formatNumber(userMinutes) }}</span>
              <span class="user-label">{{ t('contribution.yourMins', 'your mins') }}</span>
            </div>
            <div class="user-stat">
              <span class="user-value">+{{ formatNumber(userPhrases) }}</span>
              <span class="user-label">{{ t('contribution.yourPhrases', 'your phrases') }}</span>
            </div>
          </div>

          <!-- Belt strip -->
          <section class="belt-strip">
            <p class="belt-strip-prompt">
              you're working on
              <strong :style="{ color: currentBelt.color }">{{ currentBelt.name }} belt</strong>
            </p>
            <p v-if="showFurthestMarker && furthestBeltName" class="belt-strip-furthest-note">
              you've been as far as <strong>{{ furthestBeltName }} belt</strong>
            </p>

            <div
              class="map-row"
              :style="{ gridTemplateColumns: `repeat(${belts.length}, 1fr)` }"
            >
              <button
                v-for="belt in belts"
                :key="belt.name"
                class="map-chip"
                :class="{
                  'map-chip--current': isCurrentBelt(belt),
                  'is-skipping': isSkipping,
                }"
                :style="{ '--chip-color': belt.color }"
                :disabled="isCurrentBelt(belt) || isSkipping"
                :title="`Jump to ${belt.name} belt`"
                @click="handleBeltClick(belt)"
              >
                <span class="map-chip-dot"></span>
                <span class="map-chip-label">{{ belt.name }}</span>
              </button>

              <div
                v-if="typeof currentRound === 'number'"
                class="map-marker map-marker--now"
                :style="{ left: nowMarkerLeft + '%' }"
              >
                <span class="map-marker-label">now</span>
              </div>
              <div
                v-if="showFurthestMarker"
                class="map-marker map-marker--furthest"
                :style="{ left: furthestMarkerLeft + '%' }"
              >
                <span class="map-marker-label">furthest</span>
              </div>
            </div>

            <p class="belt-strip-hint">tap a belt to jump there</p>
          </section>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(240, 236, 231, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}

.modal {
  position: relative;
  width: 100%;
  max-width: 420px;
  max-height: 90dvh;
  overflow-y: auto;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 24px;
  padding: 1.75rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  box-shadow:
    0 1px 3px rgba(44, 38, 34, 0.14),
    0 8px 24px rgba(44, 38, 34, 0.12),
    0 24px 64px rgba(44, 38, 34, 0.08),
    0 0 60px var(--belt-glow);
}

.modal-close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.04);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #6B6560;
  transition: background 0.2s ease, color 0.2s ease;
}
.modal-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #2C2622;
}
.modal-close svg {
  width: 16px;
  height: 16px;
}

/* Header */
.modal-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.25rem;
  text-align: center;
}

.header-flag {
  line-height: 1;
}

.header-lang {
  margin: 0;
  font-family: var(--font-display, var(--font-body));
  font-size: 1.625rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #2C2622;
  line-height: 1.1;
}

.header-subtitle {
  margin: 0;
  font-size: 0.875rem;
  color: #6B6560;
}

/* Tabs */
.tab-bar {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 12px;
  padding: 3px;
}

.tab-btn {
  flex: 1;
  padding: 7px 8px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #A09A94;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: white;
  color: #2C2622;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.tab-btn:hover:not(.active) {
  color: #6B6560;
}

/* Global total */
.global-total {
  text-align: center;
}

.total-number {
  display: block;
  font-family: 'Space Mono', monospace;
  font-size: 2.75rem;
  font-weight: 700;
  color: #2C2622;
  line-height: 1.05;
}

.total-label {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.context-message {
  margin: 0;
  font-size: 0.8125rem;
  color: #6B6560;
  line-height: 1.5;
  text-align: center;
}

.user-contribution {
  display: flex;
  justify-content: center;
  gap: 2rem;
  padding: 0.75rem;
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
}

.user-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.user-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: #2C2622;
}

.user-label {
  font-size: 0.625rem;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

/* Belt strip */
.belt-strip {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding-top: 0.25rem;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  margin-top: 0.25rem;
}

.belt-strip-prompt {
  margin: 0;
  font-size: 0.9375rem;
  color: #2C2622;
  text-align: center;
}

.belt-strip-prompt strong {
  font-weight: 600;
  text-transform: capitalize;
}

.belt-strip-furthest-note {
  margin: 0;
  font-size: 0.8125rem;
  color: #6B6560;
  text-align: center;
  font-style: italic;
}

.belt-strip-furthest-note strong {
  font-weight: 500;
  text-transform: capitalize;
}

.belt-strip-hint {
  margin: 0;
  font-size: 0.75rem;
  color: #A09A94;
  text-align: center;
}

.map-row {
  position: relative;
  display: grid;
  /* grid-template-columns set inline on the element so we don't need
     to pre-bake a fixed belt count here. */
  gap: 0.25rem;
  padding-top: 22px; /* room for markers */
}

.map-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.5rem 0.125rem;
  background: #fafaf6;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.map-chip:hover:not(:disabled) {
  background: white;
  border-color: var(--chip-color);
  box-shadow: 0 0 10px color-mix(in srgb, var(--chip-color) 30%, transparent);
  transform: translateY(-1px);
}

.map-chip:disabled {
  cursor: default;
}

.map-chip--current {
  background: white;
  border-color: var(--chip-color);
  box-shadow: 0 0 8px color-mix(in srgb, var(--chip-color) 40%, transparent);
}

.map-chip.is-skipping {
  animation: chip-pulse 0.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes chip-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.map-chip-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--chip-color);
  box-shadow: 0 0 4px color-mix(in srgb, var(--chip-color) 50%, transparent);
}

.map-chip-label {
  font-size: 0.625rem;
  text-transform: capitalize;
  color: #6B6560;
  letter-spacing: 0.02em;
}

.map-marker {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}

.map-marker-label {
  font-size: 0.625rem;
  color: #6B6560;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.map-marker--now .map-marker-label::before {
  content: '▼ ';
  color: var(--belt-color);
}

.map-marker--furthest .map-marker-label::before {
  content: '▽ ';
  color: #A09A94;
}

/* Transitions */
.progress-modal-enter-active,
.progress-modal-leave-active {
  transition: opacity 0.25s ease;
}
.progress-modal-enter-active .modal,
.progress-modal-leave-active .modal {
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.progress-modal-enter-from,
.progress-modal-leave-to {
  opacity: 0;
}
.progress-modal-enter-from .modal,
.progress-modal-leave-to .modal {
  transform: scale(0.95) translateY(10px);
}

@media (max-width: 480px) {
  .modal {
    border-radius: 20px;
    padding: 1.5rem 1.25rem 1.25rem;
  }
  .total-number {
    font-size: 2.25rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-modal-enter-active,
  .progress-modal-leave-active,
  .progress-modal-enter-active .modal,
  .progress-modal-leave-active .modal {
    transition: none;
  }
}
</style>
