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
    }, 600)
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
    <div v-if="isVisible" class="onboarding-overlay" @click="dismissOnboarding">

      <!-- Post-it: Belt indicator - points left to belt -->
      <div class="postit postit-belt">
        <span class="postit-arrow">←</span>
        <span>Your belt = progress</span>
      </div>

      <!-- Post-it: Timer - points left to timer -->
      <div class="postit postit-timer">
        <span>Tap to pause</span>
        <span class="postit-arrow">→</span>
      </div>

      <!-- Post-it: Ring - points up to ring -->
      <div class="postit postit-ring">
        <span class="postit-arrow">↑</span>
        <span>Tap to start</span>
      </div>

      <!-- Post-it: Phases - points down to phase dots -->
      <div class="postit postit-phases">
        <span>Hear → Speak → Listen → See</span>
        <span class="postit-arrow">↓</span>
      </div>

      <!-- Post-it: Controls - points up to controls -->
      <div class="postit postit-controls">
        <span class="postit-arrow">↑</span>
        <span>Skip, replay, turbo</span>
      </div>

      <!-- Dismiss hint -->
      <div class="dismiss-hint">tap anywhere to start</div>
    </div>
  </Transition>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  cursor: pointer;
}

/* Base post-it style - Apple Notes yellow, small horizontal strip */
.postit {
  position: absolute;
  background: #FFD60A;
  padding: 0.375rem 0.625rem;
  border-radius: 3px;
  box-shadow:
    1px 2px 4px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(0, 0, 0, 0.05);
  z-index: 1001;

  display: flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
}

.postit span {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  font-size: 0.75rem;
  font-weight: 500;
  color: #1a1a1a;
  letter-spacing: -0.01em;
}

.postit-arrow {
  font-weight: 400;
  opacity: 0.6;
}

/* Position each post-it to point at its target */

.postit-belt {
  top: 12px;
  left: 200px;
}

.postit-timer {
  top: 12px;
  right: 160px;
}

.postit-phases {
  top: 100px;
  left: 50%;
  transform: translateX(-50%);
  flex-direction: column;
  gap: 0.125rem;
}

.postit-ring {
  top: 50%;
  left: 50%;
  transform: translate(-50%, 120px);
  flex-direction: column;
  gap: 0.125rem;
}

.postit-controls {
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  flex-direction: column;
  gap: 0.125rem;
}

/* Dismiss hint */
.dismiss-hint {
  position: absolute;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.02em;
}

/* Transitions */
.onboarding-enter-active {
  transition: opacity 0.3s ease;
}

.onboarding-enter-active .postit {
  animation: postit-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
}

.onboarding-enter-active .postit-belt { animation-delay: 0.05s; }
.onboarding-enter-active .postit-timer { animation-delay: 0.1s; }
.onboarding-enter-active .postit-phases { animation-delay: 0.15s; }
.onboarding-enter-active .postit-ring { animation-delay: 0.2s; }
.onboarding-enter-active .postit-controls { animation-delay: 0.25s; }

.onboarding-enter-active .dismiss-hint {
  animation: fade-in 0.3s ease 0.4s backwards;
}

.onboarding-leave-active {
  transition: opacity 0.2s ease;
}

.onboarding-enter-from,
.onboarding-leave-to {
  opacity: 0;
}

@keyframes postit-pop {
  from {
    opacity: 0;
    transform: scale(0.8);
  }
}

@keyframes fade-in {
  from { opacity: 0; }
}

/* Mobile adjustments */
@media (max-width: 600px) {
  .postit {
    padding: 0.3rem 0.5rem;
  }

  .postit span {
    font-size: 0.6875rem;
  }

  .postit-belt {
    top: 8px;
    left: 120px;
  }

  .postit-timer {
    top: 8px;
    right: 100px;
  }

  .postit-phases {
    top: 130px;
  }

  .postit-ring {
    transform: translate(-50%, 100px);
  }

  .postit-controls {
    bottom: 120px;
  }

  .dismiss-hint {
    font-size: 0.75rem;
    bottom: 30px;
  }
}

/* Large screens */
@media (min-width: 1024px) {
  .postit-belt {
    left: calc(50% - 200px);
  }

  .postit-timer {
    right: calc(50% - 200px);
  }
}
</style>
