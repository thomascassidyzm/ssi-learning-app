<script setup lang="ts">
import { ref, computed, inject, watch, onMounted, onUnmounted } from 'vue'
import { getAudioCacheStats, preloadAudioBatch } from '../composables/useScriptCache'
import { unregisterAllServiceWorkers, clearAllCaches } from '../composables/useServiceWorkerSafety'
import { BELT_RANGES, getBeltForSeed } from '../composables/useBeltLoader'
import { useBeltProgress } from '../composables/useBeltProgress'
import { useTheme } from '../composables/useTheme'
import { useInviteCode, type InviteCodeContext } from '../composables/useInviteCode'
import { useAuthModal } from '../composables/useAuthModal'
import { useRouter } from 'vue-router'

const emit = defineEmits(['close', 'openExplorer', 'openListening', 'settingChanged'])

const props = defineProps({
  course: {
    type: Object,
    default: null
  }
})

// Inject auth and data providers
const auth = inject('auth', null)
const supabase = inject('supabase', null)
const courseDataProvider = inject('courseDataProvider', null)

// Get belt progress for current seed position
const courseCode = computed(() => props.course?.course_code || 'demo')
const { completedRounds } = useBeltProgress(courseCode.value)

// Reset progress state
const showResetConfirm = ref(false)
const isResetting = ref(false)
const resetError = ref(null)
const resetSuccess = ref(false)

// Current course info for reset
const courseName = computed(() => props.course?.display_name || props.course?.course_code || 'this course')

// App info
const appVersion = '1.0.0'
const buildNumber = '2024.12.16'

// Display settings
const showFirePath = ref(true)

// Developer settings (hidden from regular users, useful for debugging)
const showViewScript = ref(false)
const showFragileProgressWarning = ref(true) // Default: show the warning to guests
const enableQaMode = ref(false) // Show Report Issue button
const showDebugOverlay = ref(false) // Show phase/round/LEGO info overlay
const enableVerboseLogging = ref(false) // Detailed console logs

// Theme settings (uses shared composable)
const { theme, toggleTheme: doToggleTheme, isDark } = useTheme()
const isDarkMode = computed(() => isDark())

// Account management state
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)
const deleteError = ref(null)

// Check if user is signed in
const isSignedIn = computed(() => auth?.user?.value != null)
const userEmail = computed(() => auth?.user?.value?.emailAddresses?.[0]?.emailAddress || '')
const userName = computed(() => auth?.user?.value?.fullName || auth?.user?.value?.firstName || '')

// Check if user is an SSi team admin (can see Developer section)
// Add email domains or specific emails here
const ADMIN_EMAIL_DOMAINS = ['saysomethingin.com', 'ssi.cymru']
const ADMIN_EMAILS = ['tom@tomcassidy.co.uk'] // Add specific admin emails here
const isAdmin = computed(() => {
  const email = userEmail.value.toLowerCase()
  if (!email) return false

  // Check specific emails first
  if (ADMIN_EMAILS.some(e => email === e.toLowerCase())) return true

  // Check email domains
  const domain = email.split('@')[1]
  return ADMIN_EMAIL_DOMAINS.some(d => domain === d.toLowerCase())
})

const { openSignIn, openSignUp } = useAuthModal()
const router = useRouter()

// School role check
const SCHOOL_ROLES = ['teacher', 'school_admin', 'govt_admin']
const educationalRole = ref<string | null>(null)
const hasSchoolRole = computed(() => educationalRole.value != null && SCHOOL_ROLES.includes(educationalRole.value))

watch(isSignedIn, async (signedIn) => {
  if (signedIn && supabase?.value && auth?.learnerId?.value) {
    try {
      const { data } = await supabase.value
        .from('learners')
        .select('educational_role')
        .eq('id', auth.learnerId.value)
        .single()
      educationalRole.value = data?.educational_role || null
    } catch {
      educationalRole.value = null
    }
  } else {
    educationalRole.value = null
  }
}, { immediate: true })

// Join school/class via invite code
const { validateCode, redeemCode, pendingCode, clearPendingCode } = useInviteCode()
const showJoinCode = ref(false)
const joinCodeInput = ref('')
const joinError = ref('')
const joinContext = ref<InviteCodeContext | null>(null)
const isJoinValidating = ref(false)
const isJoinRedeeming = ref(false)
const joinSuccess = ref(false)

const handleJoinCodeInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  let val = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (val.length === 4 && !val.includes('-')) {
    val = val.slice(0, 3) + '-' + val.slice(3)
  }
  if (val.length > 7) val = val.slice(0, 7)
  joinCodeInput.value = val
}

const handleJoinValidate = async () => {
  joinError.value = ''
  joinContext.value = null
  isJoinValidating.value = true
  try {
    const valid = await validateCode(joinCodeInput.value)
    if (valid && pendingCode.value) {
      joinContext.value = { ...pendingCode.value }
    } else {
      joinError.value = 'Invalid or expired code'
    }
  } catch {
    joinError.value = 'Failed to validate code'
  } finally {
    isJoinValidating.value = false
  }
}

const joinContextRole = computed(() => {
  if (!joinContext.value) return ''
  const map: Record<string, string> = { govt_admin: 'Regional Admin', school_admin: 'School Admin', teacher: 'Teacher', student: 'Student' }
  return map[joinContext.value.codeType] || joinContext.value.codeType
})

const joinContextDetail = computed(() => {
  if (!joinContext.value) return ''
  const ctx = joinContext.value
  if (ctx.schoolName) return `at ${ctx.schoolName}`
  if (ctx.regionName) return `for ${ctx.regionName}`
  if (ctx.className) return ctx.className
  return ''
})

const handleJoinRedeem = async () => {
  isJoinRedeeming.value = true
  joinError.value = ''
  try {
    const token = await auth?.getToken?.()
    if (!token) {
      joinError.value = 'Not signed in'
      return
    }
    const result = await redeemCode(token)
    if (result.success) {
      joinSuccess.value = true
      joinContext.value = null
      clearPendingCode()
    } else {
      joinError.value = result.error || 'Failed to join'
    }
  } catch {
    joinError.value = 'Failed to redeem code'
  } finally {
    isJoinRedeeming.value = false
  }
}

// Open Clerk's user profile for managing account
const openUserProfile = () => {
  if (auth?.openUserProfile) {
    auth.openUserProfile()
  } else {
    // Fallback - show message
    console.log('[Settings] User profile management not available')
  }
}

// Handle change email - uses Clerk's user management
const handleChangeEmail = () => {
  if (auth?.openUserProfile) {
    auth.openUserProfile()
  }
}

// Handle change password - uses Clerk's user management
const handleChangePassword = () => {
  if (auth?.openUserProfile) {
    auth.openUserProfile()
  }
}

// Handle cancel subscription - redirect to billing
const handleCancelSubscription = () => {
  // For now, open an email to support
  window.location.href = 'mailto:support@saysomethingin.com?subject=Cancel%20Subscription%20Request'
}

// Handle delete account
const handleDeleteClick = () => {
  showDeleteConfirm.value = true
  deleteError.value = null
}

const cancelDelete = () => {
  showDeleteConfirm.value = false
}

const confirmDelete = async () => {
  if (!supabase?.value || !auth?.learnerId?.value) {
    deleteError.value = 'Unable to delete - not signed in'
    return
  }

  isDeleting.value = true
  deleteError.value = null

  try {
    const learnerId = auth.learnerId.value

    // Delete all user data from all tables
    const tables = [
      'response_metrics',
      'spike_events',
      'lego_progress',
      'seed_progress',
      'sessions',
      'course_enrollments',
    ]

    for (const table of tables) {
      await supabase.value
        .from(table)
        .delete()
        .eq('learner_id', learnerId)
    }

    // Delete learner record
    await supabase.value
      .from('learners')
      .delete()
      .eq('id', learnerId)

    // Sign out via Clerk
    if (auth?.signOut) {
      await auth.signOut()
    }

    console.log('[Settings] Account deleted successfully')
    // Clear local storage
    localStorage.clear()
    // Reload to go back to welcome screen
    window.location.reload()
  } catch (err) {
    console.error('[Settings] Delete error:', err)
    deleteError.value = 'Failed to delete account. Please contact support.'
  } finally {
    isDeleting.value = false
  }
}

// Toggle dark/light mode — useTheme handles persistence and DOM update
const toggleTheme = () => {
  doToggleTheme()
}

// ============================================
// OFFLINE DOWNLOAD STATE
// ============================================

const offlineDownloadOption = ref('current') // 'current', 'next50', 'next100', 'entire'
const isDownloading = ref(false)
const downloadProgress = ref(0)
const downloadError = ref(null)
const cacheStats = ref({ count: 0, estimatedMB: 0 })
const isOnline = ref(navigator.onLine)

// Storage estimates (approximate)
const storageEstimates = {
  current: { seeds: 20, size: '~3MB' },
  next50: { seeds: 50, size: '~8MB' },
  next100: { seeds: 100, size: '~15MB' },
  entire: { seeds: 668, size: '~100MB' },
}

const selectedEstimate = computed(() => storageEstimates[offlineDownloadOption.value])

// Network status listeners
const handleOnline = () => { isOnline.value = true }
const handleOffline = () => { isOnline.value = false }

onMounted(async () => {
  // Load saved display settings
  showFirePath.value = localStorage.getItem('ssi-show-fire-path') !== 'false'

  // Load developer settings
  showViewScript.value = localStorage.getItem('ssi-show-view-script') === 'true'
  showFragileProgressWarning.value = localStorage.getItem('ssi-show-fragile-warning') !== 'false' // Default true
  enableQaMode.value = localStorage.getItem('ssi-enable-qa-mode') === 'true'
  showDebugOverlay.value = localStorage.getItem('ssi-show-debug-overlay') === 'true'
  enableVerboseLogging.value = localStorage.getItem('ssi-verbose-logging') === 'true'

  // Load cache stats
  try {
    cacheStats.value = await getAudioCacheStats()
  } catch (err) {
    console.warn('[Settings] Failed to load cache stats:', err)
  }

  // Setup network listeners
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
})

onUnmounted(() => {
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})

// Abort controller for download cancellation
let downloadAbortController = null

// Start offline download
const startOfflineDownload = async () => {
  if (isDownloading.value || !isOnline.value) return
  if (!courseDataProvider?.value) {
    downloadError.value = 'Course not loaded. Please select a course first.'
    return
  }

  isDownloading.value = true
  downloadProgress.value = 0
  downloadError.value = null
  downloadAbortController = new AbortController()

  try {
    // Calculate seed range based on option
    const currentSeed = completedRounds.value + 1 // Start from next seed
    let startSeed, endSeed

    switch (offlineDownloadOption.value) {
      case 'current': {
        const belt = getBeltForSeed(currentSeed)
        const range = BELT_RANGES[belt]
        startSeed = currentSeed
        endSeed = range.end
        break
      }
      case 'next50':
        startSeed = currentSeed
        endSeed = Math.min(currentSeed + 49, 668)
        break
      case 'next100':
        startSeed = currentSeed
        endSeed = Math.min(currentSeed + 99, 668)
        break
      case 'entire':
        startSeed = 1
        endSeed = 668
        break
    }

    const totalSeeds = endSeed - startSeed + 1
    console.log(`[Settings] Downloading seeds ${startSeed}-${endSeed} (${totalSeeds} seeds)`)

    // TODO: Offline download needs migration to use generateLearningScript + audio proxy
    downloadError.value = 'Offline download temporarily unavailable. This feature is being migrated to the new architecture.'
  } catch (err) {
    console.error('[Settings] Download error:', err)
    downloadError.value = 'Download failed. Please try again.'
  } finally {
    isDownloading.value = false
    downloadAbortController = null
  }
}

// Cancel download
const cancelDownload = () => {
  if (downloadAbortController) {
    downloadAbortController.abort()
    downloadAbortController = null
  }
  isDownloading.value = false
  downloadProgress.value = 0
}

const toggleFirePath = () => {
  showFirePath.value = !showFirePath.value
  localStorage.setItem('ssi-show-fire-path', showFirePath.value ? 'true' : 'false')
  // Dispatch custom event for same-tab reactivity
  window.dispatchEvent(new CustomEvent('ssi-setting-changed', {
    detail: { key: 'showFirePath', value: showFirePath.value }
  }))
  emit('settingChanged', { key: 'showFirePath', value: showFirePath.value })
}

const toggleViewScript = () => {
  showViewScript.value = !showViewScript.value
  localStorage.setItem('ssi-show-view-script', showViewScript.value ? 'true' : 'false')
}

const toggleFragileProgressWarning = () => {
  showFragileProgressWarning.value = !showFragileProgressWarning.value
  localStorage.setItem('ssi-show-fragile-warning', showFragileProgressWarning.value ? 'true' : 'false')
  dispatchSettingChanged('showFragileProgressWarning', showFragileProgressWarning.value)
}

const toggleQaMode = () => {
  enableQaMode.value = !enableQaMode.value
  localStorage.setItem('ssi-enable-qa-mode', enableQaMode.value ? 'true' : 'false')
  dispatchSettingChanged('enableQaMode', enableQaMode.value)
}

const toggleDebugOverlay = () => {
  showDebugOverlay.value = !showDebugOverlay.value
  localStorage.setItem('ssi-show-debug-overlay', showDebugOverlay.value ? 'true' : 'false')
  dispatchSettingChanged('showDebugOverlay', showDebugOverlay.value)
}

const toggleVerboseLogging = () => {
  enableVerboseLogging.value = !enableVerboseLogging.value
  localStorage.setItem('ssi-verbose-logging', enableVerboseLogging.value ? 'true' : 'false')
  dispatchSettingChanged('enableVerboseLogging', enableVerboseLogging.value)
}

// Clear all caches and reload (same as ?reset=1 but accessible from PWA)
const isClearingCache = ref(false)
const handleClearCacheAndReload = async () => {
  isClearingCache.value = true
  console.log('[Settings] Clearing all caches and reloading...')

  try {
    // Clear localStorage
    localStorage.clear()
    // Clear sessionStorage
    sessionStorage.clear()
    // Clear IndexedDB
    if (window.indexedDB && indexedDB.databases) {
      const dbs = await indexedDB.databases()
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name)
      }
    }
    // Unregister service workers and clear caches
    await Promise.all([
      unregisterAllServiceWorkers().catch(() => {}),
      clearAllCaches().catch(() => {})
    ])
  } catch (err) {
    console.warn('[Settings] Error during cache clear:', err)
  }

  // Reload clean
  window.location.reload()
}

// Helper to dispatch setting change events
const dispatchSettingChanged = (key: string, value: boolean) => {
  window.dispatchEvent(new CustomEvent('ssi-setting-changed', {
    detail: { key, value }
  }))
}

// Reset progress functions
const handleResetClick = () => {
  showResetConfirm.value = true
  resetError.value = null
  resetSuccess.value = false
}

const cancelReset = () => {
  showResetConfirm.value = false
}

const confirmReset = async () => {
  if (!supabase?.value || !auth?.learnerId?.value) {
    resetError.value = 'Unable to reset - not signed in'
    return
  }

  if (!courseCode.value) {
    resetError.value = 'No course selected'
    return
  }

  isResetting.value = true
  resetError.value = null

  try {
    const learnerId = auth.learnerId.value
    const course = courseCode.value

    // Delete from tables in order (respecting FK constraints)
    // Filter by both learner_id AND course_id
    const tables = [
      'response_metrics',
      'spike_events',
      'lego_progress',
      'seed_progress',
      'sessions',
    ]

    for (const table of tables) {
      const { error } = await supabase.value
        .from(table)
        .delete()
        .eq('learner_id', learnerId)
        .eq('course_id', course)

      if (error) {
        console.warn(`[Reset] Error clearing ${table}:`, error.message)
      }
    }

    // Reset enrollment stats for this course only
    await supabase.value
      .from('course_enrollments')
      .update({
        total_practice_minutes: 0,
        last_practiced_at: null,
        welcome_played: false,
      })
      .eq('learner_id', learnerId)
      .eq('course_id', course)

    resetSuccess.value = true
    console.log('[Settings] Progress reset complete for course:', course)

    // Close dialog after brief success message
    setTimeout(() => {
      showResetConfirm.value = false
      resetSuccess.value = false
    }, 1500)
  } catch (err) {
    console.error('[Settings] Reset error:', err)
    resetError.value = 'Failed to reset progress'
  } finally {
    isResetting.value = false
  }
}
</script>

<template>
  <div class="settings-screen">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-noise"></div>

    <!-- Reset Confirmation Dialog -->
    <Transition name="fade">
      <div v-if="showResetConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <div class="reset-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
            </svg>
          </div>
          <h3 class="reset-title">Reset {{ courseName }}?</h3>
          <p class="reset-desc">
            This will clear your progress for this course and start you from the beginning. Other courses are not affected. This cannot be undone.
          </p>
          <p v-if="resetError" class="reset-error">{{ resetError }}</p>
          <p v-if="resetSuccess" class="reset-success">Progress reset!</p>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="cancelReset" :disabled="isResetting">
              Cancel
            </button>
            <button class="reset-btn reset-btn--confirm" @click="confirmReset" :disabled="isResetting">
              {{ isResetting ? 'Resetting...' : 'Reset Progress' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Delete Account Confirmation Dialog -->
    <Transition name="fade">
      <div v-if="showDeleteConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <div class="reset-icon delete-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h3 class="reset-title">Delete Account?</h3>
          <p class="reset-desc">
            This will permanently delete your account and all your learning progress across all courses. This action cannot be undone.
          </p>
          <p v-if="deleteError" class="reset-error">{{ deleteError }}</p>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="cancelDelete" :disabled="isDeleting">
              Cancel
            </button>
            <button class="reset-btn reset-btn--confirm" @click="confirmDelete" :disabled="isDeleting">
              {{ isDeleting ? 'Deleting...' : 'Delete Account' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Header -->
    <header class="header">
      <div class="header-spacer" />
      <h1 class="title">Settings</h1>
      <button class="close-btn" @click="emit('close')" aria-label="Close settings">✕</button>
    </header>

    <!-- Main Content -->
    <main class="main">
      <!-- Tools Section -->
      <section class="section">
        <h3 class="section-title">Tools</h3>
        <div class="card">
          <div class="setting-row clickable" @click="emit('openListening')">
            <div class="setting-info">
              <span class="setting-label">Listening Mode</span>
              <span class="setting-desc">Review phrases with passive listening</span>
            </div>
            <svg class="tool-icon headphones" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
              <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </div>

          <template v-if="showViewScript">
            <div class="divider"></div>

            <div class="setting-row clickable" @click="emit('openExplorer')">
              <div class="setting-info">
                <span class="setting-label">View Script</span>
                <span class="setting-desc">Browse course rounds and lego sequences</span>
              </div>
              <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
          </template>
        </div>
      </section>

      <!-- Display Section -->
      <section class="section">
        <h3 class="section-title">Display</h3>
        <div class="card">
          <div class="setting-row clickable" @click="toggleFirePath">
            <div class="setting-info">
              <span class="setting-label">Path Animation</span>
              <span class="setting-desc">Show traveling pulse along phrase path</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showFirePath }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Offline Section -->
      <section class="section">
        <h3 class="section-title">Offline Learning</h3>
        <div class="card">
          <!-- Cache Status -->
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Cached Content</span>
              <span class="setting-desc">{{ cacheStats.count }} audio files ({{ cacheStats.estimatedMB }}MB)</span>
            </div>
            <span class="setting-value" :class="{ 'is-offline': !isOnline }">
              {{ isOnline ? 'Online' : 'Offline' }}
            </span>
          </div>

          <div class="divider"></div>

          <!-- Download Options -->
          <div class="setting-row download-section" v-if="!isDownloading">
            <div class="setting-info">
              <span class="setting-label">Download for Offline</span>
              <span class="setting-desc">Pre-download content to learn without internet</span>
            </div>
          </div>

          <!-- Download Option Selection -->
          <div class="download-options" v-if="!isDownloading">
            <label class="download-option" v-for="(estimate, key) in storageEstimates" :key="key">
              <input
                type="radio"
                :value="key"
                v-model="offlineDownloadOption"
                name="downloadOption"
              />
              <span class="option-radio"></span>
              <span class="option-content">
                <span class="option-label">
                  {{ key === 'current' ? 'Current belt' : key === 'next50' ? 'Next 50 seeds' : key === 'next100' ? 'Next 100 seeds' : 'Entire course' }}
                </span>
                <span class="option-size">{{ estimate.size }}</span>
              </span>
            </label>
          </div>

          <!-- Download Button -->
          <div class="download-action" v-if="!isDownloading">
            <button
              class="download-btn"
              @click="startOfflineDownload"
              :disabled="!isOnline"
            >
              {{ isOnline ? 'Download' : 'Go online to download' }}
            </button>
          </div>

          <!-- Download Progress -->
          <div class="download-progress" v-if="isDownloading">
            <div class="progress-info">
              <span class="progress-label">Downloading {{ selectedEstimate.seeds }} seeds...</span>
              <span class="progress-percent">{{ downloadProgress }}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
            </div>
            <button class="cancel-btn" @click="cancelDownload">Cancel</button>
          </div>

          <!-- Download Error -->
          <div class="download-error" v-if="downloadError">
            {{ downloadError }}
          </div>
        </div>
      </section>

      <!-- Appearance Section -->
      <section class="section">
        <h3 class="section-title">Appearance</h3>
        <div class="card">
          <div class="setting-row clickable" @click="toggleTheme">
            <div class="setting-info">
              <span class="setting-label">Dark Mode</span>
              <span class="setting-desc">Toggle light/dark theme</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': isDarkMode }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Account Section (guest - not signed in) -->
      <section class="section" v-if="!isSignedIn">
        <h3 class="section-title">Account</h3>
        <div class="card">
          <div class="auth-cta-row">
            <p class="auth-cta-text">Sign in to save your progress across devices</p>
            <div class="auth-cta-buttons">
              <button class="auth-cta-btn primary" @click="openSignIn()">Sign In</button>
              <button class="auth-cta-btn secondary" @click="openSignUp()">Create Account</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Account Section (signed-in users) -->
      <section class="section" v-if="isSignedIn">
        <h3 class="section-title">Account</h3>
        <div class="card">
          <!-- User Info -->
          <div class="setting-row" v-if="userName || userEmail">
            <div class="setting-info">
              <span class="setting-label">{{ userName || 'User' }}</span>
              <span class="setting-desc">{{ userEmail }}</span>
            </div>
          </div>

          <div class="divider" v-if="userName || userEmail"></div>

          <!-- Update Profile -->
          <div class="setting-row clickable" @click="openUserProfile">
            <div class="setting-info">
              <span class="setting-label">Update Profile</span>
              <span class="setting-desc">Change your name and photo</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div class="divider"></div>

          <!-- Change Email -->
          <div class="setting-row clickable" @click="handleChangeEmail">
            <div class="setting-info">
              <span class="setting-label">Change Email</span>
              <span class="setting-desc">Update your email address</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <!-- Schools Dashboard -->
          <template v-if="hasSchoolRole">
            <div class="divider"></div>
            <div class="setting-row clickable" @click="router.push('/schools')">
              <div class="setting-info">
                <span class="setting-label">Schools Dashboard</span>
                <span class="setting-desc">Manage your classes and students</span>
              </div>
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </template>
        </div>
      </section>

      <!-- Join School/Class Section (only for signed-in users) -->
      <section class="section" v-if="isSignedIn">
        <h3 class="section-title">Schools</h3>
        <div class="card">
          <div class="setting-row" v-if="!showJoinCode">
            <div class="setting-info">
              <span class="setting-label">Join a School or Class</span>
              <span class="setting-desc">Enter an invite code from your teacher or school</span>
            </div>
            <button class="text-btn" @click="showJoinCode = true">Enter Code</button>
          </div>
          <div v-else class="join-code-form">
            <div class="join-code-input-row">
              <input
                v-model="joinCodeInput"
                @input="handleJoinCodeInput"
                type="text"
                placeholder="ABC-123"
                maxlength="7"
                class="join-code-input"
              />
              <button
                class="text-btn"
                :disabled="joinCodeInput.length < 5 || isJoinValidating"
                @click="handleJoinValidate"
              >
                {{ isJoinValidating ? '...' : 'Go' }}
              </button>
            </div>
            <p v-if="joinError" class="join-error">{{ joinError }}</p>
            <!-- Context confirmation -->
            <div v-if="joinContext" class="join-context">
              <p class="join-context-text">
                <strong>{{ joinContextRole }}</strong>
                <span v-if="joinContextDetail"> {{ joinContextDetail }}</span>
              </p>
              <div class="join-context-actions">
                <button class="text-btn" :disabled="isJoinRedeeming" @click="handleJoinRedeem">
                  {{ isJoinRedeeming ? 'Joining...' : 'Confirm' }}
                </button>
                <button class="text-btn text-btn--secondary" @click="joinContext = null; joinCodeInput = ''">Cancel</button>
              </div>
            </div>
            <p v-if="joinSuccess" class="join-success">Joined successfully!</p>
            <button class="text-btn text-btn--secondary" @click="showJoinCode = false; joinCodeInput = ''; joinError = ''; joinContext = null; joinSuccess = false">Close</button>
          </div>
        </div>
      </section>

      <!-- Subscription Section (only for signed-in users) -->
      <section class="section" v-if="isSignedIn">
        <h3 class="section-title">Subscription</h3>
        <div class="card">
          <div class="setting-row clickable" @click="handleCancelSubscription">
            <div class="setting-info">
              <span class="setting-label">Manage Subscription</span>
              <span class="setting-desc">View or cancel your subscription</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Data Section -->
      <section class="section">
        <h3 class="section-title">Data</h3>
        <div class="card">
          <div class="setting-row clickable danger" @click="handleResetClick">
            <div class="setting-info">
              <span class="setting-label">Reset Progress</span>
              <span class="setting-desc">Start fresh for this course</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div class="divider" v-if="isSignedIn"></div>

          <div class="setting-row clickable danger" @click="handleDeleteClick" v-if="isSignedIn">
            <div class="setting-info">
              <span class="setting-label">Delete Account</span>
              <span class="setting-desc">Permanently delete your account and all data</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Developer Section - TODO: Add v-if="isAdmin" once ready for production -->
      <section class="section">
        <h3 class="section-title">Developer</h3>
        <div class="card">
          <!-- Tools -->
          <div class="setting-row clickable" @click="toggleViewScript">
            <div class="setting-info">
              <span class="setting-label">View Script</span>
              <span class="setting-desc">Show script browser in Tools section</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showViewScript }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleQaMode">
            <div class="setting-info">
              <span class="setting-label">QA Mode</span>
              <span class="setting-desc">Show Report Issue button during learning</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': enableQaMode }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleDebugOverlay">
            <div class="setting-info">
              <span class="setting-label">Debug Overlay</span>
              <span class="setting-desc">Show phase, round, and LEGO info on screen</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showDebugOverlay }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleVerboseLogging">
            <div class="setting-info">
              <span class="setting-label">Verbose Logging</span>
              <span class="setting-desc">Enable detailed console logs</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': enableVerboseLogging }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- UI Visibility -->
          <div class="setting-row clickable" @click="toggleFragileProgressWarning">
            <div class="setting-info">
              <span class="setting-label">Fragile Progress Warning</span>
              <span class="setting-desc">Show "progress is fragile" banner for guests</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showFragileProgressWarning }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- Clear Cache & Reload -->
          <div class="setting-row clickable danger" @click="handleClearCacheAndReload">
            <div class="setting-info">
              <span class="setting-label">{{ isClearingCache ? 'Clearing...' : 'Clear Cache & Reload' }}</span>
              <span class="setting-desc">Clear all local data, service workers, and reload</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- About Section -->
      <section class="section">
        <h3 class="section-title">About</h3>
        <div class="card">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Version</span>
            </div>
            <span class="setting-value">{{ appVersion }} ({{ buildNumber }})</span>
          </div>
        </div>
      </section>

      <!-- Brand Footer -->
      <footer class="brand-footer">
        <div class="brand">
          <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
        </div>
        <p class="copyright">Made with love for language learners</p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* Fonts loaded globally in style.css */

.settings-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: var(--font-body);
  position: relative;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 70% 40% at 50% -10%, var(--accent-glow) 0%, transparent 50%),
    linear-gradient(to bottom, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  pointer-events: none;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.02;
  pointer-events: none;
}

/* Header */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--border-subtle);
}

.header-spacer {
  width: 2rem;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
  border-radius: 50%;
  transition: color 0.2s, background 0.2s;
}

.close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary, rgba(255,255,255,0.08));
}

.title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

/* Main */
.main {
  flex: 1;
  padding: 1rem 1.5rem 2rem;
  position: relative;
  z-index: 10;
  overflow-y: auto;
}

/* Section */
.section {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0.25rem;
}

/* Card */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  overflow: hidden;
}

.divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 0 1rem;
}

/* Setting Row */
.setting-row {
  display: flex;
  align-items: center;
  padding: 0.875rem 1rem;
  gap: 1rem;
}

.setting-row.clickable {
  cursor: pointer;
  transition: background 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.setting-row.clickable:hover {
  background: var(--bg-elevated);
}

.setting-row.clickable:active {
  background: var(--bg-card);
}

.setting-row.danger .setting-label {
  color: #ef4444;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  display: block;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.125rem;
}

.setting-desc {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.setting-value {
  font-family: 'Space Mono', monospace;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.chevron {
  width: 20px;
  height: 20px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.tool-icon {
  width: 22px;
  height: 22px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.setting-row.clickable:hover .tool-icon {
  color: var(--gold);
}

.tool-icon.headphones {
  color: var(--gold);
}

/* Auth CTA */
.auth-cta-row {
  padding: 1rem;
  text-align: center;
}

.auth-cta-text {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0 0 1rem;
}

.auth-cta-buttons {
  display: flex;
  gap: 0.75rem;
}

.auth-cta-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.auth-cta-btn.primary {
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  border: none;
  color: white;
}

.auth-cta-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(194, 58, 58, 0.4);
}

.auth-cta-btn.secondary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-secondary);
}

.auth-cta-btn.secondary:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: var(--text-primary);
}

/* Toggle Switch */
.toggle-switch {
  width: 48px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-track {
  width: 100%;
  height: 100%;
  background: var(--bg-elevated);
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  position: relative;
  transition: all 0.3s ease;
}

.toggle-switch.is-on .toggle-track {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: var(--bg-primary);
  border-radius: 50%;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: var(--shadow-sm);
}

.toggle-switch.is-on .toggle-thumb {
  transform: translateX(20px);
}

/* Brand Footer */
.brand-footer {
  text-align: center;
  padding: 2rem 0;
  margin-top: 1rem;
}

.brand {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.02em;
  margin-bottom: 0.5rem;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

.copyright {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
}

/* Reset Dialog */
.reset-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(8px);
  padding: 1.5rem;
}

.reset-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: 1rem;
  padding: 2rem;
  max-width: 340px;
  text-align: center;
}

.reset-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 1rem;
  color: #ef4444;
}

.reset-icon svg {
  width: 100%;
  height: 100%;
}

.reset-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem;
}

.reset-desc {
  font-size: 0.875rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0 0 1.5rem;
}

.reset-error {
  font-size: 0.875rem;
  color: #ef4444;
  margin: -0.5rem 0 1rem;
}

.reset-success {
  font-size: 0.875rem;
  color: #22c55e;
  margin: -0.5rem 0 1rem;
}

.reset-actions {
  display: flex;
  gap: 0.75rem;
}

.reset-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.reset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.reset-btn--cancel {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.reset-btn--cancel:hover:not(:disabled) {
  background: var(--bg-card);
  color: var(--text-primary);
}

.reset-btn--confirm {
  background: #ef4444;
  color: var(--text-on-accent);
}

.reset-btn--confirm:hover:not(:disabled) {
  background: #dc2626;
}

/* Offline Download Styles */
.is-offline {
  color: #ef4444;
}

.download-section {
  border-bottom: none;
}

.download-options {
  padding: 0.5rem 1rem 1rem;
}

.download-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.download-option input {
  display: none;
}

.option-radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--text-muted);
  flex-shrink: 0;
  position: relative;
  transition: border-color 0.2s ease;
}

.download-option input:checked + .option-radio {
  border-color: var(--accent);
}

.download-option input:checked + .option-radio::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.option-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-label {
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.option-size {
  font-family: 'Space Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.download-action {
  padding: 0.5rem 1rem 1rem;
}

.download-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  background: var(--accent);
  color: var(--text-on-accent);
}

.download-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.download-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-elevated);
  color: var(--text-muted);
}

.download-progress {
  padding: 1rem;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.progress-percent {
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  color: var(--accent);
}

.progress-bar {
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.cancel-btn {
  width: 100%;
  padding: 0.625rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.cancel-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.download-error {
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border-top: 1px solid var(--border-subtle);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE - Simplified 2-breakpoint system
   Base: Mobile (0-767px)
   768px+: Tablet/Desktop
   ═══════════════════════════════════════════════════════════════ */

/* Tablet and Desktop (768px+) */
@media (min-width: 768px) {
  .main {
    padding: 1rem 2rem 2rem;
  }

  .section {
    margin-bottom: 2rem;
  }

  .card {
    border-radius: 20px;
  }

  .setting-row {
    padding: 1rem 1.25rem;
  }

  .setting-label {
    font-size: 1rem;
  }

  .setting-desc {
    font-size: 0.875rem;
  }

  .reset-dialog {
    padding: 2.5rem;
    max-width: 400px;
  }
}

/* Landscape phones - compact vertical spacing */
@media (orientation: landscape) and (max-height: 500px) {
  .settings-screen {
    padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px));
  }

  .header {
    padding: 0.5rem 1rem;
    position: relative;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-bottom: none;
  }

  .title {
    font-size: 1rem;
  }

  .main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem 1rem;
    align-items: start;
    max-width: none;
    padding: 0.5rem 1rem 1rem;
  }

  .section {
    margin-bottom: 0;
  }

  .section-title {
    font-size: 0.6875rem;
    margin-bottom: 0.5rem;
  }

  .card {
    border-radius: 12px;
  }

  .setting-row {
    padding: 0.5rem 0.75rem;
  }

  .setting-label {
    font-size: 0.8125rem;
  }

  .setting-desc {
    font-size: 0.6875rem;
  }

  .toggle-switch {
    width: 40px;
    height: 24px;
  }

  .toggle-thumb {
    width: 16px;
    height: 16px;
  }

  .toggle-switch.is-on .toggle-thumb {
    transform: translateX(16px);
  }

  .brand-footer {
    grid-column: 1 / -1;
    padding: 1rem 0;
    margin-top: 0;
  }

  .brand {
    font-size: 0.875rem;
  }

  .copyright {
    font-size: 0.6875rem;
  }

  /* Hide less essential sections in landscape */
  .download-options,
  .download-action {
    display: none;
  }
}

/* Join code form */
.join-code-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
}

.join-code-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.join-code-input {
  flex: 1;
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 1.125rem;
  letter-spacing: 0.2em;
  text-align: center;
  text-transform: uppercase;
  font-family: var(--font-mono);
  outline: none;
}

.join-code-input:focus {
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 2px rgba(194, 58, 58, 0.15);
}

.join-error {
  color: var(--error);
  font-size: 0.8125rem;
  margin: 0;
}

.join-success {
  color: var(--success);
  font-size: 0.8125rem;
  margin: 0;
}

.join-context {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.join-context-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 0.5rem;
}

.join-context-actions {
  display: flex;
  gap: 0.5rem;
}

.text-btn {
  padding: 0.375rem 0.75rem;
  background: rgba(194, 58, 58, 0.15);
  border: 1px solid rgba(194, 58, 58, 0.3);
  border-radius: 6px;
  color: var(--ssi-red);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.text-btn:hover:not(:disabled) {
  background: rgba(194, 58, 58, 0.25);
}

.text-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-btn--secondary {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.15);
  color: var(--text-muted);
}

.text-btn--secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}
</style>

<!-- Mist theme: paper surfaces instead of glass -->
<style>
:root[data-theme="mist"] .settings-screen .header {
  background: #EDEAE6;
  border-bottom: 1px solid rgba(122, 110, 98, 0.1);
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.05);
}

:root[data-theme="mist"] .settings-screen .reset-overlay {
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

:root[data-theme="mist"] .settings-screen .reset-dialog {
  background: #F5F3F0;
  border: 1px solid rgba(122, 110, 98, 0.12);
  box-shadow: 0 4px 12px rgba(44, 38, 34, 0.1), 0 20px 60px rgba(44, 38, 34, 0.12);
}
</style>
