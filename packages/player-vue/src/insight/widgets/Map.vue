<script setup lang="ts">
// ============================================================================
// widgets/Map.vue — choropleth / ranked-region widget
//
// Mirrors Stat.vue / RankedBar.vue EXACTLY for structure:
//   · props { data: MapData, annotations: Annotation[] }
//   · emits NOTHING — the wrapper owns all events
//   · renders ONLY the chart + annotation marks — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme / ResizeObserver / no hardcoded hex
//
// CHOROPLETH NOTE:
//   ECharts geo/map types require a world GeoJSON registered via echarts.registerMap().
//   No world GeoJSON is bundled in this repo, so this widget renders as a ranked
//   horizontal-bar of regions — the same information a choropleth would carry, without
//   a ~400KB GeoJSON dependency. If a world map is later bundled (import worldGeo from
//   '../../assets/world.geojson') it can be registered as:
//     echarts.registerMap('world', worldGeo)
//   and the buildOption() branch below switched from 'bar' to 'map' + 'visualMap'.
//   Until then this is the canonical display path and is NOT a degraded fallback —
//   it reads the same story cleanly and is lighter on the admin bundle.
//
// Visual spec:
//   · Regions sorted descending by value, top 20 shown (long tails are noise)
//   · Horizontal bars — mirrors c-standing from gallery
//   · Per-region tone colour via theme.tone() or the annotation tone override
//   · 'region' annotations: the matching bar gets a tone border + note caption below
//   · Empty state: quiet centred "No data" message — never throws
//
// Data source: player_events.ip_country (ISO-3166-1 alpha-2 or alpha-3 depending on
// the ip-geo provider; the resolver normalises to a display label via data.regions[].label).
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { MapData, Annotation, Tone } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb, hGradient, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: MapData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts lazy-loaded so it stays in the admin code-split chunk, never the learner bundle.
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

// Top 20 regions sorted descending by value — long tails add visual noise, not insight.
const MAX_REGIONS = 20

const sorted = computed(() => {
  const rs = [...(props.data.regions ?? [])]
  rs.sort((a, b) => b.value - a.value)
  return rs.slice(0, MAX_REGIONS)
})

const isEmpty = computed(() => sorted.value.length === 0)

// 'region' annotation whose .region matches the iso code.
function annForRegion(region: string): (Annotation & { at: 'region' }) | undefined {
  return props.annotations.find(
    (a): a is Annotation & { at: 'region' } => a.at === 'region' && a.region === region,
  )
}

// Active annotation notes (rendered in the DOM below the chart).
const activeAnnotations = computed(() =>
  sorted.value
    .map(r => ({ r, ann: annForRegion(r.region) }))
    .filter((x): x is { r: typeof sorted.value[number]; ann: Annotation & { at: 'region' } } => !!x.ann),
)

// Colour: annotation tone overrides region tone; falls back to neutral.
function regionColour(region: string, regionTone?: Tone): string {
  const ann = annForRegion(region)
  if (ann) return tone(ann.tone)
  if (regionTone) return tone(regionTone)
  return tone('neutral')
}

// Soft fill using a left-to-right gradient from paper-2 to the full tone colour.
function regionFill(ec: EChartsLike, region: string, regionTone?: Tone): unknown {
  const p = palette()
  const col = regionColour(region, regionTone)
  return hGradient(ec, p.paper2, col)
}

// Display label: prefer the explicit label from the resolver, fallback to the iso code.
function regionLabel(r: { region: string; label?: string }): string {
  return r.label ?? r.region
}

// Value formatter: integer or 1dp, with optional unit.
function formatValue(v: number): string {
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1)
  const u = props.data.unit
  if (!u) return n
  return u === '%' ? `${n}%` : `${n} ${u}`
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  const regions = sorted.value

  if (regions.length === 0) {
    return {
      grid: { left: 8, right: 8, top: 8, bottom: 8 },
      xAxis: { show: false },
      yAxis: { show: false },
      series: [],
    }
  }

  // ECharts horizontal bar: xAxis=value, yAxis=category.
  // Reverse the sorted array so the highest bar sits at the top.
  const reversed = [...regions].reverse()
  const categories = reversed.map(r => regionLabel(r))

  const maxVal = regions[0]?.value ?? 1
  const axisMax = maxVal * 1.22   // right-margin so value labels don't clip

  const seriesData = reversed.map(r => {
    const ann = annForRegion(r.region)
    return {
      value: r.value,
      itemStyle: {
        color: regionFill(echarts!, r.region, r.tone),
        borderColor: ann ? tone(ann.tone) : 'transparent',
        borderWidth: ann ? 3 : 0,
        borderRadius: [0, 7, 7, 0],   // mirrors c-standing
      },
    }
  })

  // Dynamic left margin: scale with longest label.
  const maxLabelLen = Math.max(...categories.map(c => c.length))
  const leftGap = Math.min(Math.max(maxLabelLen * 7.2, 48), 180)

  return {
    grid: {
      left: leftGap,
      right: 60,      // room for value labels
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
        // Annotated label: bold + ink-primary.
        formatter: (label: string) => {
          const r = reversed.find(x => regionLabel(x) === label)
          if (r && annForRegion(r.region)) return `{ann|${label}}`
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

// Re-render when data or annotations change (host swaps in-place on drill).
watch(() => [props.data, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// Expose so template style bindings can read it (mirrors Stat.vue / RankedBar.vue pattern).
const _toneRgb = toneRgb
</script>

<template>
  <div class="map-widget">
    <!-- Empty state — no chart canvas, quiet message. -->
    <div v-if="isEmpty" class="map-empty">No data</div>

    <!-- Ranked-region bar chart. Height scales with region count; floor 120px, cap 560px. -->
    <div
      v-else
      ref="chartEl"
      class="map-chart"
      :style="{
        height: `${Math.min(Math.max(sorted.length * 44 + 16, 120), 560)}px`,
      }"
    />

    <!-- Annotation notes — rendered below the chart, one per annotated region. -->
    <ul v-if="activeAnnotations.length" class="map-annotations">
      <li
        v-for="{ r, ann } in activeAnnotations"
        :key="r.region"
        class="map-ann-item"
        :style="{
          borderLeftColor: `rgba(${_toneRgb(ann.tone)}, 0.85)`,
          background: `rgba(${_toneRgb(ann.tone)}, 0.07)`,
        }"
      >
        <span class="map-ann-label">{{ r.label ?? r.region }}</span>
        <span class="map-ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.map-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  font-family: var(--font-mono);
}

.map-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 120px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-faint);
  letter-spacing: 0.06em;
}

.map-chart {
  width: 100%;
  /* height set inline, scaling with region count */
}

/* Annotation notes strip — mirrors RankedBar.vue */
.map-annotations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.map-ann-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
  padding: 5px 10px;
  border-radius: 6px;
  border-left: 3px solid transparent;
}

.map-ann-label {
  font-weight: 600;
  color: var(--ink-primary);
  white-space: nowrap;
}

.map-ann-note {
  color: var(--ink-secondary);
  line-height: 1.4;
}

/* Desktop-first; narrow screens collapse the annotation label onto its own line. */
@media (max-width: 640px) {
  .map-ann-item {
    flex-direction: column;
    gap: 2px;
  }
}
</style>
