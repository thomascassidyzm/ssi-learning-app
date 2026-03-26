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
  stopDemo,
} = useDemoController()

const narrationVisible = ref(false)
const isCollapsed = ref(false)

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

// Scene counter text
const sceneCounter = computed(
  () => `${currentSceneIndex.value + 1} / ${totalScenes.value}`
)

const isLastScene = computed(() => currentSceneIndex.value >= totalScenes.value - 1)
const isFirstScene = computed(() => currentSceneIndex.value <= 0)
</script>

<template>
  <Teleport to="body">
    <div v-if="isActive" class="demo-overlay">

      <!-- Floating transport bar (top center) -->
      <div class="demo-transport" :class="{ collapsed: isCollapsed }">

        <!-- Collapsed state: just a small pill -->
        <button v-if="isCollapsed" class="demo-expand-btn" @click="isCollapsed = false">
          <span class="expand-label">DEMO</span>
          <span class="expand-counter">{{ sceneCounter }}</span>
        </button>

        <!-- Expanded state: narration + controls -->
        <template v-else>
          <!-- Progress bar -->
          <div class="demo-progress-track">
            <div
              class="demo-progress-fill"
              :style="{ width: `${progress * 100}%` }"
            />
          </div>

          <div class="demo-transport-inner">
            <!-- Narration -->
            <div class="demo-narration" :class="{ visible: narrationVisible }">
              <span class="demo-badge">DEMO</span>
              <span v-if="currentScene?.narration" class="demo-scene-narration">
                {{ currentScene.narration }}
              </span>
            </div>

            <!-- Controls -->
            <div class="demo-controls">
              <span class="demo-counter">{{ sceneCounter }}</span>

              <button
                class="demo-btn"
                aria-label="Previous step"
                :disabled="isFirstScene"
                @click="prevScene"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>

              <button
                class="demo-btn demo-btn-next"
                aria-label="Next step"
                :disabled="isLastScene"
                @click="nextScene"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              <button
                class="demo-btn demo-btn-collapse"
                aria-label="Minimise"
                @click="isCollapsed = true"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <polyline points="4 14 12 6 20 14" />
                </svg>
              </button>

              <button class="demo-btn demo-btn-stop" aria-label="Exit demo" @click="stopDemo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.demo-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  pointer-events: none;
}

/* --- Floating transport (top center) --- */
.demo-transport {
  position: fixed;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: 720px;
  width: calc(100% - 32px);
  background: rgba(10, 10, 20, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  pointer-events: auto;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  transition: all 0.25s ease;
}

.demo-transport.collapsed {
  width: auto;
  max-width: none;
  border-radius: 10px;
}

/* --- Collapsed expand button --- */
.demo-expand-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.8);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  transition: color 0.15s ease;
}

.demo-expand-btn:hover {
  color: white;
}

.expand-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #dc2626;
}

.expand-counter {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
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

/* --- Transport inner --- */
.demo-transport-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}

/* --- Narration --- */
.demo-narration {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 10px;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.demo-narration.visible {
  opacity: 1;
}

.demo-badge {
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(220, 38, 38, 0.7);
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.demo-scene-narration {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* --- Controls --- */
.demo-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.demo-counter {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  margin-right: 4px;
  white-space: nowrap;
}

.demo-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.demo-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.95);
}

.demo-btn:disabled {
  opacity: 0.25;
  cursor: default;
}

.demo-btn-next {
  background: rgba(220, 38, 38, 0.15);
  color: #dc2626;
}

.demo-btn-next:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.25);
  color: #ef4444;
}

.demo-btn-stop:hover {
  background: rgba(220, 38, 38, 0.15);
  color: #dc2626;
}

.demo-btn-collapse {
  opacity: 0.5;
}

.demo-btn-collapse:hover {
  opacity: 1;
}

/* --- Responsive --- */
@media (max-width: 640px) {
  .demo-transport {
    top: 4px;
    width: calc(100% - 16px);
    border-radius: 10px;
  }

  .demo-transport-inner {
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px;
  }

  .demo-narration {
    flex-direction: column;
    gap: 4px;
  }

  .demo-scene-narration {
    font-size: 12px;
    -webkit-line-clamp: 3;
  }
}

/* --- Reduced motion --- */
@media (prefers-reduced-motion: reduce) {
  .demo-narration { transition: none; }
  .demo-progress-fill { transition: none; }
  .demo-transport { transition: none; }
}
</style>
