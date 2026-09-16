<script setup lang="ts">
// ============================================================================
// components/TemperatureLine.vue — a thin twelve-week line beside a number.
//
// The class over a fainter line of the cohort; no axes, no legend, no labels.
// The faint line reads as "normal for here" and the dark one as "us" — that
// is the whole message, and anything more is chart furniture the eye has to
// climb over to reach the number (Tom via RBF, 2026-09-16: "the chart is not
// the problem"). Pure SVG: no echarts, nothing lazy-loaded, testable as text.
//
// NULL is absence: the line breaks where nobody had started yet, rather than
// drawing a zero that would say they were idle.
// ============================================================================
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  entity: (number | null)[]
  cohort?: (number | null)[] | null
  /** Rendered height in px; width is the container's. */
  height?: number
  label?: string
}>(), { cohort: null, height: 28, label: '' })

const W = 120
const PAD = 2

const n = computed(() => Math.max(props.entity.length, props.cohort?.length ?? 0))
const max = computed(() => {
  let m = 0
  for (const v of [...props.entity, ...(props.cohort ?? [])]) if (typeof v === 'number' && v > m) m = v
  return m
})

/** Polyline segments; a null breaks the line rather than bridging it. */
function segments(series: (number | null)[]): string[] {
  const out: string[] = []
  let cur: string[] = []
  const step = n.value > 1 ? (W - PAD * 2) / (n.value - 1) : 0
  const h = props.height - PAD * 2
  series.forEach((v, i) => {
    if (typeof v !== 'number') {
      if (cur.length > 1) out.push(cur.join(' '))
      cur = []
      return
    }
    const x = PAD + i * step
    const y = max.value > 0 ? PAD + h - (v / max.value) * h : PAD + h
    cur.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  })
  if (cur.length > 1) out.push(cur.join(' '))
  return out
}

const entitySegments = computed(() => segments(props.entity))
const cohortSegments = computed(() => (props.cohort ? segments(props.cohort) : []))
const hasAnything = computed(() => entitySegments.value.length > 0 || cohortSegments.value.length > 0)
</script>

<template>
  <svg
    v-if="hasAnything"
    class="tl"
    :viewBox="`0 0 ${W} ${height}`"
    preserveAspectRatio="none"
    :height="height"
    role="img"
    :aria-label="label || undefined"
    data-testid="temperature-line"
  >
    <polyline v-for="(pts, i) in cohortSegments" :key="`c${i}`" class="tl-cohort" :points="pts" />
    <polyline v-for="(pts, i) in entitySegments" :key="`e${i}`" class="tl-entity" :points="pts" />
  </svg>
</template>

<style scoped>
.tl { display: block; width: 100%; overflow: visible; }
.tl-cohort {
  fill: none;
  stroke: rgba(44, 38, 34, 0.22);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  stroke-linecap: round;
}
.tl-entity {
  fill: none;
  stroke: rgba(var(--rc-entity-ink, 37, 99, 235), 0.95);
  stroke-width: 1.75;
  vector-effect: non-scaling-stroke;
  stroke-linejoin: round;
  stroke-linecap: round;
}
</style>
