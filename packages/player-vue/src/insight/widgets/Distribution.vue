<script setup lang="ts">
// ============================================================================
// widgets/Distribution.vue — Histogram / bar-of-buckets widget
//
// Mirrors Stat.vue EXACTLY for structure:
//   · props { data: DistributionData, annotations?: Annotation[], beltRegions?: BeltRegion[] }
//   · emits NOTHING — the InsightWidget wrapper owns all events
//   · renders ONLY the chart + annotation marks — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme → builds option from data + theme tokens
//   · ResizeObserver → chart.resize()
//   · NO hardcoded hex/rgba — every colour from theme.ts (palette()/tone()/toneRgb())
//
// Belt-region backgrounds are optional: pass beltRegions to shade the x-axis into
// named bands (same pattern as the legacy Histogram.vue but in ECharts markArea).
// Annotatable bucket: spec.annotate[] entries with at:'datum' whose key matches
// a bin.id get a highlighted bar + a text mark above the bar.
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { DistributionData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb, FONT_MONO,
  type EChartsLike,
} from '../theme'

// ---- props ------------------------------------------------------------------
export interface BeltRegion {
  label: string
  x0: number   // inclusive start (same unit as bin.x0/x1)
  x1: number   // exclusive end
  tone?: 'neutral' | 'good' | 'warn' | 'alarm'  // Tone coerced to tonal fill
}

const props = withDefaults(defineProps<{
  data: DistributionData
  annotations?: Annotation[]
  beltRegions?: BeltRegion[]
}>(), {
  annotations: () => [],
  beltRegions: () => [],
})

// ---- echarts types (lazy) ---------------------------------------------------
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = { setOption: (o: Record<string, unknown>, opts?: { notMerge?: boolean }) => void; resize: () => void; dispose: () => void }

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// ---- helpers ----------------------------------------------------------------

const isEmpty = computed(() => !props.data.bins || props.data.bins.length === 0)

// Datum annotations only — the legend renders only these.
const datumAnnotations = computed(() =>
  props.annotations.filter((a): a is Extract<Annotation, { at: 'datum' }> => a.at === 'datum'),
)

// Return a datum annotation for a given bin id (or undefined).
function annForBin(id: string): Annotation | undefined {
  return props.annotations.find(a => a.at === 'datum' && a.key === id)
}

// Build a label string for a bin from x0/x1 + optional unit.
function binLabel(x0: number, x1: number): string {
  const u = props.data.unit ? ` ${props.data.unit}` : ''
  return `${x0}–${x1}${u}`
}

// ---- ECharts option builder -------------------------------------------------

function buildOption(): Record<string, unknown> {
  const p = palette()

  if (isEmpty.value) {
    // Return a minimal empty option (no throw, no crash).
    return {
      grid: { left: 52, right: 24, top: 24, bottom: 48 },
      xAxis: { type: 'category', data: [], axisLine: { lineStyle: { color: p.line } }, axisTick: { show: false }, axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: p.line } }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 } },
      series: [],
    }
  }

  const bins = props.data.bins
  const xLabels = bins.map(b => binLabel(b.x0, b.x1))
  const maxCount = Math.max(...bins.map(b => b.count), 1)

  // Per-bar colour: tone from the bin, or default blue. Annotated bins get alarm/warn/good/neutral colour.
  const barData = bins.map(b => {
    const ann = annForBin(b.id)
    const baseColor = b.tone ? tone(b.tone) : p.blue
    const color = ann ? tone(ann.tone) : baseColor
    return {
      value: b.count,
      itemStyle: {
        color,
        // annotated bars get a distinct border
        borderColor: ann ? tone(ann.tone) : 'transparent',
        borderWidth: ann ? 2 : 0,
        borderRadius: [3, 3, 0, 0],
      },
    }
  })

  // Mean line: a markLine on the series if data.mean is set.
  const markLine: Record<string, unknown> = {}
  if (props.data.mean != null) {
    // mean is in the same unit as x0/x1; find the nearest bin index by midpoint.
    const nearestIdx = bins.reduce((best, b, i) => {
      const mid = (b.x0 + b.x1) / 2
      const prev = bins[best] ? Math.abs((bins[best].x0 + bins[best].x1) / 2 - props.data.mean!) : Infinity
      return Math.abs(mid - (props.data.mean as number)) < prev ? i : best
    }, 0)
    markLine.data = [{ xAxis: nearestIdx, label: { formatter: `mean\n${props.data.mean}${props.data.unit ? ' ' + props.data.unit : ''}`, position: 'insideEndTop', fontFamily: FONT_MONO, fontSize: 10, color: p.ink3, lineHeight: 14 }, lineStyle: { color: p.ink3, type: 'dashed', width: 1.5 } }]
    markLine.silent = true
    markLine.symbol = ['none', 'none']
  }

  // Belt-region backgrounds via markArea.
  const markAreaData: unknown[] = []
  if (props.beltRegions && props.beltRegions.length > 0) {
    for (const region of props.beltRegions) {
      // Map region x0/x1 to bar-index range (bins are [x0, x1) intervals).
      const startIdx = bins.findIndex(b => b.x1 > region.x0 && b.x0 < region.x1)
      const endIdx = bins.reduce((last, b, i) => b.x0 < region.x1 ? i : last, startIdx)
      if (startIdx < 0) continue
      const fillRgb = region.tone ? toneRgb(region.tone) : toneRgb('neutral')
      markAreaData.push([
        {
          xAxis: startIdx,
          itemStyle: { color: `rgba(${fillRgb}, 0.07)` },
          label: { show: true, position: 'insideTop', formatter: region.label, fontFamily: FONT_MONO, fontSize: 9, color: `rgba(${fillRgb}, 0.7)`, distance: 6 },
        },
        { xAxis: endIdx },
      ])
    }
  }

  // Annotation marks: tooltip-visible notes above annotated bars, rendered as
  // markPoint (ECharts 'pin' symbol at the bar tip). Degrade silently for unknown shapes.
  const markPointData: unknown[] = props.annotations
    .filter(a => a.at === 'datum')
    .map(a => {
      const idx = bins.findIndex(b => b.id === (a as { key: string }).key)
      if (idx < 0) return null
      return {
        coord: [idx, bins[idx].count],
        value: (a as { note: string }).note,
        itemStyle: { color: tone((a as { tone: import('../spec').Tone }).tone) },
        label: {
          formatter: (a as { note: string }).note,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: tone((a as { tone: import('../spec').Tone }).tone),
          position: 'top',
          distance: 6,
        },
        symbol: 'circle',
        symbolSize: 7,
      }
    })
    .filter(Boolean)

  return {
    grid: { left: 52, right: 24, top: markPointData.length > 0 ? 40 : 24, bottom: 48 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const arr = params as { name: string; value: number }[]
        if (!arr || arr.length === 0) return ''
        const b = bins[arr[0] ? (xLabels.indexOf(arr[0].name) >= 0 ? xLabels.indexOf(arr[0].name) : 0) : 0]
        const ann = b ? annForBin(b.id) : undefined
        const base = `<span style="font-family:${FONT_MONO};font-size:11px;color:${p.ink3}">${arr[0]?.name ?? ''}</span><br/><b style="font-size:14px;color:${p.ink}">${arr[0]?.value ?? 0}</b>`
        return ann ? `${base}<br/><span style="color:${tone(ann.tone)};font-size:10px">${ann.note}</span>` : base
      },
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      axisLine: { lineStyle: { color: p.line } },
      axisTick: { show: false },
      axisLabel: {
        fontFamily: FONT_MONO,
        color: p.ink3,
        fontSize: 11,
        rotate: xLabels.length > 8 ? 35 : 0,
        interval: 0,
      },
    },
    yAxis: {
      type: 'value',
      max: Math.ceil(maxCount * 1.15),
      splitLine: { lineStyle: { color: p.line } },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: FONT_MONO, color: p.ink3, fontSize: 11 },
    },
    series: [{
      type: 'bar',
      barMaxWidth: 56,
      barCategoryGap: '18%',
      data: barData,
      markLine: Object.keys(markLine).length > 0 ? markLine : undefined,
      markArea: markAreaData.length > 0 ? { silent: true, data: markAreaData } : undefined,
      markPoint: markPointData.length > 0
        ? {
            symbolSize: 7,
            label: { show: true },
            data: markPointData,
          }
        : undefined,
    }],
  }
}

// ---- chart lifecycle (mirrors Stat.vue) -------------------------------------

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
watch(() => [props.data, props.annotations, props.beltRegions], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// expose toneRgb for template style bindings only (no logic leaks out).
const _toneRgb = toneRgb
</script>

<template>
  <div class="dist-widget">
    <!-- empty state — no throw, clear signal -->
    <div v-if="isEmpty" class="dist-empty">
      <span>No data</span>
    </div>

    <!-- chart canvas fills the widget; the wrapper owns height constraints -->
    <div v-else ref="chartEl" class="dist-chart" />

    <!-- annotation legend — one entry per datum annotation that resolves to a known bin -->
    <ul
      v-if="datumAnnotations.length > 0 && !isEmpty"
      class="dist-ann-list"
    >
      <li
        v-for="ann in datumAnnotations"
        :key="ann.key"
        class="dist-ann-item"
      >
        <span
          class="dist-ann-swatch"
          :style="{ background: `rgba(${_toneRgb(ann.tone)}, 0.85)` }"
        />
        <span class="dist-ann-key">{{ ann.key }}</span>
        <span class="dist-ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.dist-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  font-family: var(--font-mono);
}

/* chart fills available height — the InsightWidget wrapper constrains the card height */
.dist-chart {
  width: 100%;
  height: 280px;
  flex: 0 0 auto;
}

/* empty state */
.dist-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

/* annotation legend (one row per annotated bin) */
.dist-ann-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dist-ann-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ink-secondary);
}
.dist-ann-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: 0 0 auto;
  position: relative;
  top: 1px;
}
.dist-ann-key {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ink-muted);
  white-space: nowrap;
}
.dist-ann-note {
  flex: 1 1 auto;
  color: var(--ink-secondary);
  font-size: 11.5px;
}

/* desktop-first: on a narrow pane the chart still fills width cleanly */
@media (max-width: 640px) {
  .dist-chart {
    height: 220px;
  }
}
</style>
