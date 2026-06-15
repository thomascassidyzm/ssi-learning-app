<script setup lang="ts">
// ============================================================================
// components/RateTrend.vue — small entity-vs-average trend line (8 periods).
//
// A sub-component of RateCompare.vue (kept separate so RateCompare stays under
// ~300 lines and so the ECharts lazy-import lives in one focused place). Mirrors
// the widget convention exactly:
//   · props { entityLabel, entity[], averageLabel, average[], look? }
//   · emits NOTHING — purely presentational
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) → option from theme tokens
//   · ENTITY/AVERAGE colours come from the active LOOK's role tokens
//     (--rc-entity / --rc-secondary / --rc-glow), resolved off the live DOM
//     since ECharts can't read CSS vars; re-renders when `look` changes.
//   · ResizeObserver → chart.resize()
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = defineProps<{
  entityLabel: string
  entity: number[]
  averageLabel: string
  average: number[]
  // The active "look" (warm | electric | jewel). ECharts paints to canvas and
  // can't read CSS vars, so we resolve the look's role tokens off the live DOM
  // and re-render whenever this changes. Optional so the widget still works
  // outside the teacher view (falls back to the brand red/grey).
  look?: string
}>()

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

// 8 period labels (oldest -> newest), kept generic so the same chart serves any
// per-unit ('week' / 'day' / 'session' / 'hour' / 'minute').
const periodLabels = computed(() => {
  const n = Math.max(props.entity?.length ?? 0, props.average?.length ?? 0)
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 'now' : `-${n - 1 - i}`))
})

// The entity (identity) and average colours come from the active LOOK's role
// tokens (--rc-entity / --rc-secondary / --rc-glow), resolved off the live DOM
// because ECharts can't read CSS vars. Fallbacks = the brand red / neutral grey
// so the chart still renders correctly outside the teacher view.
const ENTITY_FALLBACK = '194, 58, 58'   // SSi brand red triplet
const AVERAGE_FALLBACK = '138, 128, 120' // neutral secondary triplet

// Read an "r, g, b" role token off the chart element (it inherits [data-look]
// from the teacher root), falling back to .schools-surface then a literal.
function roleTriplet(name: string, fallback: string): string {
  if (typeof getComputedStyle === 'undefined') return fallback
  const host = chartEl.value ?? document.querySelector('.schools-surface')
  if (!host) return fallback
  const v = getComputedStyle(host as Element).getPropertyValue(name).trim()
  return v || fallback
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  // Resolve the active look's colours fresh on every build (look may have changed).
  const entityRgb = roleTriplet('--rc-entity', ENTITY_FALLBACK)
  const glowRgb = roleTriplet('--rc-glow', entityRgb)
  const avgRgb = roleTriplet('--rc-secondary', AVERAGE_FALLBACK)
  const entityColor = `rgb(${entityRgb})`
  const averageColor = `rgb(${avgRgb})`
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: p.line, type: 'dashed' } },
    },
    legend: {
      data: [props.entityLabel, props.averageLabel],
      bottom: 0,
      left: 'center',
      icon: 'roundRect',
      itemWidth: 14,
      itemHeight: 4,
      textStyle: { fontFamily: FONT_MONO, fontSize: 10.5, color: p.ink2 },
    },
    grid: { left: 36, right: 14, top: 12, bottom: 34 },
    xAxis: {
      type: 'category',
      data: periodLabels.value,
      boundaryGap: false,
      axisLine: { lineStyle: { color: p.line } },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 10 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 10 },
      splitLine: { lineStyle: { color: p.line, type: 'dashed' } },
    },
    series: [
      {
        name: props.entityLabel,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        showSymbol: false,
        // The entity is the identity/focus line — look's --rc-entity, with a
        // tasteful glow from --rc-glow.
        lineStyle: { color: entityColor, width: 2.4, shadowColor: `rgba(${glowRgb}, 0.55)`, shadowBlur: 10 },
        itemStyle: { color: entityColor },
        data: props.entity ?? [],
        z: 3,
      },
      {
        name: props.averageLabel,
        type: 'line',
        smooth: true,
        symbol: 'none',
        // The secondary cohort line — look's --rc-secondary, dashed.
        lineStyle: { color: averageColor, width: 1.6, type: 'dashed' },
        itemStyle: { color: averageColor },
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

watch(() => [props.entity, props.average, props.entityLabel, props.averageLabel, props.look],
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
  height: 200px;
}
.rate-trend-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  border: 1px dashed var(--ink-faint);
  border-radius: 10px;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
@media (max-width: 640px) {
  .rate-trend-chart { height: 170px; }
}
</style>
