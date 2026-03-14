<script setup lang="ts">
/**
 * ProsodyFeedback - Visual pronunciation feedback
 *
 * Shows native and learner energy envelopes as overlaid bar charts.
 * Native = subtle filled shape, learner = colored overlay.
 * Green where shapes match, amber where they diverge.
 */
import { ref, watch, onMounted, computed, nextTick, type PropType } from 'vue'
import type { PronunciationResult } from '@ssi/core/audio'

const props = defineProps({
  result: {
    type: Object as PropType<PronunciationResult>,
    required: true,
  },
  animate: {
    type: Boolean,
    default: true,
  },
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const showScore = ref(false)

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

const CANVAS_PADDING = 16

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

  if (native.length < 2 || learner.length < 2) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.font = '24px system-ui'
    ctx.textAlign = 'center'
    ctx.fillText('?', w / 2, h / 2 + 8)
    return
  }

  const bins = native.length // both are normalized to same bin count
  const barW = drawW / bins
  const maxVal = Math.max(...native, ...learner) || 1

  // 1. Draw native envelope as filled bars (subtle)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
  for (let i = 0; i < bins; i++) {
    const x = CANVAS_PADDING + i * barW
    const barH = (native[i] / maxVal) * drawH
    ctx.fillRect(x + 1, CANVAS_PADDING + drawH - barH, barW - 2, barH)
  }

  // 2. Draw learner envelope as colored overlay bars
  for (let i = 0; i < bins; i++) {
    const x = CANVAS_PADDING + i * barW
    const barH = (learner[i] / maxVal) * drawH

    // Color by how close this bin is to native
    const diff = Math.abs(native[i] - learner[i])
    const maxDiff = maxVal * 0.3 // 30% of max = threshold for "close enough"
    const close = diff < maxDiff

    ctx.fillStyle = close
      ? 'rgba(74, 222, 128, 0.5)'  // green
      : 'rgba(251, 191, 36, 0.5)'  // amber

    ctx.fillRect(x + 1, CANVAS_PADDING + drawH - barH, barW - 2, barH)
  }

  // 3. Draw native outline on top (dashed line connecting bar tops)
  ctx.beginPath()
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 1.5
  for (let i = 0; i < bins; i++) {
    const x = CANVAS_PADDING + i * barW + barW / 2
    const y = CANVAS_PADDING + drawH - (native[i] / maxVal) * drawH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.setLineDash([])
}

onMounted(() => {
  nextTick(() => {
    draw()
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
    <div class="contour-container">
      <canvas ref="canvasRef" class="contour-canvas" />
    </div>

    <!-- Sub-scores (human labels, no raw percentages) -->
    <Transition name="score-fade">
      <div v-if="showScore" class="sub-scores">
        <span class="sub-score">
          <span class="sub-label">Length</span>
          <span class="sub-dot" :class="dotClass(result.score.duration)" />
        </span>
        <span class="sub-score">
          <span class="sub-label">Syllables</span>
          <span class="sub-dot" :class="dotClass(result.score.peakCount)" />
        </span>
        <span class="sub-score">
          <span class="sub-label">Shape</span>
          <span class="sub-dot" :class="dotClass(result.score.envelope)" />
        </span>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts">
function dotClass(score: number): string {
  if (score >= 80) return 'dot-green'
  if (score >= 50) return 'dot-amber'
  return 'dot-red'
}
</script>

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

.sub-scores {
  display: flex;
  gap: 20px;
}

.sub-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.sub-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.4);
}

.sub-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.dot-green { background: #4ade80; }
.dot-amber { background: #fbbf24; }
.dot-red { background: #f87171; }

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

/* Mist theme */
:root[data-theme="mist"] .contour-container {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.08);
}
:root[data-theme="mist"] .sub-label {
  color: rgba(44, 38, 34, 0.4);
}
</style>
