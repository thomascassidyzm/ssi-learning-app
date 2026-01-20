<script setup>
import { ref, computed, inject, onMounted, onUnmounted } from 'vue'
import { getAudioCacheStats, preloadAudioBatch } from '../composables/useScriptCache'
import { BELT_RANGES, getBeltForSeed } from '../composables/useBeltLoader'
import { useBeltProgress } from '../composables/useBeltProgress'

const emit = defineEmits(['close', 'openExplorer', 'openNetwork', 'openListening', 'settingChanged'])

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
const { completedSeeds } = useBeltProgress(courseCode.value)

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

// Theme settings
const isDarkMode = ref(true) // Default to dark mode

// Account management state
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)
const deleteError = ref(null)

// Check if user is signed in
const isSignedIn = computed(() => auth?.user?.value != null)
const userEmail = computed(() => auth?.user?.value?.emailAddresses?.[0]?.emailAddress || '')
const userName = computed(() => auth?.user?.value?.fullName || auth?.user?.value?.firstName || '')

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

// Toggle dark/light mode
const toggleTheme = () => {
  isDarkMode.value = !isDarkMode.value
  document.documentElement.setAttribute('data-theme', isDarkMode.value ? 'dark' : 'light')
  localStorage.setItem('ssi-theme', isDarkMode.value ? 'dark' : 'light')
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
    const currentSeed = completedSeeds.value + 1 // Start from next seed
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

    // Phase 1: Generate scripts and collect audio URLs (50% of progress)
    const allAudioUrls = []
    const chunkSize = 20

    for (let seed = startSeed; seed <= endSeed; seed += chunkSize) {
      if (downloadAbortController.signal.aborted) {
        console.log('[Settings] Download cancelled during script phase')
        return
      }

      const count = Math.min(chunkSize, endSeed - seed + 1)

      try {
        const script = await courseDataProvider.value.generateLearningScript(seed, count)

        // Extract audio URLs from script
        for (const round of script.rounds || []) {
          for (const item of round.items || []) {
            if (item.audioRefs) {
              if (item.audioRefs.known?.url) allAudioUrls.push(item.audioRefs.known.url)
              if (item.audioRefs.target?.voice1?.url) allAudioUrls.push(item.audioRefs.target.voice1.url)
              if (item.audioRefs.target?.voice2?.url) allAudioUrls.push(item.audioRefs.target.voice2.url)
            }
          }
        }
      } catch (err) {
        console.warn(`[Settings] Failed to generate script for seed ${seed}:`, err)
      }

      // Update progress (0-50% for scripts)
      const scriptsProgress = Math.round(((seed - startSeed + count) / totalSeeds) * 50)
      downloadProgress.value = scriptsProgress
    }

    console.log(`[Settings] Collected ${allAudioUrls.length} audio URLs, starting download`)

    // Phase 2: Download audio files (50-100% of progress)
    const audioBatchSize = 10
    const totalAudio = allAudioUrls.length

    for (let i = 0; i < allAudioUrls.length; i += audioBatchSize) {
      if (downloadAbortController.signal.aborted) {
        console.log('[Settings] Download cancelled during audio phase')
        return
      }

      const batch = allAudioUrls.slice(i, i + audioBatchSize)
      await preloadAudioBatch(batch)

      // Update progress (50-100% for audio)
      const audioProgress = 50 + Math.round(((i + batch.length) / totalAudio) * 50)
      downloadProgress.value = audioProgress
    }

    // Update cache stats after download
    cacheStats.value = await getAudioCacheStats()

    downloadProgress.value = 100
    console.log(`[Settings] Offline download complete: ${totalSeeds} seeds, ${allAudioUrls.length} audio files`)
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
      <h1 class="title">Settings</h1>
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

          <div class="divider"></div>

          <div class="setting-row clickable" @click="emit('openExplorer')">
            <div class="setting-info">
              <span class="setting-label">Script Explorer</span>
              <span class="setting-desc">Browse and play the full learning script</span>
            </div>
            <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <path d="M14 2v6h6"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="emit('openNetwork')">
            <div class="setting-info">
              <span class="setting-label">Brain Network</span>
              <span class="setting-desc">Visualize your vocabulary connections</span>
            </div>
            <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <circle cx="19" cy="5" r="2"/>
              <circle cx="5" cy="19" r="2"/>
              <circle cx="5" cy="5" r="2"/>
              <circle cx="19" cy="19" r="2"/>
              <line x1="14" y1="10" x2="17" y2="7"/>
              <line x1="10" y1="14" x2="7" y2="17"/>
              <line x1="10" y1="10" x2="7" y2="7"/>
              <line x1="14" y1="14" x2="17" y2="17"/>
            </svg>
          </div>
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

      <!-- Account Section (only for signed-in users) -->
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

          <div class="divider"></div>

          <!-- Change Password -->
          <div class="setting-row clickable" @click="handleChangePassword">
            <div class="setting-info">
              <span class="setting-label">Change Password</span>
              <span class="setting-desc">Update your password</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
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
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.settings-screen {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
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
  justify-content: center;
  padding: 1rem 1.5rem;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--border-subtle);
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
  background: white;
  border-radius: 50%;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
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
  font-family: 'DM Sans', sans-serif;
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
  background: rgba(0, 0, 0, 0.7);
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
  color: white;
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
  color: white;
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

/* Responsive */
@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
  }

  .main {
    padding: 1rem 1rem 1.5rem;
  }

  .setting-row {
    padding: 0.875rem 1rem;
  }
}

@media (min-width: 768px) {
  .main {
    max-width: 600px;
    margin: 0 auto;
  }
}
</style>
