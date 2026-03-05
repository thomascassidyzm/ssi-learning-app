<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  currentScreen: {
    type: String,
    default: 'player'
  },
  isLearning: {
    type: Boolean,
    default: false
  },
  isPlaying: {
    type: Boolean,
    default: false
  },
  isListeningMode: {
    type: Boolean,
    default: false
  },
  isDrivingMode: {
    type: Boolean,
    default: false
  },
  showLibrary: {
    type: Boolean,
    default: false
  },
  showSettings: {
    type: Boolean,
    default: false
  },
  showSessionComplete: {
    type: Boolean,
    default: false
  },
  isAuthOpen: {
    type: Boolean,
    default: false
  },
  hasRomanizedText: {
    type: Boolean,
    default: false
  },
  isNativeScript: {
    type: Boolean,
    default: false
  },
  isPlayerReady: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['navigate', 'startLearning', 'togglePlayback', 'exitListeningMode', 'exitDrivingMode', 'toggleListening', 'toggleDriving', 'toggleScript', 'revisit', 'skip', 'openSettings', 'closeOverlays', 'closeAuth'])

// Tap feedback
const tappedItem = ref(null)
const playButtonPressed = ref(false)

const isOnPlayerScreen = computed(() => props.currentScreen === 'player')
const hasOverlayOpen = computed(() => props.showLibrary || props.showSettings)

const isStopMode = computed(() =>
  props.isPlaying && !props.isListeningMode && !props.isDrivingMode
)

const hasActiveMode = computed(() => props.isListeningMode || props.isDrivingMode)

const isReturnMode = computed(() =>
  ((!isOnPlayerScreen.value || hasOverlayOpen.value || props.isAuthOpen) && !props.isPlaying) || hasActiveMode.value
)

const handleNavTap = (itemId) => {
  tappedItem.value = itemId
  setTimeout(() => { tappedItem.value = null }, 150)
  if (navigator.vibrate) navigator.vibrate(10)
  if (props.isListeningMode) emit('exitListeningMode')
  if (props.isDrivingMode) emit('exitDrivingMode')
  emit('navigate', itemId)
}

const isPlayDisabled = computed(() =>
  isOnPlayerScreen.value && !props.isPlaying && !props.isPlayerReady && !hasOverlayOpen.value && !props.isAuthOpen && !hasActiveMode.value
)

const handlePlayTap = () => {
  if (isPlayDisabled.value) return
  playButtonPressed.value = true
  setTimeout(() => { playButtonPressed.value = false }, 200)
  if (navigator.vibrate) navigator.vibrate([10, 50, 10])
  // Exit active mode (listening or driving) — return to player
  if (props.isListeningMode) {
    emit('exitListeningMode')
    return
  }
  if (props.isDrivingMode) {
    emit('exitDrivingMode')
    return
  }
  // Back arrow when auth is open — close it
  if (props.isAuthOpen) {
    emit('closeAuth')
    return
  }
  // Back arrow when overlay is open — close it
  if (hasOverlayOpen.value && !props.isPlaying) {
    emit('closeOverlays')
    return
  }
  if (props.isPlaying || isOnPlayerScreen.value) {
    emit('togglePlayback')
  } else {
    emit('startLearning')
  }
}

const handleRevisit = () => {
  if (navigator.vibrate) navigator.vibrate(10)
  emit('revisit')
}

const handleSkip = () => {
  if (navigator.vibrate) navigator.vibrate(10)
  emit('skip')
}

const handleSettings = () => {
  if (navigator.vibrate) navigator.vibrate(10)
  emit('openSettings')
}
</script>

<template>
  <nav class="bottom-nav">
    <!-- Mode buttons — positioned absolutely relative to the pill so they stay in sync on Android -->
    <button
      v-show="!showSessionComplete && isOnPlayerScreen"
      class="mode-btn mode-btn--left"
      :class="{ active: isListeningMode, disabled: isDrivingMode }"
      @click="emit('toggleListening')"
      title="Listening mode"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
      </svg>
    </button>
    <button
      v-show="!showSessionComplete && isOnPlayerScreen && hasRomanizedText"
      class="mode-btn mode-btn--right-inner"
      :class="{ active: isNativeScript }"
      @click="emit('toggleScript')"
      :title="isNativeScript ? 'Show romanized' : 'Show native script'"
    >
      <span class="script-toggle-label">{{ isNativeScript ? 'Aa' : '\u6587' }}</span>
    </button>
    <button
      v-show="!showSessionComplete && isOnPlayerScreen"
      class="mode-btn mode-btn--right"
      :class="{ active: isDrivingMode, disabled: isListeningMode }"
      @click="emit('toggleDriving')"
      title="Driving mode"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M5 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM15 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z"/>
        <path d="M5 17H3v-6l2-5h10l4 5h2v6h-2"/>
        <path d="M5 11h14"/>
        <path d="M9 17h6"/>
      </svg>
    </button>

    <div class="nav-backdrop"></div>

    <div class="nav-content">
      <!-- Slot 1: Library -->
      <button
        class="pill-btn"
        :class="{
          active: showLibrary,
          tapped: tappedItem === 'library'
        }"
        @click="handleNavTap('library')"
        title="Library"
      >
        <span class="pill-btn-bg"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/>
          <rect x="14" y="14" width="7" height="7" rx="1.5"/>
        </svg>
      </button>

      <!-- Slot 2: Revisit (hidden on non-player screens) -->
      <button v-show="isOnPlayerScreen" class="pill-btn" :class="{ tapped: tappedItem === 'revisit' }" @click="handleRevisit" title="Revisit">
        <span class="pill-btn-bg"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <!-- Slot 3: Play / Stop / Return -->
      <button
        class="center-btn"
        :class="{
          pressed: playButtonPressed,
          'is-stop': isStopMode,
          'is-return': isReturnMode,
          'is-disabled': isPlayDisabled,
        }"
        @click="handlePlayTap"
      >
        <div class="center-btn-inner">
          <svg v-if="isStopMode" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          <svg v-else-if="isReturnMode" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="7 3 20 12 7 21 7 3"/>
          </svg>
        </div>
      </button>

      <!-- Slot 4: Skip (hidden on non-player screens) -->
      <button v-show="isOnPlayerScreen" class="pill-btn" :class="{ tapped: tappedItem === 'skip' }" @click="handleSkip" title="Skip">
        <span class="pill-btn-bg"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- Slot 5: Settings (gear) -->
      <button
        class="pill-btn"
        :class="{ active: showSettings, tapped: tappedItem === 'settings' }"
        @click="handleSettings"
        title="Settings"
      >
        <span class="pill-btn-bg"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>

    <div class="safe-area-spacer"></div>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  /* Use half the safe area on iPhone (native apps do the same),
     with 12px minimum for desktop/browser where safe area is 0 */
  bottom: max(calc(env(safe-area-inset-bottom, 0px) / 2), 12px);
  left: 50%;
  right: auto;
  transform: translateX(-50%);
  width: calc(100% - 2rem);
  max-width: 400px;
  z-index: 3000;
  overflow: visible;
}

.nav-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(10, 10, 18, 0.82);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  border-radius: 32px;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.5),
    0 8px 24px rgba(0, 0, 0, 0.4),
    0 20px 48px rgba(0, 0, 0, 0.25);
  z-index: 100;
}

.nav-content {
  position: relative;
  z-index: 102;
  display: flex;
  align-items: center;
  justify-content: space-evenly;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  height: 72px;
  padding: 0 10px;
}

/* Pill buttons (outer 4 slots) */
.pill-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
  transition: color 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}

.pill-btn svg {
  position: relative;
  z-index: 1;
  width: 24px;
  height: 24px;
}

.pill-btn:active,
.pill-btn.tapped {
  transform: scale(0.88);
}

/* Circle highlight background (Telegram-style) */
.pill-btn-bg {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: transparent;
  transition: background 0.2s ease;
}

.pill-btn.active .pill-btn-bg {
  background: rgba(255, 255, 255, 0.12);
}

.pill-btn.active {
  color: var(--text-primary);
}

@media (hover: hover) {
  .pill-btn:hover:not(.active) .pill-btn-bg {
    background: rgba(255, 255, 255, 0.08);
  }
  .pill-btn:hover:not(.active) {
    color: rgba(255, 255, 255, 0.7);
  }
}

/* Center play/stop button */
.center-btn {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, var(--ssi-red-light) 0%, var(--ssi-red) 100%);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 4px 16px rgba(194, 58, 58, 0.4),
    0 8px 24px rgba(194, 58, 58, 0.2);
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}

.center-btn:active,
.center-btn.pressed {
  transform: scale(0.9);
}

.center-btn-inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.center-btn-inner svg {
  width: 24px;
  height: 24px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.center-btn:not(.is-stop):not(.is-disabled):not(.is-return) .center-btn-inner svg {
  margin-left: 2px;
}

.center-btn.is-disabled {
  background: linear-gradient(145deg, rgba(160, 160, 160, 0.6) 0%, rgba(120, 120, 120, 0.6) 100%);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  cursor: default;
}

.center-btn.is-disabled .center-btn-inner {
  opacity: 0.5;
}

.center-btn.is-return {
  background: var(--bg-elevated);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.center-btn.is-return .center-btn-inner {
  color: var(--text-primary);
}

/* ═══════════════════════════════════════════════════════════════
   MODE BUTTONS — anchored to the pill, always in sync
   ═══════════════════════════════════════════════════════════════ */
.mode-btn {
  position: absolute;
  bottom: calc(100% + 12px);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.35);
  background: rgba(10, 10, 18, 0.82);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
  color: var(--text-muted);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.5),
    0 8px 20px rgba(0, 0, 0, 0.25);
  z-index: 103;
}

.mode-btn--left {
  left: 16px;
}

.mode-btn--right-inner {
  right: 64px;
}

.mode-btn--right {
  right: 16px;
}

.mode-btn svg {
  width: 20px;
  height: 20px;
}

.mode-btn:active {
  transform: scale(0.9);
}

.mode-btn.active {
  background: rgba(10, 10, 18, 0.92);
  border-color: rgba(255, 255, 255, 0.5);
  color: var(--text-primary);
}

.mode-btn.disabled {
  opacity: 0.3;
  pointer-events: none;
}

.script-toggle-label {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  user-select: none;
}

/* Safe area — not needed for floating pill (bottom offset includes safe area) */
.safe-area-spacer {
  display: none;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════════════════════ */

@media (min-width: 768px) {
  .nav-content {
    max-width: 420px;
    height: 68px;
  }
  .pill-btn { width: 52px; height: 52px; }
  .pill-btn svg { width: 24px; height: 24px; }
  .center-btn { width: 56px; height: 56px; }
  .center-btn-inner svg { width: 24px; height: 24px; }
}

@media (orientation: landscape) and (max-height: 500px) {
  .nav-content {
    height: 52px;
    max-width: 380px;
  }
  .pill-btn { width: 40px; height: 40px; }
  .pill-btn svg { width: 18px; height: 18px; }
  .center-btn { width: 42px; height: 42px; }
  .center-btn-inner svg { width: 18px; height: 18px; }
  .safe-area-spacer { min-height: 2px; }
}

/* ═══════════════════════════════════════════════════════════════
   MIST (LIGHT) THEME — Color overrides only
   Layout/sizing shared with cosmos via base styles above.
   ═══════════════════════════════════════════════════════════════ */

:root[data-theme="mist"] .nav-backdrop {
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.14),
              0 8px 24px rgba(44, 38, 34, 0.10),
              0 20px 48px rgba(44, 38, 34, 0.06);
}

/* Button stroke colors on white pill — neutral, no belt tint */
:root[data-theme="mist"] .pill-btn {
  color: #6B6560;
}

:root[data-theme="mist"] .pill-btn.active .pill-btn-bg {
  background: rgba(0, 0, 0, 0.06);
}

:root[data-theme="mist"] .pill-btn.active {
  color: #2C2622;
}

@media (hover: hover) {
  :root[data-theme="mist"] .pill-btn:hover:not(.active) {
    color: #2C2622;
  }
  :root[data-theme="mist"] .pill-btn:hover:not(.active) .pill-btn-bg {
    background: rgba(0, 0, 0, 0.04);
  }
}

:root[data-theme="mist"] .center-btn.is-disabled {
  background: linear-gradient(145deg, rgba(180, 175, 170, 0.5) 0%, rgba(160, 155, 150, 0.5) 100%);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.08);
}

:root[data-theme="mist"] .center-btn.is-return {
  background: rgba(0, 0, 0, 0.06);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
}

:root[data-theme="mist"] .center-btn.is-return .center-btn-inner {
  color: #2C2622;
}

/* Mode buttons on mist — match white pill */
:root[data-theme="mist"] .mode-btn {
  background: rgba(255, 255, 255, 0.96);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  color: #6B6560;
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.14),
              0 8px 20px rgba(44, 38, 34, 0.08);
}

:root[data-theme="mist"] .mode-btn.active {
  background: rgba(255, 255, 255, 0.96);
  border-color: rgba(0, 0, 0, 0.45);
  color: #2C2622;
}

:root[data-theme="mist"] .script-toggle-label {
  color: inherit;
}
</style>
