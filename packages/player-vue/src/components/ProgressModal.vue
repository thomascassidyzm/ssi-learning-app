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
import { t, forSpeakersLabel } from '@/composables/useI18n'
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
  // Offline playback. Belt jumps to a belt whose content isn't on the device
  // are disabled — a jump there would leap out of the downloaded plan to
  // content we can't fetch. LEGO/cycle nav stays enabled (it steps within
  // the cached plan); only out-of-reach belt jumps go.
  isOffline?: boolean
  // Names of belts whose content is not on the device yet. EVERY belt stays
  // tappable (Tom, 2026-09-04: navigation is never refused) — this set only
  // marks which ones the learner will have to wait a moment for.
  beltsAwaitingDownload?: Set<string>
  /** Belt name → the waiting line, from the same function the belt-skip action
   *  uses, so a pill and a tap always say the same thing. */
  beltWaitingReasons?: Map<string, string>
  // Names of belts this learner cannot reach WITHOUT PAYING. The padlock means
  // entitlement and nothing else (Tom, 2026-09-04: "The only reason these would
  // be locked would be if there was a [plain] entitlement issue... These should
  // be just greyed out - never locked"). Money is the answer here and time
  // never will be — which is exactly what separates it from the set above.
  // Computed in LearningPlayer from the SAME canAccessSeed call that gates the
  // jump, so the glyph and the behaviour cannot drift.
  paywalledBeltNames?: Set<string>
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

// (Your slice is now shown inline as the YOUR / community pair in the headline
// total — see the .global-total block — so the old prose line is retired.)

// --- Belt strip -----------------------------------------------

const belts = computed<Belt[]>(() => props.availableBelts ?? (BELTS as Belt[]))

const currentIdx = computed(() => props.currentBeltIndex ?? 0)
const highestIdx = computed(() => props.highestBeltIndex ?? 0)

// Belt-dot centre as a % of the ladder width. The grid is `belts.length`
// equal (1fr) belt columns PLUS a terminal ∞ column at the SAME 1fr width
// (so the ∞ chip matches the belt chips — distinct by colour, not size), giving
// a total fractional width of belts.length + 1 — divide by that (not just the
// belt count) or the now/furthest markers drift right of their dots.
const INFPLAY_COL_FR = 1
const chipCenterPercent = (idx: number) => {
  const total = (belts.value.length || 1) + INFPLAY_COL_FR
  return ((idx + 0.5) / total) * 100
}

const nowMarkerLeft = computed(() => chipCenterPercent(currentIdx.value))
const furthestMarkerLeft = computed(() => chipCenterPercent(highestIdx.value))

const showFurthestMarker = computed(() => {
  return typeof props.highestRound === 'number'
    && typeof props.currentRound === 'number'
    && highestIdx.value > currentIdx.value
})

const furthestBeltName = computed(() => {
  const belt = belts.value[highestIdx.value]
  return belt ? beltLabel(belt) : null
})

const beltCssVars = computed(() => ({
  '--belt-color': props.currentBelt.color,
  '--belt-glow': props.currentBelt.glow || props.currentBelt.color,
}))

const isCurrentBelt = (belt: Belt) => belt.name === props.currentBelt.name

// A belt named in the learner's own interface language: "Green Belt", "綠帶".
// Both halves already ship in all 24 locales (belt.<colour> + belt.label), so
// this is reuse, not new translation work — and it is the ONE place the modal
// turns a belt into words, so nothing here can go back to naming them in
// English. Unknown names fall through to their raw value rather than a key.
const beltLabel = (belt: { name: string }): string =>
  t('belt.label', '{color} Belt').replace('{color}', t(`belt.${belt.name}`, belt.name))

// Sentences that wrap a belt name in belt-coloured emphasis. Word order moves
// between languages, so the translated sentence is SPLIT on its {belt} slot and
// the two halves are rendered either side of the <strong> — rather than
// hardcoding "prefix + name + suffix", which is what put these four sentences
// in the bare-English baseline in the first place.
const splitAround = (sentence: string, token: string): [string, string] => {
  const at = sentence.indexOf(token)
  if (at === -1) return [sentence + ' ', '']
  return [sentence.slice(0, at), sentence.slice(at + token.length)]
}
const workingOnParts = computed(() =>
  splitAround(t('progress.workingOnBelt', "you're working on {belt}"), '{belt}'))
const infinitePlayParts = computed(() =>
  splitAround(t('progress.youreInMode', "you're in {mode}"), '{mode}'))
const furthestParts = computed(() =>
  splitAround(t('progress.beenAsFarAs', "you've been as far as {belt}"), '{belt}'))

// A belt whose content is still on its way down. NOT a lock — the chip stays
// tappable and the tap lands as soon as the content arrives (Tom, 2026-09-04:
// "the only issue is if the content has donwloaded").
const isBeltAwaitingDownload = (belt: Belt) =>
  !!props.isOffline && !!props.beltsAwaitingDownload?.has(belt.name)

// A belt behind the paywall. Drawn iff the learner would have to PAY to get
// there — never because of anything the device is still fetching. Takes
// precedence over the waiting state: if a belt is both unpaid and not yet
// downloaded, the padlock is the honest glyph, because the download will
// resolve itself and the payment will not.
const isBeltPaywalled = (belt: Belt) =>
  !!props.paywalledBeltNames?.has(belt.name)

// What a padlocked chip says to a screen reader and on hover. It must read as
// an offer, not a refusal — the tap opens the subscription card.
const beltPaywallLabel = (belt: Belt) =>
  t('progress.beltNeedsSubscription', '{belt} is part of the full course — tap to see the options')
    .replace('{belt}', beltLabel(belt))

// The waiting line for this belt, in the words the action would use.
const beltWaitingReason = (belt: Belt) =>
  props.beltWaitingReasons?.get(belt.name)
  ?? t('progress.beltStillDownloading', "{belt} is still downloading — it'll open as soon as it's here")
    .replace('{belt}', beltLabel(belt))

// Only mention downloads when something is actually still coming — most
// offline sessions have every belt up to position downloaded.
const hasUndownloadedBelt = computed(() =>
  !!props.isOffline && belts.value.some((b) => isBeltAwaitingDownload(b)))

// Highest belt that's ready offline — the ladder is downloaded contiguously
// from the start (behind-position is always in the bundle), so "belts up to
// X ready" is the honest, unambiguous summary. Walk until the first belt
// still coming down; White (the course start) is always present.
const offlineReadyUpToBeltName = computed<string | null>(() => {
  if (!hasUndownloadedBelt.value) return null
  let last: string | null = null
  for (const b of belts.value) {
    if (isBeltAwaitingDownload(b)) break
    last = beltLabel(b)
  }
  return last
})

// Chip title/aria — the only words a screen reader gets for a belt dot.
const jumpToBeltLabel = (belt: Belt): string =>
  t('progress.jumpToBeltName', 'Jump to {belt}').replace('{belt}', beltLabel(belt))

// One place decides what a chip says, in the same precedence as the glyph:
// money first (it will not resolve itself), then time, then the plain jump.
const chipLabel = (belt: Belt): string =>
  isBeltPaywalled(belt) ? beltPaywallLabel(belt)
  : isBeltAwaitingDownload(belt) ? beltWaitingReason(belt)
  : jumpToBeltLabel(belt)

// The one line under the ladder. Built here rather than in the template so the
// three branches are t() calls a scanner can see, not literals inside a
// mustache expression (which is how they slipped past the bare-English gate).
const beltStripHint = computed(() => {
  if (!hasUndownloadedBelt.value) {
    return t('progress.tapBeltHint', 'tap a belt to jump there, or ∞ at the end for infinite play')
  }
  if (offlineReadyUpToBeltName.value) {
    return t('progress.offlineBeltsReadyUpTo', 'belts up to {belt} are on this device; the rest open as they download')
      .replace('{belt}', offlineReadyUpToBeltName.value)
  }
  return t('progress.beltsStillDownloading', "tap any belt — the ones still downloading open as soon as they're here")
})

// NAVIGATION IS NEVER REFUSED (Tom, 2026-09-04). Every belt emits, including
// the one the learner is already on — that is a restart, which the player
// handles as direction 'restart' — and including belts still downloading,
// which the player holds in a self-resolving waiting state. The one thing this
// must never do is return silently: a tap that goes nowhere and says nothing
// is the exact bug that had Tom tapping Orange eight times.
function handleBeltClick(belt: Belt) {
  emit('skipToBelt', belt)
}

function handleInfPlayClick() {
  if (props.isSkipping) return
  emit('close')
  emit('enterInfPlay')
}

// --- Subtitle "for X speakers" --------------------------------

const subtitle = computed(() => {
  return forSpeakersLabel(props.knownLang)
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
          <button class="modal-close" @click="emit('close')" :aria-label="t('sector.close')">
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

          <!-- Community total for the selected window. When you've contributed,
               show it as a pair — YOUR minutes (belt-accented) / the community —
               so your own figure is instantly findable, not buried in prose.
               Guests / zero-minute windows fall back to the community number. -->
          <div class="global-total">
            <span class="total-number">
              <template v-if="userMinutes > 0"><span class="you-share">{{ formatNumber(userMinutes) }}</span><span class="slash"> / </span>{{ formatNumber(globalMinutes) }}</template>
              <template v-else>{{ formatNumber(globalMinutes) }}</template>
            </span>
            <span class="total-label">
              <template v-if="userMinutes > 0">
                {{ t('contribution.youSlashCommunity', 'you / the SSi community') }} · {{ windowLabel }}
              </template>
              <template v-else>
                {{ t('contribution.minutesOfLang', 'minutes of {language}').replace('{language}', data.languageName) }}
                {{ windowLabel }} · {{ t('contribution.theCommunity', 'the SSi community') }}
              </template>
            </span>
          </div>

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
            <!-- Belt-section header: the "you're working on X belt" prompt.
                 The ∞ infinite-play option is the TERMINAL entry IN the belt
                 ladder below (after the last belt that HAS content), so every
                 course — however far it's built — can reach INF PLAY by skip.
                 Tom 2026-06-07. -->
            <div class="belt-strip-head">
              <p class="belt-strip-prompt">
                <template v-if="isInfplay">
                  {{ infinitePlayParts[0] }}<strong :style="{ color: 'var(--ssi-red, #c23a3a)' }">{{ t('progress.infinitePlay', 'infinite play') }}</strong>{{ infinitePlayParts[1] }}
                </template>
                <template v-else>
                  {{ workingOnParts[0] }}<strong :style="{ color: currentBelt.color }">{{ beltLabel(currentBelt) }}</strong>{{ workingOnParts[1] }}
                </template>
              </p>
            </div>
            <!-- The offline infinite-play explanation, in Tom's words. The
                 one-shot dialog says this when offline play engages; this is
                 where a learner who dismissed it (or opened the modal later)
                 finds it again. Same sentence, same key. -->
            <p v-if="isInfplay && isOffline" class="belt-strip-offline-note">
              {{ t('player.offlinePracticeBody', 'We can\'t reach new items right now, so here\'s a chance to practise what you\'ve already covered — new items will come through as soon as we can reach them.') }}
            </p>
            <p v-if="showFurthestMarker && furthestBeltName" class="belt-strip-furthest-note">
              {{ furthestParts[0] }}<strong>{{ furthestBeltName }}</strong>{{ furthestParts[1] }}
            </p>

            <div class="map-row-wrap">
              <div
                class="map-row"
                :style="{ gridTemplateColumns: `repeat(${belts.length}, minmax(32px, 1fr)) minmax(32px, 1fr)` }"
              >
                <!-- Colour-only belt dots. The belt NAME lives in title/aria-label
                     (semantically present, visually gone) so the row reads as a
                     ladder of colours; the freed vertical space is the ∞ chip's.
                     Each dot carries a thin black ring so the WHITE belt reads on
                     the white modal and every dot gets a crisp edge. -->
                <button
                  v-for="belt in belts"
                  :key="belt.name"
                  class="map-chip"
                  :class="{
                    'map-chip--current': isCurrentBelt(belt),
                    'is-skipping': isSkipping,
                    'is-offline': isBeltAwaitingDownload(belt) && !isBeltPaywalled(belt),
                    'is-paywalled': isBeltPaywalled(belt),
                  }"
                  :style="{ '--chip-color': belt.color }"
                  :disabled="isSkipping"
                  :title="chipLabel(belt)"
                  :aria-label="chipLabel(belt)"
                  @click="handleBeltClick(belt)"
                >
                  <span class="map-chip-dot"></span>
                  <!-- PADLOCK = ENTITLEMENT, and nothing else. It appears iff
                       the learner would have to pay to go there, and the tap
                       opens the same subscription card that meets them when
                       they play into seed 20. It is never worn by a belt that
                       is merely still downloading. -->
                  <svg
                    v-if="isBeltPaywalled(belt)"
                    class="map-chip-glyph map-chip-lock"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true" focusable="false"
                  >
                    <rect x="4" y="10.5" width="16" height="10.5" rx="2"/>
                    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
                  </svg>
                  <!-- Still-coming affordance. Dimming alone read as "murky"
                       on-device (Tom 2026-07-09), so the state gets a glyph —
                       but a PADLOCK is the wrong word now that the chip is
                       tappable (Tom 2026-09-04). A download arrow says "on its
                       way", which is the only thing that can stand between a
                       tap and a belt. -->
                  <svg
                    v-else-if="isBeltAwaitingDownload(belt)"
                    class="map-chip-glyph map-chip-dl"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true" focusable="false"
                  >
                    <path d="M12 3v12"/>
                    <path d="m7 10 5 5 5-5"/>
                    <path d="M4 20h16"/>
                  </svg>
                </button>

                <!-- ∞ INF-PLAY — the TERMINAL ladder entry, after the last belt
                     that has content. Selecting it lands at the live content end
                     (mainLoopBoundary) and enters INF PLAY, identical to reaching
                     it by playing forward. NOT a belt: distinct SSi-red glyph chip
                     so it reads as "past the belts". Stays tappable OFFLINE (INF
                     PLAY recycles cached phrases), unlike belt jumps. -->
                <button
                  class="map-chip map-chip--infplay"
                  :class="{ 'map-chip--current': isInfplay, 'is-skipping': isSkipping }"
                  :disabled="isSkipping"
                  :title="t('progress.infinitePlayRandomReview')"
                  :aria-label="t('progress.infinitePlayRandomReview2')"
                  @click="handleInfPlayClick"
                >
                  <svg class="map-chip-inf-glyph" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" stroke-width="2.4" stroke-linecap="round"
                       stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <path d="M5.5 12 C5.5 9 7 7 9.5 7 C12 7 13.5 9 14.5 12 C15.5 15 17 17 18.5 17 C20 17 21.5 15 21.5 12 C21.5 9 20 7 18.5 7 C17 7 15.5 9 14.5 12 C13.5 15 12 17 9.5 17 C7 17 5.5 15 5.5 12 Z"/>
                  </svg>
                </button>

                <div
                  v-if="typeof currentRound === 'number' && !isInfplay"
                  class="map-marker map-marker--now"
                  :style="{ left: nowMarkerLeft + '%' }"
                >
                  <span class="map-marker-label">{{ t('resting.now') }}</span>
                </div>
                <div
                  v-if="showFurthestMarker"
                  class="map-marker map-marker--furthest"
                  :style="{ left: furthestMarkerLeft + '%' }"
                >
                  <span class="map-marker-label">{{ t('resting.furthest') }}</span>
                </div>
              </div>
            </div>

            <p class="belt-strip-hint">{{ beltStripHint }}</p>
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

/* Your share — belt-accented so your own figure is the thing the eye lands on. */
.you-share {
  color: var(--belt-color);
}
.slash {
  color: #C9C3BC;
  font-weight: 400;
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

/* Belt-section header — prompt centred. The ∞ now lives as the terminal
   chip in the ladder, so the header no longer reserves right-edge space. */
.belt-strip-head {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
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

.belt-strip-offline-note {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: #6B6560;
  text-align: center;
  max-width: 34ch;
  margin-inline: auto;
}

.belt-strip-hint {
  margin: 0;
  font-size: 0.75rem;
  color: #A09A94;
  text-align: center;
}

/* Colour-only belt ladder + the terminal ∞ chip — ONE grid row now (the ∞
   is the last column). The wrapper is a full-width block that scrolls the row
   horizontally when it can't fit at a usable chip size (see below). */
.map-row-wrap {
  display: block;
  /* On very narrow phones the 9-chip ladder (8 belts + ∞) can't fit at a
     usable touch-target size, so let it scroll horizontally rather than
     cram the chips. The grid floors (minmax on .map-row) keep each chip
     tappable; this just reveals the overflow. -webkit-overflow-scrolling
     gives iOS Safari momentum. */
  overflow-x: auto;
  overflow-y: visible;
  -webkit-overflow-scrolling: touch;
  /* Markers sit 22px above the row (.map-row padding-top) inside .map-row;
     a hidden scrollbar gutter would clip them, so we keep the native bar
     thin and let the row's own padding hold the marker space. */
  scrollbar-width: thin;
}

.map-row {
  position: relative;
  display: grid;
  /* grid-template-columns set inline on the element: N belt minmax(32px,1fr)
     cols + a terminal minmax(27px,0.85fr) ∞ col — no pre-baked belt count, and
     every chip keeps a ~32px (belt) / ~27px (∞) touch-target floor. When the
     floors sum wider than the wrap (narrow phones, up to 9 chips), the row
     overflows and .map-row-wrap scrolls it horizontally instead of cramming.
     The floors hold the 1 : 0.85 belt : ∞ ratio, so the %-based marker math
     (chipCenterPercent) is valid in both the grown and floored regimes; markers
     live INSIDE .map-row, so they scroll with the chips.

     width:max-content + min-width:100% is what keeps the now/furthest markers
     aligned. The markers are position:absolute children of .map-row, so their
     left:% resolves against .map-row's width. Without an explicit width, an
     overflowing grid inside overflow-x:auto resolves that % against the visible
     SCROLLPORT (the wrap), not the full content row — so the markers would drift
     ~23px off their dots at 320px. max-content makes .map-row size to its true
     content width (the % then matches the dots' layout); min-width:100% lets the
     1fr cols still grow to fill the wrap when everything fits (no needless
     scroll on wider phones). Verified: marker drift ≤0.5px at 320/375px,
     ≤1.5px at 390px. */
  width: max-content;
  min-width: 100%;
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

/* Still downloading: THREE redundant channels, none of them a padlock —
   dashed outline, no fill, and the dim — plus the download-arrow glyph in the
   corner. Dim alone read as "murky as hell what was ready to play" on-device
   (Tom 2026-07-09), which is what put a padlock here in the first place; the
   padlock is now reserved for entitlement, so the state has to earn its
   legibility another way. The chip stays enabled: a tap lands as soon as the
   content arrives. */
.map-chip.is-offline {
  opacity: 0.5;
  background: transparent;
  border-style: dashed;
  border-color: rgba(0, 0, 0, 0.28);
}
.map-chip.is-offline .map-chip-dot {
  filter: grayscale(0.85);
  box-shadow: none;
}
.map-chip-glyph {
  position: absolute;
  width: 11px;
  height: 11px;
  top: 3px;
  right: 3px;
  color: rgba(0, 0, 0, 0.75);
}

/* Paywalled: the chip is NOT dimmed into the murk — it's a live offer, and it
   stays fully tappable. The padlock alone carries the meaning. */
.map-chip.is-paywalled .map-chip-dot {
  filter: grayscale(0.6);
}
/* Anchor for the lock overlay — no visual change to available chips. */
.map-chip {
  position: relative;
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

/* ∞ INF-PLAY — the TERMINAL ladder chip, deliberately NOT a belt dot.
   Same chip footprint as a belt so it sits flush at the end of the ladder,
   but an SSi-red ∞ glyph + red tint + subtle throb so it reads as "past the
   belts" (red, not purple — purple is a BELT colour). Reuses the central-pill
   ∞ glyph + throb feel. Stays enabled offline (INF PLAY recycles cache). */
.map-chip--infplay {
  border-color: rgba(194, 58, 58, 0.5);
  background: linear-gradient(135deg, #fbeaea 0%, #f5d6d6 100%);
  color: var(--ssi-red, #c23a3a);
  animation: infplay-chip-throb 2.4s ease-in-out infinite;
}

.map-chip-inf-glyph {
  width: 22px;
  height: 22px;
}

.map-chip--infplay:hover:not(:disabled) {
  background: linear-gradient(135deg, #f5d6d6 0%, #eebcbc 100%);
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 10px color-mix(in srgb, var(--ssi-red, #c23a3a) 30%, transparent);
  transform: translateY(-1px);
}

.map-chip--infplay.map-chip--current {
  border-color: rgba(194, 58, 58, 0.85);
  color: #9e2a2a;
  box-shadow: 0 0 8px color-mix(in srgb, var(--ssi-red, #c23a3a) 40%, transparent);
}

@keyframes infplay-chip-throb {
  0%, 100% {
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1),
                0 0 3px rgba(194, 58, 58, 0.2);
  }
  50% {
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.12),
                0 0 9px rgba(194, 58, 58, 0.4);
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

:root[data-theme="mist"] .map-chip--infplay {
  border-color: rgba(194, 58, 58, 0.55);
  background: linear-gradient(135deg, #fbe9e9 0%, #f4d4d4 100%);
  color: var(--ssi-red, #c23a3a);
}

:root[data-theme="mist"] .map-chip--infplay:hover:not(:disabled) {
  background: linear-gradient(135deg, #f4d4d4 0%, #ecb9b9 100%);
}

:root[data-theme="mist"] .map-chip--infplay.map-chip--current {
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
  /* Tighten the inter-chip gap on phones so the 9-chip ladder needs less
     horizontal room before it has to scroll (keeps the chips' 32px floor). */
  .map-row {
    gap: 0.2rem;
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
