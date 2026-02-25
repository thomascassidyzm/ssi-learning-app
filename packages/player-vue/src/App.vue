<script setup>
import { ref, provide, onMounted } from 'vue'
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured, isClerkConfigured } from './config/env'
import { useAuth } from './composables/useAuth'
import { checkKillSwitch, unregisterAllServiceWorkers, clearAllCaches } from './composables/useServiceWorkerSafety'
import { useTheme } from './composables/useTheme'
import { useEagerScriptPreload } from './composables/useEagerScriptPreload'
import { useInviteCode } from './composables/useInviteCode'
import PwaUpdatePrompt from './components/PwaUpdatePrompt.vue'

// RECOVERY MODE: If ?reset=1 in URL, clear everything and reload
// This helps users stuck in broken states
if (window.location.search.includes('reset=1')) {
  console.log('[App] Recovery mode - clearing all data...')

  // Clear localStorage
  localStorage.clear()

  // Clear sessionStorage
  sessionStorage.clear()

  // Clear IndexedDB (async but don't wait)
  if (window.indexedDB) {
    indexedDB.databases?.().then(dbs => {
      dbs.forEach(db => {
        if (db.name) indexedDB.deleteDatabase(db.name)
      })
    }).catch(() => {})
  }

  // Unregister service workers and clear caches
  Promise.all([
    unregisterAllServiceWorkers().catch(() => {}),
    clearAllCaches().catch(() => {})
  ]).finally(() => {
    // Reload without the reset param
    const url = new URL(window.location.href)
    url.searchParams.delete('reset')
    window.location.href = url.toString()
  })
}

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
    console.log(`[App] Build ${storedVersion} → ${BUILD_VERSION}, cleared ${keysToRemove.length} cached items`)
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

// Eager script preload - fires as soon as course is known
const eagerScript = useEagerScriptPreload()

// Invite code composable (singleton)
const inviteCode = useInviteCode()

// Active course and enrolled courses state
const activeCourse = ref(null)
const enrolledCourses = ref([])

// Course persistence key
const LAST_COURSE_KEY = 'ssi-last-course'

// Handle course selection from CourseSelector
const handleCourseSelect = async (course) => {
  const courseCode = course.course_code || course.id

  // IMPORTANT: Update courseDataProvider BEFORE activeCourse
  // This ensures LearningPlayer has the correct provider when it remounts
  // (activeCourse change triggers :key change which remounts the player)
  if (supabaseClient.value) {
    courseDataProvider.value = createCourseDataProvider({
      supabaseClient: supabaseClient.value,
      audioBaseUrl: config.s3.audioBaseUrl,
      courseId: courseCode,
    })
  }

  // Fire eager script preload for new course
  if (supabaseClient.value) {
    eagerScript.preload(supabaseClient.value, courseCode)
  }

  // NOW update activeCourse (triggers LearningPlayer remount via :key)
  activeCourse.value = course

  // Persist course selection
  try {
    localStorage.setItem(LAST_COURSE_KEY, courseCode)
  } catch (e) {
    console.warn('[App] Failed to persist course selection:', e)
  }
}

// Fetch enrolled courses from Supabase
const fetchEnrolledCourses = async () => {
  if (!supabaseClient.value) {
    return
  }

  try {
    // Get courses available for this app (live or beta)
    // Status options: draft (hidden), beta (visible with badge), live (fully visible)
    const { data, error } = await supabaseClient.value
      .from('courses')
      .select('*')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')

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
        // urlCourseCode read from URL params
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
          try {
            localStorage.setItem(LAST_COURSE_KEY, urlCourseCode)
          } catch (e) {
            // ignore
          }
        }
      }

      // Then try localStorage
      if (!defaultCourse && savedCourseCode) {
        defaultCourse = data.find(c => c.course_code === savedCourseCode)
      }
      if (!defaultCourse) {
        defaultCourse = data[0]
      }

      if (defaultCourse && !activeCourse.value) {
        activeCourse.value = {
          ...defaultCourse,
          completedRounds: 0,
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
        console.log('[App] Course:', defaultCourse.course_code)

        // Fire eager script preload immediately (fire-and-forget)
        eagerScript.preload(supabaseClient.value, defaultCourse.course_code)
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
provide('eagerScript', eagerScript)
provide('inviteCode', inviteCode)

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
      }

      // Handle ?code= URL parameter for invite codes
      try {
        const urlParams = new URLSearchParams(window.location.search)
        const codeParam = urlParams.get('code')
        if (codeParam) {
          // Clean code from URL immediately
          const cleanUrl = new URL(window.location.href)
          cleanUrl.searchParams.delete('code')
          history.replaceState(null, '', cleanUrl.toString())

          // Validate the code
          await inviteCode.validateCode(codeParam)
          // The SignUpModal will pick up pendingCode from the composable
          // and show the context step when opened
        }
      } catch (err) {
        console.warn('[App] Failed to process invite code from URL:', err)
      }

      // Fetch enrolled courses
      await fetchEnrolledCourses()
    } catch (err) {
      console.error('[App] Failed to initialize Supabase:', err)
    }
  } else {
    // Running in demo mode (database not configured or disabled)
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
/*
 * All design tokens now live in styles/design-tokens.css.
 * This block is intentionally empty — base styles are in style.css,
 * global utilities in styles/global.css.
 */
</style>

<style scoped>
.app-root {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
  position: relative;
}

/* Mist theme: subtle layered mountain silhouettes at the bottom */
:global([data-theme="mist"]) .app-root::after {
  content: '';
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 45vh;
  pointer-events: none;
  z-index: 0;
  opacity: var(--mountain-opacity, 0.45);
  background:
    /* Foreground ridge — darkest, closest */
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 200' preserveAspectRatio='none'%3E%3Cpath d='M0 200 L0 140 Q60 95 120 110 Q200 80 280 100 Q360 60 440 85 Q520 55 600 75 Q680 45 760 70 Q840 50 920 65 Q1000 40 1080 60 Q1160 45 1240 70 Q1320 55 1400 80 L1440 75 L1440 200Z' fill='%23978E84'/%3E%3C/svg%3E") no-repeat bottom / 100% 55%,
    /* Mid-ground ridge — lighter, further */
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 200' preserveAspectRatio='none'%3E%3Cpath d='M0 200 L0 120 Q80 70 160 95 Q280 40 400 70 Q500 30 600 55 Q720 20 840 50 Q960 25 1080 45 Q1200 30 1320 55 L1440 45 L1440 200Z' fill='%23B5ADA5'/%3E%3C/svg%3E") no-repeat bottom / 100% 70%,
    /* Background ridge — lightest, most distant, misty */
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 200' preserveAspectRatio='none'%3E%3Cpath d='M0 200 L0 100 Q100 50 200 75 Q350 15 500 45 Q650 5 800 35 Q950 10 1100 30 Q1250 15 1380 40 L1440 30 L1440 200Z' fill='%23C8C1B9'/%3E%3C/svg%3E") no-repeat bottom / 100% 85%;
}

/* Ensure main content sits above the mountains */
:global([data-theme="mist"]) .app-root > :deep(*) {
  position: relative;
  z-index: 1;
}
</style>
