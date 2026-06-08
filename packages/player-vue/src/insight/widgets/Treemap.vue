<script setup lang="ts">
// ============================================================================
// widgets/Treemap.vue
//
// Mirrors the Stat.vue reference structure EXACTLY:
//   · props { data: TreemapData, annotations?: Annotation[] }
//   · emits NOTHING — the wrapper owns all events
//   · renders ONLY the chart + annotation marks — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) -> option built from data + theme tokens
//   · ResizeObserver -> chart.resize()
//   · NO hardcoded hex — every colour comes from theme.ts (palette()/tone()/toneRgb())
//
// Ports the proven 'c-treemap' config from insight-examples.html near-verbatim,
// re-pointing colours to the Frostwell theme. No roam, no breadcrumb.
// Annotation: at:'datum' whose key matches a node id highlights that tile with a
// tone-coloured border (the note caption is rendered by the InsightWidget wrapper).
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { TreemapData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb,
  FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: TreemapData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts is lazy-loaded so it stays in the admin code-split chunk.
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = { setOption: (o: Record<string, unknown>) => void; resize: () => void; dispose: () => void }

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// ---- colour assignment ----
// A node with an explicit tone maps to that tone colour.
// A muted node maps to inkFaint (contaminated source — gallery: Croatian).
// Nodes without a tone spread across the Frostwell categorical ramp.
const RAMP = ['red', 'gold', 'blue', 'green', 'ink3', 'inkFaint'] as const
type RampKey = typeof RAMP[number]

function nodeColour(nodeIndex: number, t: string | undefined, muted: boolean | undefined, p: ReturnType<typeof palette>): string {
  if (muted) return p.inkFaint
  if (t === 'good') return p.green
  if (t === 'warn') return p.gold
  if (t === 'alarm') return p.red
  if (t === 'neutral') return p.ink2
  // no tone → use the ramp
  const key = RAMP[nodeIndex % RAMP.length] as RampKey
  return p[key]
}

// A datum annotation whose key matches a node id draws a tone-coloured border on that tile.
function annForNode(id: string): Annotation | undefined {
  return props.annotations.find(a => a.at === 'datum' && a.key === id)
}

function buildOption(): Record<string, unknown> {
  const p = palette()
  const nodes = props.data.nodes ?? []
  const unit = props.data.unit ?? ''

  const seriesData = nodes.map((node, i) => {
    const ann = annForNode(node.id)
    const baseColour = nodeColour(i, node.tone, node.muted, p)
    return {
      name: node.name,
      value: node.value,
      // carry the id so we can use it for annotation lookup (ECharts passes the raw data object in formatters)
      _id: node.id,
      itemStyle: {
        color: baseColour,
        // annotated tiles get a tone-coloured border ring; all others inherit the series-level paper2 default
        ...(ann ? { borderColor: tone(ann.tone), borderWidth: 4 } : {}),
      },
    }
  })

  return {
    tooltip: {
      formatter: (params: { name: string; value: number }) => {
        const v = params.value
        const display = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)
        return `${params.name}: ${display}${unit ? ' ' + unit : ''}`
      },
    },
    series: [{
      type: 'treemap',
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      width: '100%',
      height: '100%',
      top: 6,
      bottom: 6,
      left: 6,
      right: 6,
      // series-level itemStyle = gallery-faithful defaults for every tile (per-node overrides on top)
      itemStyle: {
        borderColor: p.paper2,
        borderWidth: 3,
        gapWidth: 3,
        borderRadius: 7,
      },
      label: {
        show: true,
        fontFamily: FONT_MONO,
        // white text on coloured tiles — matches the gallery exactly
        color: p.card,
        fontSize: 13,
        formatter: (params: { name: string; value: number }) => {
          const v = params.value
          const display = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)
          return `${params.name}\n${display}${unit ? unit : ''}`
        },
      },
      // level 0 = suppress the parent-label ECharts injects when you have nested data
      levels: [{ upperLabel: { show: false } }],
      data: seriesData,
    }],
  }
}

async function ensureChart() {
  if (!chartEl.value) return
  // empty data — still init but with an empty series so the container is stable
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

// Re-render when data or annotations change (host swaps data on drill).
watch(() => [props.data, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// exposed only so the template can call toneRgb for annotation swatches
const _toneRgb = toneRgb

// Narrowed list for the annotation caption list: only 'datum' annotations whose
// key matches a node id. Pre-computed (not inline-filtered in the template) so the
// SFC template type-checker never has to parse inline `as` casts.
type DatumAnnotation = Extract<Annotation, { at: 'datum' }>
const datumAnnotations = computed<DatumAnnotation[]>(() => {
  const ids = new Set((props.data.nodes ?? []).map(n => n.id))
  return props.annotations.filter(
    (a): a is DatumAnnotation => a.at === 'datum' && ids.has(a.key),
  )
})
</script>

<template>
  <div class="treemap-widget">
    <!-- Empty state: stable container with a muted caption so the host doesn't collapse -->
    <div v-if="!data.nodes || data.nodes.length === 0" class="treemap-empty">
      No data
    </div>

    <div v-else ref="chartEl" class="treemap-chart" />

    <!-- Annotation marks: one pill per datum annotation that matches a node id.
         The note caption is rendered here as a lightweight overlay; the InsightWidget
         wrapper owns the full chrome (story/why/actions).  A 'datum' annotation for a
         key that has no matching node is silently skipped. -->
    <ul v-if="datumAnnotations.length" class="treemap-ann-list">
      <li
        v-for="ann in datumAnnotations"
        :key="ann.key"
        class="treemap-ann"
      >
        <span
          class="treemap-ann-swatch"
          :style="{ background: `rgba(${_toneRgb(ann.tone)}, 0.9)` }"
        />
        <span class="treemap-ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.treemap-widget {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  font-family: var(--font-mono);
}

.treemap-chart {
  width: 100%;
  /* desktop-first height; scales down gracefully on narrow admin panes */
  height: 320px;
  flex: 0 0 auto;
}

.treemap-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink-faint);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* ---- annotation pill list ---- */
.treemap-ann-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.treemap-ann {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ink-secondary);
}

.treemap-ann-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex: 0 0 auto;
}

.treemap-ann-note {
  line-height: 1.4;
}

/* on a narrow admin pane the chart is still readable at reduced height */
@media (max-width: 640px) {
  .treemap-chart {
    height: 220px;
  }
}
</style>
