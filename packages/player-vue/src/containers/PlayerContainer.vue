<script setup>
import { ref, provide, onMounted, computed, inject, watch } from 'vue'
import { useRouter } from 'vue-router'

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

// Custom auth modals
import { SignInModal, SignUpModal } from '@/components/auth'

// Global auth modal state (shared singleton)
import { useAuthModal } from '@/composables/useAuthModal'
import { BELTS, getSharedBeltProgress, getSeedFromLegoId } from '@/composables/useBeltProgress'

// Clerk components (conditionally imported)
import { SignedIn, SignedOut, UserButton } from '@clerk/vue'

// Inject from App
const supabaseClient = inject('supabase')
const progressStore = inject('progressStore')
const sessionStore = inject('sessionStore')
const courseDataProvider = inject('courseDataProvider')
const auth = inject('auth')
const config = inject('config')
const clerkEnabled = inject('clerkEnabled')
const router = useRouter()

// Global auth modal (shared with BottomNav and other components)
const {
  isSignInOpen,
  isSignUpOpen,
  openSignIn,
  openSignUp,
  closeAll: closeAuthModals,
  closeSignIn,
  closeSignUp,
  switchToSignIn,
  switchToSignUp,
} = useAuthModal()

// Navigation state — 3 panes only
// Screens: 'progress' | 'player' | 'library'
const currentScreen = ref('player')
const selectedCourse = ref(null)
const isLearning = ref(false)

// Overlay state (not screens)
const showSettings = ref(false)
const showExplorer = ref(false)
const showCourseSelector = ref(false)

// Player state - shared with nav bar for play/stop button
const isPlaying = ref(false)
const learningPlayerRef = ref(null)

// Listening mode overlay state (overlay is inside LearningPlayer, but we track it for BottomNav)
const isListeningMode = ref(false)

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

  // CRITICAL: Pause the player when navigating AWAY from it
  if (currentScreen.value === 'player' && screen !== 'player') {
    if (learningPlayerRef.value?.handlePause) {
      learningPlayerRef.value.handlePause()
      console.debug('[PlayerContainer] Paused player before navigating to', screen)
    }
  }

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

// Handle view progress from LearningPlayer (belt modal)
const handleViewProgress = () => {
  navigate('progress')
}

// Handle starting at a specific seed from CourseBrowser
const handleStartAtSeed = (seedNumber) => {
  navigate('player')
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('ssi-jump-to-seed', {
      detail: { seedNumber },
    }))
  }, 100)
}

// Settings overlay
const toggleSettings = () => {
  if (!showSettings.value) {
    // Pause player when opening settings
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

// Seed count derived from highestLegoId
const completedSeeds = computed(() => {
  const bp = beltProgress.value
  if (!bp) return 0
  const seed = getSeedFromLegoId(bp.highestLegoId.value)
  return seed ?? 0
})

// Current belt name from real progress
const currentBeltName = computed(() => {
  const bp = beltProgress.value
  if (!bp) return 'white'
  return bp.currentBelt.value.name
})

// Total seeds in course
const totalSeeds = computed(() => {
  const bp = beltProgress.value
  return bp?.TOTAL_SEEDS ?? 668
})

// Usage stats from session history
const totalLearningMinutes = computed(() => beltProgress.value?.totalLearningMinutes.value ?? 0)
const totalPhrasesSpoken = computed(() => beltProgress.value?.totalPhrasesSpoken.value ?? 0)

// Handle auth success
const handleAuthSuccess = () => {
  console.debug('[PlayerContainer] Auth successful!')
  closeSignIn()
  closeSignUp()
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
  'browse': 'library',
  'network': 'progress',
  'belt-browser': 'library',
  'settings': 'player', // settings is now an overlay
  'explorer': 'player',
  'progress': 'progress',
  'player': 'player',
  'library': 'library',
}

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search)
  const screenParam = urlParams.get('screen')
  if (screenParam) {
    const mapped = screenParamMap[screenParam] || 'player'
    currentScreen.value = mapped
    // If old URL was settings or explorer, open as overlay
    if (screenParam === 'settings') showSettings.value = true
    if (screenParam === 'explorer') showExplorer.value = true
  }

  // Check if launched from Schools with class context
  const hasClassContext = checkClassContext()
  if (hasClassContext) {
    currentScreen.value = 'player'
    isLearning.value = false
  }
})
</script>

<template>
  <div class="player-container" :class="{ 'has-nav': !isLearning }">
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
    />

    <!-- Player resting state overlay (when player is visible but paused) -->
    <PlayerRestingState
      v-if="currentScreen === 'player' && !isPlaying && !isListeningMode"
      :course="activeCourse"
      :completed-seeds="completedSeeds"
      :total-seeds="totalSeeds"
      :current-belt-name="currentBeltName"
      @start="handleTogglePlayback"
      @change-course="showCourseSelector = true"
    />

    <!-- Library pane (Browse + inline belt browser) -->
    <Transition name="slide-right" mode="out-in">
      <BrowseScreen
        v-if="currentScreen === 'library'"
        :active-course="activeCourse"
        :enrolled-courses="enrolledCourses"
        :completed-seeds="completedSeeds"
        :total-seeds="totalSeeds"
        :current-belt-name="currentBeltName"
        :total-learning-minutes="totalLearningMinutes"
        :total-phrases-spoken="totalPhrasesSpoken"
        @open-belts="navigate('library')"
        @open-brain="navigate('progress')"
        @select-course="handleCourseSelect"
        @close="navigate('player')"
        @start-seed="handleStartAtSeed"
      />
    </Transition>

    <!-- Bottom Navigation -->
    <BottomNav
      :currentScreen="currentScreen"
      :isLearning="isLearning"
      :isPlaying="isPlaying"
      :isListeningMode="isListeningMode"
      @navigate="handleNavigation"
      @startLearning="handleStartLearning"
      @togglePlayback="handleTogglePlayback"
      @exitListeningMode="handleExitListeningMode"
    />

    <!-- Gear icon for settings (visible on all panes when not learning) -->
    <button
      v-if="!isLearning"
      class="settings-gear"
      :class="{ 'settings-gear--open': showSettings }"
      @click="toggleSettings"
      :aria-label="showSettings ? 'Close settings' : 'Settings'"
    >
      <!-- Gear icon -->
      <svg v-if="!showSettings" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
      <!-- X (close) icon -->
      <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

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

    <!-- Course Selector (triggered from resting state) -->
    <CourseSelector
      :is-open="showCourseSelector"
      :supabase="supabaseClient"
      :enrolled-courses="enrolledCourses"
      :active-course-id="activeCourse?.course_code"
      @selectCourse="(c) => { showCourseSelector = false; handleCourseSelect(c) }"
      @close="showCourseSelector = false"
    />

    <!-- Custom Auth Modals (shared state with BottomNav) -->
    <SignInModal
      :is-open="isSignInOpen"
      @close="closeSignIn"
      @switch-to-sign-up="switchToSignUp"
      @success="handleAuthSuccess"
    />
    <SignUpModal
      :is-open="isSignUpOpen"
      @close="closeSignUp"
      @switch-to-sign-in="switchToSignIn"
      @success="handleAuthSuccess"
    />
  </div>
</template>

<style scoped>
.player-container {
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
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-right-leave-active {
  transition: all 0.3s ease-in;
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
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-leave-active {
  transition: all 0.25s ease-in;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.slide-up-leave-to {
  opacity: 0;
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
  max-height: 90dvh;
  overflow-y: auto;
  background: var(--bg-primary);
  border-radius: 16px 16px 0 0;
  overscroll-behavior: contain;
}
</style>
