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

const emit = defineEmits(['navigate', 'startLearning', 'togglePlayback', 'exitListeningMode'])

// Tap feedback state
const tappedItem = ref(null)
const playButtonPressed = ref(false)

// Handle navigation tap with haptic feedback
const handleNavTap = (itemId) => {
  tappedItem.value = itemId
  setTimeout(() => { tappedItem.value = null }, 150)

  if (navigator.vibrate) {
    navigator.vibrate(10)
  }

  // If listening mode is active, exit it first
  if (props.isListeningMode) {
    emit('exitListeningMode')
  }

  emit('navigate', itemId)
}

// Check if we're on the player screen
const isOnPlayerScreen = computed(() => props.currentScreen === 'player')

// Handle play button
const handlePlayTap = () => {
  if (props.isListeningMode) return

  playButtonPressed.value = true
  setTimeout(() => { playButtonPressed.value = false }, 200)

  if (navigator.vibrate) {
    navigator.vibrate([10, 50, 10])
  }

  if (isOnPlayerScreen.value) {
    emit('togglePlayback')
  } else {
    emit('startLearning')
  }
}

// Button label based on state
const playButtonLabel = computed(() => {
  if (props.isListeningMode) return 'Listening'
  if (isOnPlayerScreen.value) return props.isPlaying ? 'Stop' : 'Play'
  return 'Learn'
})

// Hide nav when learning
const isVisible = computed(() => !props.isLearning)
</script>

<template>
  <Transition name="nav-slide">
    <nav v-if="isVisible" class="bottom-nav">
      <!-- Blur backdrop -->
      <div class="nav-backdrop"></div>

      <!-- Navigation content -->
      <div class="nav-content">
        <!-- Left: Progress -->
        <div class="nav-group nav-group--left">
          <button
            class="nav-item"
            :class="{
              active: currentScreen === 'progress',
              tapped: tappedItem === 'progress'
            }"
            @click="handleNavTap('progress')"
          >
            <div class="nav-icon">
              <!-- Brain icon -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M12 2C9.5 2 7.5 3.5 7 5.5C5.5 5.5 4 7 4 9c0 1.5.8 2.8 2 3.5-.2.5-.3 1-.3 1.5 0 2 1.5 3.5 3.3 3.8.5 1.3 1.8 2.2 3 2.2s2.5-.9 3-2.2c1.8-.3 3.3-1.8 3.3-3.8 0-.5-.1-1-.3-1.5 1.2-.7 2-2 2-3.5 0-2-1.5-3.5-3-3.5C16.5 3.5 14.5 2 12 2z"/>
                <path d="M12 2v18" opacity="0.3"/>
                <path d="M7 9h10" opacity="0.3"/>
              </svg>
            </div>
            <span class="nav-label">Progress</span>
            <div class="active-indicator"></div>
          </button>
        </div>

        <!-- Central Play/Stop Button -->
        <div class="play-button-container">
          <button
            class="play-button"
            :class="{
              pressed: playButtonPressed,
              'is-playing': isOnPlayerScreen && isPlaying,
              'is-disabled': isListeningMode
            }"
            :disabled="isListeningMode"
            @click="handlePlayTap"
          >
            <div class="play-button-glow"></div>
            <div class="play-button-inner">
              <!-- Stop icon when playing -->
              <svg v-if="isOnPlayerScreen && isPlaying && !isListeningMode" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1"/>
              </svg>
              <!-- Headphones icon when in listening mode -->
              <svg v-else-if="isListeningMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
              </svg>
              <!-- Play icon otherwise -->
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
            </div>
          </button>
          <span class="play-label">{{ playButtonLabel }}</span>
        </div>

        <!-- Right: Library -->
        <div class="nav-group nav-group--right">
          <button
            class="nav-item"
            :class="{
              active: currentScreen === 'library',
              tapped: tappedItem === 'library'
            }"
            @click="handleNavTap('library')"
          >
            <div class="nav-icon">
              <!-- Browse/grid icon -->
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
            </div>
            <span class="nav-label">Library</span>
            <div class="active-indicator"></div>
          </button>
        </div>
      </div>

      <!-- Safe area spacer for PWA -->
      <div class="safe-area-spacer"></div>
    </nav>
  </Transition>
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
  border-top: 1px solid var(--border-subtle);
  z-index: 100;
}

.nav-backdrop::before {
  content: '';
  position: absolute;
  top: 0;
  left: 10%;
  right: 10%;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    var(--border-subtle) 20%,
    var(--border-subtle) 80%,
    transparent
  );
}

.nav-content {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 8px;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  height: 68px;
}

.nav-group {
  display: flex;
  flex: 1;
  max-width: 100px;
  position: relative;
  z-index: 102;
}

.nav-group--left {
  justify-content: center;
}

.nav-group--right {
  justify-content: center;
}

/* Nav Item */
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 0 10px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  min-width: 44px;
  min-height: 44px;
  -webkit-tap-highlight-color: transparent;
}

.nav-item:active,
.nav-item.tapped {
  transform: scale(0.9);
}

.nav-icon {
  width: 22px;
  height: 22px;
  color: var(--text-muted);
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nav-icon svg {
  width: 100%;
  height: 100%;
}

.nav-label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  transition: all 0.25s ease;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

/* Active state */
.nav-item.active .nav-icon {
  color: var(--belt-color, var(--ssi-red));
  transform: translateY(-1px) scale(1.05);
}

.nav-item.active .nav-label {
  color: var(--text-primary);
  font-weight: 600;
}

.active-indicator {
  position: absolute;
  bottom: 6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--belt-color, var(--ssi-red));
  opacity: 0;
  transform: scale(0) translateY(4px);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 0 8px var(--belt-glow, rgba(194, 58, 58, 0.6));
}

.nav-item.active .active-indicator {
  opacity: 1;
  transform: scale(1) translateY(0);
}

/* Hover state (desktop) */
@media (hover: hover) {
  .nav-item:hover:not(.active) .nav-icon {
    color: var(--text-secondary);
  }

  .nav-item:hover:not(.active) .nav-label {
    color: var(--text-secondary);
  }
}

/* Central Play Button */
.play-button-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 12px;
  position: relative;
  top: -18px;
  z-index: 110;
}

.play-button {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, var(--ssi-red-light) 0%, var(--ssi-red) 100%);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 4px 16px rgba(194, 58, 58, 0.45),
    0 8px 24px rgba(194, 58, 58, 0.25),
    inset 0 1px 1px var(--highlight-inset),
    inset 0 -1px 1px rgba(0, 0, 0, 0.15);
  -webkit-tap-highlight-color: transparent;
}

.play-button:active,
.play-button.pressed {
  transform: scale(0.92);
  box-shadow:
    0 2px 8px rgba(194, 58, 58, 0.5),
    0 4px 12px rgba(194, 58, 58, 0.3),
    inset 0 1px 1px var(--highlight-inset),
    inset 0 -1px 1px rgba(0, 0, 0, 0.15);
}

.play-button-glow {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(194, 58, 58, 0.5) 0%, transparent 70%);
  opacity: 0.5;
  transition: opacity 0.3s ease;
  animation: glow-pulse 2.5s ease-in-out infinite;
  pointer-events: none;
}

@keyframes glow-pulse {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.08); }
}

.play-button:hover .play-button-glow {
  opacity: 0.9;
}

.play-button-inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-accent);
}

.play-button-inner svg {
  width: 22px;
  height: 22px;
  margin-left: 2px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.play-button.is-playing .play-button-inner svg {
  margin-left: 0;
}

/* Disabled state - listening mode */
.play-button.is-disabled {
  background: linear-gradient(145deg, var(--bg-interactive-disabled) 0%, var(--bg-interactive-disabled) 100%);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.3),
    0 4px 12px rgba(0, 0, 0, 0.2),
    inset 0 1px 1px var(--border-subtle),
    inset 0 -1px 1px rgba(0, 0, 0, 0.1);
  cursor: not-allowed;
  opacity: 0.7;
}

.play-button.is-disabled .play-button-glow {
  opacity: 0;
  animation: none;
}

.play-button.is-disabled .play-button-inner {
  color: var(--text-secondary);
}

.play-button.is-disabled .play-button-inner svg {
  margin-left: 0;
}

.play-label {
  font-family: var(--font-body);
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-top: 6px;
  letter-spacing: 0.02em;
}

/* Safe area for PWA */
.safe-area-spacer {
  height: env(safe-area-inset-bottom, 0px);
  min-height: 4px;
}

/* Nav slide transition */
.nav-slide-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-slide-leave-active {
  transition: all 0.25s ease-in;
}

.nav-slide-enter-from,
.nav-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════════════════════ */

@media (min-width: 768px) {
  .nav-content {
    max-width: 400px;
    height: 68px;
  }

  .nav-group {
    max-width: 120px;
  }

  .nav-item {
    padding: 0 16px 14px;
    min-width: 56px;
    gap: 5px;
  }

  .nav-icon {
    width: 26px;
    height: 26px;
  }

  .nav-label {
    font-size: 11px;
  }

  .play-button-container {
    margin: 0 24px;
    top: -24px;
  }

  .play-button {
    width: 68px;
    height: 68px;
  }

  .play-button-inner svg {
    width: 28px;
    height: 28px;
  }

  .play-button-glow {
    inset: -8px;
  }

  .play-label {
    font-size: 11px;
    margin-top: 8px;
  }

  .active-indicator {
    width: 5px;
    height: 5px;
  }
}

@media (min-width: 1280px) {
  .nav-content {
    max-width: 400px;
    height: 68px;
  }

  .nav-group {
    max-width: 100px;
  }
}

/* Landscape compact */
@media (orientation: landscape) and (max-height: 500px) {
  .nav-content {
    height: 56px;
    max-width: 360px;
    padding: 0 8px;
  }

  .nav-group {
    max-width: 80px;
  }

  .nav-item {
    padding: 0 6px 8px;
    gap: 3px;
    min-width: 44px;
    min-height: 44px;
  }

  .nav-icon {
    width: 18px;
    height: 18px;
  }

  .nav-label {
    font-size: 8px;
  }

  .play-button-container {
    margin: 0 10px;
    top: -12px;
  }

  .play-button {
    width: 44px;
    height: 44px;
  }

  .play-button-inner svg {
    width: 18px;
    height: 18px;
  }

  .play-label {
    font-size: 8px;
    margin-top: 4px;
  }

  .safe-area-spacer {
    min-height: 2px;
  }
}

/* ═══════════════════════════════════════════════════════════════
   MISTY DOJO THEME
   ═══════════════════════════════════════════════════════════════ */
:root[data-theme="mist"] .nav-backdrop {
  background: #1A1614;
  border-top: 1px solid rgba(168, 156, 142, 0.12);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.15);
}

:root[data-theme="mist"] .nav-backdrop::before {
  background: none;
}

:root[data-theme="mist"] .nav-icon {
  color: #A89C8E;
}

:root[data-theme="mist"] .nav-label {
  color: #A89C8E;
}

:root[data-theme="mist"] .nav-item.active .nav-icon {
  color: #F2F0ED;
}

:root[data-theme="mist"] .nav-item.active .nav-label {
  color: #F2F0ED;
}
</style>
