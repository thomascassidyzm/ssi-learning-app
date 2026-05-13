<script setup lang="ts">
/**
 * BrainView.vue — "Your brain on {{ language }}" canvas + tour.
 *
 * Owns the layout and tour state. Delegates all rendering / hit-testing
 * to useBrainRenderer (PIXI-backed). Side-panel content is rendered by
 * BrainSidePanel (Agent C) — this component only emits `nodeTap` with a
 * legoId; the parent decides whether to open the panel.
 *
 * Tour order: nodes sorted by (beltIndex asc, seedNumber asc, legoIndex asc),
 * where legoIndex is parsed off the trailing `L\d+` of the legoId. Tour
 * steps emit `nodeTap` so the parent stays in sole charge of side-panel
 * state and audio playback.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useBrainRenderer, type UseBrainRendererHandle } from '../composables/useBrainRenderer'
import type { BrainViewData, BrainViewStats, NetworkNode } from '../types/brainNetwork'

// ============================================================================
// PROPS & EMITS
// ============================================================================

const props = defineProps<{
  data: BrainViewData
  stats: BrainViewStats
}>()

const emit = defineEmits<{
  nodeTap: [legoId: string]
  close: []
}>()

// ============================================================================
// REFS
// ============================================================================

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let renderer: UseBrainRendererHandle | null = null
let resizeObserver: ResizeObserver | null = null

// ============================================================================
// TOUR STATE
// ============================================================================

const SPEED_OPTIONS = [1, 1.2, 1.5, 2] as const
const playbackSpeed = ref<(typeof SPEED_OPTIONS)[number]>(1.5)
const isPlaying = ref(false)
const tourIndex = ref(0)
let tourTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Tour walks ONLY revealed nodes — there's nothing for the learner to
 * hear yet on un-revealed nodes. Order is (beltIndex, seedNumber, legoIndex).
 */
const tourNodes = computed<NetworkNode[]>(() => {
  const revealed = props.data.nodes.filter((n) => n.isRevealed)
  return revealed.slice().sort((a, b) => {
    if (a.beltIndex !== b.beltIndex) return a.beltIndex - b.beltIndex
    if (a.seedNumber !== b.seedNumber) return a.seedNumber - b.seedNumber
    return legoIndexOf(a.legoId) - legoIndexOf(b.legoId)
  })
})

function legoIndexOf(legoId: string): number {
  const match = /L(\d+)$/.exec(legoId)
  return match ? parseInt(match[1], 10) : 0
}

// Step interval: ~2.4s at 1x, scaled down by playbackSpeed.
const TOUR_BASE_INTERVAL_MS = 2400
const tourIntervalMs = computed(() => TOUR_BASE_INTERVAL_MS / playbackSpeed.value)

function stopTour() {
  isPlaying.value = false
  if (tourTimer) {
    clearTimeout(tourTimer)
    tourTimer = null
  }
}

function scheduleNextStep() {
  if (tourTimer) clearTimeout(tourTimer)
  tourTimer = setTimeout(() => {
    if (!isPlaying.value) return
    advance(1)
    if (isPlaying.value) scheduleNextStep()
  }, tourIntervalMs.value)
}

function advance(delta: number) {
  if (tourNodes.value.length === 0) return
  const len = tourNodes.value.length
  tourIndex.value = (tourIndex.value + delta + len) % len
  const node = tourNodes.value[tourIndex.value]
  if (!node) return
  renderer?.setFocus(node.legoId)
  emit('nodeTap', node.legoId)
}

function togglePlayback() {
  if (tourNodes.value.length === 0) return
  if (isPlaying.value) {
    stopTour()
  } else {
    isPlaying.value = true
    // Emit the current step immediately so the side panel updates on press.
    const node = tourNodes.value[tourIndex.value]
    if (node) {
      renderer?.setFocus(node.legoId)
      emit('nodeTap', node.legoId)
    }
    scheduleNextStep()
  }
}

function stepPrev() {
  stopTour()
  advance(-1)
}

function stepNext() {
  stopTour()
  advance(1)
}

watch(playbackSpeed, () => {
  if (isPlaying.value) scheduleNextStep()
})

// ============================================================================
// HEADER STYLE
// ============================================================================

const headerStyle = computed(() => ({
  color: props.stats.currentBelt.color,
}))

const subtitleText = computed(() => {
  const n = props.stats.revealedCount
  return n === 1 ? '1 thing you can say' : `${n} things you can say`
})

const beltAccent = computed(() => props.stats.currentBelt.color)

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return

  const handle = useBrainRenderer({
    canvas: canvasRef.value,
    data: props.data,
    stats: props.stats,
    onNodeTap: (legoId) => {
      // Stop the tour the moment the learner taps something themselves.
      stopTour()
      emit('nodeTap', legoId)
    },
  })
  renderer = handle

  // Observe container size for responsive resizing.
  resizeObserver = new ResizeObserver((entries) => {
    if (!renderer || !canvasRef.value) return
    const entry = entries[0]
    if (!entry) return
    const { width, height } = entry.contentRect
    // Sync CSS size onto the canvas backing store via the renderer.
    renderer.resize(width, height)
  })
  resizeObserver.observe(containerRef.value)
})

onBeforeUnmount(() => {
  stopTour()
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (renderer) {
    renderer.destroy()
    renderer = null
  }
})
</script>

<template>
  <div class="brain-view">
    <!-- Header overlay -->
    <header class="brain-header">
      <h1 class="brain-title" :style="headerStyle">
        Your brain on {{ data.languageName }}
      </h1>
      <p class="brain-subtitle">{{ subtitleText }}</p>
    </header>

    <!-- Close button -->
    <button class="close-btn" type="button" aria-label="Close" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>

    <!-- Canvas host -->
    <div ref="containerRef" class="canvas-host">
      <canvas ref="canvasRef" class="brain-canvas" data-testid="brain-canvas" />
    </div>

    <!-- Tour controls -->
    <div class="tour-controls" :style="{ '--accent': beltAccent }">
      <button
        class="control-btn"
        type="button"
        aria-label="Previous"
        :disabled="tourNodes.length === 0"
        @click="stepPrev"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
          <polygon points="19 20 9 12 19 4"/>
          <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>

      <button
        class="play-btn"
        type="button"
        :aria-label="isPlaying ? 'Pause tour' : 'Play tour'"
        :disabled="tourNodes.length === 0"
        @click="togglePlayback"
      >
        <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
          <polygon points="5 3 19 12 5 21"/>
        </svg>
      </button>

      <button
        class="control-btn"
        type="button"
        aria-label="Next"
        :disabled="tourNodes.length === 0"
        @click="stepNext"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
          <polygon points="5 4 15 12 5 20"/>
          <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" stroke-width="2"/>
        </svg>
      </button>

      <div class="speed-select" role="radiogroup" aria-label="Tour speed">
        <button
          v-for="speed in SPEED_OPTIONS"
          :key="speed"
          class="speed-btn"
          :class="{ active: playbackSpeed === speed }"
          :aria-pressed="playbackSpeed === speed"
          type="button"
          @click="playbackSpeed = speed"
        >
          {{ speed }}x
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brain-view {
  position: relative;
  width: 100%;
  height: 100%;
  background: #0a0a0f;
  color: #e8e4df;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  /* Honour iOS safe areas — tour controls sit just above the home bar. */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

/* ---- Header ---------------------------------------------------------- */

.brain-header {
  position: absolute;
  top: calc(var(--safe-top) + 14px);
  left: 0;
  right: 0;
  z-index: 2;
  pointer-events: none;
  text-align: center;
  padding: 0 56px;
}

.brain-title {
  font-size: clamp(1.25rem, 4vw, 1.75rem);
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
}

.brain-subtitle {
  margin: 4px 0 0;
  font-size: 0.875rem;
  color: rgba(232, 228, 223, 0.55);
}

/* ---- Close button --------------------------------------------------- */

.close-btn {
  position: absolute;
  top: calc(var(--safe-top) + 12px);
  right: 12px;
  z-index: 3;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(20, 20, 28, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e8e4df;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}
.close-btn:hover {
  background: rgba(40, 40, 52, 0.85);
}

/* ---- Canvas --------------------------------------------------------- */

.canvas-host {
  flex: 1;
  min-height: 0;
  position: relative;
}

.brain-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none; /* let pixi-viewport handle pan/zoom */
}

/* ---- Tour controls -------------------------------------------------- */

.tour-controls {
  position: relative;
  z-index: 2;
  padding: 12px 16px calc(var(--safe-bottom) + 16px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  flex-wrap: wrap;
  background: linear-gradient(to top, rgba(10, 10, 15, 0.92), rgba(10, 10, 15, 0));
}

.control-btn {
  background: none;
  border: none;
  color: #e8e4df;
  padding: 10px;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s, opacity 0.15s;
  opacity: 0.7;
}
.control-btn:hover { background: rgba(255,255,255,0.06); opacity: 1; }
.control-btn:disabled { opacity: 0.2; cursor: default; }
.control-btn:disabled:hover { background: none; }

.play-btn {
  background: var(--accent, #fcd34d);
  border: none;
  color: #0a0a0f;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: filter 0.15s, transform 0.1s;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
}
.play-btn:hover { filter: brightness(1.1); }
.play-btn:active { transform: scale(0.95); }
.play-btn:disabled { opacity: 0.35; cursor: default; }

.speed-select {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 999px;
}

.speed-btn {
  background: transparent;
  border: none;
  color: rgba(232, 228, 223, 0.6);
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.speed-btn:hover { color: #e8e4df; }
.speed-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent, #fcd34d);
}

/* ---- Mobile breakpoints --------------------------------------------- */

@media (max-width: 380px) {
  .tour-controls { gap: 12px; }
  .play-btn { width: 48px; height: 48px; }
  .speed-btn { padding: 4px 8px; font-size: 0.7rem; }
}
</style>
