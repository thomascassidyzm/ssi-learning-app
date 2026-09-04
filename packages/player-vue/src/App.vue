<script setup>
import { ref, provide, onMounted, defineAsyncComponent, watch, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { createClient } from '@supabase/supabase-js'
import { lastDashboardPath } from './router'
import { createProgressStore, createSessionStore } from '@ssi/core'
import { createCourseDataProvider } from './providers/CourseDataProvider'
import { loadConfig, isSupabaseConfigured, missingRequiredConfig } from './config/env'
import { shouldOfferAppInstall } from './platform/capabilities'
import { useAuth } from './composables/useAuth'
import {
  prewarmInstantCaches,
  setInstantPlaybackAuthProvider,
  isBundleBootstrapEnabled,
} from './composables/useInstantPlayback'
import { setCourseBundleAuthProvider, setCourseBundleIdentityProvider, getCourseBundle } from './composables/useCourseBundle'
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
import {
  withNetworkTimeout,
  NETWORK_TIMEOUT,
  BACKGROUND_FETCH_TIMEOUT_MS,
  wireNetworkRecovery,
} from './config/networkGate'
import { waitForCatalogue, usableCatalogue } from './config/catalogueWait'
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
// In-app browser — renders nothing until a link asks to open a page inside the
// app rather than throwing the learner out to a browser tab.
const InAppBrowser = defineAsyncComponent(() => import('./components/InAppBrowser.vue'))

// Suppress consecutive identical console errors/warnings after 3 repeats
installConsoleDedup()
// Clear the "network is stalled" observation the moment the browser reports a
// reconnect, so a learner walking back into signal gets live content again
// without waiting out the TTL.
wireNetworkRecovery()

// "No dead ends": show the shell-level escape on any route that doesn't carry
// its own way out. The immersive player and the shelled containers (schools /
// teach / admin) opt out via meta.hideAppEscape; everything else (bare
// top-level pages like onboarding, /with/:code, /teacher-insights) gets it.
// Critical in the installed PWA, which has no browser back button.
const route = useRoute()
const router = useRouter()
const showAppEscape = computed(() => !route.matched.some((r) => r.meta?.hideAppEscape))

// The immersive player opts out of AppEscape above — a plain learner sees no
// chrome at all, which is the point. But since the owner ruling of 2026-08-06
// ("entering the player always gives the navless player"), staff self-practice
// lands here too, with no shell nav to get home. For those users only — the ones
// carrying a `ssi-last-dashboard` breadcrumb — show the same low-emphasis pill
// pointed at their own surface, so they aren't stranded.
const dashboardEscape = computed(() =>
  route.name === 'player' ? lastDashboardPath() : null,
)

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
      // (archive/docs-retired-2026-08-24/pwa-lifecycle-design.md §2.3) — only learner intent
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
      // PREFIX match, not exact: the real workbox precache is named
      // "workbox-precache-v2-<origin>/", so the old exact-match Set deleted
      // the ENTIRE app-shell precache on every deploy — leaving offline cold
      // start on the browser "No internet" page until the next SW update
      // reinstalled it (found 2026-07-31 chasing the always-play invariant).
      const PRESERVE_PREFIXES = ['workbox-precache', 'ssi-audio-cache', 'ssi-auth-handoff']
      caches.keys().then(names => {
        const cleared = names.filter(n => !PRESERVE_PREFIXES.some(p => n.startsWith(p)))
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
// Declared here (rather than beside the course-selection helpers below) so
// the early bundle warm-up in the block that follows can read it without
// tripping over the temporal dead zone.
const LAST_COURSE_KEY = 'ssi-last-course'

/**
 * Start the bundle download the moment a course can be NAMED — the intent
 * signal, not the Start press (Tom, 2026-08-29: "by the time you get to the
 * play button ... it has already anticipated you would play that song").
 *
 * There are two moments at which the app first learns which course the
 * learner is heading for, and they are seconds apart:
 *
 *  1. Synchronously at boot, from the `?course=` param or the last-played
 *     course in storage. This is the common case and it fires at ~250ms.
 *  2. From the learner's OWN saved preference (`preferences.last_course_code`)
 *     once auth resolves — which is the only signal available on a fresh
 *     device, a fresh PWA install, or after a storage wipe, because there is
 *     nothing in localStorage to read. Measured on dev 2026-08-29, that path
 *     started the bundle at ~1.2s instead of ~0.25s: a second of overlap with
 *     app boot thrown away for want of a name.
 *
 * Both call here. `getCourseBundle` coalesces in flight and caches per
 * session, so calling it twice costs one fetch, and every later consumer
 * (`prewarmInstantCaches`, the player's own bootstrap) JOINS this one rather
 * than starting a second. A wrong guess costs one unused request, which is
 * why it is gated on the bundle flag and only ever fired for a course the
 * learner has actually pointed at.
 */
function warmBundleForIntent(courseCode) {
  if (!courseCode) return
  try {
    if (!isBundleBootstrapEnabled(courseCode)) return
    void getCourseBundle(courseCode).catch(() => {})
  } catch {
    /* no window (tests / SSR) — the player fetches it later exactly as before */
  }
}

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
    const accessToken = async () => {
      const client = supabaseClient.value
      if (!client) return null
      try {
        const { data } = await client.auth.getSession()
        return data.session?.access_token ?? null
      } catch {
        return null
      }
    }
    setInstantPlaybackAuthProvider(accessToken)
    // /bundle is gated by the same server-side entitlement resolver, and for
    // the same reason: an anonymous fetch hands a signed-in paid learner the
    // sliced preview bundle instead of the course.
    setCourseBundleAuthProvider(accessToken)
    // ...and who the caller IS, which the token cannot say (it rotates on
    // every refresh). The cached full bundle is only served back to the
    // identity that fetched it (SEC0901-D-02) — same local getSession() read,
    // no extra network.
    setCourseBundleIdentityProvider(async () => {
      const client = supabaseClient.value
      if (!client) return null
      try {
        const { data } = await client.auth.getSession()
        return data.session?.user?.id ?? null
      } catch {
        return null
      }
    })

    // Start the bundle download at the EARLIEST moment we can name a course.
    // Everything that used to kick it off — course-list resolution, the
    // enrollment lookup, the player's own mount — happens well into boot, so
    // on a cold first play the learner waited for the whole multi-megabyte
    // download from THERE. The remembered course (URL param, else last
    // played) is the course the learner lands on nearly every time, so
    // warming it here overlaps the download with the rest of app boot rather
    // than queueing behind it. Fire-and-forget; `getCourseBundle` de-dupes in
    // flight, so `prewarmInstantCaches` and the player's own bootstrap join
    // THIS fetch instead of starting another. A wrong guess costs one unused
    // request, which is why it is gated on the bundle flag.
    try {
      const remembered =
        new URLSearchParams(window.location.search).get('course') ||
        sessionStorage.getItem('ssi-demo-last-course') ||
        localStorage.getItem(LAST_COURSE_KEY)
      warmBundleForIntent(remembered)
    } catch {
      /* no storage, no window — the player fetches it later exactly as before */
    }
  } catch (err) {
    console.error('[App] Failed to initialize Supabase client synchronously:', err)
  }
} else {
  // FAIL LOUDLY. Skipping this block silently is how a single absent build-time
  // variable bricked sign-in for everybody with no trace anywhere: no client is
  // ever created, so every sign-in path answers "App not ready. Please try
  // again." forever. console.error (not log/info/debug — those are stripped in
  // production by the vite esbuild pure list) so the cause is one glance away
  // in a real browser console, and it NAMES the missing variables.
  console.error(
    '[App] NO SUPABASE CLIENT — sign-in, progress and course loading are all dead. ' +
    'Missing build-time config: ' + (missingRequiredConfig(config).join(', ') || 'none reported') +
    '. Set these on the Vercel project and redeploy.',
  )
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

// Capture beforeinstallprompt for PWA install guide. Not inside the native
// shell: there is nothing to install from in there, and holding a deferred
// prompt only gives the install surfaces something to light up on. Asked once,
// at the seam (platform/capabilities), not sniffed here.
const installPrompt = ref(null)
if (shouldOfferAppInstall()) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installPrompt.value = e
  })
}

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

// Offline mirror of the courses catalogue. The catalogue query is the FIRST
// network dependency of every boot — without a course row, activeCourse stays
// null and the player never mounts, no matter how much audio/script is cached.
// So every successful fetch writes the rows here, and an offline/failed boot
// hydrates from this mirror instead of dead-ending (always-play invariant).
const CATALOGUE_CACHE_KEY = 'ssi-courses-catalogue-v1'
const readCatalogueCache = () => {
  try {
    const raw = localStorage.getItem(CATALOGUE_CACHE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch (e) {
    return null
  }
}
const writeCatalogueCache = (rows) => {
  try {
    localStorage.setItem(CATALOGUE_CACHE_KEY, JSON.stringify(rows))
  } catch (e) {
    // Storage full/blocked — next online boot just refetches.
  }
}

// Fetch enrolled courses from Supabase
/**
 * Every column of `courses` EXCEPT the two that boot never reads.
 *
 * This query used to be `select('*')`, and `*` on this table is 1.74 MB of
 * JSON for 83 rows — because Popty stores its content-authoring working notes
 * on the same row. Measured live 2026-08-30:
 *
 *   quality_rules         1,364,495 bytes   78% of the payload   0 references in this repo
 *   translation_analysis    248,931 bytes   14% of the payload   0 references in this repo
 *   everything else         128,084 bytes    7%
 *
 * So 93% of the FIRST network dependency of every boot was authoring metadata
 * the player has never once looked at. On Fast 3G, with the JS bundle still
 * coming down the same pipe, its body took ~7s to arrive — the response
 * HEADERS landed at 2.28s, comfortably inside the 2500ms budget, and then the
 * body streamed past it. That is why a FIRST load hung and a REFRESH was fine:
 * on the second load the bundle is cached, the pipe is free, and the same
 * 1.5 MB lands in a few hundred ms. Measured against staging (no leash):
 * 5/5 first cold loads never rendered anything at all.
 *
 * Stated as an EXCLUSION rather than an allowlist on purpose. `enrolledCourses`
 * flows into the browse screen, the course switcher and LearningPlayer, and an
 * allowlist that missed a field would fail silently somewhere far from here.
 * Excluding two provably-unread columns cannot. A column added in Popty later
 * will need adding here — that is the accepted cost, and it is why the list is
 * next to the query rather than in a config file.
 */
const CATALOGUE_COLUMNS = [
  'audio_stamp', 'content_stamp', 'content_version', 'course_code', 'course_type',
  'created_at', 'creator_email', 'dialect', 'display_name', 'export_ready',
  'featured_order', 'gender_prep_check_notes', 'gender_prep_checked_at', 'is_community',
  'known_lang', 'learner_display_name', 'legacy_app_beta_started_at', 'legacy_app_status',
  'needs_gender_prep', 'new_app_beta_started_at', 'new_app_status', 'pricing_tier',
  'record_full_max_seed', 'released_at', 'seed_count', 'status', 'target_lang',
  'updated_at', 'variant_label', 'version', 'visibility', 'voice_config', 'voice_pool_key',
].join(',')

/**
 * The course catalogue read, as a real promise.
 *
 * Deliberately NOT session-scoped: the filter is `new_app_status`, and the
 * row set is identical for an anonymous and a service-role reader (verified
 * live 2026-08-30, 83 courses either way). Which is what makes it safe to
 * start before auth has resolved — only the SELECTION below needs the
 * learner, not the fetch.
 */
const startCoursesQuery = (signal) => {
  let q = supabaseClient.value
    .from('courses')
    .select(CATALOGUE_COLUMNS)
    .in('new_app_status', ['live', 'beta'])
    .order('display_name')
  // Superseded attempts are aborted rather than left to hang, so a long wait
  // on a bad network cannot quietly accumulate dead sockets.
  if (signal) q = q.abortSignal(signal)
  return Promise.resolve(q)
}

/**
 * Boot's head start on that read. `await auth.initialize()` costs ~600ms on a
 * cold boot and the catalogue fetch used to queue behind it, one after the
 * other, before any course could be named. Started alongside instead, claimed
 * once by the first fetchEnrolledCourses.
 */
let prefetchedCoursesQuery = null

/**
 * Is the learner watching a blank screen because the catalogue has not landed?
 *
 * Only ever true on a FIRST cold visit — a returning learner has the offline
 * mirror and never gets here. Drives the one visible thing in the template.
 * Waiting visibly is a state; waiting blankly is the bug this closes.
 */
const catalogueSlow = ref(false)

const fetchEnrolledCourses = async () => {
  let data = null
  if (supabaseClient.value) {
    try {
      // Get courses available for this app (live or beta)
      // Status options: draft (hidden), beta (visible with badge), live (fully visible)
      // Bounded: supabase-js has no default request timeout, so on a weak
      // signal this select hangs and the app never picks an active course —
      // no course, no player, nothing plays, even with a full cache sitting
      // on the device. The offline catalogue mirror below is exactly the
      // fallback we want; it just has to be REACHED. (Tom 2026-08-15.)
      // ONE shared promise. It is awaited up to twice below, so it must be a
      // real promise rather than the Supabase thenable, which re-runs the
      // request every time it is awaited.
      //
      // Boot may already have this in flight (see startCoursesQuery) — claim
      // it once. Every later caller (PlayerContainer's refresh) finds the slot
      // empty and issues its own, so a refresh is never served stale.
      const coursesQuery = prefetchedCoursesQuery || startCoursesQuery()
      prefetchedCoursesQuery = null
      // supabase-js reports transport failures as `res.error` rather than
      // rejecting — but if it ever does reject, a first-time visitor must
      // still reach the waiter below instead of falling out to the catch and
      // dead-ending on a blank screen, which is the whole bug being closed.
      let res = await withNetworkTimeout(coursesQuery).catch((err) => {
        console.error('[App] Courses fetch threw:', err)
        return null
      })
      if (!usableCatalogue(res) && !readCatalogueCache()) {
        // The offline mirror is the right fallback for a RETURNING learner.
        // A FIRST-TIME visitor has never written one, so there is nothing here
        // to fall back TO — and giving up at a deadline would just trade a
        // blank screen that might still resolve for a blank screen that never
        // will. Neither is any use to the learner. So: say so on screen, and
        // keep trying until it lands. (Tom's ruling, 2026-08-30.)
        if (res === NETWORK_TIMEOUT) {
          console.warn('[App] Courses fetch exceeded its budget and there is no offline mirror to serve — telling the learner and staying on it.')
        } else if (res?.error) {
          console.error('[App] Failed to fetch courses:', res.error)
        }
        catalogueSlow.value = true
        res = await waitForCatalogue(coursesQuery, {
          startQuery: (signal) => startCoursesQuery(signal),
          onRetry: (n) => console.warn(`[App] No catalogue and no offline mirror — still trying (attempt ${n}).`),
        })
      }
      if (res === NETWORK_TIMEOUT) {
        console.warn('[App] Courses fetch exceeded its budget — falling back to the offline catalogue mirror.')
      } else if (res?.error) {
        console.error('[App] Failed to fetch courses:', res.error)
      } else {
        data = res?.data ?? null
      }
    } catch (err) {
      console.error('[App] Error fetching enrolled courses:', err)
    }
  }

  if (data && data.length > 0) {
    writeCatalogueCache(data)
  } else {
    // Offline / query failed — serve the last known catalogue so the saved
    // course resolves and the player boots into its cached-content paths.
    data = readCatalogueCache()
    if (data) console.log('[App] Courses catalogue hydrated from offline mirror:', data.length, 'courses')
  }
  // Either way the wait is over — the notice comes down.
  catalogueSlow.value = false

  try {
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
    console.error('[App] Error resolving active course:', err)
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

      // Catalogue read goes out NOW, in parallel with auth init, rather than
      // waiting its turn behind it. Errors are handled where it is awaited.
      prefetchedCoursesQuery = startCoursesQuery()
      void prefetchedCoursesQuery.catch(() => {})

      // Initialize auth with Supabase client (for learner management). Its
      // completion — including the "staff on a fresh browser lands on the
      // dashboard, not the bare player" redirect that used to live here — is
      // now owned by the shared resolved-session gate (useResolvedSession),
      // written by useAuth and read by router/index.ts's one-shot corrective
      // redirect. One mechanism, reachable from router guards too, instead of
      // this component-local check.
      if (auth) {
        // Bounded. auth.initialize() times out its own getSession(), but the
        // learner-row read and guest-progress migration behind it were
        // unbounded, so on a weak signal this await could hold boot
        // indefinitely — and everything below it, including the course
        // catalogue the player needs to mount at all. A learner whose auth
        // has not resolved still gets to play what is cached; the session
        // settles behind them and the UI is reactive to it.
        // (Tom 2026-08-15: "never as a gate".)
        const authResult = await withNetworkTimeout(auth.initialize(supabaseClient.value))
        if (authResult === NETWORK_TIMEOUT) {
          console.warn('[App] Auth init exceeded its budget — booting into cached content; session will settle behind us.')
        }
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

      // INTENT, second signal: the learner's own saved course. On a fresh
      // device there is nothing in localStorage, so the synchronous warm-up
      // above had no name to work with and the download otherwise waits for
      // the course list and enrollment reads to finish. De-duped — if the
      // boot warm-up already started this course, this joins that fetch.
      warmBundleForIntent(auth.learner.value?.preferences?.last_course_code)

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
    <AppEscape v-else-if="dashboardEscape" :to="dashboardEscape" />
    <PwaUpdatePrompt />
    <InstallBanner />
    <TesterFeedback />
    <WalkOverlay />
    <CheckoutOverlay />
    <InAppBrowser />
    <!--
      Shown only on a FIRST cold visit whose catalogue has not arrived yet.
      A returning learner has the offline mirror and never sees this. It is not
      an error state and offers nothing to tap: the app is still trying, and
      the one useful thing it can do is say so rather than sit blank.
    -->
    <div v-if="catalogueSlow" class="slow-network-notice">
      <div class="slow-network-card">
        <div class="slow-network-pulse" aria-hidden="true"></div>
        <p class="slow-network-title">Still loading</p>
        <p class="slow-network-body">
          Your connection looks slow. This will start on its own as soon as it
          comes through, so there's no need to reload.
        </p>
      </div>
    </div>
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

/*
 * The slow-network notice. Mist tokens, no belt accent — this is the shell
 * speaking before any course exists, so there is no belt colour to carry yet.
 * Edge-anchored and full-bleed, so it pads itself out of the notch and the
 * home indicator per the standing safe-area rule.
 */
.slow-network-notice {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, env(safe-area-inset-top, 0px)) max(24px, env(safe-area-inset-right, 0px))
    max(24px, env(safe-area-inset-bottom, 0px)) max(24px, env(safe-area-inset-left, 0px));
  background: var(--bg-primary);
}

.slow-network-card {
  max-width: 320px;
  text-align: center;
}

.slow-network-pulse {
  width: 10px;
  height: 10px;
  margin: 0 auto 20px;
  border-radius: 50%;
  background: var(--text-secondary, #6b6560);
  animation: slow-network-breathe 1.8s ease-in-out infinite;
}

@keyframes slow-network-breathe {
  0%, 100% { opacity: 0.25; transform: scale(0.85); }
  50% { opacity: 0.9; transform: scale(1.15); }
}

@media (prefers-reduced-motion: reduce) {
  .slow-network-pulse { animation: none; opacity: 0.6; }
}

.slow-network-title {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary, #2b2724);
}

.slow-network-body {
  margin: 0;
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-secondary, #6b6560);
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
