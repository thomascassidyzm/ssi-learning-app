<script setup>
import { ref, provide, onMounted, computed, inject, watch } from 'vue'

// Screen components
import HomeScreen from '@/components/HomeScreen.vue'
import LearningPlayer from '@/components/LearningPlayer.vue'
import JourneyMap from '@/components/JourneyMap.vue'
import SettingsScreen from '@/components/SettingsScreen.vue'
import CourseExplorer from '@/components/CourseExplorer.vue'
import BrainView from '@/components/BrainView.vue'
import UsageStats from '@/components/UsageStats.vue'
import BottomNav from '@/components/BottomNav.vue'
import BuildBadge from '@/components/BuildBadge.vue'

// Custom auth modals
import { SignInModal, SignUpModal } from '@/components/auth'

// Global auth modal state (shared singleton)
import { useAuthModal } from '@/composables/useAuthModal'
import { BELTS } from '@/composables/useBeltProgress'

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

// Feature flags
const USE_NEW_SESSION = ref(false) // Toggle to use LearningSession instead of LearningPlayer

// Navigation state
// Screens: 'home' | 'player' | 'journey' | 'settings' | 'explorer' | 'network' | 'stats'
const currentScreen = ref('home')
const selectedCourse = ref(null)
const isLearning = ref(false)

// Player state - shared with nav bar for play/stop button
const isPlaying = ref(false)
const learningPlayerRef = ref(null)

// Listening mode overlay state (overlay is inside LearningPlayer, but we track it for BottomNav)
const isListeningMode = ref(false)

// Component refs
const legoNetworkRef = ref(null)

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
  // This prevents audio conflicts with BrainView, etc.
  // The player stays mounted (v-show) so state is preserved
  if (currentScreen.value === 'player' && screen !== 'player') {
    if (learningPlayerRef.value?.handlePause) {
      learningPlayerRef.value.handlePause()
      console.log('[PlayerContainer] Paused player before navigating to', screen)
    }
  }

  if (data) {
    selectedCourse.value = data
  }
  currentScreen.value = screen
  // Nav bar stays visible on all screens including player
  isLearning.value = false
}

const goHome = () => navigate('home')
const startLearning = (course) => navigate('player', course)
const handleViewJourney = () => navigate('stats')
const openSettings = () => navigate('settings')
const openExplorer = () => navigate('explorer')
const openNetwork = () => navigate('network')
const openStats = () => navigate('stats')

// Handle nav events
const handleNavigation = (screen) => {
  navigate(screen)
}

const handleStartLearning = () => {
  // Navigate to player from any screen
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
  navigate('network')
}

// Learner data (would come from database in production)
const learnerStats = ref({
  completedRounds: 42,
  totalSeeds: 668,
  learningVelocity: 1.2,
})

// Current belt based on completedRounds
const currentBeltName = computed(() => {
  const seeds = learnerStats.value.completedRounds
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seeds >= BELTS[i].seedsRequired) {
      return BELTS[i].name
    }
  }
  return 'white'
})

// Handle auth success (close modals, refresh state if needed)
const handleAuthSuccess = () => {
  console.log('[PlayerContainer] Auth successful!')
  closeSignIn()
  closeSignUp()
}

// Check for class context from Schools
const checkClassContext = () => {
  const params = new URLSearchParams(window.location.search)
  const classId = params.get('class')

  if (classId) {
    // Read class details from localStorage (set by Schools)
    const stored = localStorage.getItem('ssi-active-class')
    if (stored) {
      try {
        classContext.value = JSON.parse(stored)
        console.log('[PlayerContainer] Class context loaded:', classContext.value)
      } catch (e) {
        console.error('[PlayerContainer] Failed to parse class context:', e)
      }
    }
    return true
  }
  return false
}

// Clear class context (when exiting player back to home)
const clearClassContext = () => {
  classContext.value = null
  localStorage.removeItem('ssi-active-class')
  // Remove query param from URL without reload
  const url = new URL(window.location.href)
  url.searchParams.delete('class')
  window.history.replaceState({}, '', url)
}

// Handle going home from player
const handleGoHome = () => {
  if (classContext.value) {
    // If came from Schools, go back to Schools
    window.location.href = '/schools/classes'
  } else {
    goHome()
  }
}

onMounted(() => {
  // Check URL params for direct navigation (e.g., ?screen=project)
  const urlParams = new URLSearchParams(window.location.search)
  const screenParam = urlParams.get('screen')
  if (screenParam && ['project', 'explorer', 'network', 'settings', 'stats'].includes(screenParam)) {
    currentScreen.value = screenParam
  }

  // Check if launched from Schools with class context
  const hasClassContext = checkClassContext()
  if (hasClassContext) {
    // Auto-start player when coming from Schools
    currentScreen.value = 'player'
    // Nav stays visible even when learning
    isLearning.value = false
  }
})
</script>

<template>
  <div class="player-container" :class="{ 'has-nav': !isLearning }">
    <!-- Home Screen -->
    <Transition name="fade" mode="out-in">
      <HomeScreen
        v-if="currentScreen === 'home'"
        :supabase="supabaseClient"
        :activeCourse="activeCourse"
        :enrolledCourses="enrolledCourses"
        @startLearning="startLearning"
        @viewJourney="handleViewJourney"
        @openSettings="openSettings"
        @selectCourse="handleCourseSelect"
        @openExplorer="openExplorer"
      />
    </Transition>

    <!-- Learning Player - use v-show to keep it mounted when navigating away -->
    <!-- This preserves playback state when viewing BrainView, Settings, etc. -->
    <!-- :key forces full remount when course changes (cache invalidation) -->
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

    <!-- Journey Map -->
    <Transition name="slide-up" mode="out-in">
      <JourneyMap
        v-if="currentScreen === 'journey'"
        :completedRounds="learnerStats.completedRounds"
        :totalSeeds="learnerStats.totalSeeds"
        :learningVelocity="learnerStats.learningVelocity"
        @close="goHome"
        @startLearning="handleStartLearning"
      />
    </Transition>

    <!-- Settings Screen -->
    <Transition name="slide-right" mode="out-in">
      <SettingsScreen
        v-if="currentScreen === 'settings'"
        :course="activeCourse"
        @close="goHome"
        @openExplorer="openExplorer"
        @openNetwork="openNetwork"
      />
    </Transition>

    <!-- Course Explorer (QA Script Preview) -->
    <Transition name="slide-right" mode="out-in">
      <CourseExplorer
        v-if="currentScreen === 'explorer'"
        :course="activeCourse"
        @close="goHome"
      />
    </Transition>

    <!-- Brain View (growing brain network visualization) -->
    <Transition name="slide-right" mode="out-in">
      <BrainView
        v-if="currentScreen === 'network'"
        :course="activeCourse"
        :belt-level="currentBeltName"
        :completed-seeds="learnerStats.completedRounds"
        @close="goHome"
      />
    </Transition>

    <!-- Usage Stats -->
    <Transition name="slide-right" mode="out-in">
      <UsageStats
        v-if="currentScreen === 'stats'"
        :total-minutes="learnerStats.lifetimeLearningMinutes || 127"
        :total-words-introduced="learnerStats.totalWordsIntroduced || 142"
        :total-phrases-spoken="learnerStats.totalPhrasesSpoken || 847"
        @close="goHome"
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

    <!-- Build Badge (dev/staging visibility) -->
    <BuildBadge v-if="!isLearning" />

    <!-- Clerk User Button (only shown when signed in - sign-in is in bottom nav) -->
    <SignedIn v-if="clerkEnabled && !isLearning">
      <div class="user-button-container">
        <UserButton
          :appearance="{
            elements: {
              avatarBox: 'w-10 h-10',
              userButtonTrigger: 'focus:shadow-none'
            }
          }"
        />
      </div>
    </SignedIn>

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

/* Slide up transition */
.slide-up-enter-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.slide-up-leave-active {
  transition: all 0.3s ease-in;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateY(-10px);
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

/* Clerk User Button positioning */
.user-button-container {
  position: fixed;
  /* Account for iOS safe area (status bar) */
  top: calc(0.75rem + env(safe-area-inset-top, 0px));
  right: 1rem;
  z-index: 100;
}
</style>
