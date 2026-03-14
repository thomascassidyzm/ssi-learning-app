<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import * as d3 from 'd3'

interface Props {
  data: Array<Record<string, any>>
  labelKey: string
  valueKey: string
  color?: string
  height?: number
  formatLabel?: (val: string) => string
  formatValue?: (val: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  color: 'var(--info, #3b82f6)',
  height: 32,
  formatLabel: (val: string) => val,
  formatValue: (val: number) => String(val),
})

const containerRef = ref<HTMLDivElement>()
const svgRef = ref<SVGSVGElement>()
const tooltipVisible = ref(false)
const tooltipContent = ref('')
const tooltipStyle = ref<Record<string, string>>({})

const margin = { top: 8, right: 60, bottom: 8, left: 120 }

const sortedData = computed(() =>
  [...(props.data || [])].sort((a, b) => +b[props.valueKey] - +a[props.valueKey])
)

const totalHeight = computed(() => {
  const rows = sortedData.value.length || 1
  return rows * props.height + margin.top + margin.bottom
})

let resizeObserver: ResizeObserver | null = null

function render() {
  const svg = d3.select(svgRef.value!)
  const container = containerRef.value!
  if (!container || !sortedData.value.length) {
    svg.selectAll('*').remove()
    return
  }

  const width = container.clientWidth
  const innerWidth = width - margin.left - margin.right
  const innerHeight = totalHeight.value - margin.top - margin.bottom

  svg.attr('width', width).attr('height', totalHeight.value)
  svg.selectAll('*').remove()

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

  const x = d3.scaleLinear()
    .domain([0, d3.max(sortedData.value, d => +d[props.valueKey]) ?? 1])
    .range([0, innerWidth])

  const y = d3.scaleBand()
    .domain(sortedData.value.map(d => String(d[props.labelKey])))
    .range([0, innerHeight])
    .padding(0.25)

  // Rows
  const rows = g.selectAll('.row')
    .data(sortedData.value)
    .join('g')
    .attr('class', 'row')
    .attr('transform', d => `translate(0,${y(String(d[props.labelKey]))})`)

  // Row background (for hover)
  rows.append('rect')
    .attr('x', -margin.left)
    .attr('width', width)
    .attr('height', y.bandwidth())
    .attr('fill', 'transparent')
    .attr('class', 'row-bg')

  // Bar
  const barRadius = 3
  rows.append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', d => Math.max(0, x(+d[props.valueKey])))
    .attr('height', y.bandwidth())
    .attr('fill', props.color)
    .attr('opacity', 0.85)
    .attr('rx', barRadius)
    .attr('ry', barRadius)

  // Labels
  rows.append('text')
    .attr('x', -8)
    .attr('y', y.bandwidth() / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'central')
    .attr('fill', 'var(--text-secondary, #999)')
    .attr('font-size', 'var(--text-xs, 0.75rem)')
    .text(d => props.formatLabel(String(d[props.labelKey])))

  // Values
  rows.append('text')
    .attr('x', d => x(+d[props.valueKey]) + 8)
    .attr('y', y.bandwidth() / 2)
    .attr('dominant-baseline', 'central')
    .attr('fill', 'var(--text-muted, #666)')
    .attr('font-size', 'var(--text-xs, 0.75rem)')
    .attr('font-weight', 'var(--font-semibold, 600)')
    .text(d => props.formatValue(+d[props.valueKey]))

  // Hover
  rows
    .on('mouseenter', function () {
      d3.select(this).select('.row-bg').attr('fill', 'var(--bg-secondary, rgba(255,255,255,0.03))')
      d3.select(this).select('rect:nth-child(2)').attr('opacity', 1)
    })
    .on('mouseleave', function () {
      d3.select(this).select('.row-bg').attr('fill', 'transparent')
      d3.select(this).select('rect:nth-child(2)').attr('opacity', 0.85)
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

watch(() => [props.data, props.labelKey, props.valueKey, props.color, props.height], () => render(), { deep: true })
</script>

<template>
  <div ref="containerRef" class="chart-container">
    <svg ref="svgRef"></svg>
    <div v-if="!data?.length" class="chart-empty">No data available</div>
  </div>
</template>

<style scoped>
.chart-container {
  position: relative;
  width: 100%;
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
