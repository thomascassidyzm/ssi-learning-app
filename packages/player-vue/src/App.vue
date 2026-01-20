<script setup>
import { ref, provide, onMounted } from 'vue'
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured, isClerkConfigured } from './config/env'
import { useAuth } from './composables/useAuth'
import { checkKillSwitch } from './composables/useServiceWorkerSafety'
import { useTheme } from './composables/useTheme'
import PwaUpdatePrompt from './components/PwaUpdatePrompt.vue'

// Initialize theme (reads from localStorage, applies to document)
const { theme, toggleTheme, setTheme } = useTheme()

// Build version injected by Vite at build time
// @ts-ignore - __BUILD_NUMBER__ is defined by Vite
const BUILD_VERSION = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'

/**
 * Cache invalidation on deploy
 * Clears stale script caches when a new build is deployed
 */
const invalidateStaleCaches = () => {
  const CACHE_VERSION_KEY = 'ssi-build-version'

  const storedVersion = localStorage.getItem(CACHE_VERSION_KEY)

  if (storedVersion !== BUILD_VERSION) {
    console.log(`[App] Build changed: ${storedVersion} → ${BUILD_VERSION}, clearing caches`)

    // Collect all keys to remove first (can't modify during iteration)
    const keysToRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue

      // Clear script caches
      if (key.startsWith('ssi-script-')) {
        keysToRemove.push(key)
      }
      // Clear position caches (LearningPlayer)
      if (key.startsWith('ssi_learning_position_')) {
        keysToRemove.push(key)
      }
      // Clear position caches (CourseExplorer)
      if (key.startsWith('ssi_explorer_position_')) {
        keysToRemove.push(key)
      }
      // Clear stale belt version key (we use BUILD_VERSION now)
      if (key === 'ssi_app_version') {
        keysToRemove.push(key)
      }
    }

    // Now remove them
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // Store new version
    localStorage.setItem(CACHE_VERSION_KEY, BUILD_VERSION)
    console.log(`[App] Cleared ${keysToRemove.length} cached items (scripts, positions)`)
  } else {
    console.log(`[App] Build ${BUILD_VERSION} - caches valid`)
  }
}

// Load configuration
const config = loadConfig()
const clerkEnabled = isClerkConfigured(config)

// Auth state (only if Clerk is configured)
const auth = clerkEnabled ? useAuth() : null

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
      // courses table now uses 'course_code' directly (renamed from 'code' 2026-01-18)
      enrolledCourses.value = data

      // Check for course from URL query parameter (e.g., ?course=spa_for_eng)
      let urlCourseCode = null
      try {
        const urlParams = new URLSearchParams(window.location.search)
        urlCourseCode = urlParams.get('course')
        if (urlCourseCode) {
          console.log('[App] Course from URL param:', urlCourseCode)
        }
      } catch (e) {
        console.warn('[App] Failed to read URL params:', e)
      }

      // Check for saved course preference
      let savedCourseCode = null
      try {
        savedCourseCode = localStorage.getItem(LAST_COURSE_KEY)
      } catch (e) {
        console.warn('[App] Failed to read saved course:', e)
      }

      // Priority: 1) URL param, 2) localStorage, 3) first available
      let defaultCourse = null

      // First try URL param
      if (urlCourseCode) {
        defaultCourse = data.find(c => c.course_code === urlCourseCode)
        if (defaultCourse) {
          console.log('[App] Using course from URL:', urlCourseCode)
          // Also save to localStorage for future visits
          try {
            localStorage.setItem(LAST_COURSE_KEY, urlCourseCode)
          } catch (e) {
            console.warn('[App] Failed to save course to localStorage:', e)
          }
        } else {
          console.log('[App] Course from URL not found:', urlCourseCode, '- trying localStorage')
        }
      }

      // Then try localStorage
      if (!defaultCourse && savedCourseCode) {
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
        // Remember this course for next visit
        try {
          localStorage.setItem(LAST_COURSE_KEY, defaultCourse.course_code)
        } catch (e) {
          // Ignore localStorage errors
        }
        console.log('[App] Active course set:', defaultCourse.course_code)
      }
    }
  } catch (err) {
    console.error('[App] Error fetching enrolled courses:', err)
  }
}

// Provide stores and state to child components
provide('progressStore', progressStore)
provide('sessionStore', sessionStore)
provide('courseDataProvider', courseDataProvider)
provide('auth', auth)
provide('supabase', supabaseClient)
provide('config', config)
provide('clerkEnabled', clerkEnabled)
provide('activeCourse', activeCourse)
provide('enrolledCourses', enrolledCourses)
provide('handleCourseSelect', handleCourseSelect)
provide('theme', { theme, toggleTheme, setTheme })

onMounted(async () => {
  // Clear stale caches on new deploy
  invalidateStaleCaches()

  // Check service worker kill switch (for emergency recovery)
  // If kill switch is active, this will unregister SW and reload
  checkKillSwitch().catch(err => {
    console.warn('[App] Kill switch check failed (non-fatal):', err)
  })

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
  <div class="app-root">
    <router-view />
    <PwaUpdatePrompt />
  </div>
</template>

<style>
/* Global theme variables */
:root {
  /* Backgrounds - Dark mode (Cosmos - default) */
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

  /* Accent colors (same for both themes) */
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
  --network-node-fill: rgba(255, 255, 255, 0.6);
  --network-node-stroke: rgba(255, 255, 255, 0.3);
  --network-edge-stroke: rgba(255, 255, 255, 0.1);
  --network-active-edge: #60a5fa;
  --network-label-fill: rgba(255, 255, 255, 0.8);

  /* Safe area for bottom nav */
  --nav-height: 80px;
  --nav-height-safe: calc(80px + env(safe-area-inset-bottom, 0px));

  /* Mountain opacity for schools */
  --mountain-opacity: 0.5;

  /* Theme indicator */
  --theme-mode: dark;
}

/* ═══════════════════════════════════════════════════════════════
   MIST THEME - Soft slate/twilight dark mode
   Warmer, softer than cosmos - good for low brightness viewing
   Still dark with light text, just not as deep black
   ═══════════════════════════════════════════════════════════════ */
[data-theme="mist"] {
  /* Backgrounds - Warm slate grey (not black, not light) */
  --bg-primary: #1c1c24;
  --bg-secondary: #242430;
  --bg-card: rgba(255, 255, 255, 0.04);
  --bg-elevated: rgba(255, 255, 255, 0.07);
  --bg-overlay: rgba(0, 0, 0, 0.5);

  /* Text - Light on dark (same as cosmos, good contrast) */
  --text-primary: #f0f0f5;
  --text-secondary: rgba(240, 240, 245, 0.7);
  --text-muted: rgba(240, 240, 245, 0.4);
  --text-inverse: #1c1c24;

  /* Borders - Subtle light */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-medium: rgba(255, 255, 255, 0.12);

  /* Accent colors - slightly warmer red */
  --accent: #d04040;
  --accent-light: #e04848;
  --accent-dark: #c03838;
  --accent-glow: rgba(208, 64, 64, 0.35);
  --gold: #e0b058;
  --gold-glow: rgba(224, 176, 88, 0.35);

  /* Gradients - Mist mode */
  --gradient-accent: linear-gradient(145deg, #e04848 0%, #c03838 100%);
  --glow-accent: 0 4px 16px rgba(208, 64, 64, 0.3);
  --glow-soft: rgba(120, 120, 160, 0.08);

  /* Network visualization - Light on dark (like cosmos) */
  --network-bg: radial-gradient(ellipse at 50% 50%, rgba(100, 100, 140, 0.06) 0%, transparent 50%);
  --network-node-fill: rgba(255, 255, 255, 0.55);
  --network-node-stroke: rgba(255, 255, 255, 0.28);
  --network-edge-stroke: rgba(255, 255, 255, 0.1);
  --network-active-edge: #60a5fa;
  --network-label-fill: rgba(255, 255, 255, 0.75);

  /* Mountain opacity for schools */
  --mountain-opacity: 0.4;

  /* Theme indicator */
  --theme-mode: dark;
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
.app-root {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
}
</style>
