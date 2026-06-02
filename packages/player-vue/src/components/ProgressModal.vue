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
  // This session's elapsed time, in seconds — the SAME source as the belt
  // pill's m:ss (so the modal's "session" headline == the belt). Passed in
  // rather than recomputed so the two can never drift.
  sessionSeconds?: number
  // Guest learners have no stored lifetime history (the per-day table is
  // logged-in only), so their All-time reads 0 + a "sign in to save" nudge.
  isGuest?: boolean
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
  // Whether the learner is currently in INF PLAY. The ∞ activator stays
  // tappable in this state (re-entry is idempotent) but reads as "active".
  isInfplay?: boolean
  // Offline playback. BELT jumps are disabled offline — a belt jump leaps
  // out of the downloaded plan to content we can't fetch. LEGO/cycle nav stays
  // enabled (it steps within the cached plan); only this modal's belt jumps go.
  isOffline?: boolean
}>()

const emit = defineEmits<{
  close: []
  skipToBelt: [belt: Belt]
  // Deliberate, explicit entry into INF PLAY from the ∞ activator. The only
  // intentional entry point — wired to LearningPlayer's enterInfPlay().
  enterInfPlay: []
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
const userMinutes = computed(() => props.data.user[activeTab.value].minutes)

// --- Headline stats: Session (= belt m:ss) | All-time (your lifetime) ----
// Session mirrors the belt pill exactly: m:ss from the shared sessionSeconds.
const sessionTimeFormatted = computed(() => {
  const s = Math.max(0, Math.floor(props.sessionSeconds ?? 0))
  const m = Math.floor(s / 60)
  const secs = s % 60
  return `${m}:${secs.toString().padStart(2, '0')}`
})

// All-time = your lifetime minutes on this course (per-day table, summed).
// Bigger scale than a session, so format as h/m. Guests have none → 0m.
const allTimeMinutes = computed(() => props.data.user.allTime.minutes)
const allTimeFormatted = computed(() => {
  const mins = allTimeMinutes.value
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
})

// The selected tab as a human window for the community-total line.
const windowLabel = computed(() => {
  switch (activeTab.value) {
    case 'today': return t('contribution.windowToday', 'today')
    case 'days7': return t('contribution.window7', 'in the last 7 days')
    case 'days30': return t('contribution.window30', 'in the last 30 days')
    case 'allTime': return t('contribution.windowAll', 'all-time')
  }
})

// --- Mission (endangered) languages ----------------------------------
// The emotive "keeping {language} alive" line is for SSi's MISSION
// languages only — not mainstream ones (Tom: mainstream langs get the
// community totals, but not the endangered-revival framing).
// TEMPORARY hardcoded set — Phase ② replaces this with an SSi-controlled
// DB flag per target language so it's editable without a deploy.
const MISSION_LANGUAGES = new Set([
  'cym', 'cym_n', 'cym_s', // Welsh
  'gle', 'gla', 'gd',      // Irish, Scottish Gaelic
  'bre', 'cor', 'gv',      // Breton, Cornish, Manx
  'eus', 'cat',            // Basque, Catalan
])
const isMissionLanguage = computed(() => MISSION_LANGUAGES.has(props.data.targetLanguage))

// Personal slice line — shown ONLY when you have minutes in the selected
// window. The community total + window already sit in the label above, so
// this is purely "your share of it": no restating, and no "spoke" (the
// figure is in-app minutes, not speaking time).
const contextMessage = computed(() => {
  const userMins = userMinutes.value
  if (userMins <= 0) return ''
  return t('contribution.youContributed', 'You contributed {mins} of them.')
    .replace('{mins}', String(userMins))
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

function handleInfPlayClick() {
  if (props.isSkipping) return
  emit('close')
  emit('enterInfPlay')
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

          <!-- Headline: Session | All-time — YOUR numbers. Session is the
               same m:ss as the belt pill; All-time is your lifetime on this
               course (0 + a sign-in nudge for guests, who have no store). -->
          <div class="headline-stats">
            <div class="headline-stat">
              <span class="headline-number">{{ sessionTimeFormatted }}</span>
              <span class="headline-label">{{ t('contribution.session', 'session') }}</span>
            </div>
            <div class="headline-divider" aria-hidden="true"></div>
            <div class="headline-stat">
              <span class="headline-number">{{ allTimeFormatted }}</span>
              <span class="headline-label">{{ t('contribution.allTimeShort', 'all-time') }}</span>
              <span v-if="isGuest" class="headline-hint">{{ t('contribution.signInToSave', 'sign in to save') }}</span>
            </div>
          </div>

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

          <!-- Community total for the selected window — SSi-wide, "what's
               alive in the community right now". Shown for every language. -->
          <div class="global-total">
            <span class="total-number">{{ formatNumber(globalMinutes) }}</span>
            <span class="total-label">
              {{ t('contribution.minutesOfLang', 'minutes of {language}').replace('{language}', data.languageName) }}
              {{ windowLabel }} · {{ t('contribution.theCommunity', 'the SSi community') }}
            </span>
          </div>

          <!-- Your slice of the community total — only when you have minutes -->
          <p v-if="contextMessage" class="context-message">{{ contextMessage }}</p>

          <!-- Mission revival line — SIGNED-IN learners on a mission language.
               Guests don't count toward the totals, so they get the sign-in
               invitation below, not the present-tense "you're helping". -->
          <p v-if="isMissionLanguage && !isGuest" class="mission-line">
            {{ t('contribution.missionLine', "You're helping keep {language} alive.").replace('{language}', data.languageName) }}
          </p>

          <!-- Guests don't contribute to the global totals — a gentle sign-in
               invitation (sign-in leverage: count toward the total + the
               mission). Plain, not salesy. -->
          <p v-if="isGuest" class="signin-nudge">
            {{ isMissionLanguage
              ? t('contribution.signInContributeMission', 'Sign in to add your minutes to the global total — and help keep {language} alive.').replace('{language}', data.languageName)
              : t('contribution.signInContribute', 'Sign in to add your minutes to the global total.') }}
          </p>

          <!-- Belt strip -->
          <section class="belt-strip">
            <p class="belt-strip-prompt">
              you're working on
              <strong :style="{ color: currentBelt.color }">{{ currentBelt.name }} belt</strong>
            </p>
            <p v-if="showFurthestMarker && furthestBeltName" class="belt-strip-furthest-note">
              you've been as far as <strong>{{ furthestBeltName }} belt</strong>
            </p>

            <div class="map-row-wrap">
              <div
                class="map-row"
                :style="{ gridTemplateColumns: `repeat(${belts.length}, 1fr)` }"
              >
                <!-- Colour-only belt dots. The belt NAME lives in title/aria-label
                     (semantically present, visually gone) so the row reads as a
                     ladder of colours; the freed vertical space is the ∞ activator's.
                     Each dot carries a thin black ring so the WHITE belt reads on
                     the white modal and every dot gets a crisp edge. -->
                <button
                  v-for="belt in belts"
                  :key="belt.name"
                  class="map-chip"
                  :class="{
                    'map-chip--current': isCurrentBelt(belt),
                    'is-skipping': isSkipping,
                    'is-offline': isOffline,
                  }"
                  :style="{ '--chip-color': belt.color }"
                  :disabled="isCurrentBelt(belt) || isSkipping || isOffline"
                  :title="isOffline ? 'Belt jumps need a connection — offline you can still step LEGO by LEGO' : `Jump to ${belt.name} belt`"
                  :aria-label="isOffline ? `${belt.name} belt — belt jumps unavailable offline` : `Jump to ${belt.name} belt`"
                  @click="handleBeltClick(belt)"
                >
                  <span class="map-chip-dot"></span>
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

              <!-- ∞ INF-PLAY activator. A MODE activator, NOT a belt: glowing /
                   throbbing ∞, visually distinct from the colour dots. Tapping it
                   ENTERS infinite play — the only deliberate entry point. -->
              <button
                class="infplay-activator"
                :class="{ 'is-skipping': isSkipping, 'is-active': isInfplay }"
                :disabled="isSkipping"
                title="Activate infinite play — random review of everything you have learned"
                aria-label="Activate infinite play: random review of everything you have learned"
                @click="handleInfPlayClick"
              >
                <svg class="infplay-activator-glyph" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
                     stroke-linejoin="round" aria-hidden="true" focusable="false">
                  <path d="M5.5 12 C5.5 9 7 7 9.5 7 C12 7 13.5 9 14.5 12 C15.5 15 17 17 18.5 17 C20 17 21.5 15 21.5 12 C21.5 9 20 7 18.5 7 C17 7 15.5 9 14.5 12 C13.5 15 12 17 9.5 17 C7 17 5.5 15 5.5 12 Z"/>
                </svg>
              </button>
            </div>

            <p class="belt-strip-hint">{{ isOffline
              ? 'offline — belt jumps need a connection; step LEGO by LEGO with ‹‹ ››'
              : 'tap a belt to jump there, or ∞ for infinite play' }}</p>
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

/* Headline stats — Session | All-time, the two big YOUR numbers */
.headline-stats {
  display: flex;
  align-items: stretch;
  justify-content: center;
  gap: 0.5rem;
}

.headline-stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.25rem 0.5rem;
  text-align: center;
}

.headline-number {
  font-family: 'Space Mono', monospace;
  font-size: 2.25rem;
  font-weight: 700;
  color: #2C2622;
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.headline-label {
  font-size: 0.6875rem;
  color: #A09A94;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.headline-hint {
  margin-top: 0.1rem;
  font-size: 0.625rem;
  font-weight: 600;
  color: #c23a3a;
}

.headline-divider {
  width: 1px;
  align-self: center;
  height: 2.6rem;
  background: rgba(0, 0, 0, 0.08);
}

/* Mission (endangered) languages — emotive revival line, SSi red */
.mission-line {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: #c23a3a;
  text-align: center;
  line-height: 1.4;
}

/* Guest sign-in invitation — subtle, informative, not salesy */
.signin-nudge {
  margin: 0;
  font-size: 0.8125rem;
  color: #6B6560;
  text-align: center;
  line-height: 1.45;
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

/* Colour-only belt row + ∞ activator laid out side by side. Explicit
   dimensions: the belt row flexes to fill, the activator is a fixed 48px
   square pinned to the end. No flex/appearance hacks. */
.map-row-wrap {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.map-row {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
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
  justify-content: center;
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

/* Offline: belt jumps leap out of the downloaded plan, so they're disabled.
   Dim them so they READ as unavailable (the bare :disabled only changes the
   cursor — deliberately, so the always-disabled current belt stays
   highlighted). Opacity is theme-agnostic, so one rule covers mist too. */
.map-chip.is-offline {
  opacity: 0.4;
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

/* Colour-only dot with a thin black ring. The ring gives the WHITE belt an
   edge against the white modal (never a fg indicator the same colour as its
   bg) and crisps every other dot. The label is gone (now in title/aria). */
.map-chip-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--chip-color);
  border: 1px solid rgba(0, 0, 0, 0.55);
  box-shadow: 0 0 4px color-mix(in srgb, var(--chip-color) 50%, transparent);
}

/* ∞ INF-PLAY activator — a mode activator, deliberately NOT a belt dot.
   Fixed 48px square, glowing/throbbing ∞, distinct purple tint so it never
   reads as "another belt". Reuses the central-pill ∞ glyph + throb feel. */
.infplay-activator {
  flex: 0 0 auto;
  align-self: flex-end;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 12px;
  border: 1px solid rgba(194, 58, 58, 0.5);
  background: linear-gradient(135deg, #fbeaea 0%, #f5d6d6 100%);
  color: var(--ssi-red, #c23a3a);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  /* SSi red, not purple (purple is a BELT colour — would read as "another
     belt" rather than "past the belts"). Subtle throb, not a pulse. */
  animation: infplay-activator-throb 2.4s ease-in-out infinite;
}

.infplay-activator-glyph {
  width: 26px;
  height: 26px;
}

.infplay-activator:hover:not(:disabled) {
  background: linear-gradient(135deg, #f5d6d6 0%, #eebcbc 100%);
}

.infplay-activator:disabled {
  cursor: default;
}

.infplay-activator.is-active {
  border-color: rgba(194, 58, 58, 0.8);
  color: #9e2a2a;
}

.infplay-activator.is-skipping {
  animation: chip-pulse 0.6s ease-in-out infinite;
  pointer-events: none;
}

@keyframes infplay-activator-throb {
  0%, 100% {
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1),
                0 0 3px rgba(194, 58, 58, 0.2);
    transform: scale(1);
  }
  50% {
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.12),
                0 0 9px rgba(194, 58, 58, 0.4);
    transform: scale(1.025);
  }
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

/* Mist theme counterparts. The modal teleports to <body>, so its scoped
   rules sit under :root[data-theme="mist"] (the attribute lives on <html>).
   The modal surface stays light in every theme, so these keep the dot ring
   and ∞ activator crisp + on-brand under mist rather than letting the
   default-theme rules silently win (mist overrides every surface). */
:root[data-theme="mist"] .map-chip-dot {
  border-color: rgba(0, 0, 0, 0.55);
}

:root[data-theme="mist"] .infplay-activator {
  border-color: rgba(194, 58, 58, 0.55);
  background: linear-gradient(135deg, #fbe9e9 0%, #f4d4d4 100%);
  color: var(--ssi-red, #c23a3a);
}

:root[data-theme="mist"] .infplay-activator:hover:not(:disabled) {
  background: linear-gradient(135deg, #f4d4d4 0%, #ecb9b9 100%);
}

:root[data-theme="mist"] .infplay-activator.is-active {
  border-color: rgba(194, 58, 58, 0.85);
  color: #9e2a2a;
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
  .headline-number {
    font-size: 1.875rem;
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
