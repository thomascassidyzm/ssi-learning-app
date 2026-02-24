<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import TopNav from '@/components/schools/shared/TopNav.vue'
import GodModePanel from '@/components/schools/GodModePanel.vue'
import { SignInModal, SignUpModal } from '@/components/auth'
import { useAuthModal } from '@/composables/useAuthModal'
import { setSchoolsClient } from '@/composables/schools/client'

// Supabase client from App
const supabase = inject('supabase', ref(null)) as any

// Set up client bridge on mount so all schools composables can access Supabase
onMounted(() => {
  if (supabase.value) {
    setSchoolsClient(supabase.value)
  }
})

// Global auth modal (shared singleton - same state as PlayerContainer)
const {
  isSignInOpen,
  isSignUpOpen,
  openSignIn,
  openSignUp,
  closeSignIn,
  closeSignUp,
  switchToSignIn,
  switchToSignUp,
} = useAuthModal()

const handleAuthSuccess = () => {
  console.log('Auth successful!')
  closeSignIn()
  closeSignUp()
}
</script>

<template>
  <div class="schools-container">
    <!-- Starfield Background -->
    <div class="starfield" aria-hidden="true">
      <div class="star star-1"></div>
      <div class="star star-2"></div>
      <div class="star star-3"></div>
      <div class="star star-4"></div>
      <div class="star star-5"></div>
      <div class="star star-6"></div>
      <div class="star star-7"></div>
      <div class="star star-8"></div>
      <div class="star star-9"></div>
      <div class="star star-10"></div>
      <div class="star star-11"></div>
      <div class="star star-12"></div>
      <div class="star star-13"></div>
      <div class="star star-14"></div>
      <div class="star star-15"></div>
      <div class="star star-16"></div>
      <div class="star star-17"></div>
      <div class="star star-18"></div>
    </div>

    <!-- Drifting Star Particles -->
    <div class="drift-stars" aria-hidden="true">
      <div class="drift-star drift-1"></div>
      <div class="drift-star drift-2"></div>
      <div class="drift-star drift-3"></div>
      <div class="drift-star drift-4"></div>
      <div class="drift-star drift-5"></div>
    </div>

    <TopNav @sign-in="openSignIn" @sign-up="openSignUp" />

    <!-- God Mode Panel (replaces DevRoleSwitcher) -->
    <GodModePanel />

    <main class="main-content">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>

    <!-- Auth Modals (shared state across app) -->
    <SignInModal
      :is-open="isSignInOpen"
      @close="closeSignIn"
      @switch-to-sign-up="switchToSignUp"
      @success="handleAuthSuccess"
    />
    <SignUpModal
      :is-open="isSignUpOpen"
      @close="closeSignUp"
      @switch-to-sign-in="switchToSignIn"
      @success="handleAuthSuccess"
    />
  </div>
</template>

<style scoped>
.schools-container {
  min-height: 100vh;
  position: relative;
  background: var(--bg-primary);
  overflow: hidden;
}

.main-content {
  margin-top: 64px;
  min-height: calc(100vh - 64px);
  position: relative;
  z-index: 10;
  padding: 32px;
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
}

/* ============ STARFIELD BACKGROUND ============ */
.starfield {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: white;
  border-radius: 50%;
  animation: star-twinkle 4s ease-in-out infinite;
}

/* Distribute stars across the canvas */
.star-1 { left: 5%; top: 8%; animation-delay: 0s; opacity: 0.4; }
.star-2 { left: 15%; top: 22%; animation-delay: -0.5s; opacity: 0.6; width: 3px; height: 3px; }
.star-3 { left: 28%; top: 12%; animation-delay: -1s; opacity: 0.3; }
.star-4 { left: 42%; top: 5%; animation-delay: -1.5s; opacity: 0.5; }
.star-5 { left: 55%; top: 18%; animation-delay: -2s; opacity: 0.4; width: 3px; height: 3px; }
.star-6 { left: 68%; top: 8%; animation-delay: -2.5s; opacity: 0.35; }
.star-7 { left: 82%; top: 15%; animation-delay: -3s; opacity: 0.45; }
.star-8 { left: 92%; top: 25%; animation-delay: -3.5s; opacity: 0.3; width: 3px; height: 3px; }
.star-9 { left: 8%; top: 45%; animation-delay: -1s; opacity: 0.5; }
.star-10 { left: 22%; top: 55%; animation-delay: -0.5s; opacity: 0.35; }
.star-11 { left: 35%; top: 42%; animation-delay: -2s; opacity: 0.4; width: 3px; height: 3px; }
.star-12 { left: 48%; top: 60%; animation-delay: -1.5s; opacity: 0.3; }
.star-13 { left: 62%; top: 48%; animation-delay: -3s; opacity: 0.45; }
.star-14 { left: 75%; top: 38%; animation-delay: -2.5s; opacity: 0.35; width: 3px; height: 3px; }
.star-15 { left: 88%; top: 52%; animation-delay: -1s; opacity: 0.4; }
.star-16 { left: 12%; top: 75%; animation-delay: -2s; opacity: 0.3; }
.star-17 { left: 45%; top: 82%; animation-delay: -0.5s; opacity: 0.45; }
.star-18 { left: 78%; top: 70%; animation-delay: -3s; opacity: 0.35; width: 3px; height: 3px; }

@keyframes star-twinkle {
  0%, 100% { opacity: var(--star-opacity, 0.4); }
  50% { opacity: calc(var(--star-opacity, 0.4) * 1.8); }
}

/* Belt-colored glow on some stars */
.star-2, .star-5, .star-11, .star-18 {
  box-shadow: 0 0 4px var(--ssi-gold, rgba(212, 168, 83, 0.5));
}

/* ============ DRIFTING STAR PARTICLES ============ */
.drift-stars {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
}

.drift-star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: white;
  border-radius: 50%;
  opacity: 0.6;
  animation: drift-motion 25s linear infinite;
}

/* Distribute drifting stars */
.drift-1 { left: 10%; top: 20%; animation-delay: 0s; animation-duration: 28s; }
.drift-2 { left: 30%; top: 40%; animation-delay: -5s; animation-duration: 22s; opacity: 0.4; }
.drift-3 { left: 50%; top: 15%; animation-delay: -10s; animation-duration: 30s; }
.drift-4 { left: 70%; top: 55%; animation-delay: -15s; animation-duration: 26s; opacity: 0.5; }
.drift-5 { left: 85%; top: 30%; animation-delay: -3s; animation-duration: 24s; }

@keyframes drift-motion {
  0% {
    transform: translate(0, 0);
    opacity: 0;
  }
  5% {
    opacity: 0.6;
  }
  95% {
    opacity: 0.6;
  }
  100% {
    transform: translate(-100px, 200px);
    opacity: 0;
  }
}

/* Page transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .main-content {
    padding: 16px;
  }
}

/* Reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  .star,
  .drift-star {
    animation: none;
    opacity: 0.4;
  }
}
</style>
