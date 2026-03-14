<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as d3 from 'd3'

interface HeatmapDatum {
  row: string
  col: string
  value: number
}

interface Props {
  data: HeatmapDatum[]
  rowLabels: string[]
  colLabels: string[]
  colorScale?: [string, string, string]
  height?: number
  formatValue?: (val: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  colorScale: () => ['#ef4444', '#fbbf24', '#4ade80'],
  height: 36,
  formatValue: (val: number) => `${val}%`,
})

const containerRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltipVisible = ref(false)
const tooltipContent = ref('')
const tooltipStyle = ref<Record<string, string>>({})

const margin = { top: 32, right: 8, bottom: 8, left: 100 }
let resizeObserver: ResizeObserver | null = null

const totalHeight = computed(() => {
  return props.rowLabels.length * props.height + margin.top + margin.bottom
})

function render() {
  const svg = d3.select(svgRef.value!)
  const container = containerRef.value!
  if (!container || !props.data?.length) {
    svg.selectAll('*').remove()
    return
  }

  const width = container.clientWidth
  const innerWidth = width - margin.left - margin.right
  const innerHeight = totalHeight.value - margin.top - margin.bottom

  svg.attr('width', width).attr('height', totalHeight.value)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const cellWidth = innerWidth / props.colLabels.length
  const cellHeight = props.height

  // Build lookup
  const valueMap = new Map<string, number>()
  for (const d of props.data) {
    valueMap.set(`${d.row}__${d.col}`, d.value)
  }

  // Color scale
  const color = d3.scaleLinear<string>()
    .domain([0, 50, 100])
    .range(props.colorScale)
    .clamp(true)

  // Column headers
  g.selectAll('.col-label')
    .data(props.colLabels)
    .join('text')
    .attr('class', 'col-label')
    .attr('x', (_, i) => i * cellWidth + cellWidth / 2)
    .attr('y', -10)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-secondary, #999)')
    .attr('font-size', 'var(--text-xs, 0.75rem)')
    .text(d => d)

  // Row labels
  g.selectAll('.row-label')
    .data(props.rowLabels)
    .join('text')
    .attr('class', 'row-label')
    .attr('x', -8)
    .attr('y', (_, i) => i * cellHeight + cellHeight / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'central')
    .attr('fill', 'var(--text-secondary, #999)')
    .attr('font-size', 'var(--text-xs, 0.75rem)')
    .text(d => d)

  // Cells
  const cells: Array<{ row: string; col: string; ri: number; ci: number; value: number | undefined }> = []
  props.rowLabels.forEach((row, ri) => {
    props.colLabels.forEach((col, ci) => {
      cells.push({ row, col, ri, ci, value: valueMap.get(`${row}__${col}`) })
    })
  })

  g.selectAll('.cell')
    .data(cells)
    .join('rect')
    .attr('class', 'cell')
    .attr('x', d => d.ci * cellWidth + 1)
    .attr('y', d => d.ri * cellHeight + 1)
    .attr('width', cellWidth - 2)
    .attr('height', cellHeight - 2)
    .attr('rx', 'var(--radius-sm, 4)')
    .attr('fill', d => d.value != null ? color(d.value) : 'var(--bg-secondary, #222)')
    .attr('opacity', 0.85)
    .on('mouseenter', (event, d) => {
      d3.select(event.currentTarget).attr('opacity', 1).attr('stroke', 'var(--text-primary, #fff)').attr('stroke-width', 1.5)
      if (d.value != null) {
        tooltipContent.value = `${d.row} / ${d.col}: ${props.formatValue(d.value)}`
        tooltipVisible.value = true
      }
    })
    .on('mousemove', (event) => {
      const rect = container.getBoundingClientRect()
      tooltipStyle.value = {
        left: `${event.clientX - rect.left + 12}px`,
        top: `${event.clientY - rect.top - 28}px`,
      }
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).attr('opacity', 0.85).attr('stroke', 'none')
      tooltipVisible.value = false
    })

  // Cell value text
  g.selectAll('.cell-text')
    .data(cells.filter(d => d.value != null))
    .join('text')
    .attr('class', 'cell-text')
    .attr('x', d => d.ci * cellWidth + cellWidth / 2)
    .attr('y', d => d.ri * cellHeight + cellHeight / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', d => {
      // Dark text on light cells, light text on dark cells
      return d.value! > 60 ? '#1a1a2e' : '#fff'
    })
    .attr('font-size', 'var(--text-xs, 0.75rem)')
    .attr('font-weight', 'var(--font-semibold, 600)')
    .attr('pointer-events', 'none')
    .text(d => props.formatValue(d.value!))
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => render())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  render()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(() => [props.data, props.rowLabels, props.colLabels, props.colorScale, props.height], () => render(), { deep: true })
</script>

<template>
  <div ref="containerRef" class="chart-container">
    <svg ref="svgRef"></svg>
    <div v-if="tooltipVisible" class="chart-tooltip" :style="tooltipStyle">
      {{ tooltipContent }}
    </div>
    <div v-if="!data?.length" class="chart-empty">No data available</div>
  </div>
</template>

<style scoped>
.chart-container {
  position: relative;
  width: 100%;
}
.chart-tooltip {
  position: absolute;
  pointer-events: none;
  background: var(--bg-elevated, #1a1a2e);
  color: var(--text-primary, #fff);
  padding: var(--space-1, 4px) var(--space-2, 8px);
  border-radius: var(--radius-sm, 4px);
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--font-medium, 500);
  border: 1px solid var(--border-subtle, #333);
  white-space: nowrap;
  z-index: 10;
}
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-muted, #666);
  font-size: var(--text-sm, 0.875rem);
}
</style>
