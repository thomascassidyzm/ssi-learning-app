<script setup>
import { ref, provide, onMounted, computed } from 'vue'
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured, isClerkConfigured } from './config/env'
import { useAuth } from './composables/useAuth'

// Clerk components (conditionally imported)
import { SignedIn, SignedOut, UserButton, SignInButton } from '@clerk/vue'

// Screen components
import HomeScreen from './components/HomeScreen.vue'
import LearningPlayer from './components/LearningPlayer.vue'
import JourneyMap from './components/JourneyMap.vue'
import ProfileScreen from './components/ProfileScreen.vue'
import SettingsScreen from './components/SettingsScreen.vue'
import CourseExplorer from './components/CourseExplorer.vue'
import LegoNetwork from './components/LegoNetwork.vue'
import ProgressDemo from './components/ProgressDemo.vue'
import BottomNav from './components/BottomNav.vue'
import BuildBadge from './components/BuildBadge.vue'

// Load configuration
const config = loadConfig()
const clerkEnabled = isClerkConfigured(config)

// Auth state (only if Clerk is configured)
const auth = clerkEnabled ? useAuth() : null

// Navigation state
// Screens: 'home' | 'player' | 'journey' | 'profile' | 'settings' | 'explorer' | 'network' | 'progress-demo'
const currentScreen = ref('home')
const selectedCourse = ref(null)
const isLearning = ref(false)

// Component refs
const legoNetworkRef = ref(null)

// Class context (when launched from Schools)
const classContext = ref(null)

// Navigation functions
const navigate = (screen, data = null) => {
  if (data) {
    selectedCourse.value = data
  }
  currentScreen.value = screen
  isLearning.value = screen === 'player'
}

const goHome = () => navigate('home')
const startLearning = (course) => navigate('player', course)
const viewJourney = (course) => navigate('journey', course)
const openProfile = () => navigate('profile')
const openSettings = () => navigate('settings')
const openExplorer = () => navigate('explorer')
const openNetwork = () => navigate('network')
const openProgressDemo = () => navigate('progress-demo')

// Handle nav events
const handleNavigation = (screen) => {
  navigate(screen)
}

const handleStartLearning = () => {
  // If on Brain View (network), trigger playback mode instead of navigating
  if (currentScreen.value === 'network' && legoNetworkRef.value) {
    legoNetworkRef.value.startPlayback()
    isLearning.value = true
    return
  }
  startLearning(selectedCourse.value)
}

// Learner data (would come from database in production)
const learnerStats = ref({
  completedSeeds: 42,
  totalSeeds: 668,
  learningVelocity: 1.2,
})

// Initialize stores (null if database not configured)
const progressStore = ref(null)
const sessionStore = ref(null)
const courseDataProvider = ref(null)
const supabaseClient = ref(null)

// Active course and enrolled courses state
const activeCourse = ref(null)
const enrolledCourses = ref([])

// Course persistence key
const LAST_COURSE_KEY = 'ssi-last-course'

// Handle course selection from CourseSelector
const handleCourseSelect = async (course) => {
  const courseCode = course.course_code || course.id
  console.log('[App] Course selected:', courseCode)
  activeCourse.value = course

  // Persist course selection
  try {
    localStorage.setItem(LAST_COURSE_KEY, courseCode)
    console.log('[App] Course persisted to localStorage:', courseCode)
  } catch (e) {
    console.warn('[App] Failed to persist course selection:', e)
  }

  // Update courseDataProvider for the new course
  if (supabaseClient.value) {
    courseDataProvider.value = createCourseDataProvider({
      supabaseClient: supabaseClient.value,
      audioBaseUrl: config.s3.audioBaseUrl,
      courseId: courseCode,
    })
  }

  // Update selected course for learning
  selectedCourse.value = course
}

// Fetch enrolled courses from Supabase
const fetchEnrolledCourses = async () => {
  if (!supabaseClient.value) {
    console.log('[App] fetchEnrolledCourses: No Supabase client')
    return
  }

  console.log('[App] fetchEnrolledCourses: Fetching from courses table...')

  try {
    // For now, we don't have a learner_id, so just get all courses
    // In production, this would filter by learner enrollment
    const { data, error } = await supabaseClient.value
      .from('courses')
      .select('*')
      .order('display_name')

    console.log('[App] fetchEnrolledCourses result:', { data: data?.length || 0, error })

    if (error) {
      console.error('[App] Failed to fetch courses:', error)
      return
    }

    // Set active course from: 1) localStorage, 2) first available
    if (data && data.length > 0) {
      enrolledCourses.value = data

      // Check for saved course preference
      let savedCourseCode = null
      try {
        savedCourseCode = localStorage.getItem(LAST_COURSE_KEY)
      } catch (e) {
        console.warn('[App] Failed to read saved course:', e)
      }

      // Find saved course or fall back to first available
      let defaultCourse = null
      if (savedCourseCode) {
        defaultCourse = data.find(c => c.course_code === savedCourseCode)
        if (defaultCourse) {
          console.log('[App] Restored saved course:', savedCourseCode)
        } else {
          console.log('[App] Saved course not found:', savedCourseCode, '- using first available')
        }
      }
      if (!defaultCourse) {
        defaultCourse = data[0]
      }

      if (defaultCourse && !activeCourse.value) {
        activeCourse.value = {
          ...defaultCourse,
          completedSeeds: 0,
          progress: 0,
          lastSession: null,
        }
        // Create courseDataProvider for the default course
        courseDataProvider.value = createCourseDataProvider({
          supabaseClient: supabaseClient.value,
          audioBaseUrl: config.s3.audioBaseUrl,
          courseId: defaultCourse.course_code,
        })
        console.log('[App] Active course set:', defaultCourse.course_code)
      }
    }
  } catch (err) {
    console.error('[App] Error fetching enrolled courses:', err)
  }
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
        console.log('[App] Class context loaded:', classContext.value)
      } catch (e) {
        console.error('[App] Failed to parse class context:', e)
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
    window.location.href = '/schools/classes.html'
  } else {
    goHome()
  }
}

// Provide stores to child components (provide at setup level for reactivity)
provide('progressStore', progressStore)
provide('sessionStore', sessionStore)
provide('courseDataProvider', courseDataProvider)
provide('auth', auth)
provide('supabase', supabaseClient)

onMounted(async () => {
  // Check if launched from Schools with class context
  const hasClassContext = checkClassContext()
  if (hasClassContext) {
    // Auto-start player when coming from Schools
    currentScreen.value = 'player'
    isLearning.value = true
  }

  // Only initialize Supabase if configured and feature flag is enabled
  if (config.features.useDatabase && isSupabaseConfigured(config)) {
    try {
      console.log('[App] Initializing Supabase client...')
      supabaseClient.value = createClient(
        config.supabase.url,
        config.supabase.anonKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
          },
        }
      )

      // Create store instances
      progressStore.value = createProgressStore({ client: supabaseClient.value })
      sessionStore.value = createSessionStore({ client: supabaseClient.value })

      // Initialize auth with Supabase client (for learner management)
      if (auth) {
        await auth.initialize(supabaseClient.value)
        console.log('[App] Auth initialized, learnerId:', auth.learnerId.value)
      }

      // courseDataProvider will be created when a course is selected
      // For now, don't create with default - let course selection handle it
      console.log('[App] Database stores initialized')

      // Fetch enrolled courses
      await fetchEnrolledCourses()
    } catch (err) {
      console.error('[App] Failed to initialize Supabase:', err)
    }
  } else {
    console.log('[App] Running in demo mode (database not configured or disabled)')
  }
})
</script>

<template>
  <div class="app-container" :class="{ 'has-nav': !isLearning }">
    <!-- Home Screen -->
    <Transition name="fade" mode="out-in">
      <HomeScreen
        v-if="currentScreen === 'home'"
        :supabase="supabaseClient"
        :activeCourse="activeCourse"
        :enrolledCourses="enrolledCourses"
        @startLearning="startLearning"
        @viewJourney="viewJourney"
        @openProfile="openProfile"
        @openSettings="openSettings"
        @selectCourse="handleCourseSelect"
        @openExplorer="openExplorer"
      />
    </Transition>

    <!-- Learning Player -->
    <Transition name="slide-up" mode="out-in">
      <LearningPlayer
        v-if="currentScreen === 'player' && activeCourse"
        :classContext="classContext"
        :course="activeCourse"
        @close="handleGoHome"
      />
    </Transition>

    <!-- Journey Map -->
    <Transition name="slide-up" mode="out-in">
      <JourneyMap
        v-if="currentScreen === 'journey'"
        :completedSeeds="learnerStats.completedSeeds"
        :totalSeeds="learnerStats.totalSeeds"
        :learningVelocity="learnerStats.learningVelocity"
        @close="goHome"
        @startLearning="handleStartLearning"
      />
    </Transition>

    <!-- Profile Screen -->
    <Transition name="slide-right" mode="out-in">
      <ProfileScreen
        v-if="currentScreen === 'profile'"
        @close="goHome"
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
        @openProgressDemo="openProgressDemo"
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

    <!-- Progress Map Visualization (Brain View) -->
    <Transition name="slide-right" mode="out-in">
      <LegoNetwork
        v-if="currentScreen === 'network'"
        ref="legoNetworkRef"
        :course="activeCourse"
        beltLevel="white"
        @close="goHome"
        @playbackEnded="isLearning = false"
      />
    </Transition>

    <!-- Progress Demo (UX Variations) -->
    <Transition name="slide-right" mode="out-in">
      <ProgressDemo
        v-if="currentScreen === 'progress-demo'"
        @close="goHome"
      />
    </Transition>

    <!-- Bottom Navigation -->
    <BottomNav
      :currentScreen="currentScreen"
      :isLearning="isLearning"
      @navigate="handleNavigation"
      @startLearning="handleStartLearning"
    />

    <!-- Build Badge (dev/staging visibility) -->
    <BuildBadge v-if="!isLearning" />

    <!-- Clerk Auth Button -->
    <div v-if="clerkEnabled && !isLearning" class="user-button-container">
      <SignedIn>
        <UserButton
          :appearance="{
            elements: {
              avatarBox: 'w-10 h-10',
              userButtonTrigger: 'focus:shadow-none'
            }
          }"
        />
      </SignedIn>
      <SignedOut>
        <SignInButton mode="modal" class="sign-in-btn">
          Sign in
        </SignInButton>
      </SignedOut>
    </div>
  </div>
</template>

<style>
/* Global theme variables */
:root {
  /* Backgrounds - Dark mode */
  --bg-primary: #050508;
  --bg-secondary: #0a0a0f;
  --bg-card: rgba(255, 255, 255, 0.03);
  --bg-elevated: rgba(255, 255, 255, 0.06);
  --bg-overlay: rgba(0, 0, 0, 0.6);

  /* Text - Dark mode */
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-muted: rgba(255, 255, 255, 0.4);
  --text-inverse: #1a1a2e;

  /* Borders - Dark mode */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-medium: rgba(255, 255, 255, 0.1);

  /* Accent colors (same for both modes) */
  --accent: #c23a3a;
  --accent-light: #d44545;
  --accent-dark: #b83232;
  --accent-glow: rgba(194, 58, 58, 0.4);
  --gold: #d4a853;
  --gold-glow: rgba(212, 168, 83, 0.4);

  /* Gradients - Dark mode */
  --gradient-accent: linear-gradient(145deg, #d44545 0%, #b83232 100%);
  --glow-accent: 0 4px 16px rgba(194, 58, 58, 0.35);
  --glow-soft: rgba(100, 100, 150, 0.06);

  /* Network visualization - Dark mode */
  --network-bg: radial-gradient(ellipse at 50% 50%, rgba(80,80,100,0.05) 0%, transparent 50%);
  --node-grey: 60;

  /* Safe area for bottom nav */
  --nav-height: 80px;
  --nav-height-safe: calc(80px + env(safe-area-inset-bottom, 0px));
}

[data-theme="light"] {
  /* Backgrounds - Light mode (warm off-white, not harsh) */
  --bg-primary: #f5f5f3;
  --bg-secondary: #fafaf8;
  --bg-card: rgba(0, 0, 0, 0.025);
  --bg-elevated: rgba(0, 0, 0, 0.04);
  --bg-overlay: rgba(0, 0, 0, 0.4);

  /* Text - Light mode */
  --text-primary: #1a1a2e;
  --text-secondary: rgba(26, 26, 46, 0.7);
  --text-muted: rgba(26, 26, 46, 0.4);
  --text-inverse: #ffffff;

  /* Borders - Light mode */
  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-medium: rgba(0, 0, 0, 0.1);

  /* Accent adjustments for light mode (slightly darker for contrast) */
  --accent: #b83232;
  --accent-light: #c23a3a;
  --accent-dark: #a52929;
  --accent-glow: rgba(194, 58, 58, 0.2);
  --gold: #c49943;
  --gold-glow: rgba(196, 153, 67, 0.25);

  /* Gradients - Light mode */
  --gradient-accent: linear-gradient(145deg, #c23a3a 0%, #a52929 100%);
  --glow-accent: 0 4px 16px rgba(194, 58, 58, 0.2);
  --glow-soft: rgba(100, 100, 150, 0.08);

  /* Network visualization - Light mode */
  --network-bg: radial-gradient(ellipse at 50% 50%, rgba(100,100,120,0.06) 0%, transparent 50%);
  --node-grey: 180;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  /* Prevent overscroll bounce on iOS */
  overscroll-behavior: none;
}

/* PWA standalone mode adjustments */
@media (display-mode: standalone) {
  body {
    /* Prevent text selection on app-like interface */
    -webkit-user-select: none;
    user-select: none;
  }

  /* Allow text selection in specific areas */
  .text-zone, .known-text, .target-text {
    -webkit-user-select: text;
    user-select: text;
  }
}

button {
  font-family: inherit;
  -webkit-tap-highlight-color: transparent;
}

/* Smooth scrolling */
html {
  scroll-behavior: smooth;
}
</style>

<style scoped>
.app-container {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
}

/* Add bottom padding when nav is visible */
.app-container.has-nav {
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
  top: 1rem;
  right: 1rem;
  z-index: 100;
}

.sign-in-btn {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sign-in-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}
</style>
