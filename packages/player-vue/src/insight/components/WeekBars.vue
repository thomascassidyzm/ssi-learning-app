<script setup lang="ts">
// ============================================================================
// components/WeekBars.vue — TWELVE WEEKLY BARS WITH A FAINT NORMAL LINE.
//
// Tom's verdict from the display lab, 2026-09-16 23:28Z: "Bars with a faint
// normal line is best." So this is the lab's `bars-line` tile, lifted whole
// out of lab/LabRendering.vue and made the one trend rendering the real
// insights cards draw — the teacher's week card and every per-class card on
// the leader's page, the second at a compact height.
//
// One bar per week for THIS entity in the class colour, the newest bar — the
// week the numbers above belong to — solid, the eleven behind it faded. The
// cohort mean is a faint line laid across them: "normal for here". No axes,
// no legend, no numbers, no rank, no target. A quiet week is a short bar and
// nothing scolds anybody for it.
//
// NULL is ABSENCE, never a zero: the bar is simply not drawn and the faint
// line breaks, because nobody had started playing yet and a zero would say
// they were idle.
// ============================================================================
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  entity: (number | null)[]
  cohort?: (number | null)[] | null
  /** The week the numbers beside these bars belong to; the last week by default. */
  currentIndex?: number | null
  /** 'card' fills the card; 'compact' is the leader's per-class rows. */
  size?: 'card' | 'compact'
  label?: string
}>(), { cohort: null, currentIndex: null, size: 'card', label: '' })

const W = 320
const H = computed(() => (props.size === 'compact' ? 44 : 110))
const PAD = { l: 6, r: 6, t: 8, b: 6 }

const n = computed(() => Math.max(1, props.entity.length, props.cohort?.length ?? 0))
const idx = computed(() => (typeof props.currentIndex === 'number' ? props.currentIndex : props.entity.length - 1))

const max = computed(() => {
  let m = 0
  for (const v of [...props.entity, ...(props.cohort ?? [])]) if (typeof v === 'number' && v > m) m = v
  return Math.max(m, 1)
})

function slotW(): number { return (W - PAD.l - PAD.r) / n.value }
function x(i: number): number { return PAD.l + (i + 0.5) * slotW() }
function y(v: number): number {
  const bottom = H.value - PAD.b
  return bottom - (v / max.value) * (bottom - PAD.t)
}
function barH(v: number): number { return Math.max(0.5, H.value - PAD.b - y(v)) }

/** A polyline that BREAKS at every null rather than bridging the gap. */
const cohortPath = computed(() => {
  const s = props.cohort
  if (!s) return ''
  let d = ''
  let pen = false
  s.forEach((v, i) => {
    if (typeof v !== 'number') { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `
    pen = true
  })
  return d.trim()
})

const hasAnything = computed(() =>
  props.entity.some((v) => typeof v === 'number') || (props.cohort ?? []).some((v) => typeof v === 'number'))
</script>

<template>
  <svg
    v-if="hasAnything"
    class="wb"
    :class="`wb-${size}`"
    :viewBox="`0 0 ${W} ${H}`"
    role="img"
    :aria-label="label || undefined"
    data-testid="week-bars"
  >
    <template v-for="(v, i) in entity" :key="i">
      <rect
        v-if="typeof v === 'number'"
        class="wb-bar"
        :class="{ now: i === idx }"
        :x="x(i) - slotW() * 0.32"
        :y="y(v)"
        :width="slotW() * 0.64"
        :height="barH(v)"
      />
    </template>
    <path v-if="cohortPath" class="wb-normal" :d="cohortPath" />
  </svg>
</template>

<style scoped>
.wb { display: block; width: 100%; height: auto; overflow: visible; }
.wb-bar { fill: rgba(var(--rc-entity-ink, 37, 99, 235), 0.4); }
.wb-bar.now { fill: rgba(var(--rc-entity-ink, 37, 99, 235), 0.95); }
.wb-normal {
  fill: none;
  stroke: rgba(44, 38, 34, 0.24);
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
</style>
