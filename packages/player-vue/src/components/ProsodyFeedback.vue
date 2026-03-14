<script setup lang="ts">
/**
 * ProsodyFeedback - Visual pronunciation feedback
 *
 * Shows native pitch as a shaded "target band" and learner pitch as a line overlay.
 * Green where learner is within the band, amber where outside.
 * Score badge fades in after render.
 */
import { ref, watch, onMounted, computed, nextTick, type PropType } from 'vue'
import type { PronunciationResult } from '@ssi/core/audio'

const props = defineProps({
  result: {
    type: Object as PropType<PronunciationResult>,
    required: true,
  },
  /** Whether to animate the drawing */
  animate: {
    type: Boolean,
    default: true,
  },
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const showScore = ref(false)

// Score color: green (80+), amber (50-79), red (<50)
const scoreColor = computed(() => {
  const s = props.result.score.overall
  if (s >= 80) return '#4ade80'
  if (s >= 50) return '#fbbf24'
  return '#f87171'
})

const scoreBgColor = computed(() => {
  const s = props.result.score.overall
  if (s >= 80) return 'rgba(74, 222, 128, 0.15)'
  if (s >= 50) return 'rgba(251, 191, 36, 0.15)'
  return 'rgba(248, 113, 113, 0.15)'
})

// Drawing constants
const BAND_TOLERANCE = 2.0 // semitones above/below native for "good" band
const CANVAS_PADDING = 16
const LINE_WIDTH = 2.5
const BAND_OPACITY = 0.15

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const w = rect.width
  const h = rect.height
  const drawW = w - CANVAS_PADDING * 2
  const drawH = h - CANVAS_PADDING * 2

  ctx.clearRect(0, 0, w, h)

  const native = props.result.nativeContour
  const learner = props.result.learnerContour
  const path = props.result.alignmentPath

  if (native.length < 2 || learner.length < 2 || path.length < 2) {
    // Not enough data — show a "?" placeholder
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.font = '24px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('?', w / 2, h / 2 + 8)
    return
  }

  // Find Y range from both contours
  const allValues = [...native, ...learner]
  const minY = Math.min(...allValues) - BAND_TOLERANCE
  const maxY = Math.max(...allValues) + BAND_TOLERANCE
  const rangeY = maxY - minY || 1

  // Map functions
  const xScale = (i: number, total: number) => CANVAS_PADDING + (i / Math.max(1, total - 1)) * drawW
  const yScale = (v: number) => CANVAS_PADDING + drawH - ((v - minY) / rangeY) * drawH

  // 1. Draw native pitch as a shaded band (± tolerance)
  ctx.beginPath()
  for (let i = 0; i < native.length; i++) {
    const x = xScale(i, native.length)
    const y = yScale(native[i] + BAND_TOLERANCE)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  for (let i = native.length - 1; i >= 0; i--) {
    const x = xScale(i, native.length)
    const y = yScale(native[i] - BAND_TOLERANCE)
    ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = `rgba(255, 255, 255, ${BAND_OPACITY})`
  ctx.fill()

  // 2. Draw native center line (subtle dashed)
  ctx.beginPath()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
  ctx.lineWidth = 1
  for (let i = 0; i < native.length; i++) {
    const x = xScale(i, native.length)
    const y = yScale(native[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.setLineDash([])

  // 3. Draw learner pitch line — colored by proximity to native band
  // We use the DTW alignment path to match learner points to native points
  for (let p = 0; p < path.length - 1; p++) {
    const [ni, li] = path[p]
    const [ni2, li2] = path[p + 1]

    const x1 = xScale(li, learner.length)
    const y1 = yScale(learner[li])
    const x2 = xScale(li2, learner.length)
    const y2 = yScale(learner[li2])

    // Check if learner is within the band
    const diff = Math.abs(learner[li] - native[ni])
    const inBand = diff <= BAND_TOLERANCE

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = inBand ? '#4ade80' : '#fbbf24'
    ctx.lineWidth = LINE_WIDTH
    ctx.lineCap = 'round'
    ctx.stroke()
  }
}

onMounted(() => {
  nextTick(() => {
    draw()
    // Fade in score after a brief delay
    setTimeout(() => { showScore.value = true }, 300)
  })
})

watch(() => props.result, () => {
  showScore.value = false
  nextTick(() => {
    draw()
    setTimeout(() => { showScore.value = true }, 300)
  })
})
</script>

<template>
  <div class="prosody-feedback">
    <!-- Pitch contour visualization -->
    <div class="contour-container">
      <canvas ref="canvasRef" class="contour-canvas" />
    </div>

    <!-- Score badge -->
    <Transition name="score-fade">
      <div v-if="showScore" class="score-badge" :style="{ color: scoreColor, background: scoreBgColor }">
        <span class="score-value">{{ result.score.overall }}%</span>
      </div>
    </Transition>

    <!-- Sub-scores (compact) -->
    <Transition name="score-fade">
      <div v-if="showScore" class="sub-scores">
        <span class="sub-score">
          <span class="sub-label">Melody</span>
          <span class="sub-value">{{ result.score.pitch }}</span>
        </span>
        <span class="sub-score">
          <span class="sub-label">Rhythm</span>
          <span class="sub-value">{{ result.score.rhythm }}</span>
        </span>
        <span class="sub-score">
          <span class="sub-label">Timing</span>
          <span class="sub-value">{{ result.score.timing }}</span>
        </span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.prosody-feedback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  width: 100%;
}

.contour-container {
  width: 100%;
  max-width: 360px;
  height: 100px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.contour-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.score-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px 16px;
  border-radius: 20px;
  border: 1px solid currentColor;
}

.score-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.sub-scores {
  display: flex;
  gap: 16px;
}

.sub-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.sub-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
}

.sub-value {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  font-variant-numeric: tabular-nums;
}

/* Score fade transition */
.score-fade-enter-active {
  transition: all 0.4s ease-out;
}

.score-fade-leave-active {
  transition: all 0.2s ease-in;
}

.score-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.score-fade-leave-to {
  opacity: 0;
}

/* ═══════════════════════════════════════════════════
   MIST (LIGHT) THEME
   ═══════════════════════════════════════════════════ */

:root[data-theme="mist"] .contour-container {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.08);
}

:root[data-theme="mist"] .sub-label {
  color: rgba(44, 38, 34, 0.4);
}

:root[data-theme="mist"] .sub-value {
  color: rgba(44, 38, 34, 0.7);
}
</style>
