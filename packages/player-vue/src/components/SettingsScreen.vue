<script setup>
import { ref, computed } from 'vue'

const emit = defineEmits(['close'])

// Settings state
const settings = ref({
  theme: 'dark',
  autoplayEnabled: true,
  soundEffects: true,
  hapticFeedback: true,
  pauseDuration: 'adaptive', // 'adaptive', 'short', 'normal', 'long'
  notificationsEnabled: true,
  dailyReminder: '09:00',
  streakReminder: true,
})

// Theme options
const themeOptions = [
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'auto', label: 'System', icon: 'auto' },
]

// Pause duration options
const pauseOptions = [
  { value: 'short', label: 'Short', desc: '2x speed' },
  { value: 'normal', label: 'Normal', desc: '3x speed' },
  { value: 'adaptive', label: 'Adaptive', desc: 'Based on your pace' },
  { value: 'long', label: 'Long', desc: '4x speed' },
]

// Toggle functions
const toggleSetting = (key) => {
  settings.value[key] = !settings.value[key]
}

const setTheme = (theme) => {
  settings.value.theme = theme
  document.documentElement.setAttribute('data-theme', theme === 'auto' ? 'dark' : theme)
  localStorage.setItem('ssi-theme', theme)
}

const setPauseDuration = (duration) => {
  settings.value.pauseDuration = duration
}

// App info
const appVersion = '1.0.0'
const buildNumber = '2024.12.16'
</script>

<template>
  <div class="settings-screen">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-noise"></div>

    <!-- Header -->
    <header class="header">
      <h1 class="title">Settings</h1>
    </header>

    <!-- Main Content -->
    <main class="main">
      <!-- Appearance Section -->
      <section class="section">
        <h3 class="section-title">Appearance</h3>
        <div class="card">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Theme</span>
              <span class="setting-desc">Choose your preferred appearance</span>
            </div>
          </div>
          <div class="theme-options">
            <button
              v-for="opt in themeOptions"
              :key="opt.value"
              class="theme-option"
              :class="{ active: settings.theme === opt.value }"
              @click="setTheme(opt.value)"
            >
              <div class="theme-icon">
                <svg v-if="opt.icon === 'moon'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
                <svg v-else-if="opt.icon === 'sun'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="5"/>
                  <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                  <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </div>
              <span class="theme-label">{{ opt.label }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Learning Section -->
      <section class="section">
        <h3 class="section-title">Learning</h3>
        <div class="card">
          <div class="setting-row clickable" @click="toggleSetting('autoplayEnabled')">
            <div class="setting-info">
              <span class="setting-label">Auto-play</span>
              <span class="setting-desc">Automatically continue to next phrase</span>
            </div>
            <div class="toggle" :class="{ active: settings.autoplayEnabled }">
              <div class="toggle-thumb"></div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Pause Duration</span>
              <span class="setting-desc">Time to speak before the answer</span>
            </div>
          </div>
          <div class="pause-options">
            <button
              v-for="opt in pauseOptions"
              :key="opt.value"
              class="pause-option"
              :class="{ active: settings.pauseDuration === opt.value }"
              @click="setPauseDuration(opt.value)"
            >
              <span class="pause-label">{{ opt.label }}</span>
              <span class="pause-desc">{{ opt.desc }}</span>
            </button>
          </div>
        </div>
      </section>

      <!-- Audio Section -->
      <section class="section">
        <h3 class="section-title">Audio & Feedback</h3>
        <div class="card">
          <div class="setting-row clickable" @click="toggleSetting('soundEffects')">
            <div class="setting-info">
              <span class="setting-label">Sound Effects</span>
              <span class="setting-desc">UI sounds and celebrations</span>
            </div>
            <div class="toggle" :class="{ active: settings.soundEffects }">
              <div class="toggle-thumb"></div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleSetting('hapticFeedback')">
            <div class="setting-info">
              <span class="setting-label">Haptic Feedback</span>
              <span class="setting-desc">Vibration on interactions</span>
            </div>
            <div class="toggle" :class="{ active: settings.hapticFeedback }">
              <div class="toggle-thumb"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Notifications Section -->
      <section class="section">
        <h3 class="section-title">Notifications</h3>
        <div class="card">
          <div class="setting-row clickable" @click="toggleSetting('notificationsEnabled')">
            <div class="setting-info">
              <span class="setting-label">Push Notifications</span>
              <span class="setting-desc">Daily reminders and streak alerts</span>
            </div>
            <div class="toggle" :class="{ active: settings.notificationsEnabled }">
              <div class="toggle-thumb"></div>
            </div>
          </div>

          <template v-if="settings.notificationsEnabled">
            <div class="divider"></div>

            <div class="setting-row clickable" @click="toggleSetting('streakReminder')">
              <div class="setting-info">
                <span class="setting-label">Streak Reminders</span>
                <span class="setting-desc">Alert before losing your streak</span>
              </div>
              <div class="toggle" :class="{ active: settings.streakReminder }">
                <div class="toggle-thumb"></div>
              </div>
            </div>

            <div class="divider"></div>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">Daily Reminder</span>
                <span class="setting-desc">{{ settings.dailyReminder }}</span>
              </div>
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </template>
        </div>
      </section>

      <!-- Account Section -->
      <section class="section">
        <h3 class="section-title">Account</h3>
        <div class="card">
          <div class="setting-row clickable">
            <div class="setting-info">
              <span class="setting-label">Download Progress</span>
              <span class="setting-desc">Export your learning data</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable danger">
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

          <div class="divider"></div>

          <div class="setting-row clickable">
            <div class="setting-info">
              <span class="setting-label">Terms of Service</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable">
            <div class="setting-info">
              <span class="setting-label">Privacy Policy</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable">
            <div class="setting-info">
              <span class="setting-label">Send Feedback</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
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

/* Toggle */
.toggle {
  width: 48px;
  height: 28px;
  background: var(--bg-elevated);
  border-radius: 100px;
  position: relative;
  cursor: pointer;
  transition: background 0.3s ease;
  flex-shrink: 0;
}

.toggle.active {
  background: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  background: white;
  border-radius: 50%;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toggle.active .toggle-thumb {
  transform: translateX(20px);
}

/* Theme Options */
.theme-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  padding: 0 1rem 1rem;
}

.theme-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem 0.5rem;
  background: var(--bg-elevated);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-option:hover {
  background: var(--bg-card);
}

.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-glow);
}

.theme-icon {
  width: 28px;
  height: 28px;
  color: var(--text-secondary);
}

.theme-option.active .theme-icon {
  color: var(--accent);
}

.theme-icon svg {
  width: 100%;
  height: 100%;
}

.theme-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.theme-option.active .theme-label {
  color: var(--text-primary);
}

/* Pause Options */
.pause-options {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  padding: 0 1rem 1rem;
}

.pause-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.875rem;
  background: var(--bg-elevated);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.pause-option:hover {
  background: var(--bg-card);
}

.pause-option.active {
  border-color: var(--gold);
  background: var(--gold-glow);
}

.pause-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.pause-option.active .pause-label {
  color: var(--gold);
}

.pause-desc {
  font-size: 0.6875rem;
  color: var(--text-muted);
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

  .theme-options {
    gap: 0.375rem;
    padding: 0 0.75rem 0.75rem;
  }

  .theme-option {
    padding: 0.75rem 0.25rem;
  }

  .pause-options {
    gap: 0.375rem;
    padding: 0 0.75rem 0.75rem;
  }

  .pause-option {
    padding: 0.75rem;
  }
}

@media (min-width: 768px) {
  .main {
    max-width: 600px;
    margin: 0 auto;
  }

  .pause-options {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
