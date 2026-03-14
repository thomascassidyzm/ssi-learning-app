<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as d3 from 'd3'

interface Props {
  data: Array<Record<string, any>>
  xKey: string
  yKey: string
  color?: string
  height?: number
  showArea?: boolean
  formatX?: (val: any) => string
  formatY?: (val: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  color: 'var(--info, #3b82f6)',
  height: 250,
  showArea: true,
  formatX: (val: any) => String(val),
  formatY: (val: number) => String(val),
})

const containerRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltipVisible = ref(false)
const tooltipContent = ref('')
const tooltipStyle = ref<Record<string, string>>({})

const margin = { top: 20, right: 20, bottom: 40, left: 50 }
let resizeObserver: ResizeObserver | null = null

function parseDate(val: any): Date {
  if (val instanceof Date) return val
  return new Date(val)
}

function resolveColor(): string {
  if (!props.color.startsWith('var(')) return props.color
  const container = containerRef.value
  if (!container) return '#3b82f6'
  const match = props.color.match(/var\(([^,)]+)/)
  if (!match) return '#3b82f6'
  const resolved = getComputedStyle(container).getPropertyValue(match[1].trim())
  return resolved.trim() || '#3b82f6'
}

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

  const defs = svg.append('defs')
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const parsedData = props.data.map(d => ({
    ...d,
    _x: parseDate(d[props.xKey]),
    _y: +d[props.yKey],
  }))

  const x = d3.scaleTime()
    .domain(d3.extent(parsedData, d => d._x) as [Date, Date])
    .range([0, innerWidth])

  const yMax = d3.max(parsedData, d => d._y) ?? 0
  const y = d3.scaleLinear()
    .domain([0, yMax * 1.1 || 1])
    .nice()
    .range([innerHeight, 0])

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

  // Y-axis
  const yAxis = g.append('g')
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => props.formatY(d as number)))

  yAxis.selectAll('text').attr('fill', 'var(--text-secondary, #999)').attr('font-size', 'var(--text-xs, 0.75rem)')
  yAxis.selectAll('line').attr('stroke', 'var(--border-subtle, #333)')
  yAxis.select('.domain').attr('stroke', 'var(--border-subtle, #333)')

  // X-axis
  const xAxis = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d => props.formatX(d)))

  xAxis.selectAll('text').attr('fill', 'var(--text-secondary, #999)').attr('font-size', 'var(--text-xs, 0.75rem)')
  xAxis.selectAll('line').attr('stroke', 'var(--border-subtle, #333)')
  xAxis.select('.domain').attr('stroke', 'var(--border-subtle, #333)')

  const lineColor = resolveColor()

  // Area gradient
  if (props.showArea) {
    const gradientId = `area-gradient-${Math.random().toString(36).slice(2, 8)}`
    const gradient = defs.append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0').attr('y1', '0')
      .attr('x2', '0').attr('y2', '1')

    gradient.append('stop').attr('offset', '0%').attr('stop-color', lineColor).attr('stop-opacity', 0.3)
    gradient.append('stop').attr('offset', '100%').attr('stop-color', lineColor).attr('stop-opacity', 0)

    const area = d3.area<typeof parsedData[0]>()
      .x(d => x(d._x))
      .y0(innerHeight)
      .y1(d => y(d._y))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(parsedData)
      .attr('fill', `url(#${gradientId})`)
      .attr('d', area)
  }

  // Line
  const line = d3.line<typeof parsedData[0]>()
    .x(d => x(d._x))
    .y(d => y(d._y))
    .curve(d3.curveMonotoneX)

  g.append('path')
    .datum(parsedData)
    .attr('fill', 'none')
    .attr('stroke', lineColor)
    .attr('stroke-width', 2)
    .attr('d', line)

  // Hover elements
  const hoverLine = g.append('line')
    .attr('stroke', 'var(--text-muted, #666)')
    .attr('stroke-dasharray', '3,3')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('opacity', 0)

  const hoverCircle = g.append('circle')
    .attr('r', 4)
    .attr('fill', lineColor)
    .attr('stroke', 'var(--bg-elevated, #1a1a2e)')
    .attr('stroke-width', 2)
    .attr('opacity', 0)

  // Overlay for mouse tracking
  const bisect = d3.bisector<typeof parsedData[0], Date>(d => d._x).left

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .on('mouseenter', () => {
      hoverLine.attr('opacity', 1)
      hoverCircle.attr('opacity', 1)
      tooltipVisible.value = true
    })
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event)
      const x0 = x.invert(mx)
      const i = bisect(parsedData, x0, 1)
      const d0 = parsedData[i - 1]
      const d1 = parsedData[i]
      const d = d1 && (x0.getTime() - d0._x.getTime() > d1._x.getTime() - x0.getTime()) ? d1 : d0
      if (!d) return

      const px = x(d._x)
      const py = y(d._y)
      hoverLine.attr('x1', px).attr('x2', px)
      hoverCircle.attr('cx', px).attr('cy', py)

      tooltipContent.value = `${props.formatX(d[props.xKey])}: ${props.formatY(d._y)}`
      const rect = container.getBoundingClientRect()
      tooltipStyle.value = {
        left: `${event.clientX - rect.left + 12}px`,
        top: `${event.clientY - rect.top - 28}px`,
      }
    })
    .on('mouseleave', () => {
      hoverLine.attr('opacity', 0)
      hoverCircle.attr('opacity', 0)
      tooltipVisible.value = false
    })
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => render())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  render()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(() => [props.data, props.xKey, props.yKey, props.color, props.height, props.showArea], () => render(), { deep: true })
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
