<script setup>
import { ref, provide, onMounted, computed, inject, watch, defineAsyncComponent } from 'vue'
import { useRouter, useRoute } from 'vue-router'

// Global backdrop
import SumiEBackground from '@/components/SumiEBackground.vue'

// Screen components
import LearningPlayer from '@/components/LearningPlayer.vue'
import BottomNav from '@/components/BottomNav.vue'
import PlayerRestingState from '@/components/PlayerRestingState.vue'
// CourseSelector stays static — it's the first modal most users
// open (course pick on first visit), so paying its weight up front
// is fine and removes a launch-path roundtrip.
import CourseSelector from '@/components/CourseSelector.vue'

// Modals async — pre-warmed in onMounted (see below) so chunks are
// usually already loaded by the time the user clicks. Combined with
// the min-height on .settings-panel, the panel-collapse issue from
// the previous attempt can't recur even if a user clicks before
// pre-warm completes.
const SettingsScreen = defineAsyncComponent(() => import('@/components/SettingsScreen.vue'))
const CourseExplorer = defineAsyncComponent(() => import('@/components/CourseExplorer.vue'))
const BrowseScreen = defineAsyncComponent(() => import('@/components/BrowseScreen.vue'))
const SignInModal = defineAsyncComponent(() => import('@/components/auth/SignInModal.vue'))

// Global auth modal state (shared singleton)
import { useAuthModal } from '@/composables/useAuthModal'
import { getSharedBeltProgress, getSeedFromLegoId } from '@/composables/useBeltProgress'
import { useSharedUserEntitlements } from '@/composables/useUserEntitlements'
import { useCheckout } from '@/composables/useCheckout'

// Inject from App
const supabaseClient = inject('supabase')
const progressStore = inject('progressStore')
const sessionStore = inject('sessionStore')
const courseDataProvider = inject('courseDataProvider')
const auth = inject('auth')
const config = inject('config')
const themeContext = inject('theme', null)
const router = useRouter()
const route = useRoute()

// When launched "Play as class" from the tutor (teach) shell, the player runs
// INSIDE TeachContainer, which keeps its TopNav fixed at the top. The player's
// root (.learning-player-root) and all its pop-ups are `position: fixed; inset: 0`,
// so they anchor to the viewport — sliding their top controls UNDER the teach nav.
// On this route we make .player-container a containing block (via transform) and
// size it to the area below the nav, so every fixed descendant anchors below the
// nav instead of the viewport top. Standalone player (route '/') is untouched.
// True when the player runs inside a shell that already provides its own white
// (Mist) top nav: the tutor "Play as class" (teach-play) AND the schools
// "Play as class" (schools-play). In both cases the player's own legacy dark
// `.class-bar` ("Back to classes") is a redundant second top bar in the wrong
// theme — pass embedded so it's hidden and the shell's white nav is the single
// source of navigation.
const isTeachEmbedded = computed(
  () => route.name === 'teach-play' || route.name === 'schools-play',
)

// Global auth modal (shared with BottomNav and other components)
const {
  isOpen: isAuthOpen,
  open: openAuth,
  close: closeAuth,
} = useAuthModal()
// Aliases for backwards compatibility within this file
const closeAuthModals = closeAuth

// Navigation state — 2 screens + overlays
// Screens: 'progress' | 'player'
// Overlays: showLibrary, showSettings, showExplorer
const currentScreen = ref('player')
const selectedCourse = ref(null)
const isLearning = ref(false)

// Overlay state (not screens)
const showSettings = ref(false)
const showLibrary = ref(false)
const showExplorer = ref(false)
const showCourseSelector = ref(false)

// Player state - shared with nav bar for play/stop button
const isPlaying = ref(false)
const learningPlayerRef = ref(null)

// Listening mode overlay state (overlay is inside LearningPlayer, but we track it for BottomNav)
const isListeningMode = ref(false)

// Driving mode state (tracked for BottomNav return arrow)

// Pronunciation mode state
const isPronunciationMode = ref(false)

// Mode button visibility (controlled by Settings, stored in localStorage)
const showListeningBtn = ref(false)
const showPronunciationBtn = ref(false)


// Script mode (romanized vs native script toggle)
const playerHasRomanized = computed(() => learningPlayerRef.value?.hasRomanizedText ?? false)
const playerIsNativeScript = computed(() => learningPlayerRef.value?.isNativeScript ?? false)
const isPlayerReady = computed(() => !(learningPlayerRef.value?.isAwakening ?? true))

// Class context (when launched from Schools)
const classContext = ref(null)

// Preview mode: skip to a specific LEGO index via URL param ?preview=50
const previewLegoIndex = computed(() => {
  if (typeof window === 'undefined') return 0
  const params = new URLSearchParams(window.location.search)
  const preview = params.get('preview')
  return preview ? parseInt(preview, 10) || 0 : 0
})

// Active course and enrolled courses state
const activeCourse = inject('activeCourse')
const enrolledCourses = inject('enrolledCourses')
const handleCourseSelect = inject('handleCourseSelect')

// Navigation functions
const navigate = (screen, data = null) => {
  // Close any open auth modals when navigating
  closeAuthModals()

  // Let audio continue when browsing library/progress — center button shows Stop from any screen

  // CRITICAL: Unlock audio element synchronously within user gesture context.
  if (screen === 'player' && learningPlayerRef.value?.unlockAudio) {
    learningPlayerRef.value.unlockAudio()
  }

  if (data) {
    selectedCourse.value = data
  }
  currentScreen.value = screen
  isLearning.value = false
}

const goHome = () => navigate('player')
const startLearning = (course) => navigate('player', course)

// Handle nav events
const handleNavigation = (screen) => {
  // Always close course selector when navigating
  showCourseSelector.value = false

  if (screen === 'library') {
    toggleLibrary()
    return
  }
  // Close library overlay when navigating elsewhere
  showLibrary.value = false
  navigate(screen)
}

const handleStartLearning = () => {
  startLearning(activeCourse.value || selectedCourse.value)
}

// Handle play/stop toggle from nav bar
const handleTogglePlayback = () => {
  if (learningPlayerRef.value) {
    learningPlayerRef.value.togglePlayback()
  }
}

// Bottom-nav transport now steps the LEGO axis (was CYCLE — cycle moved to the
// phase pill, belt moved to the header). Tom 2026-06-01.
const handleRevisit = () => {
  if (learningPlayerRef.value?.handleRoundBack) {
    learningPlayerRef.value.handleRoundBack()
  }
}

const handleSkip = () => {
  if (learningPlayerRef.value?.handleRoundForward) {
    learningPlayerRef.value.handleRoundForward()
  }
}


// Handle play state changes from LearningPlayer
const handlePlayStateChanged = (playing) => {
  isPlaying.value = playing
}

// Handle listening mode state changes from LearningPlayer
const handleListeningModeChanged = (listening) => {
  isListeningMode.value = listening
}

// Handle exit listening mode from BottomNav (user navigated away)
const handleExitListeningMode = () => {
  if (learningPlayerRef.value) {
    learningPlayerRef.value.exitListeningMode()
  }
}

// Handle mode toggle from BottomNav mode buttons
const handleToggleListening = () => {
  if (learningPlayerRef.value?.handleListeningToggle) {
    learningPlayerRef.value.handleListeningToggle()
  }
}

// Handle pronunciation mode state changes from LearningPlayer
const handlePronunciationModeChanged = (active) => {
  isPronunciationMode.value = active
}

// Handle exit pronunciation mode from BottomNav
const handleExitPronunciationMode = () => {
  if (learningPlayerRef.value) {
    learningPlayerRef.value.exitPronunciationMode()
  }
}

const handleTogglePronunciation = () => {
  if (learningPlayerRef.value?.handlePronunciationToggle) {
    learningPlayerRef.value.handlePronunciationToggle()
  }
}

const handleToggleScript = () => {
  if (learningPlayerRef.value?.toggleScriptMode) {
    learningPlayerRef.value.toggleScriptMode()
  }
}

const handleToggleTurbo = () => {
  if (learningPlayerRef.value?.toggleTurbo) {
    learningPlayerRef.value.toggleTurbo()
  }
}

const handleToggleOffline = () => {
  if (learningPlayerRef.value?.toggleOffline) {
    learningPlayerRef.value.toggleOffline()
  }
}

// Handle starting at a specific seed from CourseBrowser
const handleStartAtSeed = (seedNumber) => {
  closeLibrary()
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', {
      detail: { seedNumber },
    }))
  }, 100)
}

// Library overlay
const toggleLibrary = () => {
  if (!showLibrary.value) {
    showSettings.value = false // Close settings if open
    if (learningPlayerRef.value?.handlePause) {
      learningPlayerRef.value.handlePause()
    }
  }
  showLibrary.value = !showLibrary.value
}

const closeLibrary = () => {
  showLibrary.value = false
}

// Settings overlay
const toggleSettings = () => {
  if (!showSettings.value) {
    showLibrary.value = false // Close library if open
    showCourseSelector.value = false // Close course selector if open
    if (learningPlayerRef.value?.handlePause) {
      learningPlayerRef.value.handlePause()
    }
  }
  showSettings.value = !showSettings.value
}

const closeSettings = () => {
  showSettings.value = false
}

const openExplorerOverlay = () => {
  showExplorer.value = true
}

const closeExplorerOverlay = () => {
  showExplorer.value = false
}

// Real learner progress from shared belt progress (created by LearningPlayer)
const beltProgress = computed(() => getSharedBeltProgress())

// Belt CSS vars for cascading to BottomNav and other siblings
const containerBeltVars = computed(() => {
  const bp = beltProgress.value
  if (!bp) return {}
  return bp.beltCssVars.value
})

// Seed count derived from highestLegoId
const completedSeeds = computed(() => {
  const bp = beltProgress.value
  if (!bp) return 0
  const seed = getSeedFromLegoId(bp.highestLegoId.value)
  return seed ?? 0
})

// Belt = the LEGO the current ROUND introduced = one position, one belt. Use
// playingBelt (the live cursor position), NOT currentBelt — currentBelt is
// max(position, highest), a ratchet to the highest belt ever reached, which
// the model says must NEVER be displayed (highest is a separate "you've been
// as far as" readout). When you jump DOWN a belt, this must follow you down.
// Fixed the resting pill + background tint showing Purple while playing Orange.
const currentBeltName = computed(() => {
  const bp = beltProgress.value
  if (!bp) return 'white'
  return bp.playingBelt.value.name
})

const currentBeltColor = computed(() => {
  const bp = beltProgress.value
  if (!bp) return '#ffffff'
  return bp.playingBelt.value.color
})

// Total seeds in course (dynamic per course)
const totalSeeds = computed(() => {
  const bp = beltProgress.value
  return bp?.courseSeedCount?.value ?? bp?.TOTAL_SEEDS ?? 668
})

// Usage stats. The headline "Total Time" is the learner's COMMITMENT metric, so
// it must be true time-in-app (session spans, all courses, incl. listening) — not
// the local per-course estimate, and never the old audio-playback-seconds number.
// For a signed-in learner we read the server value (same definition as admin);
// guests / offline fall back to the local session-history estimate.
const serverEngagedMinutes = ref(null)
async function loadEngagedMinutes() {
  const sb = supabaseClient
  if (!sb?.value) return
  try {
    const { data: { session } } = await sb.value.auth.getSession()
    const token = session?.access_token
    if (!token) return // guest — keep the local estimate
    const res = await fetch('/api/me/engaged-time', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return
    const data = await res.json()
    if (typeof data?.engagedMinutes === 'number') serverEngagedMinutes.value = data.engagedMinutes
  } catch {
    /* non-fatal — fall back to the local estimate */
  }
}
const totalLearningMinutes = computed(() =>
  serverEngagedMinutes.value ?? beltProgress.value?.totalLearningMinutes.value ?? 0
)
const totalPhrasesSpoken = computed(() => beltProgress.value?.totalPhrasesSpoken.value ?? 0)

// Admin detection (mirrors SettingsScreen logic)
const ADMIN_EMAIL_DOMAINS = ['saysomethingin.com', 'ssi.cymru']
const ADMIN_EMAILS = ['tom@tomcassidy.co.uk']
const isAdmin = computed(() => {
  const email = (auth?.user?.value?.emailAddresses?.[0]?.emailAddress || '').toLowerCase()
  if (!email) return false
  if (ADMIN_EMAILS.some(e => email === e.toLowerCase())) return true
  const domain = email.split('@')[1]
  return ADMIN_EMAIL_DOMAINS.some(d => domain === d.toLowerCase())
})

// Handle auth success — refresh entitlements and course list so newly redeemed codes take effect
const fetchEnrolledCourses = inject('fetchEnrolledCourses', null)
const handleAuthSuccess = async () => {
  console.debug('[PlayerContainer] Auth successful, refreshing entitlements...')
  closeAuth()
  // Refresh entitlements so paywall re-evaluates with new codes
  const { refresh: refreshEntitlements } = useSharedUserEntitlements()
  await refreshEntitlements().catch(() => {})
  // Re-fetch courses so newly accessible courses appear
  if (fetchEnrolledCourses) await fetchEnrolledCourses().catch(() => {})
  // If the user started the in-player paywall checkout while signed out, the
  // sign-in modal interrupted it — continue straight into Paddle now.
  await useCheckout().completePendingCheckout().catch(() => {})
}

// Check for class context from Schools
const checkClassContext = () => {
  const params = new URLSearchParams(window.location.search)
  const classId = params.get('class')

  if (classId) {
    const stored = sessionStorage.getItem('ssi-demo-active-class') || localStorage.getItem('ssi-active-class')
    if (stored) {
      try {
        classContext.value = JSON.parse(stored)
        console.debug('[PlayerContainer] Class context loaded:', classContext.value)
      } catch (e) {
        console.error('[PlayerContainer] Failed to parse class context:', e)
      }
    }
    return true
  }
  return false
}

// Clear class context
const clearClassContext = () => {
  classContext.value = null
  sessionStorage.removeItem('ssi-demo-active-class')
  localStorage.removeItem('ssi-active-class')
  const url = new URL(window.location.href)
  url.searchParams.delete('class')
  window.history.replaceState({}, '', url)
}

// Handle going home from player
const handleGoHome = () => {
  if (classContext.value) {
    // Return to whichever surface launched the class session — the tutor
    // dashboard (/teach) or the schools classes list — so the teacher keeps
    // their context instead of being dumped into the learner home.
    const launchedFromTeach = router.currentRoute.value.path.startsWith('/tutors/dashboard')
    clearClassContext()
    router.push(launchedFromTeach ? '/tutors/dashboard' : '/schools/classes')
  } else {
    goHome()
  }
}

// Map old screen param values to new panes
const screenParamMap = {
  'home': 'player',
  'project': 'player',
  'browse': 'player', // library is now an overlay
  'network': 'player',
  'belt-browser': 'player', // library is now an overlay
  'settings': 'player', // settings is now an overlay
  'explorer': 'player',
  'progress': 'player',
  'player': 'player',
  'library': 'player', // library is now an overlay
}

// Load mode button visibility from localStorage and listen for changes
const loadModeVisibility = () => {
  showListeningBtn.value = localStorage.getItem('ssi-mode-listening') === 'true'
  showPronunciationBtn.value = localStorage.getItem('ssi-mode-pronunciation') === 'true'
}

onMounted(() => {
  loadModeVisibility()
  void loadEngagedMinutes()

  // Pre-warm async modal chunks. Fired on idle so the player's first
  // paint isn't competing for bandwidth, but kicks in well before a
  // user is likely to tap any modal-opening icon. Best-effort —
  // failures just mean the chunk loads on click instead.
  const prewarm = () => {
    void import('@/components/SettingsScreen.vue').catch(() => {})
    void import('@/components/BrowseScreen.vue').catch(() => {})
    void import('@/components/CourseExplorer.vue').catch(() => {})
    void import('@/components/auth/SignInModal.vue').catch(() => {})
  }
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(prewarm, { timeout: 2000 })
  } else {
    setTimeout(prewarm, 1500)
  }

  // Listen for settings changes (from SettingsScreen toggle)
  window.addEventListener('ssi-setting-changed', (e) => {
    const { key } = e.detail || {}
    if (key?.startsWith('show') && key.endsWith('Mode')) loadModeVisibility()
  })

  const urlParams = new URLSearchParams(window.location.search)
  const screenParam = urlParams.get('screen')
  if (screenParam) {
    const mapped = screenParamMap[screenParam] || 'player'
    currentScreen.value = mapped
    // If old URL was settings, explorer, or library, open as overlay
    if (screenParam === 'settings') showSettings.value = true
    if (screenParam === 'explorer') showExplorer.value = true
    if (['library', 'browse', 'belt-browser'].includes(screenParam)) showLibrary.value = true
  }

  // 'Or browse our free courses' on /premium pushes here with ?openCourses=1
  // — open the Choose Your Course modal directly. The modal (CourseSelector)
  // lives at the bottom of this container's template.
  if (urlParams.get('openCourses') === '1') {
    showCourseSelector.value = true
    // Strip the param so a refresh doesn't keep re-opening the modal.
    router.replace({ path: '/', query: {} })
  }

  // Listen for mode tip "open settings" from LearningPlayer
  window.addEventListener('ssi-open-settings', () => {
    if (!showSettings.value) toggleSettings()
  })

  // Check if launched from Schools with class context
  const hasClassContext = checkClassContext()
  if (hasClassContext && classContext.value?.course_code) {
    // Switch to the class's course using full course metadata from enrolled list
    const courseCode = classContext.value.course_code
    if (handleCourseSelect && (!activeCourse.value || activeCourse.value.course_code !== courseCode)) {
      const fullCourse = enrolledCourses?.value?.find(c => c.course_code === courseCode)
      handleCourseSelect(fullCourse || { course_code: courseCode, id: courseCode })
    }
    currentScreen.value = 'player'
    isLearning.value = false
  }
})
</script>

<template>
  <div class="player-container" :class="{ 'has-nav': !isLearning, 'is-teach-embedded': isTeachEmbedded }" :style="containerBeltVars">
    <!-- Cultural journey backdrop (mist theme only, language-specific artwork) -->
    <SumiEBackground v-if="themeContext?.theme?.value === 'mist'" :lang="activeCourse?.target_lang" :belt-name="currentBeltName" :belt-color="currentBeltColor" />

    <!-- Learning Player - use v-show to keep it mounted when navigating away -->
    <LearningPlayer
      v-if="activeCourse"
      v-show="currentScreen === 'player'"
      :key="activeCourse?.course_code"
      ref="learningPlayerRef"
      :classContext="classContext"
      :embedded="isTeachEmbedded"
      :course="activeCourse"
      :previewLegoIndex="previewLegoIndex"
      :isVisible="currentScreen === 'player'"
      @close="handleGoHome"
      @playStateChanged="handlePlayStateChanged"
      @listeningModeChanged="handleListeningModeChanged"
      @pronunciationModeChanged="handlePronunciationModeChanged"
    />

    <!-- Player resting state overlay (shown when paused, hidden during playback).
         Gated on activeCourse only — the course identity (flag + name +
         subtitle) renders as soon as the Supabase row resolves. The belt
         badge and journey CTA inside PlayerRestingState have their own
         isPlayerReady gate, so the "White Belt" / globe placeholder issue
         we used to flash can't recur — the user sees the flag and language
         name immediately, then the belt and journey populate when the
         player has finished awakening. -->
    <PlayerRestingState
      v-if="activeCourse && currentScreen === 'player' && !isListeningMode && !isPronunciationMode && !isPlaying"
      :course="activeCourse"
      :completed-seeds="completedSeeds"
      :total-seeds="totalSeeds"
      :current-belt-name="currentBeltName"
      :is-player-ready="isPlayerReady"
      @start="handleTogglePlayback"
      @change-course="showCourseSelector = true"
    />

    <!-- Library overlay (slide-up modal, same pattern as Settings) -->
    <Transition name="slide-up">
      <div v-if="showLibrary" class="settings-overlay" @click.self="closeLibrary">
        <div class="settings-panel">
          <BrowseScreen
            :active-course="activeCourse"
            :enrolled-courses="enrolledCourses"
            :completed-seeds="completedSeeds"
            :total-seeds="totalSeeds"
            :current-belt-name="currentBeltName"
            :total-learning-minutes="totalLearningMinutes"
            :total-phrases-spoken="totalPhrasesSpoken"
            @open-belts="null"
            @select-course="(c) => { closeLibrary(); handleCourseSelect(c) }"
            @close="closeLibrary"
            @start-seed="handleStartAtSeed"
          />
        </div>
      </div>
    </Transition>

    <!-- Bottom Navigation -->
    <BottomNav
      :currentScreen="currentScreen"
      :isLearning="isLearning"
      :isPlaying="isPlaying"
      :isListeningMode="isListeningMode"
      :isPronunciationMode="isPronunciationMode"
      :showLibrary="showLibrary"
      :showSettings="showSettings"
      :isAuthOpen="isAuthOpen"
      :showCourseSelector="showCourseSelector"
      :hasRomanizedText="playerHasRomanized"
      :isNativeScript="playerIsNativeScript"
      :isPlayerReady="isPlayerReady"
      :showListeningBtn="showListeningBtn"
      :showPronunciationBtn="showPronunciationBtn"
      :isTurboMode="learningPlayerRef?.turboActive ?? false"
      :isOfflineMode="learningPlayerRef?.offlineActive ?? false"
      :isInListeningCycle="learningPlayerRef?.isInListeningCycle ?? false"
      @navigate="handleNavigation"
      @startLearning="handleStartLearning"
      @togglePlayback="handleTogglePlayback"
      @exitListeningMode="handleExitListeningMode"
      @exitPronunciationMode="handleExitPronunciationMode"
      @toggleListening="handleToggleListening"
      @togglePronunciation="handleTogglePronunciation"
      @toggleScript="handleToggleScript"
      @toggleTurbo="handleToggleTurbo"
      @toggleOffline="handleToggleOffline"
      @revisit="handleRevisit"
      @skip="handleSkip"
      @openSettings="toggleSettings"
      @closeOverlays="closeLibrary(); closeSettings(); showCourseSelector = false"
      @closeAuth="closeAuth"
    />

    <!-- Gear icon removed — settings now accessible from bottom pill -->

    <!-- Settings overlay (slide-up modal) -->
    <Transition name="slide-up">
      <div v-if="showSettings" class="settings-overlay" @click.self="closeSettings">
        <div class="settings-panel">
          <SettingsScreen
            :course="activeCourse"
            @close="closeSettings"
            @openExplorer="openExplorerOverlay"
            @openListening="closeSettings(); handleToggleListening()"
          />
        </div>
      </div>
    </Transition>

    <!-- Course Explorer overlay (nested inside settings flow) -->
    <Transition name="slide-up">
      <div v-if="showExplorer" class="settings-overlay" @click.self="closeExplorerOverlay">
        <div class="settings-panel">
          <CourseExplorer
            :course="activeCourse"
            @close="closeExplorerOverlay"
          />
        </div>
      </div>
    </Transition>

    <!-- Course Selector (always mounted, manages own overlay) -->
    <CourseSelector
      :is-open="showCourseSelector"
      :supabase="supabaseClient"
      :enrolled-courses="enrolledCourses"
      :active-course-id="activeCourse?.course_code"
      :is-admin="isAdmin"
      @selectCourse="(c) => { showCourseSelector = false; handleCourseSelect(c) }"
      @close="showCourseSelector = false"
    />

    <!-- Unified Auth Modal (shared state with all components) -->
    <SignInModal @success="handleAuthSuccess" />

  </div>
</template>

<style scoped>
.player-container {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
}

/* Add bottom padding when nav is visible */
.player-container.has-nav {
  padding-bottom: var(--nav-height-safe);
}

/* Embedded in the teach shell ("Play as class"): the TopNav stays fixed at the
   top. `transform` makes this element the containing block for its `position:
   fixed` descendants (the player root + every pop-up), so they anchor to this
   box instead of the viewport. Sized to the area BELOW the nav (the parent
   .main-content already offsets us down by the nav height), so nothing — modal
   close buttons, mode-tray controls, the player header — hides under the nav. */
.player-container.is-teach-embedded {
  transform: translateZ(0);
  min-height: 0;
  height: calc(100vh - var(--nav-height) - env(safe-area-inset-top, 0px));
  height: calc(100dvh - var(--nav-height) - env(safe-area-inset-top, 0px));
}

/* Slide up transition for overlays */
.slide-up-enter-active {
  transition: opacity 0.3s ease;
}

.slide-up-enter-active .settings-panel {
  transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-leave-active {
  transition: opacity 0.25s ease-in;
}

.slide-up-leave-active .settings-panel {
  transition: transform 0.2s ease-in;
}

.slide-up-enter-from {
  opacity: 0;
}

.slide-up-enter-from .settings-panel {
  transform: translateY(100%);
}

.slide-up-leave-to {
  opacity: 0;
}

.slide-up-leave-to .settings-panel {
  transform: translateY(100%);
}

/* Settings overlay */
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.settings-panel {
  width: 100%;
  max-width: 500px;
  /* Safety net: with the async modals (Settings, Library, Explorer,
     SignIn), the panel content is briefly empty while the chunk is
     in flight. Without a min-height the panel collapses to 0 and
     the user sees only the scrim — confusing. Pre-warm normally
     beats them to it, but this guarantees a visible panel even on
     a cold click. */
  min-height: 50vh;
  max-height: 85dvh;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: 16px 16px 0 0;
  overscroll-behavior: contain;
}

@media (min-width: 540px) {
  .settings-panel {
    border-left: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
    border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
  }
}

@media (display-mode: standalone) {
  .settings-panel {
    max-height: 90vh;
  }
}


</style>

<!-- Mist theme: subtle border for desktop panels -->
<style>
:root[data-theme="mist"] .player-container .settings-panel {
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  border-right: 1px solid rgba(0, 0, 0, 0.08);
}

@media (max-width: 539px) {
  :root[data-theme="mist"] .player-container .settings-panel {
    border-left: none;
    border-right: none;
  }
}
</style>
