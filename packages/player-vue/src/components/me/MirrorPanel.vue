<script setup lang="ts">
/**
 * MirrorPanel — LAYER 2 of the learner profile: reflect execution.
 *
 * Founder ruling 2026-08-03: how quickly replies arrive is reported DIRECTLY;
 * the under-the-hood signals stay under the hood. Framed as "where you are ×
 * the direction you're moving". Honest, warm, UNREWARDED — nothing here is a
 * prize, and a flat line is stated plainly rather than dressed up.
 *
 * In the first ~30 hours this panel's job is ACCELERATING EXTRAPOLATION: show
 * the curve early, before the learner can feel it, so belief outruns doubt.
 * Hence the dashed continuation — explicitly labelled as "where this is
 * heading", never presented as measured fact.
 *
 * LANGUAGE WALL: no internal terminology reaches this surface. Not "latency",
 * not "prosody", not any unit name. "How quickly your replies come" is the
 * whole vocabulary.
 */
import { computed } from 'vue'
import type { LearnerProfile } from '@/composables/useLearnerProfile'

const props = defineProps<{ mirror: LearnerProfile['mirror'] }>()

const W = 320
const H = 96
const PAD = 8

const points = computed(() => props.mirror.curve ?? [])
const hasCurve = computed(() => points.value.length >= 3)

// Scale over the measured points only; the projection extends past the right
// edge into its own reserved strip so it can never be mistaken for data.
const scaled = computed(() => {
  const pts = points.value
  if (!pts.length) return []
  const xs = pts.map((p) => p.hours)
  const ys = pts.map((p) => p.ms)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1
  const plotW = (W - PAD * 2) * 0.72 // measured data occupies the left 72%
  return pts.map((p) => ({
    x: PAD + ((p.hours - xMin) / xSpan) * plotW,
    // Faster (lower ms) plots HIGHER — the line rises as the learner improves.
    y: PAD + ((p.ms - yMin) / ySpan) * (H - PAD * 2),
    ...p,
  }))
})

const linePath = computed(() =>
  scaled.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
)

// The projection: continue the recent slope for roughly the same span again.
// Deliberately conservative — half the observed slope — because an over-promise
// that fails to land is the one thing that would cost the learner's trust.
const projectionPath = computed(() => {
  const pts = scaled.value
  if (pts.length < 3) return ''
  const last = pts[pts.length - 1]
  const prev = pts[Math.max(0, pts.length - 3)]
  const dx = last.x - prev.x || 1
  const slope = ((last.y - prev.y) / dx) * 0.5
  const endX = W - PAD
  const endY = Math.max(PAD, Math.min(H - PAD, last.y + slope * (endX - last.x)))
  return `M${last.x.toFixed(1)},${last.y.toFixed(1)} L${endX.toFixed(1)},${endY.toFixed(1)}`
})

const endPoint = computed(() => scaled.value[scaled.value.length - 1] ?? null)

const seconds = (ms: number | null): string =>
  ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`

// The honest sentence. Direction is stated as what it is; when it has not moved
// yet, we say so warmly rather than inventing progress.
const directionLine = computed(() => {
  const d = props.mirror.directionPct
  if (d == null) return 'Give it a few more goes and this will start showing you the shape of it.'
  if (d <= -8) {
    return `Your replies are coming ${Math.abs(d)}% quicker than when you started. That is the thing you cannot feel from the inside.`
  }
  if (d >= 8) {
    return 'Your replies are taking a bit longer just now — which is exactly what happens when the material steps up. It settles.'
  }
  return 'Holding steady. Steady is fine — the change usually arrives in steps, not a slope.'
})
</script>

<template>
  <section class="panel">
    <h2 class="title">How quickly it comes</h2>

    <div class="readout">
      <div class="now">
        <span class="now-value">{{ seconds(mirror.latencyNowMs) }}</span>
        <span class="now-label">to answer, lately</span>
      </div>
      <div v-if="mirror.latencyEarlyMs" class="then">
        <span class="then-value">{{ seconds(mirror.latencyEarlyMs) }}</span>
        <span class="then-label">when you started</span>
      </div>
    </div>

    <figure v-if="hasCurve" class="chart">
      <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="`Response time trend: ${seconds(mirror.latencyEarlyMs)} when you started, ${seconds(mirror.latencyNowMs)} lately`">
        <!-- recessive baseline -->
        <line :x1="PAD" :y1="H - PAD" :x2="W - PAD" :y2="H - PAD" class="axis" />
        <path :d="linePath" class="line" />
        <path v-if="projectionPath" :d="projectionPath" class="projection" />
        <circle v-if="endPoint" :cx="endPoint.x" :cy="endPoint.y" r="4.5" class="endpoint" />
      </svg>
      <figcaption class="caption">
        <span class="key-measured">Measured</span>
        <span class="key-projected">Where this is heading</span>
      </figcaption>
    </figure>

    <p class="direction">{{ directionLine }}</p>

    <p v-if="mirror.unitsSteady > 0" class="steady">
      {{ mirror.unitsSteady }} things now come back without you reaching for them.
    </p>

    <p v-if="mirror.source === 'mock'" class="sample">Sample data — not your real numbers yet.</p>
  </section>
</template>

<style scoped>
.panel {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}
.title {
  margin: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-secondary, #6B635C);
  letter-spacing: 0.01em;
}
.readout { display: flex; align-items: baseline; gap: var(--space-5, 20px); flex-wrap: wrap; }
.now { display: flex; align-items: baseline; gap: 8px; }
.now-value {
  font-size: 36px; font-weight: var(--font-semibold, 600); line-height: 1;
  color: var(--ink-primary, #2C2622); font-variant-numeric: tabular-nums;
}
.now-label { font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); }
.then { display: flex; align-items: baseline; gap: 6px; }
.then-value {
  font-size: var(--text-base, 15px); color: var(--ink-tertiary, #8A8078);
  font-variant-numeric: tabular-nums; text-decoration: line-through;
  text-decoration-color: rgba(138, 128, 120, 0.5);
}
.then-label { font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078); }

.chart { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.chart svg { width: 100%; height: auto; display: block; overflow: visible; }
.axis { stroke: rgba(44, 38, 34, 0.12); stroke-width: 1; }
.line {
  fill: none; stroke: var(--accent-belt, #7C6A58); stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
}
.projection {
  fill: none; stroke: var(--accent-belt, #7C6A58); stroke-width: 2;
  stroke-dasharray: 3 5; stroke-linecap: round; opacity: 0.45;
}
.endpoint { fill: var(--accent-belt, #7C6A58); stroke: var(--bg-elevated, #fff); stroke-width: 2; }
.caption {
  display: flex; gap: var(--space-4, 16px);
  font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078);
}
.key-measured::before, .key-projected::before {
  content: ''; display: inline-block; width: 14px; height: 2px; margin-right: 6px;
  vertical-align: middle; background: var(--accent-belt, #7C6A58);
}
.key-projected::before {
  background: repeating-linear-gradient(
    to right, var(--accent-belt, #7C6A58) 0 3px, transparent 3px 8px
  );
  opacity: 0.6;
}
.direction {
  margin: 0; font-size: var(--text-base, 15px); line-height: 1.55;
  color: var(--ink-primary, #2C2622);
}
.steady { margin: 0; font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); }
.sample {
  margin: 0; font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078); font-style: italic;
}
</style>
