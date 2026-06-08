<script setup lang="ts">
// ============================================================================
// widgets/CohortGrid.vue — heatmap grid (cohort retention OR friction map)
//
// Mirrors Stat.vue EXACTLY for structure:
//   · props { data: CohortGridData, annotations: Annotation[] } — data narrowed by `kind`
//   · emits NOTHING — the InsightWidget wrapper owns all events
//   · renders ONLY the chart + annotation marks — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) → builds option from data + theme tokens
//   · ResizeObserver → chart.resize()
//   · NO hardcoded hex — every colour comes from theme.ts (palette()/tone())
//
// Chart type: heatmap, visualMap paper→red scale, value labels, rounded cells.
// Annotatable cell: { at: 'cell'; x: string; y: string; … } draws a coloured
// border ring + a tooltip marker on the matching cell.
//
// Ported near-verbatim from the proven c-heatmap config in
// packages/player-vue/public/docs/insight-examples.html.
// ============================================================================
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { CohortGridData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone,
  FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: CohortGridData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ---- ECharts lazy-loaded so it stays in the admin chunk, never the learner bundle ----
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

// ---- Annotation helpers ----
// Find a `cell` annotation for a given (x, y) coordinate pair.
function annForCell(x: string, y: string): (Annotation & { at: 'cell' }) | undefined {
  return props.annotations.find(
    (a): a is Annotation & { at: 'cell' } => a.at === 'cell' && a.x === x && a.y === y,
  )
}

// Build the ECharts option — ported from c-heatmap in insight-examples.html.
// Colours come from palette() / tone(), never from hex literals.
function buildOption(): Record<string, unknown> {
  const p = palette()
  const { xLabels, yLabels, cells, min, max, unit } = props.data

  // Guard: empty data renders an empty canvas without throwing.
  if (!xLabels.length || !yLabels.length) {
    return {
      grid: { left: 78, right: 18, top: 14, bottom: 44 },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'category', data: [] },
      series: [],
    }
  }

  // Map cells to [xIdx, yIdx, value] triples ECharts heatmap expects.
  // Also resolve per-cell borderColor from annotations (annotated cells get a
  // tone-coloured ring so the mark is visible on the canvas).
  const seriesData = cells.map(c => {
    const xi = xLabels.indexOf(c.x)
    const yi = yLabels.indexOf(c.y)
    const ann = annForCell(c.x, c.y)
    const item: Record<string, unknown> = { value: [xi, yi, c.value] }
    if (ann) {
      item.itemStyle = {
        borderColor: tone(ann.tone),
        borderWidth: 3,
        borderRadius: 4,
      }
    }
    return item
  })

  // visualMap scale: paper → gold → muted-red → full-red.
  // Gallery equivalent: ["#efece4","#f3d9a6","#e89a6a","#DB1E17"].
  // We re-point every step to palette tokens + rgba blending so no hex literal escapes:
  //   · paper2     = p.paper2  (the gallery's #efece4)
  //   · gold       = p.gold    (the gallery's #f3d9a6 warm step)
  //   · muted-red  = rgba(red, 0.55) blended over paper — warm orange midpoint
  //   · full red   = p.red     (the Frostwell alarm colour, #DB1E17)
  // ECharts visualMap.inRange.color accepts any CSS colour string.
  const mutedRed = p.red.startsWith('rgb(')
    ? p.red.replace('rgb(', 'rgba(').replace(')', ', 0.55)')
    : p.red  // fallback: just use full red if the format is unexpected
  const visualMapColors = [p.paper2, p.gold, mutedRed, p.red]

  const unitSuffix = unit ? ` ${unit}` : ''
  const xIdxToLabel = (i: number) => xLabels[i] ?? String(i)
  const yIdxToLabel = (i: number) => yLabels[i] ?? String(i)

  return {
    tooltip: {
      position: 'top',
      formatter: (params: { data: { value: [number, number, number] } }) => {
        const [xi, yi, v] = params.data.value
        const xL = xIdxToLabel(xi)
        const yL = yIdxToLabel(yi)
        // Surface any annotation note in the tooltip.
        const ann = annForCell(xL, yL)
        const note = ann ? ` · ${ann.note}` : ''
        return `${yL} · ${xL}: <b>${v}${unitSuffix}</b>${note}`
      },
    },
    grid: { left: 78, right: 18, top: 14, bottom: 44 },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: p.line } },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 },
    },
    yAxis: {
      type: 'category',
      data: yLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink2, fontSize: 12 },
    },
    visualMap: {
      min: min,
      max: max,
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 4,
      itemWidth: 12,
      itemHeight: 120,
      text: ['high', ''],
      textStyle: { fontFamily: FONT_MONO, fontSize: 10, color: p.ink3 },
      inRange: { color: visualMapColors },
    },
    series: [{
      type: 'heatmap',
      data: seriesData,
      label: {
        show: true,
        fontFamily: FONT_MONO,
        fontSize: 11,
        color: p.ink,
        formatter: '{c}',
      },
      itemStyle: {
        // default cell border — annotated cells override via per-item itemStyle
        borderColor: p.card,
        borderWidth: 2,
        borderRadius: 4,
      },
      emphasis: {
        itemStyle: { shadowBlur: 8, shadowColor: p.lineSoft },
      },
    }],
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
  chart.setOption(buildOption(), true)
}

onMounted(async () => {
  await ensureChart()
  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
})

// Re-render when the data or annotations change (host swaps data on drill).
watch(() => [props.data, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="cohort-grid-widget">
    <div ref="chartEl" class="cohort-grid-chart" />

    <!--
      Annotation captions — for each `cell` annotation we render a small badge
      below the chart so the note text is readable (the canvas mark is the ring
      drawn via itemStyle.borderColor above; this is the text companion).
      All other annotation shapes are ignored here (degrade, never throw).
    -->
    <ul v-if="annotations.length" class="cohort-grid-annotations">
      <li
        v-for="ann in annotations.filter((a): a is Annotation & { at: 'cell' } => a.at === 'cell')"
        :key="`${ann.x}:${ann.y}`"
        class="cohort-grid-ann-item"
        :style="{ borderLeftColor: tone(ann.tone) }"
      >
        <span class="ann-coords">{{ ann.y }} · {{ ann.x }}</span>
        <span class="ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.cohort-grid-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  font-family: var(--font-mono);
}

/* The canvas fills the widget; minimum height keeps it legible on narrow
   admin side-panels. Desktop-first: 340px is comfortable for 4–8 rows. */
.cohort-grid-chart {
  width: 100%;
  height: 340px;
  min-height: 160px;
}

/* Annotation caption list — sits below the chart, tight and scannable. */
.cohort-grid-annotations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cohort-grid-ann-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 8px;
  border-left: 3px solid var(--ink-faint);
  border-radius: 2px;
  background: transparent;
  font-size: 12px;
  line-height: 1.4;
}
.ann-coords {
  font-variant-numeric: tabular-nums;
  color: var(--ink-muted);
  white-space: nowrap;
  font-size: 11px;
  letter-spacing: 0.04em;
}
.ann-note {
  color: var(--ink-secondary);
  flex: 1 1 auto;
}

/* On narrow viewports the chart height drops gracefully. */
@media (max-width: 640px) {
  .cohort-grid-chart {
    height: 240px;
  }
}
</style>
