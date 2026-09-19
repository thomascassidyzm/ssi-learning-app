<script setup lang="ts">
// ============================================================================
// widgets/TimeSeries.vue — Smooth line chart (optional area, multi-series)
//
// Mirrors Stat.vue EXACTLY for structure:
//   · props { data: TimeSeriesData, annotations?: Annotation[] }  — data already narrowed by kind
//   · emits NOTHING                                               — the wrapper owns all events
//   · renders ONLY the chart + annotation marks                   — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) -> builds an option from data + theme tokens
//   · ResizeObserver -> chart.resize()
//   · NO hardcoded hex — every colour from theme.ts (palette()/tone())
//
// Spec: ECharts bars per bucket, never smoothed (job #673). X = time/category, Y = value.
// Multi-series allowed. Annotatable points: 'point' annotation at (series?, x) marks
// a datum with a labelled point and a tone colour.
// ============================================================================
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { TimeSeriesData, Annotation, Tone } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone,
  FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: TimeSeriesData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts is lazy-loaded so it lands in the admin code-split chunk, never the learner bundle.
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = { setOption: (o: Record<string, unknown>, opts?: Record<string, unknown>) => void; resize: () => void; dispose: () => void }

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// Whether data is empty enough to show a placeholder instead of a broken chart.
function isEmpty(): boolean {
  return (
    !props.data.x?.length ||
    !props.data.series?.length ||
    props.data.series.every(s => !s.points?.length)
  )
}

// A series colour ramp: reuse the Frostwell editorial order (blue first for Lens A, then richer)
function seriesColor(index: number, seriesTone?: Tone): string {
  const p = palette()
  if (seriesTone) return tone(seriesTone)
  // Frostwell ramp — matches the gallery editorial feel, Lens-A-blue first
  const ramp = [p.blue, p.gold, p.red, p.green, p.ink3, p.inkFaint]
  return ramp[index % ramp.length]
}

// Resolve 'point' annotations for a given series name + x value.
// A 'point' with no series name applies to all series.
function annotationsForPoint(seriesName: string, x: string | number): Annotation[] {
  return (props.annotations ?? []).filter(
    a => a.at === 'point' &&
      (a.series == null || a.series === seriesName) &&
      String(a.x) === String(x),
  )
}

// Build per-series markPoint data from the 'point' annotations.
function buildMarkPoints(seriesName: string): Record<string, unknown>[] {
  const marks: Record<string, unknown>[] = []
  for (const x of props.data.x) {
    const anns = annotationsForPoint(seriesName, x)
    for (const ann of anns) {
      if (ann.at !== 'point') continue
      marks.push({
        name: ann.note,
        coord: [x, props.data.series.find(s => s.name === seriesName)
          ?.points[props.data.x.indexOf(String(x))] ?? 0],
        value: ann.note,
        symbol: 'circle',
        symbolSize: 10,
        itemStyle: { color: tone(ann.tone) },
        label: {
          show: true,
          position: 'top',
          formatter: ann.note,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: tone(ann.tone),
        },
      })
    }
  }
  return marks
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  const data = props.data

  const series = (data.series ?? []).map((s, i) => {
    const colour = seriesColor(i, s.tone)
    const markPoints = buildMarkPoints(s.name)
    // Real bars per bucket, never a smoothed line (Tom, 2026-09-14, job
    // #673): a point with no activity is a zero bar, not a slope between
    // its neighbours.
    const seriesObj: Record<string, unknown> = {
      name: s.name,
      type: 'bar',
      barMaxWidth: 28,
      itemStyle: { color: colour, borderRadius: [3, 3, 0, 0] },
      data: s.points ?? [],
    }
    if (markPoints.length) {
      seriesObj.showSymbol = true
      seriesObj.markPoint = {
        data: markPoints,
        label: { show: true },
      }
    }
    return seriesObj
  })

  const legendData = data.series.map((s, i) => ({
    name: s.name,
    itemStyle: { color: seriesColor(i, s.tone) },
  }))
  const showLegend = data.series.length > 1

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'line',
        lineStyle: { color: p.line, type: 'dashed' },
      },
    },
    legend: showLegend
      ? {
          data: legendData,
          bottom: 0,
          left: 'center',
          icon: 'roundRect',
          itemWidth: 14,
          itemHeight: 4,
          textStyle: { fontFamily: FONT_MONO, fontSize: 11, color: p.ink2 },
        }
      : { show: false },
    grid: {
      left: 48,
      right: 20,
      top: 16,
      bottom: showLegend ? 40 : 20,
    },
    xAxis: {
      type: 'category',
      data: data.x ?? [],
      boundaryGap: true,
      axisLine: { lineStyle: { color: p.line } },
      axisTick: { show: false },
      // Readable on a phone (Tom, 18 Sep 2026: "I can't read the legend on the
      // x axis"). ink3 at 11px on the warm-grey canvas is a whisper; ink2 at
      // 12px is the same restraint you can actually read at arm's length.
      axisLabel: { fontFamily: FONT_MONO, color: p.ink2, fontSize: 12 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      name: data.yLabel ?? '',
      nameTextStyle: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11, align: 'left' },
      nameGap: 8,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink2, fontSize: 12 },
      splitLine: { lineStyle: { color: p.line, type: 'dashed' } },
    },
    series,
  }
}

async function ensureChart() {
  if (!chartEl.value) return
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

// Re-render when data or annotations change (host swaps data in place on drill).
watch(() => [props.data, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="ts-widget">
    <!-- Empty state: graceful zero (spec: a resolver NEVER throws; widget NEVER throws) -->
    <div v-if="isEmpty()" class="ts-empty">
      <span class="ts-empty-label">No data</span>
    </div>

    <!-- Chart container. ResizeObserver keeps it responsive; desktop-first. -->
    <div v-else ref="chartEl" class="ts-chart" />
  </div>
</template>

<style scoped>
.ts-widget {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 240px;
  font-family: var(--font-mono);
}

.ts-chart {
  width: 100%;
  flex: 1 1 auto;
  min-height: 240px;
}

/* Empty / zero state — a quiet placeholder, not an error */
.ts-empty {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 1px dashed var(--ink-faint);
  border-radius: 10px;
  background: transparent;
}
.ts-empty-label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* Desktop-first: on narrower admin panes the chart compresses gracefully */
@media (max-width: 640px) {
  .ts-chart,
  .ts-empty {
    min-height: 180px;
  }
}
</style>
