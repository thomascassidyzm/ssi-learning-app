<script setup>
import { ref, provide, onMounted } from 'vue'
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured } from './config/env'
import { useAuth } from './composables/useAuth'
import { checkKillSwitch, unregisterAllServiceWorkers, clearAllCaches } from './composables/useServiceWorkerSafety'
import { useTheme } from './composables/useTheme'
import { useEagerScriptPreload } from './composables/useEagerScriptPreload'
import { useInviteCode } from './composables/useInviteCode'
import { useAuthModal } from './composables/useAuthModal'
import { useSharedUserEntitlements } from './composables/useUserEntitlements'
import { useSharedSubscription } from './composables/useSubscription'
import { checkCourseAccess, inferPricingTier } from '@ssi/core'
import { useUserRole } from './composables/useUserRole'
import { installConsoleDedup } from './utils/consoleDedup'
import PwaUpdatePrompt from './components/PwaUpdatePrompt.vue'
import InstallBanner from './components/InstallBanner.vue'
import DemoOverlay from './components/demo/DemoOverlay.vue'
import TesterFeedback from './components/TesterFeedback.vue'
import GodModePanel from './components/schools/GodModePanel.vue'
import { setSchoolsClient } from './composables/schools/client'

// Suppress consecutive identical console errors/warnings after 3 repeats
installConsoleDedup()

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

// DEMO CLEANUP: Remove stale demo state from localStorage
// This catches cases where someone visited /demo, started a demo,
// then closed the tab without stopping it properly
if (localStorage.getItem('ssi-dev-tier') === 'paid' && !sessionStorage.getItem('ssi-demo-active')) {
  console.log('[App] Cleaning up stale demo state from localStorage')
  localStorage.removeItem('ssi-dev-tier')
  localStorage.removeItem('ssi-active-class')
  // Don't remove ssi-last-course — user might have set that themselves
  // Don't remove ssi-god-mode-user — that's used outside demo too
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

    // Clear ALL Cache API caches (SW runtime caches: audio, fonts)
    // This ensures stale 404s or wrong audio never persist across deploys
    if ('caches' in window) {
      caches.keys().then(names => {
        const cleared = names.filter(n => n !== 'workbox-precache-v2') // keep precache, workbox manages it
        cleared.forEach(name => caches.delete(name))
        if (cleared.length > 0) {
          console.log(`[App] Cleared ${cleared.length} runtime caches:`, cleared)
        }
      }).catch(() => {})
    }

    // Store new version
    localStorage.setItem(CACHE_VERSION_KEY, BUILD_VERSION)
    console.log(`[App] Build ${storedVersion} → ${BUILD_VERSION}, cleared ${keysToRemove.length} cached items`)
  }
}

// Load configuration
const config = loadConfig()

// Auth state
const auth = useAuth()

// Initialize stores (null if database not configured)
const progressStore = ref(null)
const sessionStore = ref(null)
const courseDataProvider = ref(null)
const supabaseClient = ref(null)

// Create Supabase client synchronously (before children mount) so globally-
// mounted components like <GodModePanel> can read the schools-client bridge
// during their own onMounted. Deferring this to App.vue's onMounted meant
// the child's onMounted (which fires first in Vue 3) saw a missing client,
// getSchoolsClient() threw, the error was swallowed, and GOD mode never
// surfaced on non-/schools routes.
if (config.features.useDatabase && isSupabaseConfigured(config)) {
  try {
    supabaseClient.value = createClient(
      config.supabase.url,
      config.supabase.anonKey,
      { auth: { persistSession: true, autoRefreshToken: true } }
    )
    setSchoolsClient(supabaseClient.value)
  } catch (err) {
    console.error('[App] Failed to initialize Supabase client synchronously:', err)
  }
}

// Eager script preload - fires as soon as course is known
const eagerScript = useEagerScriptPreload()

// Invite code composable (singleton)
const inviteCode = useInviteCode()

// Capture beforeinstallprompt for PWA install guide
const installPrompt = ref(null)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  installPrompt.value = e
})

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

  // Fire eager script preload for new course (skip if already cached)
  if (supabaseClient.value && eagerScript.courseCode.value !== courseCode) {
    eagerScript.preload(supabaseClient.value, courseCode)
  }

  // NOW update activeCourse (triggers LearningPlayer remount via :key)
  activeCourse.value = course

  // Persist course selection (localStorage + DB)
  try {
    localStorage.setItem(LAST_COURSE_KEY, courseCode)
  } catch (e) {
    console.warn('[App] Failed to persist course selection:', e)
  }
  // Save to DB for cross-device persistence (fire-and-forget)
  if (supabaseClient.value && auth.learner.value?.id) {
    supabaseClient.value
      .from('learners')
      .update({ preferences: { ...auth.learner.value.preferences, last_course_code: courseCode } })
      .eq('id', auth.learner.value.id)
      .then(({ error }) => {
        if (error) console.warn('[App] Failed to save last course to DB:', error.message)
      })
  }
}

// Check if user can access a course (mirrors CourseSelector logic)
const canAccessCourse = (course) => {
  const { entitlements } = useSharedUserEntitlements()
  const { isSubscribed } = useSharedSubscription()
  const { platformRole } = useUserRole()
  const pricingTier = course.pricing_tier ?? inferPricingTier(course.target_lang ?? '', course.course_code)
  const isCommunity = course.is_community ?? course.course_code?.startsWith('community_')
  const devPaid = (() => {
    try {
      if (sessionStorage.getItem('ssi-demo-tier') === 'paid') return true
      const tier = localStorage.getItem('ssi-dev-tier')
      if (tier === 'paid') return true
      return localStorage.getItem('ssi-dev-paid-user') === 'true'
    } catch { return false }
  })()
  const subscription = {
    isActive: isSubscribed.value || devPaid,
    tier: (isSubscribed.value || devPaid) ? 'paid' : 'free',
  }
  const result = checkCourseAccess(
    { course_code: course.course_code, pricing_tier: pricingTier, is_community: isCommunity },
    subscription,
    entitlements.value,
    platformRole.value
  )
  return result.canAccess
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

      // Check for saved course preference: DB (cross-device) then localStorage (fallback)
      let savedCourseCode = auth.learner.value?.preferences?.last_course_code || null
      if (!savedCourseCode) {
        try {
          // Check demo session first, then persistent localStorage
          savedCourseCode = sessionStorage.getItem('ssi-demo-last-course') || localStorage.getItem(LAST_COURSE_KEY)
        } catch (e) {
          console.warn('[App] Failed to read saved course:', e)
        }
      }

      // Priority: 1) URL param, 2) DB/localStorage, 3) first available
      let defaultCourse = null

      // First try URL param (explicit intent — let paywall handle access)
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

      // Then try localStorage (but only if user can access it)
      if (!defaultCourse && savedCourseCode) {
        const saved = data.find(c => c.course_code === savedCourseCode)
        if (saved && canAccessCourse(saved)) {
          defaultCourse = saved
        }
      }
      // Fall back to first accessible course
      if (!defaultCourse) {
        defaultCourse = data.find(c => canAccessCourse(c)) || data[0]
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
provide('activeCourse', activeCourse)
provide('enrolledCourses', enrolledCourses)
provide('handleCourseSelect', handleCourseSelect)
provide('theme', { theme, toggleTheme, setTheme })
provide('eagerScript', eagerScript)
provide('inviteCode', inviteCode)
provide('installPrompt', installPrompt)
provide('fetchEnrolledCourses', fetchEnrolledCourses)

onMounted(async () => {
  // Clear stale caches on new deploy
  invalidateStaleCaches()

  // Check service worker kill switch (for emergency recovery)
  // If kill switch is active, this will unregister SW and reload
  checkKillSwitch().catch(err => {
    console.warn('[App] Kill switch check failed (non-fatal):', err)
  })

  // Supabase client was created synchronously above. Finish the async parts
  // (stores + auth init) now that mount is complete.
  if (supabaseClient.value) {
    try {
      progressStore.value = createProgressStore({ client: supabaseClient.value })
      sessionStore.value = createSessionStore({ client: supabaseClient.value })

      // Initialize auth with Supabase client (for learner management)
      if (auth) {
        await auth.initialize(supabaseClient.value)
      }

      // Initialize entitlements + subscription (now that supabase + auth are ready)
      // Await so course access checks have data before fetchEnrolledCourses picks a default
      const { initialize: initEntitlements } = useSharedUserEntitlements()
      const { initialize: initSubscription } = useSharedSubscription()
      await Promise.all([initEntitlements(), initSubscription()]).catch(() => {})

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
          const valid = await inviteCode.validateCode(codeParam)
          if (valid) {
            // If entitlement code grants specific courses, inject as ?course= so fetchEnrolledCourses selects it
            const granted = inviteCode.pendingCode.value?.grantedCourses
            if (granted?.length) {
              const url = new URL(window.location.href)
              if (!url.searchParams.has('course')) {
                url.searchParams.set('course', granted[0])
                history.replaceState(null, '', url.toString())
              }
            }
            if (auth.learner.value) {
              // Already signed in — redeem immediately
              try {
                const { data: { session } } = await supabaseClient.value.auth.getSession()
                if (session?.access_token) {
                  const result = await inviteCode.redeemCode(session.access_token)
                  if (result.success) {
                    const { refresh } = useSharedUserEntitlements()
                    await refresh()
                  }
                }
              } catch (e) {
                console.warn('[App] Auto-redeem failed:', e)
              }
            } else {
              // Not signed in — open auth modal
              useAuthModal().open()
            }
          }
        }
      } catch (err) {
        console.warn('[App] Failed to process invite code from URL:', err)
      }

      // If there's a pending code from sessionStorage (e.g. from /redeem/:code flow)
      // and user isn't signed in, open auth modal so they can complete sign-up + redeem
      if (!auth.learner.value && inviteCode.pendingCode.value) {
        useAuthModal().open()
      }

      // Fetch enrolled courses
      await fetchEnrolledCourses()
    } catch (err) {
      console.error('[App] Failed to initialize Supabase:', err)
    }
  } else {
    // Running in demo mode (database not configured or disabled)
  }

  // Listen for demo course selection (bypasses normal enrolled course lookup)
  window.addEventListener('demo:selectCourse', (e) => {
    const detail = e.detail
    if (detail?.course_code) {
      console.log('[App] Demo course switch:', detail.course_code)
      handleCourseSelect(detail)
    }
  })

})
</script>

<template>
  <div class="app-root">
    <router-view />
    <PwaUpdatePrompt />
    <InstallBanner />
    <DemoOverlay />
    <TesterFeedback />
    <GodModePanel />
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
}
</style>
