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
  }
})

const emit = defineEmits(['navigate', 'startLearning', 'togglePlayback', 'exitListeningMode', 'revisit', 'skip', 'openSettings'])

// Tap feedback
const tappedItem = ref(null)
const playButtonPressed = ref(false)

const isOnPlayerScreen = computed(() => props.currentScreen === 'player')

const isStopMode = computed(() =>
  isOnPlayerScreen.value && props.isPlaying && !props.isListeningMode
)

const handleNavTap = (itemId) => {
  tappedItem.value = itemId
  setTimeout(() => { tappedItem.value = null }, 150)
  if (navigator.vibrate) navigator.vibrate(10)
  if (props.isListeningMode) emit('exitListeningMode')
  emit('navigate', itemId)
}

const handlePlayTap = () => {
  if (props.isListeningMode) return
  playButtonPressed.value = true
  setTimeout(() => { playButtonPressed.value = false }, 200)
  if (navigator.vibrate) navigator.vibrate([10, 50, 10])
  if (isOnPlayerScreen.value) {
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
    <div class="nav-backdrop"></div>

    <div class="nav-content">
      <!-- Slot 1: Library -->
      <button
        class="pill-btn"
        :class="{
          active: currentScreen === 'library',
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

      <!-- Slot 2: Revisit -->
      <button class="pill-btn" :class="{ tapped: tappedItem === 'revisit' }" @click="handleRevisit" title="Revisit">
        <span class="pill-btn-bg"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <!-- Slot 3: Play / Stop -->
      <button
        class="center-btn"
        :class="{
          pressed: playButtonPressed,
          'is-stop': isStopMode,
          'is-disabled': isListeningMode
        }"
        :disabled="isListeningMode"
        @click="handlePlayTap"
      >
        <div class="center-btn-inner">
          <svg v-if="isStopMode" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          <svg v-else-if="isListeningMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
            <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="7 3 20 12 7 21 7 3"/>
          </svg>
        </div>
      </button>

      <!-- Slot 4: Skip -->
      <button class="pill-btn" :class="{ tapped: tappedItem === 'skip' }" @click="handleSkip" title="Skip">
        <span class="pill-btn-bg"></span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- Slot 5: Settings (gear) -->
      <button
        class="pill-btn"
        :class="{ tapped: tappedItem === 'settings' }"
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
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 3000;
}

.nav-backdrop {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    var(--bg-elevated) 0%,
    var(--bg-elevated) 50%,
    color-mix(in srgb, var(--bg-elevated) 88%, transparent) 100%
  );
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-top: 1.5px solid rgba(255, 255, 255, 0.22);
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
  height: 64px;
  padding: 0 6px;
}

/* Pill buttons (outer 4 slots) */
.pill-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
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
  width: 22px;
  height: 22px;
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
  background: color-mix(in srgb, var(--belt-color, var(--ssi-red)) 12%, transparent);
}

.pill-btn.active {
  color: var(--belt-color, var(--ssi-red));
}

@media (hover: hover) {
  .pill-btn:hover:not(.active) .pill-btn-bg {
    background: rgba(255, 255, 255, 0.06);
  }
  .pill-btn:hover:not(.active) {
    color: var(--text-secondary);
  }
}

/* Center play/stop button */
.center-btn {
  position: relative;
  width: 52px;
  height: 52px;
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
  width: 22px;
  height: 22px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.center-btn:not(.is-stop):not(.is-disabled) .center-btn-inner svg {
  margin-left: 2px;
}

.center-btn.is-disabled {
  background: var(--bg-elevated);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  cursor: not-allowed;
  opacity: 0.6;
}

.center-btn.is-disabled .center-btn-inner {
  color: var(--text-muted);
}

/* Safe area */
.safe-area-spacer {
  height: env(safe-area-inset-bottom, 0px);
  min-height: 4px;
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
   MODERN LIGHT THEME — Floating pill
   ═══════════════════════════════════════════════════════════════ */

:root[data-theme="mist"] .bottom-nav {
  left: 50%;
  right: auto;
  bottom: calc(20px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  width: calc(100% - 2rem);
  max-width: 400px;
  overflow: visible;
}

:root[data-theme="mist"] .nav-backdrop {
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-top: none;
  border: 1.5px solid rgba(0, 0, 0, 0.22);
  border-radius: 32px;
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.14),
              0 8px 24px rgba(44, 38, 34, 0.10),
              0 20px 48px rgba(44, 38, 34, 0.06);
}

:root[data-theme="mist"] .nav-backdrop::before {
  display: none;
}

:root[data-theme="mist"] .nav-content {
  height: 64px;
  padding: 0 6px;
}

:root[data-theme="mist"] .safe-area-spacer {
  display: none;
}

/* Button stroke colors on white pill — subtle belt tint */
:root[data-theme="mist"] .pill-btn {
  color: color-mix(in srgb, var(--belt-color, var(--ssi-red)) 15%, #6B6560);
}

:root[data-theme="mist"] .pill-btn.active {
  color: var(--belt-color, var(--ssi-red));
}

:root[data-theme="mist"] .pill-btn.active .pill-btn-bg {
  background: color-mix(in srgb, var(--belt-color, var(--ssi-red)) 12%, rgba(0, 0, 0, 0.02));
}

@media (hover: hover) {
  :root[data-theme="mist"] .pill-btn:hover:not(.active) {
    color: color-mix(in srgb, var(--belt-color, var(--ssi-red)) 65%, #2C2622);
  }
  :root[data-theme="mist"] .pill-btn:hover:not(.active) .pill-btn-bg {
    background: color-mix(in srgb, var(--belt-color, var(--ssi-red)) 10%, rgba(0, 0, 0, 0.02));
  }
}
</style>
