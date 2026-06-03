<script setup lang="ts">
// ============================================================================
// widgets/Scatter.vue — difficulty × execution scatter plane
//
// Mirrors Stat.vue exactly for structure:
//   · props { data: ScatterData, annotations: Annotation[] }  — data already narrowed by `kind`
//   · emits NOTHING                                            — the wrapper owns all events
//   · renders ONLY the chart + annotation marks               — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme from theme.ts, ResizeObserver, Frostwell tokens
//   · NO hardcoded hex — every colour comes from theme.ts (palette()/tone()/toneRgb())
//
// Chart: cloud of blue scatter points + red effectScatter ripple for outliers.
// Ported near-verbatim from the c-scatter config in public/docs/insight-examples.html.
//
// Outliers: points whose tone === 'alarm' are promoted to effectScatter.
// Annotations: `at:'point'` marks draw a labelled leader on the nearest data point;
//   `at:'band'` draws a threshold line (axis:'x'|'y'); other `at` types are ignored.
// ============================================================================
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { ScatterData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: ScatterData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts is lazy-loaded so it lands in the admin code-split chunk, never the learner bundle.
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = {
  setOption: (o: Record<string, unknown>, notMerge?: boolean) => void
  resize: () => void
  dispose: () => void
}

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// ---- partition points into cloud (neutral/good/warn) vs outliers (alarm) ----
function partitionPoints(points: ScatterData['points']): {
  cloud: [number, number][]
  outliers: [number, number][]
} {
  const cloud: [number, number][] = []
  const outliers: [number, number][] = []
  for (const pt of points) {
    if (pt.tone === 'alarm') {
      outliers.push([pt.x, pt.y])
    } else {
      cloud.push([pt.x, pt.y])
    }
  }
  return { cloud, outliers }
}

// ---- build annotation mark lines / points ----
function buildMarkLines(): Record<string, unknown>[] {
  const lines: { name: string; xAxis?: number; yAxis?: number; lineStyle: Record<string, unknown>; label: Record<string, unknown> }[] = []

  for (const ann of props.annotations) {
    if (ann.at === 'band') {
      const col = tone(ann.tone)
      if (ann.axis === 'x') {
        // vertical band lines at min and max
        lines.push({
          name: ann.note,
          xAxis: ann.min,
          lineStyle: { color: col, type: 'dashed', width: 1.5, opacity: 0.6 },
          label: { show: false },
        })
        lines.push({
          name: '',
          xAxis: ann.max,
          lineStyle: { color: col, type: 'dashed', width: 1.5, opacity: 0.6 },
          label: { show: false },
        })
      } else {
        // horizontal band lines (y axis is default)
        lines.push({
          name: ann.note,
          yAxis: ann.min,
          lineStyle: { color: col, type: 'dashed', width: 1.5, opacity: 0.6 },
          label: { show: false },
        })
        lines.push({
          name: '',
          yAxis: ann.max,
          lineStyle: { color: col, type: 'dashed', width: 1.5, opacity: 0.6 },
          label: { show: false },
        })
      }
    }
  }
  return lines
}

// ---- build annotation mark points (at:'point' on the cloud series) ----
function buildMarkPoints(): Record<string, unknown>[] {
  const marks: { coord: [number, number]; name: string; itemStyle: Record<string, unknown>; label: Record<string, unknown> }[] = []

  for (const ann of props.annotations) {
    if (ann.at === 'point') {
      const x = typeof ann.x === 'number' ? ann.x : parseFloat(String(ann.x))
      // find nearest point in the dataset by x proximity (x-only match for point annotations)
      let closest: [number, number] = [x, 0]
      let minDist = Infinity
      for (const pt of props.data.points) {
        const d = Math.abs(pt.x - x)
        if (d < minDist) {
          minDist = d
          closest = [pt.x, pt.y]
        }
      }
      marks.push({
        coord: closest,
        name: ann.note,
        itemStyle: { color: tone(ann.tone), borderWidth: 2, borderColor: tone(ann.tone) },
        label: {
          show: true,
          formatter: ann.note,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: tone(ann.tone),
          position: 'top',
        },
      })
    }
  }
  return marks
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  const { cloud, outliers } = partitionPoints(props.data.points)

  const xMax = props.data.xMax ?? 100
  const yMax = props.data.yMax ?? 100

  const cloudBlue = `rgba(${toneRgb('neutral')}, 0.45)`   // neutral = blue in the theme
  const outlierRed = tone('alarm')

  const axisCommon = {
    min: 0,
    splitLine: { lineStyle: { color: p.line } },
    axisLine: { lineStyle: { color: p.line } },
    axisLabel: { show: false },
    axisTick: { show: false },
  }

  const markLines = buildMarkLines()
  const markPoints = buildMarkPoints()

  const cloudSeries: Record<string, unknown> = {
    type: 'scatter',
    symbolSize: 9,
    itemStyle: { color: cloudBlue },
    data: cloud,
    markLine: markLines.length > 0 ? {
      silent: true,
      symbol: ['none', 'none'],
      data: markLines,
    } : undefined,
    markPoint: markPoints.length > 0 ? {
      symbol: 'circle',
      symbolSize: 14,
      data: markPoints,
    } : undefined,
  }

  const outlierSeries: Record<string, unknown> = {
    type: 'effectScatter',
    symbolSize: 13,
    rippleEffect: { scale: 2.6, brushType: 'stroke' },
    itemStyle: { color: outlierRed },
    data: outliers,
  }

  return {
    grid: { left: 46, right: 18, top: 18, bottom: 42 },
    xAxis: {
      ...axisCommon,
      max: xMax,
      name: props.data.xLabel,
      nameLocation: 'middle',
      nameGap: 26,
      nameTextStyle: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 },
    },
    yAxis: {
      ...axisCommon,
      max: yMax,
      name: props.data.yLabel,
      nameLocation: 'middle',
      nameGap: 22,
      nameTextStyle: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { data: [number, number] }) => {
        const [x, y] = params.data
        return `${props.data.xLabel}: ${x.toFixed(1)}<br/>${props.data.yLabel}: ${y.toFixed(1)}`
      },
    },
    series: [cloudSeries, outlierSeries],
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
  // Empty data guard — render an empty axes frame rather than throwing.
  chart.setOption(buildOption(), true)
}

onMounted(async () => {
  await ensureChart()
  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
})

// Re-render when the data or annotations change (the host swaps data in place on drill).
watch(() => [props.data, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// expose the resolved triplet only so a template style binding can read it (no logic leaks out)
const _toneRgb = toneRgb
</script>

<template>
  <div class="scatter-widget">
    <!-- The chart fills the widget. The wrapper (InsightWidget) owns all chrome. -->
    <div ref="chartEl" class="scatter-canvas" />

    <!-- Annotation caption list: 'point' and 'band' annotations rendered as a quiet legend
         below the canvas when notes are present. Other `at` types are silently skipped. -->
    <ul
      v-if="annotations.length > 0"
      class="scatter-ann-list"
    >
      <li
        v-for="(ann, i) in annotations.filter(a => a.at === 'point' || a.at === 'band')"
        :key="i"
        class="scatter-ann-item"
      >
        <span
          class="scatter-ann-dot"
          :style="{
            background: ann.tone === 'alarm'
              ? `rgba(${_toneRgb('alarm')}, 0.85)`
              : ann.tone === 'warn'
              ? `rgba(${_toneRgb('warn')}, 0.85)`
              : ann.tone === 'good'
              ? `rgba(${_toneRgb('good')}, 0.85)`
              : 'var(--ink-faint)',
          }"
        />
        <span class="scatter-ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.scatter-widget {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  font-family: var(--font-mono);
}

/* The canvas fills available width; height is desktop-first tall (mirrors .chart.tall in the gallery). */
.scatter-canvas {
  width: 100%;
  height: 320px;
  flex: 0 0 auto;
}

/* ---- annotation caption strip ---- */
.scatter-ann-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}

.scatter-ann-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--ink-secondary);
}

.scatter-ann-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.scatter-ann-note {
  line-height: 1.3;
}

/* Desktop-first; on narrow admin panes the canvas stays tall and scrolls. */
@media (max-width: 640px) {
  .scatter-canvas {
    height: 260px;
  }
}
</style>
