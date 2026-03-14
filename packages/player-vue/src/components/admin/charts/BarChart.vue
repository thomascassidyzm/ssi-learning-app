<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as d3 from 'd3'

interface Props {
  data: Array<Record<string, any>>
  xKey: string
  yKey: string
  color?: string
  height?: number
  formatX?: (val: any) => string
  formatY?: (val: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  color: 'var(--info, #3b82f6)',
  height: 250,
  formatX: (val: any) => String(val),
  formatY: (val: number) => String(val),
})

const containerRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltipVisible = ref(false)
const tooltipContent = ref('')
const tooltipStyle = ref<Record<string, string>>({})

const margin = { top: 24, right: 20, bottom: 48, left: 50 }
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

  const x = d3.scaleBand()
    .domain(props.data.map(d => String(d[props.xKey])))
    .range([0, innerWidth])
    .padding(0.3)

  const yMax = d3.max(props.data, d => +d[props.yKey]) ?? 0
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
  const rotateLabels = props.data.length > 8
  const xAxis = g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(x).tickFormat(d => props.formatX(d)))

  xAxis.selectAll('text')
    .attr('fill', 'var(--text-secondary, #999)')
    .attr('font-size', 'var(--text-xs, 0.75rem)')

  if (rotateLabels) {
    xAxis.selectAll('text')
      .attr('transform', 'rotate(-40)')
      .attr('text-anchor', 'end')
      .attr('dx', '-0.5em')
      .attr('dy', '0.25em')
  }

  xAxis.selectAll('line').attr('stroke', 'var(--border-subtle, #333)')
  xAxis.select('.domain').attr('stroke', 'var(--border-subtle, #333)')

  // Bars
  const barRadius = 3
  g.selectAll('.bar')
    .data(props.data)
    .join('path')
    .attr('class', 'bar')
    .attr('fill', props.color)
    .attr('opacity', 0.85)
    .attr('d', d => {
      const bx = x(String(d[props.xKey]))!
      const bw = x.bandwidth()
      const by = y(+d[props.yKey])
      const bh = innerHeight - by
      if (bh <= 0) return ''
      const r = Math.min(barRadius, bh / 2, bw / 2)
      return `M${bx},${by + r}
        Q${bx},${by} ${bx + r},${by}
        L${bx + bw - r},${by}
        Q${bx + bw},${by} ${bx + bw},${by + r}
        L${bx + bw},${innerHeight}
        L${bx},${innerHeight}Z`
    })
    .on('mouseenter', (event, d) => {
      d3.select(event.currentTarget).attr('opacity', 1)
      tooltipContent.value = `${props.formatX(d[props.xKey])}: ${props.formatY(+d[props.yKey])}`
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
      d3.select(event.currentTarget).attr('opacity', 0.85)
      tooltipVisible.value = false
    })

  // Value labels
  g.selectAll('.value-label')
    .data(props.data)
    .join('text')
    .attr('class', 'value-label')
    .attr('x', d => x(String(d[props.xKey]))! + x.bandwidth() / 2)
    .attr('y', d => y(+d[props.yKey]) - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-muted, #666)')
    .attr('font-size', 'var(--text-xs, 0.75rem)')
    .text(d => props.formatY(+d[props.yKey]))
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => render())
  if (containerRef.value) resizeObserver.observe(containerRef.value)
  render()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(() => [props.data, props.xKey, props.yKey, props.color, props.height], () => render(), { deep: true })
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
