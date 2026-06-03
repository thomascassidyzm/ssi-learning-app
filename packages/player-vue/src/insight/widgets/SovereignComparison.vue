<script setup lang="ts">
// ============================================================================
// widgets/SovereignComparison.vue — LENS A standing chart
//
// Mirrors Stat.vue's structure exactly:
//   · props { data: SovereignComparisonData, annotations?: Annotation[], named?: boolean }
//   · renders ONLY the chart + annotation marks
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) -> builds option from data + theme tokens
//   · ResizeObserver -> chart.resize()
//   · NO hardcoded hex — every colour comes from theme.ts (palette() / hGradient())
//
// Chart: c-standing (horizontal bar) — top-5 anonymised peers + entity "you" bar
// highlighted blue + average mark line + percentile caption, ported near-verbatim
// from public/docs/insight-examples.html's mk("c-standing", …) call.
//
// The InsightWidget WRAPPER owns:
//   story / why? / graded actions / sovereignty caption
// This widget renders ONLY the ECharts canvas + the DOM stand-foot footer (avg + percentile).
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { SovereignComparisonData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, hGradient,
  GRAD_BLUE_LIGHT, GRAD_GOLD_LIGHT,
  FONT_MONO,
  type EChartsLike,
} from '../theme'

// ---- props ------------------------------------------------------------------
// `named` is injected only when the wrapper is in admin identified-visibility mode.
// It controls whether top-bar labels render as initials (false) or actual names (true).
const props = withDefaults(defineProps<{
  data: SovereignComparisonData
  annotations?: Annotation[]
  named?: boolean
}>(), {
  annotations: () => [],
  named: false,
})

// ---- echarts lazy type -------------------------------------------------------
let echarts: (EChartsLike & {
  init: (
    el: HTMLElement,
    theme?: string | null,
    opts?: Record<string, unknown>,
  ) => EChartInstance
}) | null = null
type EChartInstance = {
  setOption: (o: Record<string, unknown>, opts?: { notMerge?: boolean }) => void
  resize: () => void
  dispose: () => void
}

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// ---- helpers ----------------------------------------------------------------
function fmtValue(v: number, unit?: string): string {
  if (!unit) {
    // treat raw number as hours — format as "Xh YYm"
    const h = Math.floor(v)
    const m = Math.round((v - h) * 60)
    return `${h}h ${m < 10 ? '0' : ''}${m}m`
  }
  if (unit === 'h' || unit === 'hrs' || unit === 'hours') {
    const h = Math.floor(v)
    const m = Math.round((v - h) * 60)
    return `${h}h ${m < 10 ? '0' : ''}${m}m`
  }
  if (unit === 'min' || unit === 'mins' || unit === 'minutes') {
    return `${v}m`
  }
  if (unit === '%') return `${v}%`
  return `${v}${unit}`
}

function fmtAvg(avg: number, unit?: string): string {
  return fmtValue(avg, unit)
}

// ---- annotation lookup: a 'datum' annotation whose key matches a bar id -----
function annForBar(id: string): Annotation | undefined {
  return props.annotations.find(a => a.at === 'datum' && a.key === id)
}

// ---- chart option builder (requires echarts to be loaded for gradients) ----
// Called only from ensureChart(), where echarts is guaranteed non-null.
function buildOption(ec: NonNullable<typeof echarts>): Record<string, unknown> {
  const p = palette()
  const { top, self, average, unit } = props.data

  // ECharts category axis renders the first array item at the bottom.
  // Sort peers ascending so the largest appears at the top of the chart.
  // Self ("you") row sits at the very bottom (index 0).
  const peers = [...top].sort((a, b) => a.value - b.value)
  const selfLabel = self?.label ?? 'you'

  const categories: string[] = [selfLabel, ...peers.map(r => r.label)]

  // Self bar — blue gradient (gallery canonical: GRAD_BLUE_LIGHT → palette.blue)
  const selfBar: Record<string, unknown> = {
    value: self?.value ?? 0,
    itemStyle: {
      color: hGradient(ec, GRAD_BLUE_LIGHT, p.blue),
    },
  }

  // Peer bars — gold gradient; annotated bars get a tone-coloured border.
  const peerBars: Record<string, unknown>[] = peers.map(r => {
    const ann = annForBar(r.id)
    const richEnd = ann ? tone(ann.tone) : p.gold
    return {
      value: r.value,
      itemStyle: {
        color: hGradient(ec, GRAD_GOLD_LIGHT, richEnd),
        borderColor: ann ? tone(ann.tone) : 'transparent',
        borderWidth: ann ? 2 : 0,
      },
    }
  })

  const bars: Record<string, unknown>[] = [selfBar, ...peerBars]

  // Average mark line (dashed vertical rule)
  const markLine = average > 0
    ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: p.ink3, type: 'dashed', width: 1.5 },
        data: [{ xAxis: average }],
        label: {
          show: true,
          position: 'end',
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: p.ink3,
          formatter: `avg\n${fmtAvg(average, unit)}`,
        },
      }
    : undefined

  // y-axis rich formatter: entity label renders blue+bold; peers render plain.
  const richKey = 'self'
  const yAxisRich: Record<string, unknown> = {
    [richKey]: { color: p.blue, fontWeight: 'bold', fontFamily: FONT_MONO, fontSize: 13 },
  }

  // x-axis ceiling: 12% headroom so the right-side value labels don't clip.
  const allValues = [...top.map(r => r.value), self?.value ?? 0, average].filter(v => v > 0)
  const xMax = allValues.length ? Math.max(...allValues) * 1.12 : 10

  return {
    grid: { left: 64, right: 54, top: 10, bottom: 10 },
    xAxis: {
      type: 'value',
      max: xMax,
      splitLine: { lineStyle: { color: p.line } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    yAxis: {
      type: 'category',
      data: categories,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: FONT_MONO,
        fontSize: 13,
        color: p.ink2,
        // Use a rich formatter to highlight the entity row.
        formatter: (v: string) => v === selfLabel ? `{${richKey}|${v}}` : v,
        rich: yAxisRich,
      },
    },
    series: [
      {
        type: 'bar',
        barWidth: '56%',
        itemStyle: { borderRadius: [0, 7, 7, 0] },
        label: {
          show: true,
          position: 'right',
          fontFamily: FONT_MONO,
          fontSize: 12,
          color: p.ink2,
          formatter: (params: { value: number }) => fmtValue(params.value, unit),
        },
        data: bars,
        ...(markLine ? { markLine } : {}),
      },
    ],
  }
}

// ---- lifecycle --------------------------------------------------------------
async function ensureChart() {
  if (!chartEl.value) return
  if (!echarts) {
    echarts = (await import('echarts')) as unknown as typeof echarts
    registerInsightTheme(echarts!)
  }
  if (!chart) {
    chart = echarts!.init(chartEl.value, INSIGHT_THEME_NAME, { renderer: 'canvas' })
  }
  chart.setOption(buildOption(echarts!), { notMerge: true })
}

onMounted(async () => {
  await ensureChart()
  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
})

watch(() => [props.data, props.annotations, props.named], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// ---- footer: percentile caption + average line ------------------------------
const percentileText = computed(() => {
  if (props.data.percentile == null) return ''
  const p = props.data.percentile
  if (p >= 75) return `You're in the top ${100 - p}% ✨`
  if (p >= 50) return `You're in the top half`
  return `You're at the ${p}th percentile`
})

const avgText = computed(() => {
  const { groupLabel, windowLabel, average, unit } = props.data
  return `Average ${groupLabel} · ${windowLabel}: ${fmtAvg(average, unit)}`
})

// Chart height: 1 row per bar. Peers (up to 5) + self row. ~48px per bar, min 220px.
const chartHeight = computed(() => {
  const rows = Math.min(props.data.top.length, 5) + 1
  return Math.max(220, rows * 52)
})
</script>

<template>
  <div class="sc-widget">
    <!-- ECharts canvas -->
    <div
      ref="chartEl"
      class="sc-chart"
      :style="{ height: chartHeight + 'px' }"
    />

    <!-- standing footer: average + percentile (mirrors .stand-foot in the gallery) -->
    <div v-if="avgText || percentileText" class="sc-foot">
      <span v-if="avgText" class="sc-avg">{{ avgText }}</span>
      <span v-if="percentileText" class="sc-pct">{{ percentileText }}</span>
    </div>

    <!-- Annotation captions are rendered by InsightWidget.vue (.read-note).
         This widget only reflects annotations ON the chart (border/colour overrides on bars).
         No DOM caption list here — that would double-render the notes. -->
  </div>
</template>

<style scoped>
.sc-widget {
  display: flex;
  flex-direction: column;
  width: 100%;
  font-family: var(--font-mono);
}

.sc-chart {
  width: 100%;
  /* height is bound dynamically via :style */
}

/* ---- standing footer (mirrors gallery .stand-foot) ---- */
.sc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 4px 2px;
}

.sc-avg {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-secondary);
}

.sc-pct {
  font-family: var(--font-display);
  font-weight: 700;
  color: rgba(var(--tone-green), 1);
  font-size: 16px;
}

/* on narrow admin panes the footer stacks */
@media (max-width: 640px) {
  .sc-foot {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
