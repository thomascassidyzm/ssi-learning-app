<script setup>
import { ref, computed, inject, onMounted } from 'vue'

const emit = defineEmits(['close', 'openExplorer', 'openNetwork', 'settingChanged'])

const props = defineProps({
  course: {
    type: Object,
    default: null
  }
})

// Inject auth and data providers
const auth = inject('auth', null)
const supabase = inject('supabase', null)

// Reset progress state
const showResetConfirm = ref(false)
const isResetting = ref(false)
const resetError = ref(null)
const resetSuccess = ref(false)

// Current course info for reset
const courseName = computed(() => props.course?.display_name || props.course?.course_code || 'this course')
const courseCode = computed(() => props.course?.course_code)

// App info
const appVersion = '1.0.0'
const buildNumber = '2024.12.16'

// Display settings
const showFirePath = ref(true)

onMounted(() => {
  // Load saved display settings
  showFirePath.value = localStorage.getItem('ssi-show-fire-path') !== 'false'
})

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

    <!-- Header -->
    <header class="header">
      <h1 class="title">Settings</h1>
    </header>

    <!-- Main Content -->
    <main class="main">
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

      <!-- Account Section -->
      <section class="section">
        <h3 class="section-title">Account</h3>
        <div class="card">
          <div class="setting-row clickable danger" @click="handleResetClick">
            <div class="setting-info">
              <span class="setting-label">Reset Progress</span>
              <span class="setting-desc">Start fresh (cannot be undone)</span>
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
