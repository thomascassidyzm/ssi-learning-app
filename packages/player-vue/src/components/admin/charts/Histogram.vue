<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as d3 from 'd3'

interface BeltRegion {
  start: number
  end: number
  color: string
  name: string
}

interface Props {
  data: Array<Record<string, any>>
  xKey: string
  yKey: string
  height?: number
  beltRegions?: BeltRegion[]
  overlayData?: Array<Record<string, any>>
  overlayKey?: string
}

const defaultBeltRegions: BeltRegion[] = [
  { start: 0, end: 7, color: '#ffffff', name: 'White' },
  { start: 8, end: 19, color: '#ffd700', name: 'Yellow' },
  { start: 20, end: 39, color: '#ff8c00', name: 'Orange' },
  { start: 40, end: 79, color: '#22c55e', name: 'Green' },
  { start: 80, end: 149, color: '#3b82f6', name: 'Blue' },
  { start: 150, end: 279, color: '#8b5cf6', name: 'Purple' },
  { start: 280, end: 399, color: '#92400e', name: 'Brown' },
  { start: 400, end: 999, color: '#1a1a2e', name: 'Black' },
]

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  beltRegions: () => defaultBeltRegions,
})

const containerRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltipVisible = ref(false)
const tooltipContent = ref('')
const tooltipStyle = ref<Record<string, string>>({})

const margin = { top: 20, right: 50, bottom: 52, left: 50 }
let resizeObserver: ResizeObserver | null = null

function render() {
  const svg = d3.select(svgRef.value!)
  const container = containerRef.value!
  if (!container || !props.data?.length) {
    svg.selectAll('*').remove()
    return
  }

  const width = container.clientWidth
  const innerWidth = width - margin.left - margin.right
  const innerHeight = props.height - margin.top - margin.bottom

  svg.attr('width', width).attr('height', props.height)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const xExtent = d3.extent(props.data, d => +d[props.xKey]) as [number, number]
  const x = d3.scaleLinear()
    .domain([xExtent[0] - 0.5, xExtent[1] + 0.5])
    .range([0, innerWidth])

  const yMax = d3.max(props.data, d => +d[props.yKey]) ?? 0
  const y = d3.scaleLinear()
    .domain([0, yMax * 1.1 || 1])
    .nice()
    .range([innerHeight, 0])

  // Belt region backgrounds
  const regions = props.beltRegions.filter(r => r.start <= xExtent[1] && r.end >= xExtent[0])
  regions.forEach(region => {
    const rx1 = Math.max(x(region.start - 0.5), 0)
    const rx2 = Math.min(x(region.end + 0.5), innerWidth)
    if (rx2 <= rx1) return

    g.append('rect')
      .attr('x', rx1)
      .attr('y', 0)
      .attr('width', rx2 - rx1)
      .attr('height', innerHeight)
      .attr('fill', region.color)
      .attr('opacity', 0.08)

    // Belt name label
    const labelX = rx1 + (rx2 - rx1) / 2
    g.append('text')
      .attr('x', labelX)
      .attr('y', innerHeight + 36)
      .attr('text-anchor', 'middle')
      .attr('fill', region.color === '#ffffff' ? 'var(--text-muted, #666)' : region.color)
      .attr('font-size', 'var(--text-xs, 0.75rem)')
      .attr('font-weight', 'var(--font-medium, 500)')
      .attr('opacity', 0.7)
      .text(region.name)
  })

  // Gridlines
  g.append('g')
    .attr('class', 'grid')
    .call(
      d3.axisLeft(y)
        .tickSize(-innerWidth)
        .tickFormat(() => '')
    )
    .selectAll('line')
    .attr('stroke', 'var(--border-subtle, #333)')
    .attr('stroke-dasharray', '3,3')
    .attr('opacity', 0.5)

  g.select('.grid .domain').remove()

  // Y-axis (left)
  const yAxis = g.append('g')
    .call(d3.axisLeft(y).ticks(5))

  yAxis.selectAll('text').attr('fill', 'var(--text-secondary, #999)').attr('font-size', 'var(--text-xs, 0.75rem)')
  yAxis.selectAll('line').attr('stroke', 'var(--border-subtle, #333)')
  yAxis.select('.domain').attr('stroke', 'var(--border-subtle, #333)')

  // X-axis
  const xAxis = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(10).tickFormat(d3.format('d')))

  xAxis.selectAll('text').attr('fill', 'var(--text-secondary, #999)').attr('font-size', 'var(--text-xs, 0.75rem)')
  xAxis.selectAll('line').attr('stroke', 'var(--border-subtle, #333)')
  xAxis.select('.domain').attr('stroke', 'var(--border-subtle, #333)')

  // Bars
  const barWidth = Math.max(1, innerWidth / (xExtent[1] - xExtent[0] + 1) * 0.7)
  g.selectAll('.bar')
    .data(props.data)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', d => x(+d[props.xKey]) - barWidth / 2)
    .attr('y', d => y(+d[props.yKey]))
    .attr('width', barWidth)
    .attr('height', d => Math.max(0, innerHeight - y(+d[props.yKey])))
    .attr('fill', 'var(--ssi-red, #ef4444)')
    .attr('opacity', 0.7)
    .attr('rx', 1)
    .on('mouseenter', (event, d) => {
      d3.select(event.currentTarget).attr('opacity', 1)
      let text = `Seed ${d[props.xKey]}: ${d[props.yKey]}`
      if (props.overlayData && props.overlayKey) {
        const overlay = props.overlayData.find(o => +o[props.xKey] === +d[props.xKey])
        if (overlay) text += ` | Rate: ${overlay[props.overlayKey]}`
      }
      tooltipContent.value = text
      tooltipVisible.value = true
    })
    .on('mousemove', (event) => {
      const rect = container.getBoundingClientRect()
      tooltipStyle.value = {
        left: `${event.clientX - rect.left + 12}px`,
        top: `${event.clientY - rect.top - 28}px`,
      }
    })
    .on('mouseleave', (event) => {
      d3.select(event.currentTarget).attr('opacity', 0.7)
      tooltipVisible.value = false
    })

  // Overlay line (spike_rate)
  if (props.overlayData?.length && props.overlayKey) {
    const y2Max = d3.max(props.overlayData, d => +d[props.overlayKey!]) ?? 0
    const y2 = d3.scaleLinear()
      .domain([0, y2Max * 1.1 || 1])
      .nice()
      .range([innerHeight, 0])

    // Right y-axis
    const y2Axis = g.append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(d3.axisRight(y2).ticks(5))

    y2Axis.selectAll('text').attr('fill', 'var(--ssi-gold, #d4a853)').attr('font-size', 'var(--text-xs, 0.75rem)')
    y2Axis.selectAll('line').attr('stroke', 'var(--border-subtle, #333)')
    y2Axis.select('.domain').attr('stroke', 'var(--border-subtle, #333)')

    const line = d3.line<Record<string, any>>()
      .x(d => x(+d[props.xKey]))
      .y(d => y2(+d[props.overlayKey!]))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(props.overlayData)
      .attr('fill', 'none')
      .attr('stroke', 'var(--ssi-gold, #d4a853)')
      .attr('stroke-width', 2)
      .attr('d', line)
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => render())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  render()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(
  () => [props.data, props.xKey, props.yKey, props.height, props.beltRegions, props.overlayData, props.overlayKey],
  () => render(),
  { deep: true }
)
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
