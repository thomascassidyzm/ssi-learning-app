<script setup lang="ts">
// ============================================================================
// widgets/Stat.vue — THE REFERENCE WIDGET
//
// The template the other 12 widgets mirror EXACTLY:
//   · props { data: StatData, annotations: Annotation[] }  — data already narrowed by `kind`
//   · emits NOTHING                                          — the wrapper owns all events
//   · renders ONLY the chart + annotation marks             — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) -> builds an option from data + theme tokens
//   · ResizeObserver -> chart.resize() (mirrors components/admin/charts/*.vue)
//   · NO hardcoded hex — every colour comes from theme.ts (palette()/tone())
//
// Stat is the simplest widget: a big number + label + a curvature delta. It ALSO carries the
// optional ECharts donut variant (build-sha "is my fix live?" spread) — proving a widget can
// be part DOM, part canvas, and still keep echarts lazy and theme-driven.
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { StatData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb, FONT_DISPLAY, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: StatData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts is lazy-loaded so it lands in the admin code-split chunk, never the learner bundle.
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = { setOption: (o: Record<string, unknown>) => void; resize: () => void; dispose: () => void }

const donutEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

const hasDonut = computed(() => !!props.data.donut && props.data.donut.length > 0)

// Format the headline number: integers plain, fractions to 1dp, with optional unit.
const displayValue = computed(() => {
  const v = props.data.value
  const n = Number.isInteger(v) ? String(v) : v.toFixed(1)
  return props.data.unit ? `${n}${props.data.unit === '%' ? '%' : ' ' + props.data.unit}` : n
})

// The curvature read ("up from 2.4%") with its tone colour.
const deltaText = computed(() => {
  if (props.data.delta == null) return ''
  const arrow = props.data.delta > 0 ? '↑' : props.data.delta < 0 ? '↓' : '·'
  const mag = Math.abs(props.data.delta)
  const win = props.data.deltaWindow ? ` from ${props.data.deltaWindow}` : ''
  return `${arrow} ${mag}${win}`
})
const deltaColor = computed(() => tone(props.data.deltaTone ?? 'neutral'))

// A datum annotation whose key matches a donut slice highlights it; a band annotation is ignored here.
function annForDonutSlice(name: string): Annotation | undefined {
  return props.annotations.find(a => a.at === 'datum' && a.key === name)
}

function buildDonutOption(): Record<string, unknown> {
  const p = palette()
  const slices = (props.data.donut ?? []).map(s => {
    const ann = annForDonutSlice(s.name)
    const base = s.tone ? tone(s.tone) : p.inkFaint
    return {
      value: s.value,
      name: s.name,
      itemStyle: {
        color: base,
        // an annotated slice gets a tone-coloured ring (the wrapper renders the note caption)
        borderColor: ann ? tone(ann.tone) : p.card,
        borderWidth: ann ? 3 : 2,
      },
    }
  })
  // centre label = the leading slice's share (gallery formatter: "28%\non latest")
  const lead = (props.data.donut ?? [])[0]
  const leadPct = lead ? `${lead.value}%` : displayValue.value
  const leadName = lead ? lead.name : props.data.label
  return {
    tooltip: { formatter: '{b}: {c}%' },
    series: [{
      type: 'pie',
      radius: ['56%', '82%'],
      center: ['50%', '52%'],
      avoidLabelOverlap: false,
      padAngle: 2,
      itemStyle: { borderRadius: 6 },
      label: {
        show: true,
        position: 'center',
        formatter: `${leadPct}\n{sub|${leadName}}`,
        rich: { sub: { fontFamily: FONT_MONO, fontSize: 11, color: p.ink3, lineHeight: 16 } },
        fontFamily: FONT_DISPLAY,
        fontWeight: 700,
        fontSize: 28,
        color: p.ink,
        lineHeight: 30,
      },
      labelLine: { show: false },
      data: slices,
    }],
  }
}

async function ensureChart() {
  if (!hasDonut.value || !donutEl.value) return
  if (!echarts) {
    echarts = (await import('echarts')) as unknown as typeof echarts
    registerInsightTheme(echarts!)
  }
  if (!chart) {
    chart = echarts!.init(donutEl.value, INSIGHT_THEME_NAME, { renderer: 'canvas' })
  }
  chart.setOption(buildDonutOption())
}

onMounted(async () => {
  await ensureChart()
  if (donutEl.value) {
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(donutEl.value)
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
  <div class="stat-widget">
    <div class="stat-headline">
      <div class="stat-value">{{ displayValue }}</div>
      <div class="stat-label">{{ data.label }}</div>
      <div v-if="deltaText" class="stat-delta" :style="{ color: deltaColor }">{{ deltaText }}</div>
    </div>

    <div v-if="hasDonut" class="stat-donut-wrap">
      <div ref="donutEl" class="stat-donut" />
      <ul v-if="data.donut" class="stat-legend">
        <li v-for="s in data.donut" :key="s.name" class="stat-legend-item">
          <span
            class="stat-swatch"
            :style="{ background: s.tone ? `rgba(${_toneRgb(s.tone)},0.9)` : 'var(--ink-faint)' }"
          />
          <span class="stat-legend-name">{{ s.name }}</span>
          <span class="stat-legend-val">{{ s.value }}%</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.stat-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;
  font-family: var(--font-mono);
}

/* ---- headline (big number + label + curvature delta) ---- */
.stat-headline {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-value {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 46px;
  line-height: 1.02;
  letter-spacing: -0.02em;
  color: var(--ink-primary);
  font-variant-numeric: tabular-nums;
}
.stat-label {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.stat-delta {
  font-family: var(--font-mono);
  font-size: 12.5px;
  margin-top: 2px;
}

/* ---- optional donut variant (build-sha spread) ---- */
.stat-donut-wrap {
  display: flex;
  align-items: center;
  gap: 20px;
}
.stat-donut {
  width: 200px;
  height: 200px;
  flex: 0 0 auto;
}
.stat-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.stat-legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-secondary);
}
.stat-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: 0 0 auto;
}
.stat-legend-name {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stat-legend-val {
  font-variant-numeric: tabular-nums;
  color: var(--ink-primary);
  font-weight: 600;
}

/* desktop-first; on a narrow admin pane the donut stacks above its legend */
@media (max-width: 640px) {
  .stat-donut-wrap { flex-direction: column; align-items: flex-start; }
  .stat-donut { width: 100%; max-width: 240px; }
}
</style>
