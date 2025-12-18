<script setup>
import { ref, onMounted } from 'vue'

const emit = defineEmits(['complete'])

const isVisible = ref(false)
const STORAGE_KEY = 'ssi-onboarding-complete'

// Check if user has seen onboarding
onMounted(() => {
  const hasSeenOnboarding = localStorage.getItem(STORAGE_KEY)
  if (!hasSeenOnboarding) {
    // Small delay to let the player render first
    setTimeout(() => {
      isVisible.value = true
    }, 800)
  }
})

const dismissOnboarding = () => {
  localStorage.setItem(STORAGE_KEY, 'true')
  isVisible.value = false
  emit('complete')
}

// For demo/testing - reset onboarding
const resetOnboarding = () => {
  localStorage.removeItem(STORAGE_KEY)
  isVisible.value = true
}

// Expose reset for parent component if needed
defineExpose({ resetOnboarding })
</script>

<template>
  <Transition name="onboarding">
    <div v-if="isVisible" class="onboarding-overlay" @click.self="dismissOnboarding">
      <!-- Semi-transparent backdrop -->
      <div class="onboarding-backdrop"></div>

      <!-- Post-it: Belt indicator (top left area) -->
      <div class="postit postit-belt" style="--rotation: -2deg">
        <div class="postit-tape"></div>
        <p>Your <strong>belt</strong> shows progress toward mastery</p>
      </div>

      <!-- Post-it: 4-phase dots (top center) -->
      <div class="postit postit-phases" style="--rotation: 1.5deg">
        <div class="postit-tape"></div>
        <p>4 phases: <strong>Hear → Speak → Listen → See</strong></p>
      </div>

      <!-- Post-it: Timer (top right) -->
      <div class="postit postit-timer" style="--rotation: -1deg">
        <div class="postit-tape"></div>
        <p>Tap the <strong>timer</strong> to pause & see summary</p>
      </div>

      <!-- Post-it: The ring (center) -->
      <div class="postit postit-ring" style="--rotation: 2deg">
        <div class="postit-tape"></div>
        <p><strong>Tap to start!</strong> Speak during the countdown</p>
      </div>

      <!-- Post-it: Controls (bottom) -->
      <div class="postit postit-controls" style="--rotation: -1.5deg">
        <div class="postit-tape"></div>
        <p><strong>Replay</strong>, <strong>skip</strong>, or <strong>turbo</strong> for speed</p>
      </div>

      <!-- Got it button -->
      <button class="got-it-btn" @click="dismissOnboarding">
        Got it, let's learn!
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.onboarding-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}

/* Base post-it style */
.postit {
  position: absolute;
  background: #fef9c3;
  padding: 0.625rem 0.875rem;
  border-radius: 2px;
  box-shadow:
    2px 2px 8px rgba(0, 0, 0, 0.15),
    0 0 1px rgba(0, 0, 0, 0.1);
  transform: rotate(var(--rotation, 0deg));
  max-width: 180px;
  z-index: 1001;

  /* Subtle paper texture feel */
  background-image:
    linear-gradient(180deg,
      rgba(255,255,255,0.4) 0%,
      transparent 30%,
      transparent 100%
    );
}

.postit p {
  margin: 0;
  font-family: 'Caveat', 'Segoe Script', 'Comic Sans MS', cursive;
  font-size: 0.9375rem;
  line-height: 1.35;
  color: #44403c;
}

.postit strong {
  color: #1c1917;
  font-weight: 600;
}

/* Tape effect at top */
.postit-tape {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 12px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 1px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

/* Position each post-it near its target */

.postit-belt {
  top: 70px;
  left: 50%;
  transform: translateX(-50%) rotate(var(--rotation));
}

.postit-phases {
  top: 140px;
  left: 50%;
  transform: translateX(-50%) rotate(var(--rotation));
}

.postit-timer {
  top: 60px;
  right: 20px;
  transform: rotate(var(--rotation));
}

.postit-ring {
  top: 50%;
  left: 50%;
  transform: translate(-50%, 60px) rotate(var(--rotation));
}

.postit-controls {
  bottom: 140px;
  left: 50%;
  transform: translateX(-50%) rotate(var(--rotation));
}

/* Got it button */
.got-it-btn {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1002;

  padding: 0.875rem 2rem;
  background: #c23a3a;
  color: white;
  border: none;
  border-radius: 100px;
  font-family: 'DM Sans', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;

  box-shadow:
    0 4px 16px rgba(194, 58, 58, 0.4),
    0 0 0 4px rgba(194, 58, 58, 0.15);

  transition: all 0.2s ease;
}

.got-it-btn:hover {
  transform: translateX(-50%) scale(1.05);
  box-shadow:
    0 6px 24px rgba(194, 58, 58, 0.5),
    0 0 0 6px rgba(194, 58, 58, 0.2);
}

.got-it-btn:active {
  transform: translateX(-50%) scale(0.98);
}

/* Transitions */
.onboarding-enter-active {
  transition: opacity 0.4s ease;
}

.onboarding-enter-active .postit {
  animation: postit-appear 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
}

.onboarding-enter-active .postit-belt { animation-delay: 0.1s; }
.onboarding-enter-active .postit-phases { animation-delay: 0.2s; }
.onboarding-enter-active .postit-timer { animation-delay: 0.3s; }
.onboarding-enter-active .postit-ring { animation-delay: 0.4s; }
.onboarding-enter-active .postit-controls { animation-delay: 0.5s; }

.onboarding-enter-active .got-it-btn {
  animation: btn-appear 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.7s backwards;
}

.onboarding-leave-active {
  transition: opacity 0.3s ease;
}

.onboarding-enter-from,
.onboarding-leave-to {
  opacity: 0;
}

@keyframes postit-appear {
  from {
    opacity: 0;
    transform: translateY(-20px) rotate(var(--rotation)) scale(0.8);
  }
}

@keyframes btn-appear {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(20px) scale(0.9);
  }
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .postit {
    max-width: 150px;
    padding: 0.5rem 0.75rem;
  }

  .postit p {
    font-size: 0.8125rem;
  }

  .postit-belt {
    top: 100px;
    left: 20px;
    transform: rotate(var(--rotation));
  }

  .postit-phases {
    top: 160px;
    left: 50%;
  }

  .postit-timer {
    top: 80px;
    right: 10px;
  }

  .postit-ring {
    top: 45%;
    transform: translate(-50%, 80px) rotate(var(--rotation));
  }

  .postit-controls {
    bottom: 160px;
  }

  .got-it-btn {
    bottom: 80px;
    padding: 0.75rem 1.5rem;
    font-size: 0.9375rem;
  }
}

/* Tablet adjustments */
@media (min-width: 481px) and (max-width: 768px) {
  .postit-belt {
    left: 30%;
  }

  .postit-timer {
    right: 30px;
  }
}
</style>
