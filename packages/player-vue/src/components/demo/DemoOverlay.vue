<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useDemoController } from '@/composables/demo/useDemoController'

const {
  isActive,
  isPaused,
  currentScene,
  currentSceneIndex,
  totalScenes,
  progress,
  nextScene,
  prevScene,
  pause,
  resume,
  stopDemo,
} = useDemoController()

// Spotlight bounding rect for highlighted element
const spotlightRect = ref<DOMRect | null>(null)
const narrationVisible = ref(false)

// Recompute spotlight when scene changes
watch(
  () => currentScene.value?.highlight,
  async (selector) => {
    if (!selector) {
      spotlightRect.value = null
      return
    }
    await nextTick()
    const el = document.querySelector(selector)
    spotlightRect.value = el ? el.getBoundingClientRect() : null
  },
  { immediate: true }
)

// Fade narration text on scene change
watch(currentSceneIndex, () => {
  narrationVisible.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      narrationVisible.value = true
    })
  })
})

// Initial fade-in
onMounted(() => {
  requestAnimationFrame(() => {
    narrationVisible.value = true
  })
})

// Keyboard controls are handled by useDemoController (singleton listener)

// Spotlight clip-path
const spotlightClip = computed(() => {
  const r = spotlightRect.value
  if (!r) return ''
  const pad = 8
  const x = r.left - pad
  const y = r.top - pad
  const w = r.width + pad * 2
  const h = r.height + pad * 2
  const radius = 12
  // SVG-style clip path with a cutout: full viewport minus the spotlight rect
  return `polygon(
    0% 0%, 0% 100%, ${x}px 100%, ${x}px ${y}px,
    ${x + w}px ${y}px, ${x + w}px ${y + h}px,
    ${x}px ${y + h}px, ${x}px 100%, 100% 100%, 100% 0%
  )`
})

// Toggle pause/resume
function togglePause() {
  isPaused.value ? resume() : pause()
}

// Scene counter text
const sceneCounter = computed(
  () => `${currentSceneIndex.value + 1} of ${totalScenes.value}`
)
</script>

<template>
  <Teleport to="body">
    <div v-if="isActive" class="demo-overlay">

      <!-- Spotlight mask (conditional) -->
      <div
        v-if="spotlightRect"
        class="demo-spotlight"
        :style="{ clipPath: spotlightClip }"
      />

      <!-- Demo badge (top-right) -->
      <div class="demo-badge">DEMO</div>

      <!-- Bottom control bar -->
      <div class="demo-bar">

        <!-- Progress line (top edge of bar) -->
        <div class="demo-progress-track">
          <div
            class="demo-progress-fill"
            :class="{ paused: isPaused }"
            :style="{ width: `${progress * 100}%` }"
          />
        </div>

        <div class="demo-bar-inner">

          <!-- Narration text -->
          <div class="demo-narration" :class="{ visible: narrationVisible }">
            <p v-if="currentScene?.title" class="demo-scene-title">
              {{ currentScene.title }}
            </p>
            <p v-if="currentScene?.narration" class="demo-scene-narration">
              {{ currentScene.narration }}
            </p>
          </div>

          <!-- Controls -->
          <div class="demo-controls">
            <span class="demo-counter">{{ sceneCounter }}</span>

            <button
              class="demo-btn"
              aria-label="Previous scene"
              :disabled="currentSceneIndex <= 0"
              @click="prevScene"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <button
              class="demo-btn demo-btn-pause"
              :class="{ pulsing: isPaused }"
              :aria-label="isPaused ? 'Resume' : 'Pause'"
              @click="togglePause"
            >
              <!-- Pause icon -->
              <svg v-if="!isPaused" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
              <!-- Play icon -->
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            </button>

            <button
              class="demo-btn"
              aria-label="Next scene"
              :disabled="currentSceneIndex >= totalScenes - 1"
              @click="nextScene"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button class="demo-btn demo-btn-stop" aria-label="Exit demo" @click="stopDemo">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <!-- Keyboard hints -->
        <div class="demo-hints">
          Space: pause &middot; &larr;&rarr;: navigate &middot; Esc: exit
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ============================================
   Demo Overlay - Minimal documentary style
   ============================================ */

.demo-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  pointer-events: none;
}

/* --- Spotlight mask --- */
.demo-spotlight {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  transition: clip-path 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  pointer-events: none;
}

/* --- Demo badge --- */
.demo-badge {
  position: fixed;
  top: 16px;
  right: 16px;
  padding: 4px 12px;
  border-radius: 6px;
  background: rgba(220, 38, 38, 0.7);
  color: rgba(255, 255, 255, 0.85);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  pointer-events: none;
  user-select: none;
}

/* --- Bottom bar --- */
.demo-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(10, 10, 20, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: auto;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.demo-bar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  max-width: 1200px;
  margin: 0 auto;
}

/* --- Progress bar --- */
.demo-progress-track {
  height: 2px;
  background: rgba(255, 255, 255, 0.06);
}

.demo-progress-fill {
  height: 100%;
  background: #dc2626;
  transition: width 0.3s linear;
}

.demo-progress-fill.paused {
  transition: none;
  opacity: 0.6;
}

/* --- Narration --- */
.demo-narration {
  flex: 1;
  min-width: 0;
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.demo-narration.visible {
  opacity: 1;
  transform: translateY(0);
}

.demo-scene-title {
  margin: 0 0 2px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.demo-scene-narration {
  margin: 0;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 15px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.45;
}

/* --- Controls --- */
.demo-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.demo-counter {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-right: 4px;
  white-space: nowrap;
}

.demo-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.demo-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.95);
}

.demo-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.demo-btn-pause {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: rgba(220, 38, 38, 0.15);
  color: #dc2626;
}

.demo-btn-pause:hover {
  background: rgba(220, 38, 38, 0.25);
  color: #ef4444;
}

.demo-btn-pause.pulsing {
  animation: pause-pulse 1.8s ease-in-out infinite;
}

@keyframes pause-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.3); }
  50% { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
}

.demo-btn-stop {
  margin-left: 4px;
}

.demo-btn-stop:hover {
  background: rgba(220, 38, 38, 0.15);
  color: #dc2626;
}

/* --- Keyboard hints --- */
.demo-hints {
  text-align: center;
  padding: 4px 20px 6px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.2);
  letter-spacing: 0.02em;
}

/* --- Responsive --- */
@media (max-width: 640px) {
  .demo-bar-inner {
    flex-direction: column;
    gap: 10px;
    padding: 10px 14px;
  }

  .demo-narration {
    text-align: center;
  }

  .demo-scene-title {
    font-size: 11px;
  }

  .demo-scene-narration {
    font-size: 13px;
  }

  .demo-hints {
    display: none;
  }

  .demo-badge {
    top: 10px;
    right: 10px;
    font-size: 10px;
    padding: 3px 8px;
  }
}

/* --- Reduced motion --- */
@media (prefers-reduced-motion: reduce) {
  .demo-narration {
    transition: none;
  }

  .demo-progress-fill {
    transition: none;
  }

  .demo-spotlight {
    transition: none;
  }

  .demo-btn-pause.pulsing {
    animation: none;
  }
}
</style>
