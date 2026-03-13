<script setup>
import { ref, provide, onMounted, computed, inject, watch } from 'vue'
import { useRouter } from 'vue-router'

// Global backdrop
import SumiEBackground from '@/components/SumiEBackground.vue'

// Screen components
import LearningPlayer from '@/components/LearningPlayer.vue'
import SettingsScreen from '@/components/SettingsScreen.vue'
import CourseExplorer from '@/components/CourseExplorer.vue'
import BrainView from '@/components/BrainView.vue'
import CourseBrowser from '@/components/CourseBrowser.vue'
import BrowseScreen from '@/components/BrowseScreen.vue'
import BottomNav from '@/components/BottomNav.vue'
import BuildBadge from '@/components/BuildBadge.vue'
import PlayerRestingState from '@/components/PlayerRestingState.vue'
import CourseSelector from '@/components/CourseSelector.vue'

// Custom auth modal (unified)
import { SignInModal } from '@/components/auth'

// Global auth modal state (shared singleton)
import { useAuthModal } from '@/composables/useAuthModal'
import { BELTS, getSharedBeltProgress, getSeedFromLegoId } from '@/composables/useBeltProgress'

// Inject from App
const supabaseClient = inject('supabase')
const progressStore = inject('progressStore')
const sessionStore = inject('sessionStore')
const courseDataProvider = inject('courseDataProvider')
const auth = inject('auth')
const config = inject('config')
const themeContext = inject('theme', null)
const router = useRouter()

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
const isDrivingMode = ref(false)

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

// Handle transport controls from BottomNav (revisit/skip)
const handleRevisit = () => {
  if (learningPlayerRef.value?.handleRevisit) {
    learningPlayerRef.value.handleRevisit()
  }
}

const handleSkip = () => {
  if (learningPlayerRef.value?.handleSkip) {
    learningPlayerRef.value.handleSkip()
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

// Handle driving mode state changes from LearningPlayer
const handleDrivingModeChanged = (driving) => {
  isDrivingMode.value = driving
}

// Handle exit listening mode from BottomNav (user navigated away)
const handleExitListeningMode = () => {
  if (learningPlayerRef.value) {
    learningPlayerRef.value.exitListeningMode()
  }
}

// Handle exit driving mode from BottomNav
const handleExitDrivingMode = () => {
  if (learningPlayerRef.value) {
    learningPlayerRef.value.handleExitDrivingMode()
  }
}

// Handle mode toggle from BottomNav mode buttons
const handleToggleListening = () => {
  if (learningPlayerRef.value?.handleListeningToggle) {
    learningPlayerRef.value.handleListeningToggle()
  }
}

const handleToggleDriving = () => {
  if (learningPlayerRef.value?.handleDrivingToggle) {
    learningPlayerRef.value.handleDrivingToggle()
  }
}

const handleToggleScript = () => {
  if (learningPlayerRef.value?.toggleScriptMode) {
    learningPlayerRef.value.toggleScriptMode()
  }
}

// Handle view progress from LearningPlayer (belt modal)
const handleViewProgress = () => {
  navigate('progress')
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

// Current belt name and color from real progress
const currentBeltName = computed(() => {
  const bp = beltProgress.value
  if (!bp) return 'white'
  return bp.currentBelt.value.name
})

const currentBeltColor = computed(() => {
  const bp = beltProgress.value
  if (!bp) return '#ffffff'
  return bp.currentBelt.value.color
})

// Total seeds in course
const totalSeeds = computed(() => {
  const bp = beltProgress.value
  return bp?.TOTAL_SEEDS ?? 668
})

// Usage stats from session history
const totalLearningMinutes = computed(() => beltProgress.value?.totalLearningMinutes.value ?? 0)
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

// Handle auth success
const handleAuthSuccess = () => {
  console.debug('[PlayerContainer] Auth successful!')
  closeAuth()
}

// Check for class context from Schools
const checkClassContext = () => {
  const params = new URLSearchParams(window.location.search)
  const classId = params.get('class')

  if (classId) {
    const stored = localStorage.getItem('ssi-active-class')
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
  localStorage.removeItem('ssi-active-class')
  const url = new URL(window.location.href)
  url.searchParams.delete('class')
  window.history.replaceState({}, '', url)
}

// Handle going home from player
const handleGoHome = () => {
  if (classContext.value) {
    clearClassContext()
    router.push('/schools/classes')
  } else {
    goHome()
  }
}

// Map old screen param values to new panes
const screenParamMap = {
  'home': 'player',
  'project': 'player',
  'browse': 'player', // library is now an overlay
  'network': 'progress',
  'belt-browser': 'player', // library is now an overlay
  'settings': 'player', // settings is now an overlay
  'explorer': 'player',
  'progress': 'progress',
  'player': 'player',
  'library': 'player', // library is now an overlay
}

onMounted(() => {
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
  <div class="player-container" :class="{ 'has-nav': !isLearning }" :style="containerBeltVars">
    <!-- Cultural journey backdrop (mist theme only, language-specific artwork) -->
    <SumiEBackground v-if="themeContext?.theme?.value === 'mist'" :lang="activeCourse?.target_lang" :belt-name="currentBeltName" :belt-color="currentBeltColor" />

    <!-- Progress pane (Brain View) -->
    <Transition name="slide-right" mode="out-in">
      <BrainView
        v-if="currentScreen === 'progress'"
        :course="activeCourse"
        :belt-level="currentBeltName"
        :completed-rounds="completedSeeds"
        @close="navigate('player')"
      />
    </Transition>

    <!-- Learning Player - use v-show to keep it mounted when navigating away -->
    <LearningPlayer
      v-if="activeCourse"
      v-show="currentScreen === 'player'"
      :key="activeCourse?.course_code"
      ref="learningPlayerRef"
      :classContext="classContext"
      :course="activeCourse"
      :previewLegoIndex="previewLegoIndex"
      :isVisible="currentScreen === 'player'"
      @close="handleGoHome"
      @playStateChanged="handlePlayStateChanged"
      @viewProgress="handleViewProgress"
      @listeningModeChanged="handleListeningModeChanged"
      @drivingModeChanged="handleDrivingModeChanged"
    />

    <!-- Player resting state overlay (shown when paused, hidden during playback) -->
    <PlayerRestingState
      v-if="currentScreen === 'player' && !isListeningMode && !isDrivingMode && !isPlaying"
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
            @open-brain="closeLibrary(); navigate('progress')"
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
      :isDrivingMode="isDrivingMode"
      :showLibrary="showLibrary"
      :showSettings="showSettings"
      :isAuthOpen="isAuthOpen"
      :showCourseSelector="showCourseSelector"
      :hasRomanizedText="playerHasRomanized"
      :isNativeScript="playerIsNativeScript"
      :isPlayerReady="isPlayerReady"
      @navigate="handleNavigation"
      @startLearning="handleStartLearning"
      @togglePlayback="handleTogglePlayback"
      @exitListeningMode="handleExitListeningMode"
      @exitDrivingMode="handleExitDrivingMode"
      @toggleListening="handleToggleListening"
      @toggleDriving="handleToggleDriving"
      @toggleScript="handleToggleScript"
      @revisit="handleRevisit"
      @skip="handleSkip"
      @openSettings="toggleSettings"
      @closeOverlays="closeLibrary(); closeSettings()"
      @closeAuth="closeAuth"
    />

    <!-- Gear icon removed — settings now accessible from bottom pill -->

    <!-- Build Badge (dev/staging visibility) -->
    <BuildBadge v-if="!isLearning" />

    <!-- Settings overlay (slide-up modal) -->
    <Transition name="slide-up">
      <div v-if="showSettings" class="settings-overlay" @click.self="closeSettings">
        <div class="settings-panel">
          <SettingsScreen
            :course="activeCourse"
            @close="closeSettings"
            @openExplorer="openExplorerOverlay"
            @openListening="closeSettings(); handleToggleListening()"
            @openDriving="closeSettings(); handleToggleDriving()"
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

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Slide right transition */
.slide-right-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  will-change: transform, opacity;
}

.slide-right-leave-active {
  transition: all 0.2s ease-in;
  will-change: transform, opacity;
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.slide-right-leave-to {
  opacity: 0;
  transform: translateX(-10px);
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

/* Settings gear icon */
.settings-gear {
  position: fixed;
  top: calc(0.75rem + env(safe-area-inset-top, 0px));
  right: 1rem;
  z-index: 100;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.settings-gear:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-elevated) 95%, transparent);
}

.settings-gear:active {
  transform: scale(0.9);
}

.settings-gear svg {
  width: 20px;
  height: 20px;
  transition: transform 0.3s ease;
}

.settings-gear--open svg {
  transform: rotate(90deg);
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
  max-height: 100dvh;
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
