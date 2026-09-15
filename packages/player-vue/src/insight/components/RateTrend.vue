<script setup lang="ts">
// ============================================================================
// components/RateTrend.vue — THE HERO graph of RateCompare: the measure over
// time, entity vs average, as REAL BARS per bucket (Tom, 2026-09-14, job #673:
// no spline, a bucket with no play is a zero bar). The option itself is
// built in rateTrendOption.ts so the shape is testable without a canvas.
//
//   · props { entityLabel, entity[], averageLabel, average[], yLabel?, periodDays? }
//   · x-axis = the last N points ending "now" (real calendar dates), spaced by
//     `periodDays` (1 = daily, 7 = weekly, 30 = monthly — the windows+measures
//     contract's trendPeriodDays) so the axis is always the honest window,
//     whichever time window the caller picked.
//   · y-axis = the rate, titled with its unit ("LEGOs / week").
//   · ENTITY = blue bars (--rc-entity / --rc-glow), the newest bar labelled
//     so you can read the current value off the chart. AVERAGE = grey dashed.
//   · lazy echarts in onMounted; registerInsightTheme; ResizeObserver → resize.
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette,
  type EChartsLike,
} from '../theme'
import { buildRateTrendOption } from './rateTrendOption'

const props = withDefaults(defineProps<{
  entityLabel: string
  entity: number[]
  averageLabel: string
  average: number[]
  yLabel?: string        // the rate unit for the y-axis title, e.g. "LEGOs / week"
  periodDays?: number    // spacing between trend points — <1 = hourly, 1 daily, 7 weekly, 30 monthly x labels
}>(), {
  periodDays: 7,
})

let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = {
  setOption: (o: Record<string, unknown>, opts?: Record<string, unknown>) => void
  resize: () => void
  dispose: () => void
}

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

const isEmpty = computed(() => !props.entity?.length && !props.average?.length)

// Honest x labels spaced by periodDays, ending "now" (the newest point).
// periodDays<1 (sub-day = hourly buckets, the Today window) reads as "HH:00";
// periodDays=1 (daily) and 7 (weekly) both read as "dd MMM" — a day/week is a
// point in time; periodDays=30 (monthly) reads as "MMM" — a whole month,
// stepped by real calendar months rather than a fixed 30-day multiple so
// "last 12 months" lines up with actual month boundaries.
const xLabels = computed(() => {
  const n = Math.max(props.entity?.length ?? 0, props.average?.length ?? 0) || 8
  const now = new Date()
  const out: string[] = []
  for (let j = 0; j < n; j++) {
    const stepsBack = (n - 1) - j        // oldest → newest
    if (stepsBack === 0) { out.push('now'); continue }
    const d = new Date(now)
    if (props.periodDays < 1) {
      d.setTime(d.getTime() - stepsBack * props.periodDays * 86400000)
      out.push(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    } else if (props.periodDays === 30) {
      d.setMonth(d.getMonth() - stepsBack)
      out.push(d.toLocaleDateString('en-GB', { month: 'short' }))
    } else {
      d.setDate(d.getDate() - stepsBack * props.periodDays)
      out.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))
    }
  }
  return out
})

// The entity (identity) and average colours come from the green/blue role tokens
// (--rc-entity = blue / --rc-secondary = grey / --rc-glow = blue), resolved off
// the live DOM because ECharts can't read CSS vars.
const ENTITY_FALLBACK = '96, 165, 250'   // blue entity triplet
const AVERAGE_FALLBACK = '138, 128, 120' // neutral secondary triplet

function roleTriplet(name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback
  const host = chartEl.value ?? document.querySelector('.schools-surface')
  if (!host) return fallback
  const v = getComputedStyle(host as Element).getPropertyValue(name).trim()
  return v || fallback
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  const entityRgb = roleTriplet('--rc-entity', ENTITY_FALLBACK)
  return buildRateTrendOption({
    entityLabel: props.entityLabel,
    entity: props.entity ?? [],
    averageLabel: props.averageLabel,
    average: props.average ?? [],
    yLabel: props.yLabel,
    xLabels: xLabels.value,
    entityRgb,
    glowRgb: roleTriplet('--rc-glow', entityRgb),
    avgRgb: roleTriplet('--rc-secondary', AVERAGE_FALLBACK),
    palette: { line: p.line, ink2: p.ink2, ink3: p.ink3 },
  })
}

async function ensureChart() {
  if (!chartEl.value || isEmpty.value) return
  if (!echarts) {
    echarts = (await import('echarts')) as unknown as typeof echarts
    registerInsightTheme(echarts!)
  }
  if (!chart) {
    chart = echarts!.init(chartEl.value, INSIGHT_THEME_NAME, { renderer: 'canvas' })
  }
  chart.setOption(buildOption(), { notMerge: true })
}

onMounted(async () => {
  await ensureChart()
  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
})

watch(() => [props.entity, props.average, props.entityLabel, props.averageLabel, props.yLabel, props.periodDays],
  () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="rate-trend">
    <div v-if="isEmpty" class="rate-trend-empty">No trend</div>
    <div v-else ref="chartEl" class="rate-trend-chart" />
  </div>
</template>

<style scoped>
.rate-trend {
  width: 100%;
  font-family: var(--font-mono);
}
.rate-trend-chart {
  width: 100%;
  height: 320px;          /* the hero — the graph carries the read */
}
.rate-trend-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 220px;
  border: 1px dashed var(--ink-faint);
  border-radius: 10px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
@media (max-width: 640px) {
  .rate-trend-chart { height: 260px; }
}
</style>
