<script setup>
import { ref, provide, onMounted, defineAsyncComponent, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createClient } from '@supabase/supabase-js'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured } from './config/env'
import { useAuth } from './composables/useAuth'
import { prewarmInstantCaches, setInstantPlaybackAuthProvider } from './composables/useInstantPlayback'
import { checkKillSwitch, unregisterAllServiceWorkers, clearAllCaches, killSwitchMessage } from './composables/useServiceWorkerSafety'
import { useTheme } from './composables/useTheme'
import { useEagerScriptPreload } from './composables/useEagerScriptPreload'
import { checkContentVersion } from './composables/useScriptCache'
import { useInviteCode } from './composables/useInviteCode'
import { useAccessClaim } from './composables/useAccessClaim'
import { useAuthModal } from './composables/useAuthModal'
import { useSharedUserEntitlements } from './composables/useUserEntitlements'
import { hasTryEntitlement } from './composables/useEntitlement'
import { useSharedSubscription } from './composables/useSubscription'
import { useOfflineLease } from './composables/useOfflineLease'
import { checkCourseAccess, inferPricingTier } from '@ssi/core'
import { useUserRole } from './composables/useUserRole'
import { installConsoleDedup } from './utils/consoleDedup'
// Async-load the 4 always-mounted overlay components — none of them
// render anything visible until some internal condition triggers
// (PWA update available, install prompt eligible, admin flag), so
// they don't belong on the first-paint critical path.
const PwaUpdatePrompt = defineAsyncComponent(() => import('./components/PwaUpdatePrompt.vue'))
const InstallBanner = defineAsyncComponent(() => import('./components/InstallBanner.vue'))
const TesterFeedback = defineAsyncComponent(() => import('./components/TesterFeedback.vue'))
// Walkthrough overlay — renders nothing until a walk is started by a user tap
// (noticing invitation / How-this-works "Show me"); never auto-plays.
const WalkOverlay = defineAsyncComponent(() => import('./components/admin/WalkOverlay.vue'))
import { setSchoolsClient } from './composables/schools/client'
import AppEscape from './components/AppEscape.vue'
import CheckoutOverlay from './components/CheckoutOverlay.vue'

// Suppress consecutive identical console errors/warnings after 3 repeats
installConsoleDedup()

// "No dead ends": show the shell-level escape on any route that doesn't carry
// its own way out. The immersive player and the shelled containers (schools /
// teach / admin) opt out via meta.hideAppEscape; everything else (bare
// top-level pages like onboarding, /with/:code, /teacher-insights) gets it.
// Critical in the installed PWA, which has no browser back button.
const route = useRoute()
const router = useRouter()
const showAppEscape = computed(() => !route.matched.some((r) => r.meta?.hideAppEscape))

// RedeemCode.vue (mounted at /redeem and /group) owns the pendingCode it
// creates and drives its own inline auth/details UI — the global sign-in
// modal must stay closed while either is active (see onMounted below).
const isRedeemFlowRoute = computed(() => route.name === 'redeem-code' || route.name === 'group-landing')

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
  // Don't remove ssi-last-course — user might have set that themselves.
}

// Wipe dead god-mode storage keys — impersonation was removed from the
// app. These only exist on browsers that ran a prior version; safe to
// drop unconditionally every boot until enough users have rotated.
localStorage.removeItem('ssi-god-mode-user')
sessionStorage.removeItem('ssi-god-mode-user')
localStorage.removeItem('ssi-god-fab-pos')

// One-shot flag SettingsScreen.vue sets immediately before a reset/
// recover reload, to stop LearningPlayer's pagehide dormancy flush from
// re-saving the pre-reset position during that reload. sessionStorage
// survives the reload itself (same tab), so it must be cleared here, at
// the start of the FRESH boot, or it would silently suspend every
// position save for the rest of the session.
sessionStorage.removeItem('ssi-position-writes-suspended')

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
      // Position caches (ssi_learning_position_*, ssi_explorer_position_*)
      // are deliberately NOT cleared here — they're stored as absolute
      // ids precisely so they survive a deploy/script regeneration (see
      // savePositionToLocalStorage's comment), and wiping them on every
      // build silently restarted every guest at round 1 (guests have no
      // server row to fall back to). Position authority ruling
      // (docs/pwa-lifecycle-design.md §2.3) — only learner intent
      // (reset, sign-out) may clear a position key.
      // Clear stale belt version key (we use BUILD_VERSION now)
      if (key === 'ssi_app_version') {
        keysToRemove.push(key)
      }
    }

    // Now remove them
    keysToRemove.forEach(key => localStorage.removeItem(key))

    // Clear SW runtime caches on deploy — but PRESERVE ssi-audio-cache.
    //
    // 2026-05-23: audio cache wipe-on-deploy was hammering learners on
    // slow networks. Every deploy → audio cache nuked → every <audio>
    // play = network round-trip via SW CacheFirst miss. Tom's stress
    // test showed 57,859 requests / 589 MB transferred over 4 min on
    // Slow 4G after a single "Update" tap.
    //
    // Why the wipe was wrong:
    //  - Audio UUIDs are content-addressed (UUID = hash of text+role),
    //    so "wrong audio under same UUID" can't happen
    //  - Workbox config has cacheableResponse:{statuses:[200]} so 404s
    //    are never cached in the first place
    //  - When audio IS regenerated (rare), `checkContentVersion()` in
    //    useScriptCache fires `caches.delete(AUDIO_CACHE_NAME)` for
    //    just that course's transition — the right scoped trigger
    //
    // Navigation/font caches still get wiped — those benefit from a
    // fresh fetch on deploy and are tiny.
    if ('caches' in window) {
      // ssi-auth-handoff carries the session across the iOS Safari → Home
      // Screen PWA boundary (see utils/authHandoff.ts) — wiping it on
      // deploy would silently break the install sign-in carry-over.
      const PRESERVE = new Set(['workbox-precache-v2', 'ssi-audio-cache', 'ssi-auth-handoff'])
      caches.keys().then(names => {
        const cleared = names.filter(n => !PRESERVE.has(n))
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
    // Feed the caller's Supabase access token to the instant-playback fast-path
    // fetches (round-map / cycles / infplay-cycles). These endpoints are
    // entitlement-gated server-side (d4396730): without a token, a signed-in
    // paid learner past the free-preview window (seed <=19) is treated as
    // anonymous and 403'd onto the slow legacy walk. getSession() is a local
    // read (no network), so resolving it per fetch is cheap.
    setInstantPlaybackAuthProvider(async () => {
      const client = supabaseClient.value
      if (!client) return null
      try {
        const { data } = await client.auth.getSession()
        return data.session?.access_token ?? null
      } catch {
        return null
      }
    })
  } catch (err) {
    console.error('[App] Failed to initialize Supabase client synchronously:', err)
  }
}

// Eager script preload — provided for consumers that trigger their own walk
// (DemoLauncher) and for LearningPlayer's fallback paths. App.vue itself no
// longer fires it: on the instant-playback path the ONE full course-wide walk
// is LearningPlayer's deferred handoff (which threads the live algorithm
// config — pod pin, L1 fire counts, script shape — that this preload's
// default-config walk never had). Firing it here too just ran the same
// six course-wide queries again, starving the bootstrap that actually
// gets audio playing.
const eagerScript = useEagerScriptPreload()

// The one piece of the old preload that WAS load-bearing at course open:
// checkContentVersion clears the warm-start script cache when the course's
// content_version bumps, and LearningPlayer's cache fast-path assumes that
// check has run BEFORE it mounts (a cache hit means current content). It's a
// single tiny query — run it immediately, not on idle, so the ordering holds.
const checkCourseContentVersion = (client, code) => {
  void checkContentVersion(client, code).catch(() => {}) // offline is fine
}

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
// Per-learner enrollment rows (course_enrollments) keyed by course_code.
// This is the real per-learner progress source — distinct from
// `enrolledCourses` above, which is actually the course catalogue (the
// name is historical).
const learnerEnrollments = ref(new Map())

const fetchLearnerEnrollments = async () => {
  if (!supabaseClient.value || !auth.learner.value?.id) {
    learnerEnrollments.value = new Map()
    return
  }
  try {
    const { data, error } = await supabaseClient.value
      .from('course_enrollments')
      .select('course_id, last_completed_lego_id, last_practiced_at, total_practice_minutes, current_cycle_index')
      .eq('learner_id', auth.learner.value.id)
    if (error) {
      console.warn('[App] fetchLearnerEnrollments failed:', error.message)
      return
    }
    const m = new Map()
    for (const r of data || []) m.set(r.course_id, r)
    learnerEnrollments.value = m
  } catch (err) {
    console.warn('[App] fetchLearnerEnrollments failed:', err)
  }
}

watch(() => auth.learner.value?.id, fetchLearnerEnrollments, { immediate: true })
// True only when both URL and stored preference were absent — drives the
// auto-open of the Choose Course modal on first run.
const noPriorCourseSelection = ref(false)

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

  // Keep the warm-start cache honest for the new course (clears it on a
  // content_version bump). The full walk itself is LearningPlayer's deferred
  // handoff — not fired from here.
  if (supabaseClient.value) {
    checkCourseContentVersion(supabaseClient.value, courseCode)
  }

  // Warm the instant-playback caches (round-map + first-round cycles) BEFORE the
  // remount, so the new course's bootstrap is a cache hit instead of two cold
  // serial round-trips — the bulk of the ~1.7s course-switch cost. Fire-and-forget.
  void prewarmInstantCaches(courseCode)

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
  const devPaid = hasTryEntitlement()
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
  // Premium courses are enterable/defaultable on preview — everyone can PLAY
  // every course through end-of-Yellow (seed 19). The seed-19 wall still gates
  // play via canAccessSeed in LearningPlayer; this only opens the door.
  return result.canAccess || result.canPreview
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

      // First try URL param — must pass the same entitlement gate as a
      // click, otherwise visiting /?course=<premium_code> bypasses the
      // paywall and the premium course just starts playing for a guest.
      if (urlCourseCode) {
        const requested = data.find(c => c.course_code === urlCourseCode)
        if (requested && canAccessCourse(requested)) {
          defaultCourse = requested
          try {
            localStorage.setItem(LAST_COURSE_KEY, urlCourseCode)
          } catch (e) {
            // ignore
          }
        }
        // If the URL-requested course is locked, fall through to the other
        // resolution paths — leave defaultCourse null here. We can't push
        // to /premium from this async boot path without racing the router.
      }

      // Then try localStorage (but only if user can access it)
      if (!defaultCourse && savedCourseCode) {
        const saved = data.find(c => c.course_code === savedCourseCode)
        if (saved && canAccessCourse(saved)) {
          defaultCourse = saved
        }
      }
      // Fall back to the first course the user can actually access. If
      // there isn't one (rare — would mean every course in the catalogue
      // is gated for this user), leave defaultCourse null so no premium
      // course gets auto-loaded; the CourseSelector picker will open.
      if (!defaultCourse) {
        // Prefer Chinese as the first thing a fresh/anon visitor lands on,
        // falling back to the first accessible course (now incl. previewable
        // premium courses) if it isn't in the catalogue for this user.
        const PREFERRED_DEFAULT = 'zho_for_eng'
        defaultCourse =
          data.find(c => c.course_code === PREFERRED_DEFAULT && canAccessCourse(c)) ||
          data.find(c => canAccessCourse(c)) || null
        noPriorCourseSelection.value = true
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

        // Keep the warm-start cache honest before the player mounts. The full
        // walk itself is LearningPlayer's deferred handoff — not fired here.
        checkCourseContentVersion(supabaseClient.value, defaultCourse.course_code)

        // Warm the instant-playback caches for the auto-selected default course
        // too — previously only handleCourseSelect (an explicit switch) did this,
        // so a fresh visitor's very first boot always paid the cold round-map +
        // first-cycles round-trips instead of hitting the prewarmed cache.
        // Fire-and-forget; mirrors the handleCourseSelect wiring above.
        void prewarmInstantCaches(defaultCourse.course_code)
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
provide('learnerEnrollments', learnerEnrollments)
provide('fetchLearnerEnrollments', fetchLearnerEnrollments)
provide('noPriorCourseSelection', noPriorCourseSelection)
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

      // Initialize auth with Supabase client (for learner management). Its
      // completion — including the "staff on a fresh browser lands on the
      // dashboard, not the bare player" redirect that used to live here — is
      // now owned by the shared resolved-session gate (useResolvedSession),
      // written by useAuth and read by router/index.ts's one-shot corrective
      // redirect. One mechanism, reachable from router guards too, instead of
      // this component-local check.
      if (auth) {
        await auth.initialize(supabaseClient.value)
      }

      // Initialize entitlements + subscription (now that supabase + auth are
      // ready) WITHOUT blocking boot on their round-trips (1-2s each on a cold
      // deployment). Nothing at boot needs the fresh values: default-course
      // picking is identical either way — canAccessCourse returns
      // canAccess||canPreview and EVERY live/beta course is at least
      // previewable, so entitlements can't change the pick — and the seed-19
      // wall (canAccessSeed) first fires well into play, long after these
      // land. Both composables also hydrate from their localStorage cache at
      // setup for instant reads.
      const { initialize: initEntitlements } = useSharedUserEntitlements()
      const { initialize: initSubscription } = useSharedSubscription()
      const entitlementsReady = Promise.all([initEntitlements(), initSubscription()]).catch(() => {})

      // 30-day offline lease (the "Spotify handshake"). Wire boot/reconnect/timer
      // renewals AFTER subscription resolves, so the first renew sees the
      // freshest entitlement state — chained off the promise rather than
      // blocking boot. Idempotent + best-effort (fail-open offline).
      void entitlementsReady.then(() => {
        try {
          useOfflineLease().initialize(supabaseClient, auth.userId)
        } catch (e) {
          console.warn('[App] Offline-lease init failed (non-fatal):', e)
        }
      })

      // Claim any email-allowlist (pre-granted) free access for a restored /
      // already-signed-in session — onAuthStateChange's SIGNED_IN doesn't fire
      // for a session restored on load, so this covers returning users.
      // Fire-and-forget: it's a no-op for everyone without a pending grant,
      // and when a grant DOES land it refreshes entitlements itself, so the
      // UI unlocks reactively. Awaiting it put a full /api/access/claim
      // round-trip (1s+ on a cold deployment) on every boot's critical path.
      if (auth.learner.value) {
        void (async () => {
          try {
            const { data: { session } } = await supabaseClient.value.auth.getSession()
            if (session?.access_token) {
              await useAccessClaim().claimAccess(session.access_token)
            }
          } catch (e) {
            console.warn('[App] Access claim failed (non-fatal):', e)
          }
        })()
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
            } else if (!isRedeemFlowRoute.value) {
              // Not signed in — open auth modal. Skip while /redeem or /group
              // is itself mounted: RedeemCode.vue owns this pendingCode and is
              // already showing its own auth/details step inline — opening the
              // global modal here races the page's own flow and, once the
              // possession-redeem path signs the user in and clears
              // pendingCode, was left stuck open (isOpen is a module
              // singleton nothing else closes) over the freshly-loaded
              // dashboard after redirect.
              useAuthModal().open()
            }
          }
        }
      } catch (err) {
        console.warn('[App] Failed to process invite code from URL:', err)
      }

      // If there's a pending code from sessionStorage (e.g. from /redeem/:code flow)
      // and user isn't signed in, open auth modal so they can complete sign-up + redeem
      // — unless /redeem or /group is itself currently mounted (see above).
      if (!auth.learner.value && inviteCode.pendingCode.value && !isRedeemFlowRoute.value) {
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
})
</script>

<template>
  <div class="app-root">
    <router-view />
    <AppEscape v-if="showAppEscape" />
    <PwaUpdatePrompt />
    <InstallBanner />
    <TesterFeedback />
    <WalkOverlay />
    <CheckoutOverlay />
    <div v-if="killSwitchMessage" class="kill-switch-overlay">
      <p>{{ killSwitchMessage }}</p>
    </div>
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

.kill-switch-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  text-align: center;
  background: rgba(20, 16, 14, 0.92);
  color: #fff;
}

.kill-switch-overlay p {
  max-width: 420px;
  font-size: 16px;
  line-height: 1.5;
}
</style>
