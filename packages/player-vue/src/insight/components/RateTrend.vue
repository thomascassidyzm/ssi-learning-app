<script setup lang="ts">
// ============================================================================
// components/RateTrend.vue — THE HERO graph of RateCompare: the rate over time,
// entity vs average, as a rolling line.
//
// A rate is a TRAJECTORY, so the line is the story — where you're heading vs
// where the cohort is heading (the curvature, per Measuring Progress, leads).
//
//   · props { entityLabel, entity[], averageLabel, average[], yLabel?, periodDays? }
//   · x-axis = the last N points ending "now" (real calendar dates), spaced by
//     `periodDays` (1 = daily, 7 = weekly, 30 = monthly — the windows+measures
//     contract's trendPeriodDays) so the axis is always the honest window,
//     whichever time window the caller picked.
//   · y-axis = the rate, titled with its unit ("LEGOs / week").
//   · ENTITY = blue (--rc-entity / --rc-glow), area-filled + a "now" endpoint
//     so you can read your current value off the line. AVERAGE = grey dashed.
//   · lazy echarts in onMounted; registerInsightTheme; ResizeObserver → resize.
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  entityLabel: string
  entity: number[]
  averageLabel: string
  average: number[]
  yLabel?: string        // the rate unit for the y-axis title, e.g. "LEGOs / week"
  periodDays?: number    // spacing between trend points (1|7|30) — daily/weekly/monthly x labels
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
    if (props.periodDays === 30) {
      d.setMonth(d.getMonth() - stepsBack)
      out.push(d.toLocaleDateString('en-GB', { month: 'short' }))
    } else {
      d.setDate(d.getDate() - stepsBack * props.periodDays)
      out.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }))
    }
  }
  return out
})

// Compact value formatter for the endpoint label.
function fmt(v: number): string {
  if (!Number.isFinite(v)) return ''
  if (Number.isInteger(v)) return String(v)
  return Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0)
}

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
  const glowRgb = roleTriplet('--rc-glow', entityRgb)
  const avgRgb = roleTriplet('--rc-secondary', AVERAGE_FALLBACK)
  const entityColor = `rgb(${entityRgb})`
  const averageColor = `rgb(${avgRgb})`

  const entityData = props.entity ?? []
  const lastIdx = entityData.length - 1

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: p.line, type: 'dashed' } },
      valueFormatter: (v: number) => fmt(Number(v)),
    },
    legend: {
      data: [props.entityLabel, props.averageLabel],
      bottom: 0,
      left: 'center',
      icon: 'roundRect',
      itemWidth: 16,
      itemHeight: 4,
      textStyle: { fontFamily: FONT_MONO, fontSize: 11, color: p.ink2 },
    },
    // Room for the y-axis title (top-left), the "now" endpoint label (right) and
    // the legend (bottom).
    grid: { left: 46, right: 52, top: 30, bottom: 40 },
    xAxis: {
      type: 'category',
      data: xLabels.value,
      boundaryGap: false,
      axisLine: { lineStyle: { color: p.line } },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 10.5, hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: props.yLabel ?? '',
      nameLocation: 'end',
      nameGap: 12,
      nameTextStyle: { fontFamily: FONT_MONO, fontSize: 10, color: p.ink3, align: 'left' },
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 10 },
      splitLine: { lineStyle: { color: p.line, type: 'dashed' } },
    },
    series: [
      {
        name: props.entityLabel,
        type: 'line',
        smooth: true,                    // a rolling, settled curve — not jagged raw points
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: false,
        // The entity is the identity/focus line — blue, lifted by a soft glow and
        // a gentle area fill so it reads as the hero against the dashed average.
        lineStyle: { color: entityColor, width: 2.8, shadowColor: `rgba(${glowRgb}, 0.5)`, shadowBlur: 10 },
        itemStyle: { color: entityColor, borderColor: '#fff', borderWidth: 2 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: `rgba(${entityRgb}, 0.18)` },
              { offset: 1, color: `rgba(${entityRgb}, 0.0)` },
            ],
          },
        },
        // Show the current value at the line's "now" end so it's readable off the chart.
        endLabel: {
          show: true,
          formatter: () => (lastIdx >= 0 ? fmt(entityData[lastIdx]) : ''),
          color: entityColor,
          fontFamily: FONT_MONO,
          fontWeight: 'bold',
          fontSize: 12,
        },
        emphasis: { focus: 'series' },
        data: entityData,
        z: 3,
      },
      {
        name: props.averageLabel,
        type: 'line',
        smooth: true,
        symbol: 'none',
        // The cohort baseline — grey, dashed, recedes behind the entity.
        lineStyle: { color: averageColor, width: 1.8, type: 'dashed' },
        itemStyle: { color: averageColor },
        emphasis: { focus: 'series' },
        data: props.average ?? [],
        z: 2,
      },
    ],
  }
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
