<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'

const props = defineProps({
  // Stats data - would come from database in production
  totalMinutes: {
    type: Number,
    default: 0
  },
  totalWordsIntroduced: {
    type: Number,
    default: 0
  },
  totalPhrasesSpoken: {
    type: Number,
    default: 0
  },
  // Chart data arrays
  dailyData: {
    type: Array,
    default: () => []
    // Shape: [{ date: Date, minutes: number }, ...]
  },
  weeklyData: {
    type: Array,
    default: () => []
    // Shape: [{ week: string, minutes: number }, ...]
  },
  monthlyData: {
    type: Array,
    default: () => []
    // Shape: [{ month: string, minutes: number }, ...]
  },
  // When used as a tab inside BrainView, hides header and adjusts positioning
  embedded: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

// Format total time as hours and minutes
const formattedTotalTime = computed(() => {
  const hours = Math.floor(props.totalMinutes / 60)
  const mins = props.totalMinutes % 60
  if (hours === 0) {
    return `${mins}m`
  }
  return `${hours}h ${mins}m`
})

// Chart refs
const dailyChartRef = ref(null)
const weeklyChartRef = ref(null)
const monthlyChartRef = ref(null)

// Generate demo data if none provided
const getDemoData = () => {
  const now = new Date()

  // Daily data - last 14 days
  const daily = []
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now)
    date.setDate(date.getDate() - i)
    daily.push({
      date: date,
      minutes: Math.floor(Math.random() * 45) + 5
    })
  }

  // Weekly data - last 8 weeks
  const weekly = []
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - (i * 7))
    weekly.push({
      week: `W${8 - i}`,
      minutes: Math.floor(Math.random() * 180) + 30
    })
  }

  // Monthly data - last 6 months
  const monthly = []
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  for (let i = 5; i >= 0; i--) {
    const month = new Date(now)
    month.setMonth(month.getMonth() - i)
    monthly.push({
      month: monthNames[month.getMonth()],
      minutes: Math.floor(Math.random() * 600) + 100
    })
  }

  return { daily, weekly, monthly }
}

// Use provided data or demo data
const chartData = computed(() => {
  if (props.dailyData.length > 0) {
    return {
      daily: props.dailyData,
      weekly: props.weeklyData,
      monthly: props.monthlyData
    }
  }
  return getDemoData()
})

// Draw a line chart
const drawLineChart = (container, data, xAccessor, yAccessor, xLabel) => {
  if (!container) return

  // Clear previous
  d3.select(container).selectAll('*').remove()

  const rect = container.getBoundingClientRect()
  const margin = { top: 20, right: 20, bottom: 40, left: 50 }
  const width = rect.width - margin.left - margin.right
  const height = rect.height - margin.top - margin.bottom

  if (width <= 0 || height <= 0) return

  const svg = d3.select(container)
    .append('svg')
    .attr('width', rect.width)
    .attr('height', rect.height)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)

  // Scales
  const xScale = d3.scalePoint()
    .domain(data.map(xAccessor))
    .range([0, width])
    .padding(0.5)

  const yMax = d3.max(data, yAccessor) || 60
  const yScale = d3.scaleLinear()
    .domain([0, yMax * 1.1])
    .range([height, 0])

  // Grid lines
  svg.append('g')
    .attr('class', 'grid')
    .selectAll('line')
    .data(yScale.ticks(5))
    .join('line')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', d => yScale(d))
    .attr('y2', d => yScale(d))
    .attr('stroke', 'rgba(255, 255, 255, 0.05)')
    .attr('stroke-dasharray', '2,2')

  // Area gradient
  const areaGradient = svg.append('defs')
    .append('linearGradient')
    .attr('id', `areaGradient-${xLabel}`)
    .attr('x1', '0%')
    .attr('y1', '0%')
    .attr('x2', '0%')
    .attr('y2', '100%')

  areaGradient.append('stop')
    .attr('offset', '0%')
    .attr('stop-color', 'var(--accent)')
    .attr('stop-opacity', 0.3)

  areaGradient.append('stop')
    .attr('offset', '100%')
    .attr('stop-color', 'var(--accent)')
    .attr('stop-opacity', 0)

  // Area
  const area = d3.area()
    .x(d => xScale(xAccessor(d)))
    .y0(height)
    .y1(d => yScale(yAccessor(d)))
    .curve(d3.curveMonotoneX)

  svg.append('path')
    .datum(data)
    .attr('fill', `url(#areaGradient-${xLabel})`)
    .attr('d', area)

  // Line
  const line = d3.line()
    .x(d => xScale(xAccessor(d)))
    .y(d => yScale(yAccessor(d)))
    .curve(d3.curveMonotoneX)

  svg.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', 'var(--accent)')
    .attr('stroke-width', 2)
    .attr('d', line)

  // Dots
  svg.selectAll('.dot')
    .data(data)
    .join('circle')
    .attr('class', 'dot')
    .attr('cx', d => xScale(xAccessor(d)))
    .attr('cy', d => yScale(yAccessor(d)))
    .attr('r', 4)
    .attr('fill', 'var(--bg-primary)')
    .attr('stroke', 'var(--accent)')
    .attr('stroke-width', 2)

  // X axis
  svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(xScale).tickSize(0))
    .call(g => g.select('.domain').remove())
    .selectAll('text')
    .attr('fill', 'var(--text-muted)')
    .attr('font-size', '10px')
    .attr('dy', '1em')

  // Y axis
  svg.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickSize(0))
    .call(g => g.select('.domain').remove())
    .selectAll('text')
    .attr('fill', 'var(--text-muted)')
    .attr('font-size', '10px')

  // Y axis label
  svg.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('y', -40)
    .attr('x', -height / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--text-muted)')
    .attr('font-size', '11px')
    .text('Minutes')
}

// Draw all charts
const drawCharts = () => {
  nextTick(() => {
    const data = chartData.value

    // Daily chart
    if (dailyChartRef.value && data.daily.length > 0) {
      drawLineChart(
        dailyChartRef.value,
        data.daily,
        d => {
          if (d.date instanceof Date) {
            // Use day number + first letter of weekday (e.g., "15M", "16T")
            const day = d.date.getDate()
            const weekdayLetter = d.date.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0)
            return `${day}${weekdayLetter}`
          }
          return d.date
        },
        d => d.minutes,
        'daily'
      )
    }

    // Weekly chart
    if (weeklyChartRef.value && data.weekly.length > 0) {
      drawLineChart(
        weeklyChartRef.value,
        data.weekly,
        d => d.week,
        d => d.minutes,
        'weekly'
      )
    }

    // Monthly chart
    if (monthlyChartRef.value && data.monthly.length > 0) {
      drawLineChart(
        monthlyChartRef.value,
        data.monthly,
        d => d.month,
        d => d.minutes,
        'monthly'
      )
    }
  })
}

// Redraw on resize
let resizeObserver = null

onMounted(() => {
  drawCharts()

  // Watch for resize
  resizeObserver = new ResizeObserver(() => {
    drawCharts()
  })

  if (dailyChartRef.value) resizeObserver.observe(dailyChartRef.value)
  if (weeklyChartRef.value) resizeObserver.observe(weeklyChartRef.value)
  if (monthlyChartRef.value) resizeObserver.observe(monthlyChartRef.value)
})

// Cleanup
import { onUnmounted } from 'vue'
onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// Redraw when data changes
watch(() => props.dailyData, drawCharts, { deep: true })
</script>

<template>
  <div class="usage-stats" :class="{ embedded: embedded }">
    <!-- Background (hidden in embedded mode) -->
    <template v-if="!embedded">
      <div class="bg-gradient"></div>
      <div class="bg-noise"></div>
    </template>

    <!-- Header (hidden in embedded mode - BrainView has tabs) -->
    <header v-if="!embedded" class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <h1 class="title">Usage Stats</h1>
      <div class="header-spacer"></div>
    </header>

    <!-- Content -->
    <main class="content">
      <!-- Totals Section -->
      <section class="totals-section">
        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div class="stat-value">{{ formattedTotalTime }}</div>
          <div class="stat-label">Total Time</div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              <line x1="8" y1="7" x2="16" y2="7"/>
              <line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </div>
          <div class="stat-value">{{ totalWordsIntroduced || 142 }}</div>
          <div class="stat-label">Words Introduced</div>
        </div>

        <div class="stat-card">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
          </div>
          <div class="stat-value">{{ totalPhrasesSpoken || 847 }}</div>
          <div class="stat-label">Phrases Spoken</div>
        </div>
      </section>

      <!-- Charts Section -->
      <section class="charts-section">
        <!-- Daily Chart -->
        <div class="chart-card">
          <h3 class="chart-title">Daily Activity</h3>
          <p class="chart-subtitle">Minutes per day</p>
          <div class="chart-container" ref="dailyChartRef"></div>
        </div>

        <!-- Weekly Chart -->
        <div class="chart-card">
          <h3 class="chart-title">Weekly Activity</h3>
          <p class="chart-subtitle">Minutes per week</p>
          <div class="chart-container" ref="weeklyChartRef"></div>
        </div>

        <!-- Monthly Chart -->
        <div class="chart-card">
          <h3 class="chart-title">Monthly Activity</h3>
          <p class="chart-subtitle">Minutes per month</p>
          <div class="chart-container" ref="monthlyChartRef"></div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.usage-stats {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  font-family: 'DM Sans', -apple-system, sans-serif;
  position: relative;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Background */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% 0%, var(--accent-glow) 0%, transparent 50%),
    linear-gradient(to bottom, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  pointer-events: none;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.02;
  pointer-events: none;
}

/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1.5rem 1rem 1.5rem;
  gap: 1rem;
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-card);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.header-spacer {
  width: 40px;
}

/* Content */
.content {
  flex: 1;
  padding: 0 1.5rem;
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* Totals Section */
.totals-section {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
}

.stat-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--accent-glow);
  display: flex;
  align-items: center;
  justify-content: center;
}

.stat-icon svg {
  width: 20px;
  height: 20px;
  color: var(--accent);
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

/* Charts Section */
.charts-section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.chart-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 1rem;
}

.chart-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.25rem 0;
}

.chart-subtitle {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0 0 0.75rem 0;
}

.chart-container {
  width: 100%;
  height: 160px;
  position: relative;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE
   ═══════════════════════════════════════════════════════════════ */

/* Extra small phones */
@media (max-width: 360px) {
  .header {
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 0.75rem 0.75rem 0.75rem;
  }

  .content {
    padding: 0 0.75rem;
    gap: 1rem;
  }

  .totals-section {
    gap: 0.5rem;
  }

  .stat-card {
    padding: 0.75rem 0.5rem;
    border-radius: 12px;
  }

  .stat-icon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
  }

  .stat-icon svg {
    width: 16px;
    height: 16px;
  }

  .stat-value {
    font-size: 1rem;
  }

  .stat-label {
    font-size: 0.625rem;
  }

  .chart-card {
    padding: 0.75rem;
    border-radius: 12px;
  }

  .chart-container {
    height: 140px;
  }

  .back-btn {
    min-width: 44px;
    min-height: 44px;
  }
}

/* Small phones */
@media (min-width: 361px) and (max-width: 479px) {
  .content {
    padding: 0 1rem;
  }

  .stat-card {
    padding: 0.875rem;
  }

  .chart-container {
    height: 150px;
  }
}

/* Tablets */
@media (min-width: 768px) {
  .content {
    max-width: 640px;
    margin: 0 auto;
  }

  .totals-section {
    gap: 1rem;
  }

  .stat-card {
    padding: 1.5rem;
    border-radius: 20px;
  }

  .stat-icon {
    width: 44px;
    height: 44px;
  }

  .stat-icon svg {
    width: 24px;
    height: 24px;
  }

  .stat-value {
    font-size: 1.5rem;
  }

  .stat-label {
    font-size: 0.8125rem;
  }

  .chart-card {
    padding: 1.5rem;
    border-radius: 20px;
  }

  .chart-title {
    font-size: 1rem;
  }

  .chart-container {
    height: 200px;
  }
}

/* Laptops */
@media (min-width: 1024px) {
  .content {
    max-width: 800px;
  }

  /* Charts remain stacked vertically for consistency */
  .charts-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .chart-container {
    height: 180px;
  }
}

/* Desktops */
@media (min-width: 1280px) {
  .content {
    max-width: 1000px;
    padding: 0 3rem;
  }

  .totals-section {
    gap: 1.5rem;
  }

  .stat-card {
    padding: 2rem;
  }

  .stat-value {
    font-size: 2rem;
  }

  .charts-section {
    gap: 1.5rem;
  }

  .chart-container {
    height: 220px;
  }
}

/* ═══════════════════════════════════════════════════════════════
   EMBEDDED MODE (when used as a tab inside BrainView)
   ═══════════════════════════════════════════════════════════════ */

.usage-stats.embedded {
  /* Position absolutely within BrainView, below the tabs */
  position: absolute;
  top: calc(120px + env(safe-area-inset-top, 0px));
  left: 0;
  right: 0;
  bottom: 0;
  min-height: unset;
  background: transparent;
  padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.usage-stats.embedded .content {
  padding: 16px;
  padding-top: 0;
}

/* Embedded mode card styling - use BrainView's dark theme */
.usage-stats.embedded .stat-card,
.usage-stats.embedded .chart-card {
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(10px);
  border-color: rgba(255, 255, 255, 0.08);
}

.usage-stats.embedded .stat-icon {
  background: rgba(255, 255, 255, 0.1);
}

.usage-stats.embedded .stat-icon svg {
  color: rgba(255, 255, 255, 0.7);
}

.usage-stats.embedded .stat-value {
  color: rgba(255, 255, 255, 0.95);
}

.usage-stats.embedded .stat-label {
  color: rgba(255, 255, 255, 0.5);
}

.usage-stats.embedded .chart-title {
  color: rgba(255, 255, 255, 0.9);
}

.usage-stats.embedded .chart-subtitle {
  color: rgba(255, 255, 255, 0.5);
}
</style>
