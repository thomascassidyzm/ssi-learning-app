<script setup lang="ts">
/**
 * BrainView v2 — "Your brain on {language}" live timelapse canvas.
 *
 * V1 was a static distinction-network with a tour mode. V2 reframes the
 * brain as a *living timelapse* — the learner watches their network
 * grow over time, with synapse-strength edges thickening as LEGOs fire
 * together. The scrubber IS the tour.
 *
 * This component owns chrome only:
 *   - Header overlay ("Your brain on Italian" + counts)
 *   - Scrubber bar (timeline + play/pause + speed)
 *   - Close button
 *
 * It delegates rendering / hit-testing to useBrainRenderer (PIXI + d3-force).
 *
 * No tour mode controls separate from the scrubber. Play auto-advances the
 * playhead event-by-event at the configured pace.
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useBrainRenderer, type UseBrainRendererHandle } from '../composables/useBrainRenderer'
import type { BrainTimelapseData } from '../types/brainTimelapse'

// ============================================================================
// PROPS & EMITS
// ============================================================================

const props = defineProps<{
  data: BrainTimelapseData
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
const scrubberRef = ref<HTMLDivElement | null>(null)

let renderer: UseBrainRendererHandle | null = null
let resizeObserver: ResizeObserver | null = null

// ============================================================================
// SCRUBBER STATE
// ============================================================================

const SPEED_OPTIONS = [1, 2, 4, 8] as const
type SpeedOption = (typeof SPEED_OPTIONS)[number]
const playbackSpeed = ref<SpeedOption>(1)
const isPlaying = ref(false)
let playTimer: ReturnType<typeof setTimeout> | null = null

/** Scrubber bounds — earliest event → now (load-time snapshot). */
const minTime = computed(() => {
  const first = props.data.events[0]
  if (first) return Date.parse(first.at)
  // Fallback: earliest node introducedAt, or now if there are no nodes.
  let min = Number.POSITIVE_INFINITY
  for (const n of props.data.nodes) {
    const t = Date.parse(n.introducedAt)
    if (Number.isFinite(t) && t < min) min = t
  }
  return Number.isFinite(min) ? min : Date.now()
})

const maxTime = ref<number>(Date.now())
// On mount, lock maxTime to "now" so the scrubber's right edge is stable.

/** Playhead in ms (epoch). Starts at maxTime ("now"). */
const playheadMs = ref<number>(Date.now())

const playheadIso = computed(() => new Date(playheadMs.value).toISOString())

const scrubberRatio = computed(() => {
  const span = maxTime.value - minTime.value
  if (span <= 0) return 1
  return Math.min(1, Math.max(0, (playheadMs.value - minTime.value) / span))
})

// Push scrubber state into the renderer whenever it changes.
watch(playheadIso, (iso) => {
  renderer?.setVisibleAt(iso)
})

// ============================================================================
// COUNTS — drive the subline (revealed at the current visible time).
// ============================================================================

const revealedCount = computed(() => {
  const t = playheadMs.value
  let n = 0
  for (const node of props.data.nodes) {
    if (Date.parse(node.introducedAt) <= t) n++
  }
  return n
})

const synapseCount = computed(() => {
  const t = playheadMs.value
  let n = 0
  for (const edge of props.data.edges) {
    if (Date.parse(edge.firstFiredAt) <= t) n++
  }
  return n
})

const subtitleText = computed(() => {
  const things = revealedCount.value === 1
    ? '1 thing you can say'
    : `${revealedCount.value} things you can say`
  const synapses = synapseCount.value === 1
    ? '1 synapse'
    : `${synapseCount.value} synapses`
  return `${things} · ${synapses}`
})

// ============================================================================
// PLAYBACK — event-by-event auto-advance at configurable pace.
// ============================================================================

const BASE_EVENT_INTERVAL_MS = 250

function scheduleNextStep() {
  if (playTimer) clearTimeout(playTimer)
  const interval = BASE_EVENT_INTERVAL_MS / playbackSpeed.value
  playTimer = setTimeout(() => {
    if (!isPlaying.value) return
    advanceToNextEvent()
    if (isPlaying.value) scheduleNextStep()
  }, interval)
}

function advanceToNextEvent() {
  const t = playheadMs.value
  let nextT: number | null = null
  for (const ev of props.data.events) {
    const evT = Date.parse(ev.at)
    if (evT > t) {
      nextT = evT
      break
    }
  }
  if (nextT == null) {
    // Reached the end — snap to maxTime and stop.
    playheadMs.value = maxTime.value
    stopPlayback()
    return
  }
  playheadMs.value = Math.min(nextT, maxTime.value)
}

function stopPlayback() {
  isPlaying.value = false
  if (playTimer) {
    clearTimeout(playTimer)
    playTimer = null
  }
}

function togglePlayback() {
  if (props.data.events.length === 0) return
  if (isPlaying.value) {
    stopPlayback()
  } else {
    // If we're at the end, restart from the beginning.
    if (playheadMs.value >= maxTime.value) {
      playheadMs.value = minTime.value
    }
    isPlaying.value = true
    scheduleNextStep()
  }
}

function jumpToStart() {
  stopPlayback()
  playheadMs.value = minTime.value
}

watch(playbackSpeed, () => {
  if (isPlaying.value) scheduleNextStep()
})

// ============================================================================
// SCRUBBER DRAG
// ============================================================================

let isDragging = false

function timeFromClientX(clientX: number): number {
  const el = scrubberRef.value
  if (!el) return playheadMs.value
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return minTime.value + (maxTime.value - minTime.value) * ratio
}

function onScrubberPointerDown(e: PointerEvent) {
  isDragging = true
  stopPlayback()
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  playheadMs.value = timeFromClientX(e.clientX)
}

function onScrubberPointerMove(e: PointerEvent) {
  if (!isDragging) return
  playheadMs.value = timeFromClientX(e.clientX)
}

function onScrubberPointerUp(e: PointerEvent) {
  if (!isDragging) return
  isDragging = false
  ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
}

// ============================================================================
// HEADER STYLE
// ============================================================================

const headerStyle = computed(() => ({
  color: props.data.currentBelt.color,
}))

const beltAccent = computed(() => props.data.currentBelt.color)

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  // Snapshot "now" — scrubber max stays fixed for the life of the view.
  maxTime.value = Date.now()
  playheadMs.value = maxTime.value

  if (!canvasRef.value || !containerRef.value) return

  renderer = useBrainRenderer({
    canvas: canvasRef.value,
    data: props.data,
    initiallyVisibleAt: playheadIso.value,
    onNodeTap: (legoId) => {
      // Tapping a node pauses auto-play (the learner is exploring).
      stopPlayback()
      emit('nodeTap', legoId)
    },
  })

  resizeObserver = new ResizeObserver((entries) => {
    if (!renderer || !canvasRef.value) return
    const entry = entries[0]
    if (!entry) return
    const { width, height } = entry.contentRect
    renderer.resize(width, height)
  })
  resizeObserver.observe(containerRef.value)
})

onBeforeUnmount(() => {
  stopPlayback()
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
    <button
      class="close-btn"
      type="button"
      aria-label="Close"
      @click="emit('close')"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        width="20"
        height="20"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>

    <!-- Canvas host -->
    <div ref="containerRef" class="canvas-host">
      <canvas ref="canvasRef" class="brain-canvas" data-testid="brain-canvas" />
    </div>

    <!-- Scrubber bar -->
    <div class="scrubber-bar" :style="{ '--accent': beltAccent }">
      <button
        class="control-btn"
        type="button"
        aria-label="Jump to start"
        :disabled="data.events.length === 0"
        @click="jumpToStart"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
          <polygon points="19 20 9 12 19 4" />
          <rect x="5" y="4" width="2" height="16" />
        </svg>
      </button>

      <div
        ref="scrubberRef"
        class="scrubber-track"
        data-testid="brain-scrubber"
        :data-min="minTime"
        :data-max="maxTime"
        :aria-valuemin="minTime"
        :aria-valuemax="maxTime"
        :aria-valuenow="playheadMs"
        role="slider"
        tabindex="0"
        @pointerdown="onScrubberPointerDown"
        @pointermove="onScrubberPointerMove"
        @pointerup="onScrubberPointerUp"
        @pointercancel="onScrubberPointerUp"
      >
        <div class="scrubber-fill" :style="{ width: `${scrubberRatio * 100}%` }" />
        <div
          class="scrubber-handle"
          :style="{ left: `${scrubberRatio * 100}%` }"
        />
      </div>

      <button
        class="control-btn play-btn"
        type="button"
        :aria-label="isPlaying ? 'Pause' : 'Play'"
        :disabled="data.events.length === 0"
        @click="togglePlayback"
      >
        <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
          <rect x="6" y="4" width="4" height="16" />
          <rect x="14" y="4" width="4" height="16" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
          <polygon points="5 3 19 12 5 21" />
        </svg>
      </button>

      <div class="speed-select" role="radiogroup" aria-label="Playback speed">
        <button
          v-for="speed in SPEED_OPTIONS"
          :key="speed"
          class="speed-btn"
          :class="{ active: playbackSpeed === speed }"
          :aria-pressed="playbackSpeed === speed"
          type="button"
          @click="playbackSpeed = speed"
        >
          {{ speed }}×
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
  color: rgba(232, 228, 223, 0.6);
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
  touch-action: none;
}

/* ---- Scrubber bar --------------------------------------------------- */

.scrubber-bar {
  position: relative;
  z-index: 2;
  padding: 10px 14px calc(var(--safe-bottom) + 14px);
  display: flex;
  align-items: center;
  gap: 10px;
  background: linear-gradient(to top, rgba(10, 10, 15, 0.92), rgba(10, 10, 15, 0));
}

/* ---- Buttons — lifted from ListeningPodPlayer's .control-btn -------- */

.control-btn {
  background: none;
  border: none;
  color: #e8e4df;
  padding: 10px;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s, opacity 0.15s;
  opacity: 0.7;
  display: flex;
  align-items: center;
  justify-content: center;
}
.control-btn:hover { background: rgba(255, 255, 255, 0.06); opacity: 1; }
.control-btn:disabled { opacity: 0.2; cursor: default; }
.control-btn:disabled:hover { background: none; }

.play-btn {
  background: var(--accent, #fcd34d);
  color: #0a0a0f;
  width: 40px;
  height: 40px;
  padding: 0;
  opacity: 1;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
.play-btn:hover { background: var(--accent, #fcd34d); filter: brightness(1.1); }
.play-btn:disabled { opacity: 0.35; }

/* ---- Scrubber track — horizontal iOS-character pill ----------------- */

.scrubber-track {
  flex: 1;
  position: relative;
  height: 26px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.3),
    0 1px 3px rgba(255, 200, 120, 0.05);
  cursor: pointer;
  touch-action: none;
}

.scrubber-fill {
  position: absolute;
  inset: 2px auto 2px 2px;
  height: calc(100% - 4px);
  border-radius: 999px;
  background: linear-gradient(
    to right,
    rgba(255, 255, 255, 0.04),
    color-mix(in srgb, var(--accent, #fcd34d) 35%, transparent)
  );
  pointer-events: none;
  transition: width 0.06s linear;
}

.scrubber-handle {
  position: absolute;
  top: 50%;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent, #fcd34d);
  border: 2px solid #0a0a0f;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  transform: translate(-50%, -50%);
  pointer-events: none;
  transition: left 0.06s linear;
}

/* ---- Speed selector ------------------------------------------------- */

.speed-select {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.25);
}

.speed-btn {
  background: transparent;
  border: none;
  color: rgba(232, 228, 223, 0.6);
  font-size: 0.7rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  min-width: 28px;
}
.speed-btn:hover { color: #e8e4df; }
.speed-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent, #fcd34d);
}

/* ---- Mobile ---------------------------------------------------------- */

@media (max-width: 380px) {
  .scrubber-bar { gap: 6px; padding: 8px 10px calc(var(--safe-bottom) + 12px); }
  .speed-btn { padding: 3px 6px; font-size: 0.65rem; min-width: 24px; }
  .play-btn { width: 36px; height: 36px; }
}
</style>
