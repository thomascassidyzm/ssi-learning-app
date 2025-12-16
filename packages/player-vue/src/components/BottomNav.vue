<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  currentScreen: {
    type: String,
    default: 'home'
  },
  isLearning: {
    type: Boolean,
    default: false
  },
  streak: {
    type: Number,
    default: 0
  }
})

const emit = defineEmits(['navigate', 'startLearning'])

// Navigation items
const navItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'journey', label: 'Journey', icon: 'map' },
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

// Tap feedback state
const tappedItem = ref(null)
const playButtonPressed = ref(false)

// Handle navigation tap with haptic feedback
const handleNavTap = (itemId) => {
  // Visual feedback
  tappedItem.value = itemId
  setTimeout(() => { tappedItem.value = null }, 150)

  // Haptic feedback (if available)
  if (navigator.vibrate) {
    navigator.vibrate(10)
  }

  emit('navigate', itemId)
}

// Handle play button
const handlePlayTap = () => {
  playButtonPressed.value = true
  setTimeout(() => { playButtonPressed.value = false }, 200)

  if (navigator.vibrate) {
    navigator.vibrate([10, 50, 10])
  }

  emit('startLearning')
}

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
        <!-- Left nav items -->
        <div class="nav-group nav-group--left">
          <button
            v-for="item in navItems.slice(0, 2)"
            :key="item.id"
            class="nav-item"
            :class="{
              active: currentScreen === item.id,
              tapped: tappedItem === item.id
            }"
            @click="handleNavTap(item.id)"
          >
            <div class="nav-icon">
              <!-- Home icon -->
              <svg v-if="item.icon === 'home'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <!-- Map/Journey icon -->
              <svg v-else-if="item.icon === 'map'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3l7 2 7-2 4 2v16l-4-2-7 2-7-2-4 2V3z"/>
                <path d="M10 5v16"/>
                <path d="M17 3v16"/>
              </svg>
            </div>
            <span class="nav-label">{{ item.label }}</span>

            <!-- Active indicator dot -->
            <div class="active-indicator"></div>
          </button>
        </div>

        <!-- Central Play Button -->
        <div class="play-button-container">
          <button
            class="play-button"
            :class="{ pressed: playButtonPressed }"
            @click="handlePlayTap"
          >
            <div class="play-button-glow"></div>
            <div class="play-button-inner">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
            </div>
            <!-- Streak badge -->
            <div v-if="streak > 0" class="streak-badge">
              <span>{{ streak }}</span>
            </div>
          </button>
          <span class="play-label">Learn</span>
        </div>

        <!-- Right nav items -->
        <div class="nav-group nav-group--right">
          <button
            v-for="item in navItems.slice(2, 4)"
            :key="item.id"
            class="nav-item"
            :class="{
              active: currentScreen === item.id,
              tapped: tappedItem === item.id
            }"
            @click="handleNavTap(item.id)"
          >
            <div class="nav-icon">
              <!-- User/Profile icon -->
              <svg v-if="item.icon === 'user'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              <!-- Settings icon -->
              <svg v-else-if="item.icon === 'settings'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>
            <span class="nav-label">{{ item.label }}</span>

            <!-- Active indicator dot -->
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
  z-index: 1000;
  padding-top: 8px;
}

.nav-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(10, 10, 15, 0.85);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.nav-content {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  padding: 0 8px;
  max-width: 500px;
  margin: 0 auto;
}

.nav-group {
  display: flex;
  flex: 1;
}

.nav-group--left {
  justify-content: flex-start;
  gap: 4px;
}

.nav-group--right {
  justify-content: flex-end;
  gap: 4px;
}

/* Nav Item */
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 16px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  border-radius: 12px;
}

.nav-item:active,
.nav-item.tapped {
  transform: scale(0.92);
}

.nav-icon {
  width: 24px;
  height: 24px;
  color: rgba(255, 255, 255, 0.4);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nav-icon svg {
  width: 100%;
  height: 100%;
}

.nav-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.4);
  transition: all 0.3s ease;
  letter-spacing: 0.02em;
}

/* Active state */
.nav-item.active .nav-icon {
  color: #c23a3a;
  transform: translateY(-2px);
}

.nav-item.active .nav-label {
  color: #c23a3a;
  font-weight: 600;
}

.active-indicator {
  position: absolute;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #c23a3a;
  opacity: 0;
  transform: scale(0);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nav-item.active .active-indicator {
  opacity: 1;
  transform: scale(1);
}

/* Hover state (desktop) */
@media (hover: hover) {
  .nav-item:hover:not(.active) .nav-icon {
    color: rgba(255, 255, 255, 0.7);
    transform: translateY(-1px);
  }

  .nav-item:hover:not(.active) .nav-label {
    color: rgba(255, 255, 255, 0.7);
  }
}

/* Central Play Button */
.play-button-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 8px;
  position: relative;
  top: -12px;
}

.play-button {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, #c23a3a 0%, #d44545 100%);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 4px 20px rgba(194, 58, 58, 0.4),
    0 8px 32px rgba(194, 58, 58, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.play-button:active,
.play-button.pressed {
  transform: scale(0.9);
  box-shadow:
    0 2px 12px rgba(194, 58, 58, 0.5),
    0 4px 16px rgba(194, 58, 58, 0.3);
}

.play-button-glow {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(194, 58, 58, 0.4) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
  animation: glow-pulse 3s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}

.play-button:hover .play-button-glow {
  opacity: 1;
}

.play-button-inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.play-button-inner svg {
  width: 26px;
  height: 26px;
  margin-left: 3px; /* Optical centering for play icon */
}

.play-label {
  font-family: 'DM Sans', sans-serif;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 6px;
  letter-spacing: 0.02em;
}

/* Streak badge */
.streak-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  background: linear-gradient(135deg, #ff9500 0%, #ffb340 100%);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(255, 149, 0, 0.4);
  animation: streak-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes streak-bounce {
  0% { transform: scale(0); }
  100% { transform: scale(1); }
}

.streak-badge span {
  font-family: 'Space Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  color: white;
}

/* Safe area for PWA */
.safe-area-spacer {
  height: env(safe-area-inset-bottom, 0px);
  min-height: 8px;
}

/* Nav slide transition */
.nav-slide-enter-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.nav-slide-leave-active {
  transition: all 0.3s ease-in;
}

.nav-slide-enter-from,
.nav-slide-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* Light theme */
[data-theme="light"] .nav-backdrop {
  background: rgba(248, 249, 250, 0.9);
  border-top-color: rgba(0, 0, 0, 0.06);
}

[data-theme="light"] .nav-icon {
  color: rgba(26, 26, 46, 0.4);
}

[data-theme="light"] .nav-label {
  color: rgba(26, 26, 46, 0.4);
}

[data-theme="light"] .nav-item.active .nav-icon,
[data-theme="light"] .nav-item.active .nav-label {
  color: #c23a3a;
}

[data-theme="light"] .play-label {
  color: rgba(26, 26, 46, 0.5);
}

/* Responsive adjustments */
@media (max-width: 360px) {
  .nav-item {
    padding: 8px 12px 12px;
  }

  .play-button {
    width: 56px;
    height: 56px;
  }

  .play-button-inner svg {
    width: 22px;
    height: 22px;
  }
}

@media (min-width: 768px) {
  .nav-content {
    max-width: 600px;
  }

  .nav-item {
    padding: 10px 20px 14px;
  }

  .nav-icon {
    width: 26px;
    height: 26px;
  }

  .nav-label {
    font-size: 11px;
  }

  .play-button {
    width: 72px;
    height: 72px;
  }

  .play-button-inner svg {
    width: 30px;
    height: 30px;
  }
}
</style>
