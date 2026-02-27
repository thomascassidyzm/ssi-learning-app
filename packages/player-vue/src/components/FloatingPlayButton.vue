<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  isPlaying: {
    type: Boolean,
    default: false
  },
  isListeningMode: {
    type: Boolean,
    default: false
  },
  isOnPlayerScreen: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['togglePlayback', 'startLearning'])

const pressed = ref(false)

const handleTap = () => {
  if (props.isListeningMode) return

  pressed.value = true
  setTimeout(() => { pressed.value = false }, 200)

  if (navigator.vibrate) {
    navigator.vibrate([10, 50, 10])
  }

  if (props.isOnPlayerScreen) {
    emit('togglePlayback')
  } else {
    emit('startLearning')
  }
}
</script>

<template>
  <button
    class="floating-play"
    :class="{
      pressed,
      'is-playing': isOnPlayerScreen && isPlaying,
      'is-disabled': isListeningMode
    }"
    :disabled="isListeningMode"
    @click="handleTap"
  >
    <div class="play-glow"></div>
    <div class="play-inner">
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
</template>

<style scoped>
.floating-play {
  position: fixed;
  bottom: calc(72px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
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

.floating-play:active,
.floating-play.pressed {
  transform: translateX(-50%) scale(0.92);
  box-shadow:
    0 2px 8px rgba(194, 58, 58, 0.5),
    0 4px 12px rgba(194, 58, 58, 0.3),
    inset 0 1px 1px var(--highlight-inset),
    inset 0 -1px 1px rgba(0, 0, 0, 0.15);
}

.play-glow {
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

.floating-play:hover .play-glow {
  opacity: 0.9;
}

.play-inner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-on-accent);
}

.play-inner svg {
  width: 22px;
  height: 22px;
  margin-left: 2px;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
}

.floating-play.is-playing .play-inner svg {
  margin-left: 0;
}

/* Disabled state - listening mode */
.floating-play.is-disabled {
  background: linear-gradient(145deg, var(--bg-interactive-disabled) 0%, var(--bg-interactive-disabled) 100%);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.3),
    0 4px 12px rgba(0, 0, 0, 0.2),
    inset 0 1px 1px var(--border-subtle),
    inset 0 -1px 1px rgba(0, 0, 0, 0.1);
  cursor: not-allowed;
  opacity: 0.7;
}

.floating-play.is-disabled .play-glow {
  opacity: 0;
  animation: none;
}

.floating-play.is-disabled .play-inner {
  color: var(--text-secondary);
}

.floating-play.is-disabled .play-inner svg {
  margin-left: 0;
}

/* Responsive */
@media (min-width: 768px) {
  .floating-play {
    width: 68px;
    height: 68px;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }

  .play-inner svg {
    width: 28px;
    height: 28px;
  }

  .play-glow {
    inset: -8px;
  }
}

@media (orientation: landscape) and (max-height: 500px) {
  .floating-play {
    width: 44px;
    height: 44px;
    bottom: calc(56px + env(safe-area-inset-bottom, 0px));
  }

  .play-inner svg {
    width: 18px;
    height: 18px;
  }
}
</style>
