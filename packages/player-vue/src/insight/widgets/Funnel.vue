<script setup lang="ts">
// ============================================================================
// widgets/Funnel.vue — Descending funnel; annotated leak stage highlighted red.
//
// Contract mirrors Stat.vue exactly:
//   · props { data: FunnelData, spec: InsightSpec }   — data already narrowed to 'funnel'
//   · emits NOTHING                                    — the wrapper owns all events
//   · renders ONLY the chart + annotation marks        — the wrapper owns story/why/actions chrome
//   · lazy-imports echarts in onMounted (stays in the admin chunk)
//   · registerInsightTheme(echarts) -> option built from data + theme tokens
//   · ResizeObserver -> chart.resize()
//   · NO hardcoded hex — every colour from theme.ts (palette()/tone()/toneRgb())
//
// Annotation support:
//   · at === 'stage' and ann.stage === stage.id  → that segment gets a tone-coloured
//     border ring + the note is overlaid as a label suffix below the label row.
//   · all other at-shapes are silently ignored (spec: degrade, never throw).
// ============================================================================
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import type { FunnelData, Annotation, InsightSpec } from '../spec'
import {
  registerInsightTheme, INSIGHT_THEME_NAME, palette, tone, toneRgb, FONT_MONO,
  type EChartsLike,
} from '../theme'

const props = withDefaults(defineProps<{
  data: FunnelData
  spec: InsightSpec
  annotations?: Annotation[]
}>(), {
  annotations: () => [],
})

// ---- lazy ECharts (admin chunk only) ----
let echarts: (EChartsLike & {
  init: (el: HTMLElement, theme?: string | null, opts?: Record<string, unknown>) => EChartInstance
}) | null = null
type EChartInstance = { setOption: (o: Record<string, unknown>) => void; resize: () => void; dispose: () => void }

const chartEl = ref<HTMLDivElement | null>(null)
let chart: EChartInstance | null = null
let resizeObserver: ResizeObserver | null = null

// ---- annotation helpers ----
// Find a 'stage' annotation for a given stage id. Silently ignores non-stage shapes.
function annForStage(stageId: string): (Annotation & { at: 'stage' }) | undefined {
  const found = (props.spec.annotate ?? props.annotations).find(
    (a): a is Annotation & { at: 'stage' } => a.at === 'stage' && a.stage === stageId,
  )
  return found
}

// ---- ECharts option builder (c-funnel ported from gallery, colours from theme) ----
function buildOption(): Record<string, unknown> {
  const p = palette()

  // Graceful zero: if all values are zero, render them as equal-sized segments so the
  // funnel still paints a visible shape rather than collapsing.
  const stages = props.data.stages
  const allZero = stages.length === 0 || stages.every(s => s.value === 0)

  // The gallery assigns colours top-down by index (blue/blue-shade/red/blue-shade/green).
  // We derive the same ramp from theme tokens so no hex leaks into the widget.
  const ramp: string[] = [p.blue, p.blue, p.red, p.blue, p.green]

  const data = stages.map((s, i) => {
    const ann = annForStage(s.id)
    // An annotated stage takes its tone colour; otherwise we cycle through the ramp.
    // Tone overrides come before a fallback to the stage's own tone field.
    const baseColour = ann ? tone(ann.tone) : (s.tone ? tone(s.tone) : (ramp[i % ramp.length] ?? p.blue))

    // Solid fill derived from the semantic base colour.  The gallery uses within-hue
    // gradients (gradV(blue,"#4a90d9")) but those require per-segment hex literals we
    // cannot use here.  A flat fill is the cleanest token-safe approximation.
    // allZero -> p.inkFaint so all-zero stages render as equal muted bands.
    const gradFill = allZero ? p.inkFaint : baseColour

    // Border highlight for annotated stages.
    const itemStyle: Record<string, unknown> = {
      color: gradFill,
      borderColor: ann ? tone(ann.tone) : p.card,
      borderWidth: ann ? 3 : 2,
    }

    // Label: for annotated stages, append a small note suffix.
    // We use a rich-text formatter so the note sits on a second line inside the segment.
    const labelFormatter = ann
      ? `{name|${s.label}  ${allZero ? 0 : s.value}}\n{note|${ann.note}}`
      : `${s.label}  ${allZero ? 0 : s.value}`

    return {
      value: allZero ? 1 : s.value,   // non-zero so ECharts paints equal bands on all-zero input
      name: s.label,
      itemStyle,
      label: {
        formatter: labelFormatter,
        rich: {
          name: {
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: p.card,
            lineHeight: 16,
          },
          note: {
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: ann ? tone(ann.tone) : p.card,
            lineHeight: 14,
            padding: [0, 0, 0, 0],
          },
        },
      },
    }
  })

  return {
    tooltip: {
      formatter: (params: { name: string; value: number | string }) => {
        if (allZero) return `${params.name}: —`
        return `${params.name}: ${params.value}`
      },
    },
    series: [{
      type: 'funnel',
      left: '6%',
      right: '6%',
      top: 10,
      bottom: 14,
      minSize: '30%',
      maxSize: '100%',
      sort: 'descending',
      gap: 3,
      label: {
        position: 'inside',
        color: p.card,
        fontFamily: FONT_MONO,
        fontSize: 12,
        formatter: '{b}  {c}',
      },
      itemStyle: {
        borderColor: p.card,
        borderWidth: 2,
      },
      data,
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

// Re-render on data or annotation change (host swaps data in place on drill).
watch(() => [props.data, props.spec, props.annotations], () => { ensureChart() }, { deep: true })

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart?.dispose()
  chart = null
})

// Expose toneRgb for template annotation badge styling (mirrors Stat.vue convention).
const _toneRgb = toneRgb
</script>

<template>
  <div class="funnel-widget">
    <!-- The ECharts canvas -->
    <div ref="chartEl" class="funnel-chart" />

    <!-- Annotation badges: rendered below the chart as labelled callouts for each annotated stage.
         The wrapper owns the full story/why/actions chrome; these are purely chart-level marks. -->
    <ul
      v-if="(spec.annotate ?? annotations).some(a => a.at === 'stage')"
      class="funnel-annotations"
    >
      <li
        v-for="ann in (spec.annotate ?? annotations).filter((a): a is typeof a & { at: 'stage' } => a.at === 'stage')"
        :key="ann.stage"
        class="funnel-ann-item"
        :style="{ borderColor: `rgba(${_toneRgb(ann.tone)}, 0.35)`, background: `rgba(${_toneRgb(ann.tone)}, 0.07)` }"
      >
        <span
          class="funnel-ann-dot"
          :style="{ background: `rgba(${_toneRgb(ann.tone)}, 0.9)` }"
        />
        <span class="funnel-ann-stage">{{ ann.stage }}</span>
        <span class="funnel-ann-note">{{ ann.note }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.funnel-widget {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  font-family: var(--font-mono);
}

.funnel-chart {
  width: 100%;
  height: 300px;
}

/* ---- annotation badge strip ---- */
.funnel-annotations {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.funnel-ann-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 12px;
  line-height: 1.4;
}

.funnel-ann-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  position: relative;
  top: 1px;
}

.funnel-ann-stage {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-secondary);
  flex: 0 0 auto;
}

.funnel-ann-note {
  font-size: 12.5px;
  color: var(--ink-primary);
  flex: 1 1 auto;
}

/* desktop-first; on a narrow pane the chart fills full width */
@media (max-width: 640px) {
  .funnel-chart {
    height: 260px;
  }
}
</style>
