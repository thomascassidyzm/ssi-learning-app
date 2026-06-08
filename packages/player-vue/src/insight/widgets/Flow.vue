<script setup lang="ts">
// ============================================================================
// widgets/Flow.vue — Sankey course-flow graph
//
// Mirrors the Stat.vue template exactly:
//   · props { data: FlowData, annotations: Annotation[] }  — data already narrowed by kind
//   · emits NOTHING                                          — the wrapper owns all events
//   · renders ONLY the chart + annotation marks             — the wrapper owns all chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) -> builds option from data + theme tokens
//   · ResizeObserver -> chart.resize() (mirrors components/admin/charts/*.vue)
//   · NO hardcoded hex — every colour comes from theme.ts (palette()/tone())
//
// Ports c-sankey from public/docs/insight-examples.html near-verbatim,
// re-pointing all colours to the theme (no hex literals).
// Sankey: gradient links, adjacency-focus emphasis, node annotations.
// ============================================================================
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type { FlowData, Annotation } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: FlowData
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ECharts lazy-loaded so it stays in the admin code-split chunk, never the learner bundle.
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = { setOption: (o: Record<string, unknown>) => void; resize: () => void; dispose: () => void }

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// Tone -> colour for node tones. Annotated nodes get a tone-coloured border ring.
// Non-toned nodes cycle through the theme's default categorical colour ramp.
// The Sankey ECharts series requires per-node itemStyle; we build that here.
function nodeColor(p: ReturnType<typeof palette>, index: number, nodeTone?: string): string {
  if (nodeTone) {
    switch (nodeTone) {
      case 'good':    return p.green
      case 'warn':    return p.gold
      case 'alarm':   return p.red
      case 'neutral':
      default:        return p.blue
    }
  }
  // cycle the Frostwell categorical ramp for uncolored nodes (matches the theme.ts color array order)
  const ramp = [p.red, p.gold, p.blue, p.green, p.ink3, p.inkFaint, p.ink2, p.inkFaint]
  return ramp[index % ramp.length]
}

// Find annotation for a node (at: 'node', node === id).
function annForNode(nodeId: string): Annotation | undefined {
  return props.annotations.find(a => a.at === 'node' && a.node === nodeId)
}

function buildOption(): Record<string, unknown> {
  const p = palette()

  // Map node id -> index for colour cycling.
  const nodeIndexMap = new Map<string, number>()
  props.data.nodes.forEach((n, i) => nodeIndexMap.set(n.id, i))

  const sankeyNodes = props.data.nodes.map(n => {
    const ann = annForNode(n.id)
    const col = nodeColor(p, nodeIndexMap.get(n.id) ?? 0, n.tone ?? undefined)
    return {
      name: n.label,
      itemStyle: {
        color: col,
        borderWidth: ann ? 3 : 0,
        borderColor: ann ? tone(ann.tone) : col,
      },
    }
  })

  // Links: resolve source/target from id -> label (ECharts Sankey uses node names, not ids).
  const idToLabel = new Map<string, string>()
  props.data.nodes.forEach(n => idToLabel.set(n.id, n.label))

  const sankeyLinks = props.data.links.map(l => ({
    source: idToLabel.get(l.source) ?? l.source,
    target: idToLabel.get(l.target) ?? l.target,
    value: l.value,
  }))

  return {
    tooltip: {
      trigger: 'item',
      triggerOn: 'mousemove',
    },
    series: [{
      type: 'sankey',
      left: 8,
      right: 90,
      top: 10,
      bottom: 10,
      nodeGap: 13,
      nodeWidth: 14,
      emphasis: { focus: 'adjacency' },
      label: {
        fontFamily: FONT_MONO,
        fontSize: 12,
        color: p.ink,
      },
      lineStyle: {
        color: 'gradient',
        opacity: 0.4,
        curveness: 0.5,
      },
      itemStyle: {
        borderWidth: 0,
      },
      data: sankeyNodes,
      links: sankeyLinks,
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

// Has any data to render?
const isEmpty = computed(() =>
  props.data.nodes.length === 0 || props.data.links.length === 0,
)
</script>

<template>
  <div class="flow-widget">
    <div v-if="isEmpty" class="flow-empty">
      No flow data in this window yet.
    </div>
    <div v-else ref="chartEl" class="flow-chart" />
  </div>
</template>

<style scoped>
.flow-widget {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.flow-chart {
  width: 100%;
  height: 340px;
  min-height: 220px;
}

.flow-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 220px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-muted);
}

/* Desktop-first: on very narrow admin panes give the Sankey a bit more height */
@media (max-width: 640px) {
  .flow-chart {
    height: 260px;
  }
}
</style>
