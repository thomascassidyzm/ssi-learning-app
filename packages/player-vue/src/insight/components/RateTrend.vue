<script setup lang="ts">
// ============================================================================
// components/RateTrend.vue — small entity-vs-average trend line (8 periods).
//
// A sub-component of RateCompare.vue (kept separate so RateCompare stays under
// ~300 lines and so the ECharts lazy-import lives in one focused place). Mirrors
// the widget convention exactly:
//   · props { entityLabel, entity[], averageLabel, average[] }
//   · emits NOTHING — purely presentational
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) → option from theme tokens (NO hardcoded hex)
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

// Entity = SSi brand red (#c23a3a / --tone-accent); average = neutral grey
// (--ink-muted #8A8078). Kept as literals so the entity/average split is the
// fixed brand scheme regardless of the resolved Frostwell palette.
const ENTITY_RED = '#c23a3a'
const AVERAGE_GREY = '#8A8078'

function buildOption(): Record<string, unknown> {
  const p = palette()
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
        // SSi brand red (#c23a3a / --tone-accent) — the entity is the identity/focus line.
        lineStyle: { color: ENTITY_RED, width: 2.4, shadowColor: 'rgba(194,58,58,0.5)', shadowBlur: 8 },
        itemStyle: { color: ENTITY_RED },
        data: props.entity ?? [],
        z: 3,
      },
      {
        name: props.averageLabel,
        type: 'line',
        smooth: true,
        symbol: 'none',
        // Neutral grey dashed — clearly the secondary cohort line.
        lineStyle: { color: AVERAGE_GREY, width: 1.6, type: 'dashed' },
        itemStyle: { color: AVERAGE_GREY },
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

watch(() => [props.entity, props.average, props.entityLabel, props.averageLabel],
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
