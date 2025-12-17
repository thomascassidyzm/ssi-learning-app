<script setup>
import { ref, provide, onMounted, computed } from 'vue'
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured } from './config/env'

// Screen components
import HomeScreen from './components/HomeScreen.vue'
import LearningPlayer from './components/LearningPlayer.vue'
import JourneyMap from './components/JourneyMap.vue'
import ProfileScreen from './components/ProfileScreen.vue'
import SettingsScreen from './components/SettingsScreen.vue'
import BottomNav from './components/BottomNav.vue'

// Load configuration
const config = loadConfig()

// Navigation state
// Screens: 'home' | 'player' | 'journey' | 'profile' | 'settings'
const currentScreen = ref('home')
const selectedCourse = ref(null)
const isLearning = ref(false)

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

// Handle nav events
const handleNavigation = (screen) => {
  navigate(screen)
}

const handleStartLearning = () => {
  startLearning(selectedCourse.value)
}

// Learner data (would come from database in production)
const learnerStats = ref({
  completedSeeds: 42,
  totalSeeds: 668,
  currentStreak: 7,
  learningVelocity: 1.2,
})

// Initialize stores (null if database not configured)
const progressStore = ref(null)
const sessionStore = ref(null)
const courseDataProvider = ref(null)

onMounted(() => {
  // Only initialize Supabase if configured and feature flag is enabled
  if (config.features.useDatabase && isSupabaseConfigured(config)) {
    try {
      console.log('[App] Initializing Supabase client...')
      const supabaseClient = createClient(
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
      progressStore.value = createProgressStore({ client: supabaseClient })
      sessionStore.value = createSessionStore({ client: supabaseClient })
      courseDataProvider.value = createCourseDataProvider({
        supabaseClient,
        audioBaseUrl: config.s3.audioBaseUrl,
        courseId: 'spa_for_eng_v2',
      })

      console.log('[App] Database stores initialized')
    } catch (err) {
      console.error('[App] Failed to initialize Supabase:', err)
    }
  } else {
    console.log('[App] Running in demo mode (database not configured or disabled)')
  }

  // Provide stores to child components (will be null in demo mode)
  provide('progressStore', progressStore)
  provide('sessionStore', sessionStore)
  provide('courseDataProvider', courseDataProvider)
})
</script>

<template>
  <div class="app-container" :class="{ 'has-nav': !isLearning }">
    <!-- Home Screen -->
    <Transition name="fade" mode="out-in">
      <HomeScreen
        v-if="currentScreen === 'home'"
        @startLearning="startLearning"
        @viewJourney="viewJourney"
        @openProfile="openProfile"
        @openSettings="openSettings"
      />
    </Transition>

    <!-- Learning Player -->
    <Transition name="slide-up" mode="out-in">
      <LearningPlayer
        v-if="currentScreen === 'player'"
        @close="goHome"
      />
    </Transition>

    <!-- Journey Map -->
    <Transition name="slide-up" mode="out-in">
      <JourneyMap
        v-if="currentScreen === 'journey'"
        :completedSeeds="learnerStats.completedSeeds"
        :totalSeeds="learnerStats.totalSeeds"
        :currentStreak="learnerStats.currentStreak"
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
        @close="goHome"
      />
    </Transition>

    <!-- Bottom Navigation -->
    <BottomNav
      :currentScreen="currentScreen"
      :isLearning="isLearning"
      :streak="learnerStats.currentStreak"
      @navigate="handleNavigation"
      @startLearning="handleStartLearning"
    />
  </div>
</template>

<style>
/* Global theme variables */
:root {
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-card: rgba(255, 255, 255, 0.03);
  --bg-elevated: rgba(255, 255, 255, 0.06);
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.7);
  --text-muted: rgba(255, 255, 255, 0.4);
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-medium: rgba(255, 255, 255, 0.1);

  /* Safe area for bottom nav */
  --nav-height: 80px;
  --nav-height-safe: calc(80px + env(safe-area-inset-bottom, 0px));
}

[data-theme="light"] {
  --bg-primary: #f8f9fa;
  --bg-secondary: #ffffff;
  --bg-card: rgba(0, 0, 0, 0.02);
  --bg-elevated: rgba(0, 0, 0, 0.04);
  --text-primary: #1a1a2e;
  --text-secondary: rgba(26, 26, 46, 0.7);
  --text-muted: rgba(26, 26, 46, 0.4);
  --border-subtle: rgba(0, 0, 0, 0.05);
  --border-medium: rgba(0, 0, 0, 0.1);
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
</style>
