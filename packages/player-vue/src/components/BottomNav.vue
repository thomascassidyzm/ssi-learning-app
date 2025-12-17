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
  { id: 'journey', label: 'Progress', icon: 'network' },
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
              <!-- Network/Brain icon -->
              <svg v-else-if="item.icon === 'network'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="5" r="2.5"/>
                <circle cx="5" cy="12" r="2.5"/>
                <circle cx="19" cy="12" r="2.5"/>
                <circle cx="8" cy="19" r="2.5"/>
                <circle cx="16" cy="19" r="2.5"/>
                <path d="M12 7.5v4M9.5 10.5l-2 1M14.5 10.5l2 1M9.5 17l-1-2.5M14.5 17l1-2.5"/>
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
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 1000;
}

.nav-backdrop {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to top,
    rgba(10, 10, 15, 0.98) 0%,
    rgba(10, 10, 15, 0.95) 50%,
    rgba(10, 10, 15, 0.88) 100%
  );
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

/* Subtle top edge highlight */
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
    rgba(255, 255, 255, 0.08) 20%,
    rgba(255, 255, 255, 0.08) 80%,
    transparent
  );
}

.nav-content {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 12px;
  max-width: 420px;
  margin: 0 auto;
  height: 72px;
}

.nav-group {
  display: flex;
  flex: 1;
  max-width: 140px;
}

.nav-group--left {
  justify-content: space-around;
}

.nav-group--right {
  justify-content: space-around;
}

/* Nav Item */
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  padding: 0 12px 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
  transition: all 0.2s ease;
  min-width: 56px;
  -webkit-tap-highlight-color: transparent;
}

.nav-item:active,
.nav-item.tapped {
  transform: scale(0.9);
}

.nav-icon {
  width: 22px;
  height: 22px;
  color: rgba(255, 255, 255, 0.35);
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nav-icon svg {
  width: 100%;
  height: 100%;
  stroke-width: 1.8;
}

.nav-label {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.35);
  transition: all 0.25s ease;
  letter-spacing: 0.01em;
}

/* Active state */
.nav-item.active .nav-icon {
  color: #c23a3a;
  transform: translateY(-1px) scale(1.05);
}

.nav-item.active .nav-label {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

.active-indicator {
  position: absolute;
  bottom: 6px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #c23a3a;
  opacity: 0;
  transform: scale(0) translateY(4px);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 0 8px rgba(194, 58, 58, 0.6);
}

.nav-item.active .active-indicator {
  opacity: 1;
  transform: scale(1) translateY(0);
}

/* Hover state (desktop) */
@media (hover: hover) {
  .nav-item:hover:not(.active) .nav-icon {
    color: rgba(255, 255, 255, 0.6);
  }

  .nav-item:hover:not(.active) .nav-label {
    color: rgba(255, 255, 255, 0.6);
  }
}

/* Central Play Button */
.play-button-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 16px;
  position: relative;
  top: -20px;
}

.play-button {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, #d44545 0%, #b83232 100%);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 4px 16px rgba(194, 58, 58, 0.45),
    0 8px 24px rgba(194, 58, 58, 0.25),
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
    inset 0 -1px 1px rgba(0, 0, 0, 0.15);
  -webkit-tap-highlight-color: transparent;
}

.play-button:active,
.play-button.pressed {
  transform: scale(0.92);
  box-shadow:
    0 2px 8px rgba(194, 58, 58, 0.5),
    0 4px 12px rgba(194, 58, 58, 0.3),
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
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
  color: white;
}

.play-button-inner svg {
  width: 24px;
  height: 24px;
  margin-left: 2px; /* Optical centering for play icon */
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.play-label {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 8px;
  letter-spacing: 0.02em;
}

/* Streak badge */
.streak-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: linear-gradient(135deg, #ff9500 0%, #ffb340 100%);
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 2px 6px rgba(255, 149, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  animation: streak-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  border: 2px solid rgba(10, 10, 15, 0.95);
}

@keyframes streak-bounce {
  0% { transform: scale(0); }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

.streak-badge span {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 9px;
  font-weight: 700;
  color: white;
  line-height: 1;
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

/* Light theme */
[data-theme="light"] .nav-backdrop {
  background: linear-gradient(
    to top,
    rgba(248, 249, 250, 0.98) 0%,
    rgba(248, 249, 250, 0.95) 50%,
    rgba(248, 249, 250, 0.88) 100%
  );
  border-top-color: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .nav-backdrop::before {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(0, 0, 0, 0.06) 20%,
    rgba(0, 0, 0, 0.06) 80%,
    transparent
  );
}

[data-theme="light"] .nav-icon {
  color: rgba(26, 26, 46, 0.35);
}

[data-theme="light"] .nav-label {
  color: rgba(26, 26, 46, 0.35);
}

[data-theme="light"] .nav-item.active .nav-label {
  color: rgba(26, 26, 46, 0.9);
}

[data-theme="light"] .play-label {
  color: rgba(26, 26, 46, 0.5);
}

[data-theme="light"] .streak-badge {
  border-color: rgba(248, 249, 250, 0.95);
}

/* Responsive adjustments */
@media (max-width: 360px) {
  .nav-content {
    padding: 0 8px;
    height: 68px;
  }

  .nav-group {
    max-width: 120px;
  }

  .nav-item {
    padding: 0 8px 12px;
    min-width: 48px;
  }

  .nav-icon {
    width: 20px;
    height: 20px;
  }

  .play-button-container {
    margin: 0 12px;
    top: -16px;
  }

  .play-button {
    width: 52px;
    height: 52px;
  }

  .play-button-inner svg {
    width: 20px;
    height: 20px;
  }

  .play-label {
    margin-top: 6px;
  }
}

@media (min-width: 768px) {
  .nav-content {
    max-width: 480px;
    height: 80px;
  }

  .nav-group {
    max-width: 160px;
  }

  .nav-item {
    padding: 0 16px 16px;
    min-width: 64px;
  }

  .nav-icon {
    width: 24px;
    height: 24px;
  }

  .nav-label {
    font-size: 11px;
  }

  .play-button-container {
    margin: 0 20px;
    top: -24px;
  }

  .play-button {
    width: 66px;
    height: 66px;
  }

  .play-button-inner svg {
    width: 28px;
    height: 28px;
  }
}
</style>
