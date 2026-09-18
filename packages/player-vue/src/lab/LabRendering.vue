<script setup lang="ts">
/**
 * One rendering of the one primitive (job #26, the display lab): an ENTITY
 * against the MEAN of a GROUP it belongs to, one metric, week by week over
 * twelve weeks, the group mean frozen per week. `kind` picks the grammar;
 * the data is identical across every kind, so Tom is judging the drawing.
 *
 * Absence (null) is drawn as ABSENCE: the path breaks, the cell is empty,
 * the bar is not there. Never a zero.
 */
import { computed } from 'vue'

export type Series = (number | null)[]
export type Kind =
  | 'lines' | 'anomaly' | 'bars-line' | 'paired' | 'multiples' | 'heat'
  | 'dots' | 'running' | 'bignumber' | 'sentence' | 'slope' | 'ribbon'

const props = defineProps<{
  kind: Kind
  weeks: string[]
  entity: Series
  cohort: Series
  entityPhrases: Series
  cohortPhrases: Series
  /** Index of the week the three numbers belong to. */
  idx: number
  metric: 'minutes' | 'phrases'
  entityLabel: string
  cohortLabel: string | null
  weekLabel: string
}>()

const W = 320
const H = 120
const PAD = { l: 6, r: 6, t: 10, b: 8 }

const series = computed(() => props.metric === 'minutes'
  ? { e: props.entity, c: props.cohort }
  : { e: props.entityPhrases, c: props.cohortPhrases })

function present(s: Series): number[] { return s.filter((v): v is number => typeof v === 'number') }
function maxOf(...ss: Series[]): number { return Math.max(1, ...ss.flatMap(present)) }
function x(i: number, n = props.weeks.length): number { return PAD.l + (i + 0.5) * ((W - PAD.l - PAD.r) / n) }
function slotW(n = props.weeks.length): number { return (W - PAD.l - PAD.r) / n }
function y(v: number, max: number, top = PAD.t, bottom = H - PAD.b): number { return bottom - (v / max) * (bottom - top) }

/** A polyline that BREAKS at every null. */
function pathOf(s: Series, max: number, top = PAD.t, bottom = H - PAD.b): string {
  let d = ''
  let pen = false
  s.forEach((v, i) => {
    if (typeof v !== 'number') { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v, max, top, bottom).toFixed(1)} `
    pen = true
  })
  return d.trim()
}

const max = computed(() => maxOf(series.value.e, series.value.c))
const ePath = computed(() => pathOf(series.value.e, max.value))
const cPath = computed(() => pathOf(series.value.c, max.value))

/** entity − cohort per week, absent when either is absent. */
const diff = computed<Series>(() => series.value.e.map((v, i) => {
  const c = series.value.c[i]
  return typeof v === 'number' && typeof c === 'number' ? Math.round((v - c) * 10) / 10 : null
}))
const diffMax = computed(() => Math.max(1, ...present(diff.value).map(Math.abs)))
const zeroY = H / 2
function yDiff(v: number): number { return zeroY - (v / diffMax.value) * (zeroY - PAD.t) }
const diffPath = computed(() => {
  let d = ''; let pen = false
  diff.value.forEach((v, i) => {
    if (typeof v !== 'number') { pen = false; return }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${yDiff(v).toFixed(1)} `; pen = true
  })
  return d.trim()
})
/** Area between the anomaly line and zero, one closed shape per contiguous run. */
const diffAreas = computed(() => {
  const out: { d: string; above: boolean }[] = []
  let run: { i: number; v: number }[] = []
  const flush = (): void => {
    if (run.length === 0) return
    const segs: { i: number; v: number }[][] = []
    let cur: { i: number; v: number }[] = []
    let sign = Math.sign(run[0].v) || 1
    for (const p of run) {
      const s = Math.sign(p.v) || sign
      if (s !== sign && cur.length) { segs.push(cur); cur = []; sign = s }
      cur.push(p)
    }
    if (cur.length) segs.push(cur)
    for (const seg of segs) {
      const top = seg.map((p) => `${x(p.i).toFixed(1)},${yDiff(p.v).toFixed(1)}`).join(' L')
      const d = `M${x(seg[0].i).toFixed(1)},${zeroY} L${top} L${x(seg[seg.length - 1].i).toFixed(1)},${zeroY} Z`
      out.push({ d, above: (seg[0].v || 0) >= 0 })
    }
    run = []
  }
  diff.value.forEach((v, i) => { if (typeof v === 'number') run.push({ i, v }); else flush() })
  flush()
  return out
})

/** Cumulative totals, absent until the first present week. */
function running(s: Series): Series {
  let acc: number | null = null
  return s.map((v) => { if (typeof v !== 'number') return acc; acc = (acc ?? 0) + v; return acc })
}
const runE = computed(() => running(series.value.e))
const runC = computed(() => running(series.value.c))
const runMax = computed(() => maxOf(runE.value, runC.value))

const minutesMax = computed(() => maxOf(props.entity, props.cohort))
const phrasesMax = computed(() => maxOf(props.entityPhrases, props.cohortPhrases))

const cur = computed(() => ({ e: series.value.e[props.idx] ?? null, c: series.value.c[props.idx] ?? null }))
const delta = computed(() => (typeof cur.value.e === 'number' && typeof cur.value.c === 'number') ? Math.round((cur.value.e - cur.value.c) * 10) / 10 : null)
const prev = computed(() => ({ e: series.value.e[props.idx - 1] ?? null, c: series.value.c[props.idx - 1] ?? null }))

function fmt(v: number | null): string {
  if (typeof v !== 'number') return '—'
  if (props.metric === 'phrases') return `${Math.round(v)}`
  const m = Math.round(v)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
function fmtSigned(v: number | null): string {
  if (typeof v !== 'number') return '—'
  const s = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${s}${fmt(Math.abs(v))}`
}

const sentence = computed(() => {
  const e = cur.value.e
  const c = cur.value.c
  const what = props.metric === 'minutes' ? 'practised' : 'reached'
  const unit = props.metric === 'minutes' ? '' : ' new phrases'
  if (typeof e !== 'number') return `${props.entityLabel} has not started yet.`
  const first = `${props.entityLabel} ${what} ${fmt(e)}${unit} ${props.weekLabel}.`
  if (typeof c !== 'number' || !props.cohortLabel) return `${first} No group to compare with yet.`
  const d = e - c
  const tone = Math.abs(d) < Math.max(1, c * 0.1)
    ? 'About the same as the others.'
    : d > 0 ? `${fmt(Math.abs(d))}${unit} more than the others.` : `${fmt(Math.abs(d))}${unit} less than the others.`
  return `${first} The ${props.cohortLabel.replace(/ average$/, '')} average was ${fmt(c)}${unit}. ${tone}`
})

/** Heat cell fill: above normal → entity ink, below → warm grey, absent → none. */
function heatFill(v: number | null): string {
  if (typeof v !== 'number') return 'none'
  const a = Math.min(1, Math.abs(v) / diffMax.value)
  return v >= 0 ? `rgba(37,99,235,${0.12 + a * 0.75})` : `rgba(138,128,120,${0.12 + a * 0.7})`
}
</script>

<template>
  <div class="r" :data-kind="kind">
    <!-- 1 · two overlaid lines -->
    <svg v-if="kind === 'lines'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <path :d="cPath" class="c-line" />
      <path :d="ePath" class="e-line" />
      <circle v-if="typeof cur.e === 'number'" :cx="x(idx)" :cy="y(cur.e, max)" r="3" class="e-dot" />
    </svg>

    <!-- 2 · anomaly line, weather-style around zero -->
    <svg v-else-if="kind === 'anomaly'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <line :x1="PAD.l" :x2="W - PAD.r" :y1="zeroY" :y2="zeroY" class="zero" />
      <path v-for="(a, i) in diffAreas" :key="i" :d="a.d" :class="a.above ? 'area-above' : 'area-below'" />
      <path :d="diffPath" class="e-line" />
      <circle v-if="typeof diff[idx] === 'number'" :cx="x(idx)" :cy="yDiff(diff[idx] as number)" r="3" class="e-dot" />
    </svg>

    <!-- 3 · entity bars, cohort as a faint line -->
    <svg v-else-if="kind === 'bars-line'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <template v-for="(v, i) in series.e" :key="i">
        <rect v-if="typeof v === 'number'" :x="x(i) - slotW() * 0.32" :y="y(v, max)" :width="slotW() * 0.64" :height="Math.max(0.5, H - PAD.b - y(v, max))" :class="i === idx ? 'e-bar now' : 'e-bar'" />
      </template>
      <path :d="cPath" class="c-line" />
    </svg>

    <!-- 4 · paired bars -->
    <svg v-else-if="kind === 'paired'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <template v-for="(v, i) in series.e" :key="i">
        <rect v-if="typeof v === 'number'" :x="x(i) - slotW() * 0.38" :y="y(v, max)" :width="slotW() * 0.34" :height="Math.max(0.5, H - PAD.b - y(v, max))" :class="i === idx ? 'e-bar now' : 'e-bar'" />
        <rect v-if="typeof series.c[i] === 'number'" :x="x(i) + slotW() * 0.04" :y="y(series.c[i] as number, max)" :width="slotW() * 0.34" :height="Math.max(0.5, H - PAD.b - y(series.c[i] as number, max))" class="c-bar" />
      </template>
    </svg>

    <!-- 5 · small multiples, one per metric -->
    <div v-else-if="kind === 'multiples'" class="multiples">
      <div class="mult">
        <div class="mult-cap">minutes</div>
        <svg :viewBox="`0 0 ${W} ${H}`" class="svg">
          <path :d="pathOf(cohort, minutesMax)" class="c-line" />
          <path :d="pathOf(entity, minutesMax)" class="e-line" />
        </svg>
      </div>
      <div class="mult">
        <div class="mult-cap">new phrases</div>
        <svg :viewBox="`0 0 ${W} ${H}`" class="svg">
          <path :d="pathOf(cohortPhrases, phrasesMax)" class="c-line" />
          <path :d="pathOf(entityPhrases, phrasesMax)" class="e-line" />
        </svg>
      </div>
    </div>

    <!-- 6 · heat strip -->
    <svg v-else-if="kind === 'heat'" :viewBox="`0 0 ${W} 60`" class="svg svg-short">
      <template v-for="(v, i) in diff" :key="i">
        <rect :x="x(i) - slotW() * 0.46" y="8" :width="slotW() * 0.92" height="36" rx="3" :fill="heatFill(v)" :class="typeof v === 'number' ? '' : 'absent'" :stroke="i === idx ? 'rgba(44,38,34,.6)' : 'none'" stroke-width="1.5" />
      </template>
    </svg>

    <!-- 7 · rank-free dot strip -->
    <svg v-else-if="kind === 'dots'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <template v-for="(v, i) in series.e" :key="i">
        <line v-if="typeof v === 'number' && typeof series.c[i] === 'number'" :x1="x(i)" :x2="x(i)" :y1="y(v, max)" :y2="y(series.c[i] as number, max)" class="stem" />
        <circle v-if="typeof series.c[i] === 'number'" :cx="x(i)" :cy="y(series.c[i] as number, max)" r="3.2" class="c-dot" />
        <circle v-if="typeof v === 'number'" :cx="x(i)" :cy="y(v, max)" :r="i === idx ? 4.2 : 3.2" class="e-dot" />
      </template>
    </svg>

    <!-- 8 · running total -->
    <svg v-else-if="kind === 'running'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <path :d="pathOf(runC, runMax)" class="c-line" />
      <path :d="pathOf(runE, runMax)" class="e-line" />
      <text v-if="typeof runE[idx] === 'number'" :x="x(idx) - 4" :y="y(runE[idx] as number, runMax) - 6" text-anchor="end" class="lbl">{{ fmt(runE[idx]) }}</text>
    </svg>

    <!-- 9 · big number, delta, tiny sparkline -->
    <div v-else-if="kind === 'bignumber'" class="big">
      <div class="big-num">{{ fmt(cur.e) }}</div>
      <div class="big-delta" :class="delta === null ? '' : delta >= 0 ? 'up' : 'down'">{{ delta === null ? 'no group yet' : `${fmtSigned(delta)} vs ${cohortLabel?.replace(/ average$/, '') ?? 'group'}` }}</div>
      <svg :viewBox="`0 0 ${W} 40`" class="svg spark">
        <path :d="pathOf(series.c, max, 4, 36)" class="c-line" />
        <path :d="pathOf(series.e, max, 4, 36)" class="e-line" />
      </svg>
    </div>

    <!-- 10 · words only -->
    <p v-else-if="kind === 'sentence'" class="sentence">{{ sentence }}</p>

    <!-- 11 · slope: last week → this week, both -->
    <svg v-else-if="kind === 'slope'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <template v-if="typeof prev.c === 'number' && typeof cur.c === 'number'">
        <line :x1="90" :x2="230" :y1="y(prev.c, max)" :y2="y(cur.c, max)" class="c-line" />
        <circle cx="90" :cy="y(prev.c, max)" r="3" class="c-dot" /><circle cx="230" :cy="y(cur.c, max)" r="3" class="c-dot" />
      </template>
      <template v-if="typeof prev.e === 'number' && typeof cur.e === 'number'">
        <line :x1="90" :x2="230" :y1="y(prev.e, max)" :y2="y(cur.e, max)" class="e-line" />
        <circle cx="90" :cy="y(prev.e, max)" r="3.5" class="e-dot" /><circle cx="230" :cy="y(cur.e, max)" r="3.5" class="e-dot" />
        <text x="82" :y="y(prev.e, max) + 4" text-anchor="end" class="lbl">{{ fmt(prev.e) }}</text>
        <text x="238" :y="y(cur.e, max) + 4" class="lbl">{{ fmt(cur.e) }}</text>
      </template>
      <text x="90" :y="H - 1" text-anchor="middle" class="axis-lbl">last week</text>
      <text x="230" :y="H - 1" text-anchor="middle" class="axis-lbl">this week</text>
    </svg>

    <!-- 12 · gap ribbon: the space between the two lines, tinted by sign -->
    <svg v-else-if="kind === 'ribbon'" :viewBox="`0 0 ${W} ${H}`" class="svg">
      <template v-for="(v, i) in series.e" :key="i">
        <polygon
          v-if="i > 0 && typeof v === 'number' && typeof series.e[i-1] === 'number' && typeof series.c[i] === 'number' && typeof series.c[i-1] === 'number'"
          :points="`${x(i-1)},${y(series.e[i-1] as number, max)} ${x(i)},${y(v, max)} ${x(i)},${y(series.c[i] as number, max)} ${x(i-1)},${y(series.c[i-1] as number, max)}`"
          :class="(v + (series.e[i-1] as number)) >= ((series.c[i] as number) + (series.c[i-1] as number)) ? 'area-above' : 'area-below'"
        />
      </template>
      <path :d="cPath" class="c-line" />
      <path :d="ePath" class="e-line" />
    </svg>
  </div>
</template>

<style scoped>
.r { --e: 37, 99, 235; --c: 44, 38, 34; }
.svg { display: block; width: 100%; height: auto; }
.svg-short { max-height: 60px; }
.spark { height: 40px; }
.e-line { fill: none; stroke: rgba(var(--e), .95); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.c-line { fill: none; stroke: rgba(var(--c), .24); stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.e-dot { fill: rgba(var(--e), .95); }
.c-dot { fill: rgba(var(--c), .26); }
.stem { stroke: rgba(var(--c), .18); stroke-width: 1.2; }
.e-bar { fill: rgba(var(--e), .55); }
.e-bar.now { fill: rgba(var(--e), .95); }
.c-bar { fill: rgba(var(--c), .18); }
.zero { stroke: rgba(var(--c), .35); stroke-width: 1; stroke-dasharray: 2 3; }
.area-above { fill: rgba(var(--e), .18); }
.area-below { fill: rgba(var(--c), .14); }
.absent { fill: none; stroke: rgba(var(--c), .12); stroke-dasharray: 2 2; }
.lbl { font-size: 11px; fill: rgba(var(--c), .85); font-weight: 600; }
.axis-lbl { font-size: 10px; fill: rgba(var(--c), .5); }
.multiples { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.mult-cap { font-size: 11px; color: rgba(var(--c), .55); margin-bottom: 2px; }
.big { display: flex; flex-direction: column; gap: 2px; }
.big-num { font-size: 44px; font-weight: 700; line-height: 1; color: rgba(var(--e), 1); letter-spacing: -0.02em; }
.big-delta { font-size: 13px; color: rgba(var(--c), .6); }
.big-delta.up { color: rgba(var(--e), .9); }
.sentence { font-size: 17px; line-height: 1.4; margin: 0; color: rgba(var(--c), .9); }
</style>
