<script setup>
import { ref, computed, inject } from 'vue'
import { useAuthModal } from '@/composables/useAuthModal'

const props = defineProps({
  currentScreen: {
    type: String,
    default: 'home'
  },
  isLearning: {
    type: Boolean,
    default: false
  },
  // When on player screen, show play/stop based on this
  isPlaying: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['navigate', 'startLearning', 'togglePlayback'])

// Auth state from injected auth provider
const auth = inject('auth', null)

// Global auth modal (shared singleton)
const { openSignIn } = useAuthModal()

// Check if user is signed in
const isSignedIn = computed(() => auth?.user?.value != null)
const isGuest = computed(() => auth?.isGuest?.value === true)

// Get user display info
const userInitial = computed(() => {
  const user = auth?.user?.value
  if (!user) return null
  return (user.firstName?.[0] || user.username?.[0] || 'U').toUpperCase()
})

const userImageUrl = computed(() => auth?.user?.value?.imageUrl || null)

// Navigation items (left side only - account handled separately)
const leftNavItems = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'network', label: 'Progress', icon: 'network' },
]

// Settings nav item
const settingsItem = { id: 'settings', label: 'Settings', icon: 'settings' }

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

// Check if we're on the player screen
const isOnPlayerScreen = computed(() => props.currentScreen === 'player')

// Handle play button - either start learning or toggle playback
const handlePlayTap = () => {
  playButtonPressed.value = true
  setTimeout(() => { playButtonPressed.value = false }, 200)

  if (navigator.vibrate) {
    navigator.vibrate([10, 50, 10])
  }

  if (isOnPlayerScreen.value) {
    // On player screen - toggle play/pause
    emit('togglePlayback')
  } else {
    // Not on player - start learning
    emit('startLearning')
  }
}

// Button label and icon based on state
const playButtonLabel = computed(() => {
  if (isOnPlayerScreen.value) {
    return props.isPlaying ? 'Stop' : 'Play'
  }
  return 'Learn'
})

// Handle account button tap
const handleAccountTap = () => {
  tappedItem.value = 'account'
  setTimeout(() => { tappedItem.value = null }, 150)

  if (navigator.vibrate) {
    navigator.vibrate(10)
  }

  if (isGuest.value) {
    // Guest - open sign in modal (uses global auth modal)
    openSignIn()
  } else {
    // Signed in - go to settings (account section)
    emit('navigate', 'settings')
  }
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
            v-for="item in leftNavItems"
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

        <!-- Central Play/Stop Button -->
        <div class="play-button-container">
          <button
            class="play-button"
            :class="{ pressed: playButtonPressed, 'is-playing': isOnPlayerScreen && isPlaying }"
            @click="handlePlayTap"
          >
            <div class="play-button-glow"></div>
            <div class="play-button-inner">
              <!-- Stop icon when playing on player screen -->
              <svg v-if="isOnPlayerScreen && isPlaying" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="1"/>
              </svg>
              <!-- Play icon otherwise -->
              <svg v-else viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6 3 20 12 6 21 6 3"/>
              </svg>
            </div>
          </button>
          <span class="play-label">{{ playButtonLabel }}</span>
        </div>

        <!-- Right nav items -->
        <div class="nav-group nav-group--right">
          <!-- Account button (dynamic based on auth state) -->
          <button
            class="nav-item"
            :class="{ tapped: tappedItem === 'account' }"
            @click="handleAccountTap"
          >
            <div class="nav-icon account-icon">
              <!-- Guest: Sign In icon -->
              <template v-if="isGuest">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                  <polyline points="10 17 15 12 10 7"/>
                  <line x1="15" y1="12" x2="3" y2="12"/>
                </svg>
              </template>
              <!-- Signed in: Avatar or initial -->
              <template v-else-if="isSignedIn">
                <img v-if="userImageUrl" :src="userImageUrl" alt="" class="account-avatar" />
                <span v-else class="account-initial">{{ userInitial }}</span>
              </template>
              <!-- Loading/default: User icon -->
              <template v-else>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </template>
            </div>
            <span class="nav-label">{{ isGuest ? 'Sign In' : 'Account' }}</span>
          </button>

          <!-- Settings -->
          <button
            class="nav-item"
            :class="{
              active: currentScreen === 'settings',
              tapped: tappedItem === 'settings'
            }"
            @click="handleNavTap('settings')"
          >
            <div class="nav-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>
            <span class="nav-label">Settings</span>

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

/* Account icon styles */
.account-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.account-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
}

.account-initial {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(145deg, #c23a3a 0%, #9a2e2e 100%);
  color: white;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
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

/* Stop icon doesn't need the optical centering offset */
.play-button.is-playing .play-button-inner svg {
  margin-left: 0;
}

.play-label {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 8px;
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
   RESPONSIVE - Full breakpoint coverage with proper touch targets
   ═══════════════════════════════════════════════════════════════ */

/* Extra small phones (320px) - compact but usable */
@media (max-width: 360px) {
  .nav-content {
    padding: 0 6px;
    height: 64px;
  }

  .nav-group {
    max-width: 100px;
  }

  .nav-item {
    padding: 0 6px 10px;
    /* Ensure minimum touch target of 44px */
    min-width: 44px;
    min-height: 44px;
  }

  .nav-icon {
    width: 18px;
    height: 18px;
  }

  .nav-label {
    font-size: 9px;
  }

  .account-avatar,
  .account-initial {
    width: 18px;
    height: 18px;
  }

  .account-initial {
    font-size: 9px;
  }

  .play-button-container {
    margin: 0 8px;
    top: -14px;
  }

  .play-button {
    width: 48px;
    height: 48px;
  }

  .play-button-inner svg {
    width: 18px;
    height: 18px;
  }

  .play-label {
    font-size: 9px;
    margin-top: 5px;
  }

  .play-button-glow {
    inset: -4px;
  }

  .active-indicator {
    width: 3px;
    height: 3px;
  }
}

/* Small phones (361-479px) */
@media (min-width: 361px) and (max-width: 479px) {
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
    min-height: 44px;
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

/* Phone landscape / small tablets (480-767px) */
@media (min-width: 480px) and (max-width: 767px) {
  .nav-content {
    max-width: 440px;
    height: 74px;
  }

  .nav-group {
    max-width: 140px;
  }

  .nav-item {
    min-width: 52px;
    min-height: 44px;
  }

  .nav-icon {
    width: 22px;
    height: 22px;
  }

  .nav-label {
    font-size: 10px;
  }

  .play-button {
    width: 60px;
    height: 60px;
  }

  .play-button-inner svg {
    width: 24px;
    height: 24px;
  }
}

/* Tablets (768-1023px) */
@media (min-width: 768px) and (max-width: 1023px) {
  .nav-content {
    max-width: 520px;
    height: 80px;
  }

  .nav-group {
    max-width: 180px;
  }

  .nav-item {
    padding: 0 16px 14px;
    min-width: 60px;
  }

  .nav-icon {
    width: 24px;
    height: 24px;
  }

  .nav-label {
    font-size: 11px;
  }

  .account-avatar,
  .account-initial {
    width: 24px;
    height: 24px;
  }

  .account-initial {
    font-size: 12px;
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

  .play-label {
    font-size: 11px;
  }
}

/* Laptops (1024-1279px) */
@media (min-width: 1024px) and (max-width: 1279px) {
  .nav-content {
    max-width: 560px;
    height: 84px;
  }

  .nav-group {
    max-width: 200px;
  }

  .nav-item {
    padding: 0 18px 16px;
    min-width: 64px;
  }

  .nav-icon {
    width: 26px;
    height: 26px;
  }

  .nav-label {
    font-size: 11px;
  }

  .play-button-container {
    margin: 0 28px;
    top: -26px;
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

/* Desktops (1280-1535px) */
@media (min-width: 1280px) and (max-width: 1535px) {
  .nav-content {
    max-width: 600px;
    height: 88px;
  }

  .nav-group {
    max-width: 220px;
  }

  .nav-item {
    padding: 0 20px 16px;
    gap: 6px;
  }

  .nav-icon {
    width: 28px;
    height: 28px;
  }

  .nav-label {
    font-size: 12px;
  }

  .account-avatar,
  .account-initial {
    width: 28px;
    height: 28px;
  }

  .account-initial {
    font-size: 13px;
  }

  .play-button-container {
    margin: 0 32px;
    top: -28px;
  }

  .play-button {
    width: 76px;
    height: 76px;
  }

  .play-button-inner svg {
    width: 32px;
    height: 32px;
  }

  .play-label {
    font-size: 12px;
    margin-top: 10px;
  }

  .active-indicator {
    width: 5px;
    height: 5px;
  }
}

/* Large desktops and ultrawides (1536px+) */
@media (min-width: 1536px) {
  .nav-content {
    max-width: 680px;
    height: 96px;
  }

  .nav-group {
    max-width: 260px;
  }

  .nav-item {
    padding: 0 24px 18px;
    gap: 7px;
  }

  .nav-icon {
    width: 32px;
    height: 32px;
  }

  .nav-label {
    font-size: 13px;
  }

  .account-avatar,
  .account-initial {
    width: 32px;
    height: 32px;
  }

  .account-initial {
    font-size: 14px;
  }

  .play-button-container {
    margin: 0 40px;
    top: -32px;
  }

  .play-button {
    width: 84px;
    height: 84px;
    box-shadow:
      0 6px 24px rgba(194, 58, 58, 0.5),
      0 12px 36px rgba(194, 58, 58, 0.3),
      inset 0 1px 1px rgba(255, 255, 255, 0.25),
      inset 0 -1px 1px rgba(0, 0, 0, 0.15);
  }

  .play-button-glow {
    inset: -10px;
  }

  .play-button-inner svg {
    width: 36px;
    height: 36px;
  }

  .play-label {
    font-size: 13px;
    margin-top: 12px;
  }

  .active-indicator {
    width: 6px;
    height: 6px;
  }

  .safe-area-spacer {
    min-height: 8px;
  }
}

/* Landscape orientation - compact bottom nav */
@media (orientation: landscape) and (max-height: 500px) {
  .bottom-nav {
    /* Slide to side on landscape phones */
  }

  .nav-content {
    height: 56px;
    max-width: 360px;
    padding: 0 8px;
  }

  .nav-group {
    max-width: 100px;
  }

  .nav-item {
    padding: 0 6px 8px;
    gap: 3px;
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
</style>
