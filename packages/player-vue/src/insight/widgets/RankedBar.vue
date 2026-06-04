<script setup lang="ts">
// ============================================================================
// widgets/RankedBar.vue — horizontal ranked-bar widget
//
// Mirrors Stat.vue EXACTLY for structure:
//   · props { data: RankedBarData, annotations: Annotation[] }
//   · emits NOTHING — the wrapper owns all events
//   · renders ONLY the chart + annotation marks — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme / ResizeObserver / no hardcoded hex
//
// Visual spec:
//   · Horizontal bars sorted descending
//   · Value labels at right end of each bar
//   · Rounded right corners (borderRadius: [0,7,7,0])
//   · Per-bar tone colour via theme.tone()
//   · Annotatable row — a 'datum' annotation whose key matches bar.id
//     renders a tone-coloured left-border marker and a note caption
//
// Ported from the 'c-standing' config in public/docs/insight-examples.html.
// Colours re-pointed to palette()/tone() — zero hex literals.
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { RankedBarData, Annotation, Tone } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb, hGradient, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: RankedBarData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts is lazy-loaded so it stays in the admin code-split chunk.
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = {
  setOption: (o: Record<string, unknown>) => void
  resize: () => void
  dispose: () => void
}

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// Sorted descending by value (chart renders top-to-bottom = last category first in ECharts,
// so we reverse for the inverted-yAxis pattern used by c-standing).
const sorted = computed(() => {
  const bars = [...(props.data.bars ?? [])]
  bars.sort((a, b) => b.value - a.value)
  return bars
})

const isEmpty = computed(() => sorted.value.length === 0)

// Annotation lookup: 'datum' annotations whose key matches a bar id.
function annForBar(id: string): Annotation & { at: 'datum' } | undefined {
  return props.annotations.find(
    (a): a is Annotation & { at: 'datum' } => a.at === 'datum' && a.key === id,
  )
}

// Active annotation notes (rendered in the DOM below the chart).
const activeAnnotations = computed(() =>
  sorted.value
    .map(bar => ({ bar, ann: annForBar(bar.id) }))
    .filter((x): x is { bar: typeof sorted.value[number]; ann: Annotation & { at: 'datum' } } => !!x.ann),
)

// Pick bar colour: annotated bar uses its annotation tone, otherwise bar.tone, otherwise neutral.
function barColour(id: string, barTone?: Tone): string {
  const ann = annForBar(id)
  if (ann) return tone(ann.tone)
  if (barTone) return tone(barTone)
  return tone('neutral')
}

// Build a soft fill variant (lighter) using a horizontal gradient from a desaturated tint.
function barFill(ec: EChartsLike, id: string, barTone?: Tone): unknown {
  const p = palette()
  const col = barColour(id, barTone)
  // Gradient: start from a pale tint (near paper-2), end at the full tone colour.
  // hGradient goes left→right (x0=0,y0=0,x1=1,y1=0).
  return hGradient(ec, p.paper2, col)
}

// Value formatter: show integer values plain; fractions to 1dp; append unit if present.
function formatValue(v: number): string {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1)
  const u = props.data.unit
  if (!u) return n
  return u === '%' ? `${n}%` : `${n} ${u}`
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  const bars = sorted.value

  if (bars.length === 0) {
    // Minimal empty-state option — renders nothing but doesn't throw.
    return {
      grid: { left: 8, right: 8, top: 8, bottom: 8 },
      xAxis: { show: false },
      yAxis: { show: false },
      series: [],
    }
  }

  // ECharts horizontal bar: xAxis=value, yAxis=category.
  // Categories are listed bottom-to-top by default, so we reverse the sorted array so
  // the highest-value bar sits at the top of the chart.
  const reversed = [...bars].reverse()
  const categories = reversed.map(b => b.label)

  const maxVal = bars[0]?.value ?? 1
  // Give the axis a small right margin so value labels don't clip.
  const axisMax = maxVal * 1.22

  const seriesData = reversed.map(b => {
    const ann = annForBar(b.id)
    return {
      value: b.value,
      itemStyle: {
        color: barFill(echarts!, b.id, b.tone),
        // Annotated bar: ECharts renders a uniform outline (not a one-sided border — canvas limitation).
        // The primary annotation mark is the DOM strip rendered below the chart.
        borderColor: ann ? tone(ann.tone) : 'transparent',
        borderWidth: ann ? 2 : 0,
        // Rounded right corners (c-standing gallery: borderRadius:[0,7,7,0])
        borderRadius: [0, 7, 7, 0],
        opacity: b.muted ? 0.45 : 1,
      },
    }
  })

  // Dynamic grid: left margin scales with the longest label string.
  const maxLabelLen = Math.max(...categories.map(c => c.length))
  const leftGap = Math.min(Math.max(maxLabelLen * 7.5, 48), 160)

  return {
    grid: {
      left: leftGap,
      right: 56,   // room for value labels
      top: 6,
      bottom: 6,
      containLabel: false,
    },
    xAxis: {
      type: 'value',
      max: axisMax,
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
        // Annotated label: bold + annotation tone colour.
        formatter: (label: string) => {
          const bar = reversed.find(b => b.label === label)
          if (bar && annForBar(bar.id)) {
            return `{ann|${label}}`
          }
          return label
        },
        rich: {
          ann: {
            fontFamily: FONT_MONO,
            fontSize: 13,
            fontWeight: 700,
            color: p.ink,
          },
        },
      },
    },
    series: [{
      type: 'bar',
      barWidth: '56%',
      label: {
        show: true,
        position: 'right',
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: p.ink2,
        formatter: (params: { value: number }) => formatValue(params.value),
      },
      data: seriesData,
    }],
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number }) =>
        `${params.name}: ${formatValue(params.value)}`,
    },
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
  chart.setOption(buildOption())
}

onMounted(async () => {
  await ensureChart()
  if (chartEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
})

// Re-render when data or annotations change (the host swaps data in-place on drill).
watch(() => [props.data, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// Expose so template style bindings can call it (mirrors Stat.vue pattern).
const _toneRgb = toneRgb
</script>

<template>
  <div class="ranked-bar-widget">
    <!-- Empty state — no chart canvas, just a quiet message. -->
    <div v-if="isEmpty" class="ranked-bar-empty">No data</div>

    <!-- The ECharts canvas. Height scales with bar count; floor at 120px, cap at 480px. -->
    <div
      v-else
      ref="chartEl"
      class="ranked-bar-chart"
      :style="{
        height: `${Math.min(Math.max(sorted.length * 44 + 16, 120), 480)}px`,
      }"
    />

    <!-- Annotation notes — rendered in the DOM below the chart, one per annotated bar. -->
    <ul v-if="activeAnnotations.length" class="ranked-bar-annotations">
      <li
        v-for="{ bar, ann } in activeAnnotations"
        :key="bar.id"
        class="ranked-bar-ann-item"
        :style="{
          '--ann-rgb': _toneRgb(ann.tone),
          borderLeftColor: `rgba(${_toneRgb(ann.tone)}, 0.85)`,
          background: `rgba(${_toneRgb(ann.tone)}, 0.07)`,
        }"
      >
        <span class="ranked-bar-ann-label">{{ bar.label }}</span>
        <span class="ranked-bar-ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ranked-bar-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  font-family: var(--font-mono);
}

.ranked-bar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-faint);
  letter-spacing: 0.06em;
}

.ranked-bar-chart {
  width: 100%;
  /* height is set inline, scaling with bar count */
}

/* Annotation notes strip */
.ranked-bar-annotations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ranked-bar-ann-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  padding: 5px 10px;
  border-radius: 6px;
  /* tone-coloured left border + tinted bg — values set via inline style from _toneRgb() */
  border-left: 3px solid transparent;
}

.ranked-bar-ann-label {
  font-weight: 600;
  color: var(--ink-primary);
  white-space: nowrap;
}

.ranked-bar-ann-note {
  color: var(--ink-secondary);
  line-height: 1.4;
}

/* Desktop-first; on narrow screens the chart respects its own grid padding. */
@media (max-width: 640px) {
  .ranked-bar-ann-item {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
