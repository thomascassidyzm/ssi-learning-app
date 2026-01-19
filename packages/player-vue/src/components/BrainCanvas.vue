<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'

const props = defineProps({
  // Completed seeds/nodes to display
  completedNodes: {
    type: Array,
    default: () => []
    // Shape: [{ id, belt, connections: [id, id, ...] }, ...]
  },
  // Current belt level
  currentBelt: {
    type: String,
    default: 'white'
  },
  // Total seeds per belt (for region sizing)
  beltTotals: {
    type: Object,
    default: () => ({
      white: 8, yellow: 12, orange: 20, green: 40,
      blue: 70, purple: 70, brown: 130, black: 120
    })
  }
})

const emit = defineEmits(['close', 'selectNode'])

// Canvas ref
const canvasRef = ref(null)
const containerRef = ref(null)

// Canvas state
const canvasWidth = ref(800)
const canvasHeight = ref(600)
const dpr = ref(1) // Device pixel ratio

// Pan and zoom state
const transform = ref({ x: 0, y: 0, scale: 1 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const lastTransform = ref({ x: 0, y: 0 })

// Belt colors - galaxy/nebula style with glows
const BELT_COLORS = {
  white: { fill: '#f5f5f5', glow: 'rgba(245, 245, 245, 0.6)', nebula: 'rgba(245, 245, 245, 0.08)' },
  yellow: { fill: '#fcd34d', glow: 'rgba(252, 211, 77, 0.6)', nebula: 'rgba(252, 211, 77, 0.08)' },
  orange: { fill: '#fb923c', glow: 'rgba(251, 146, 60, 0.6)', nebula: 'rgba(251, 146, 60, 0.08)' },
  green: { fill: '#4ade80', glow: 'rgba(74, 222, 128, 0.6)', nebula: 'rgba(74, 222, 128, 0.08)' },
  blue: { fill: '#60a5fa', glow: 'rgba(96, 165, 250, 0.6)', nebula: 'rgba(96, 165, 250, 0.08)' },
  purple: { fill: '#a78bfa', glow: 'rgba(167, 139, 250, 0.6)', nebula: 'rgba(167, 139, 250, 0.08)' },
  brown: { fill: '#a8856c', glow: 'rgba(168, 133, 108, 0.6)', nebula: 'rgba(168, 133, 108, 0.08)' },
  black: { fill: '#6b7280', glow: 'rgba(107, 114, 128, 0.6)', nebula: 'rgba(107, 114, 128, 0.08)' }
}

const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']

// Belt cluster positions - arranged in a flowing galaxy pattern
// Each belt gets a region where its nodes cluster
const BELT_CLUSTERS = {
  white:  { cx: 0.5, cy: 0.5, radius: 0.12 },   // Center - where you start
  yellow: { cx: 0.35, cy: 0.38, radius: 0.11 },  // Upper left
  orange: { cx: 0.28, cy: 0.58, radius: 0.10 },  // Left
  green:  { cx: 0.42, cy: 0.72, radius: 0.11 },  // Lower center-left
  blue:   { cx: 0.62, cy: 0.68, radius: 0.12 },  // Lower center-right
  purple: { cx: 0.72, cy: 0.48, radius: 0.11 },  // Right
  brown:  { cx: 0.65, cy: 0.28, radius: 0.10 },  // Upper right
  black:  { cx: 0.48, cy: 0.22, radius: 0.12 },  // Top - mastery
}

// Pre-calculate node positions based on their belt - clustered in galaxy pattern
const nodePositions = computed(() => {
  const positions = new Map()

  // Group nodes by belt
  const nodesByBelt = {}
  BELT_ORDER.forEach(belt => nodesByBelt[belt] = [])

  props.completedNodes.forEach(node => {
    const belt = node.belt || 'white'
    if (nodesByBelt[belt]) {
      nodesByBelt[belt].push(node)
    }
  })

  // Position nodes within their belt cluster
  BELT_ORDER.forEach(belt => {
    const nodes = nodesByBelt[belt]
    const cluster = BELT_CLUSTERS[belt]

    nodes.forEach((node, i) => {
      // Distribute nodes in a scattered pattern within cluster
      const count = nodes.length
      // Golden angle for nice distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const angle = i * goldenAngle
      // Vary distance from center - more nodes = more spread
      const radiusFactor = 0.2 + (Math.sqrt(i / Math.max(count, 1))) * 0.7

      const x = cluster.cx + Math.cos(angle) * cluster.radius * radiusFactor
      const y = cluster.cy + Math.sin(angle) * cluster.radius * radiusFactor

      positions.set(node.id, { x, y, belt: node.belt, node })
    })
  })

  return positions
})

// Draw the galaxy/constellation visualization
const draw = () => {
  const canvas = canvasRef.value
  if (!canvas) return

  const ctx = canvas.getContext('2d')
  const w = canvasWidth.value
  const h = canvasHeight.value

  // Clear canvas
  ctx.clearRect(0, 0, w * dpr.value, h * dpr.value)

  // Save state and apply transform
  ctx.save()
  ctx.scale(dpr.value, dpr.value)

  // Apply pan and zoom
  ctx.translate(w / 2, h / 2)
  ctx.scale(transform.value.scale, transform.value.scale)
  ctx.translate(-w / 2 + transform.value.x, -h / 2 + transform.value.y)

  // Draw area dimensions
  const padding = 20
  const areaW = w - padding * 2
  const areaH = h - padding * 2

  // Draw subtle nebula clouds for each belt cluster (background glow)
  BELT_ORDER.forEach(belt => {
    const cluster = BELT_CLUSTERS[belt]
    const colors = BELT_COLORS[belt]
    const isCurrentBelt = belt === props.currentBelt

    const cx = padding + cluster.cx * areaW
    const cy = padding + cluster.cy * areaH
    const radius = cluster.radius * Math.min(areaW, areaH)

    // Nebula glow - larger, softer
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.5)
    gradient.addColorStop(0, isCurrentBelt ? colors.nebula.replace('0.08', '0.15') : colors.nebula)
    gradient.addColorStop(0.5, isCurrentBelt ? colors.nebula.replace('0.08', '0.08') : colors.nebula.replace('0.08', '0.04'))
    gradient.addColorStop(1, 'transparent')

    ctx.beginPath()
    ctx.arc(cx, cy, radius * 1.5, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
  })

  // Draw connections (constellation lines) - use stable positions, no random
  ctx.lineWidth = 1

  nodePositions.value.forEach((pos, nodeId) => {
    const node = pos.node
    if (node.connections) {
      node.connections.forEach(targetId => {
        const targetPos = nodePositions.value.get(targetId)
        if (targetPos) {
          const x1 = padding + pos.x * areaW
          const y1 = padding + pos.y * areaH
          const x2 = padding + targetPos.x * areaW
          const y2 = padding + targetPos.y * areaH

          // Gradient line between nodes
          const lineGradient = ctx.createLinearGradient(x1, y1, x2, y2)
          const color1 = BELT_COLORS[pos.belt] || BELT_COLORS.white
          const color2 = BELT_COLORS[targetPos.belt] || BELT_COLORS.white
          lineGradient.addColorStop(0, color1.glow.replace('0.6', '0.2'))
          lineGradient.addColorStop(1, color2.glow.replace('0.6', '0.2'))

          ctx.beginPath()
          ctx.moveTo(x1, y1)
          ctx.lineTo(x2, y2)
          ctx.strokeStyle = lineGradient
          ctx.stroke()
        }
      })
    }
  })

  // Draw nodes (stars)
  nodePositions.value.forEach((pos, nodeId) => {
    const colors = BELT_COLORS[pos.belt] || BELT_COLORS.white
    const x = padding + pos.x * areaW
    const y = padding + pos.y * areaH
    const isCurrentBelt = pos.belt === props.currentBelt
    const radius = isCurrentBelt ? 5 : 3

    // Outer glow
    const glowRadius = isCurrentBelt ? 12 : 8
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius)
    gradient.addColorStop(0, colors.glow)
    gradient.addColorStop(0.3, colors.glow.replace('0.6', '0.3'))
    gradient.addColorStop(1, 'transparent')

    ctx.beginPath()
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()

    // Core star
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = colors.fill
    ctx.fill()
  })

  ctx.restore()
}

// Handle mouse/touch events for pan
const handlePointerDown = (e) => {
  isDragging.value = true
  const rect = canvasRef.value.getBoundingClientRect()
  dragStart.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  }
  lastTransform.value = { x: transform.value.x, y: transform.value.y }
  canvasRef.value.style.cursor = 'grabbing'
}

const handlePointerMove = (e) => {
  if (!isDragging.value) return

  const rect = canvasRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const y = e.clientY - rect.top

  const dx = (x - dragStart.value.x) / transform.value.scale
  const dy = (y - dragStart.value.y) / transform.value.scale

  transform.value.x = lastTransform.value.x + dx
  transform.value.y = lastTransform.value.y + dy

  requestAnimationFrame(draw)
}

const handlePointerUp = () => {
  isDragging.value = false
  if (canvasRef.value) {
    canvasRef.value.style.cursor = 'grab'
  }
}

// Handle zoom with wheel
const handleWheel = (e) => {
  e.preventDefault()

  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(0.5, Math.min(3, transform.value.scale * zoomFactor))

  transform.value.scale = newScale
  requestAnimationFrame(draw)
}

// Handle touch gestures
let lastTouchDistance = 0

const handleTouchStart = (e) => {
  if (e.touches.length === 1) {
    handlePointerDown(e.touches[0])
  } else if (e.touches.length === 2) {
    isDragging.value = false
    lastTouchDistance = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    )
  }
}

const handleTouchMove = (e) => {
  if (e.touches.length === 1 && isDragging.value) {
    handlePointerMove(e.touches[0])
  } else if (e.touches.length === 2) {
    const distance = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    )

    if (lastTouchDistance > 0) {
      const zoomFactor = distance / lastTouchDistance
      const newScale = Math.max(0.5, Math.min(3, transform.value.scale * zoomFactor))
      transform.value.scale = newScale
      requestAnimationFrame(draw)
    }

    lastTouchDistance = distance
  }
}

const handleTouchEnd = () => {
  isDragging.value = false
  lastTouchDistance = 0
}

// Resize handler
const handleResize = () => {
  if (!containerRef.value || !canvasRef.value) return

  const rect = containerRef.value.getBoundingClientRect()
  canvasWidth.value = rect.width
  canvasHeight.value = rect.height
  dpr.value = window.devicePixelRatio || 1

  canvasRef.value.width = rect.width * dpr.value
  canvasRef.value.height = rect.height * dpr.value
  canvasRef.value.style.width = `${rect.width}px`
  canvasRef.value.style.height = `${rect.height}px`

  draw()
}

// Reset view
const resetView = () => {
  transform.value = { x: 0, y: 0, scale: 1 }
  draw()
}

// Generate demo data if no nodes provided
const demoNodes = computed(() => {
  if (props.completedNodes.length > 0) return props.completedNodes

  // Generate some demo nodes for visualization
  const nodes = []
  const currentBeltIndex = BELT_ORDER.indexOf(props.currentBelt)

  BELT_ORDER.forEach((belt, beltIndex) => {
    if (beltIndex <= currentBeltIndex) {
      // Add completed nodes up to current belt
      const count = beltIndex === currentBeltIndex
        ? Math.floor(props.beltTotals[belt] * 0.6) // Partial progress on current
        : props.beltTotals[belt] // Full for previous belts

      for (let i = 0; i < Math.min(count, 15); i++) { // Cap at 15 per belt for demo
        const nodeId = `${belt}-${i}`
        const connections = []

        // Add some random connections
        if (i > 0) connections.push(`${belt}-${i - 1}`)
        if (beltIndex > 0 && Math.random() > 0.5) {
          const prevBelt = BELT_ORDER[beltIndex - 1]
          connections.push(`${prevBelt}-${Math.floor(Math.random() * 5)}`)
        }

        nodes.push({ id: nodeId, belt, connections })
      }
    }
  })

  return nodes
})

// Watch for data changes
watch(() => props.completedNodes, () => {
  nextTick(draw)
}, { deep: true })

watch(() => props.currentBelt, () => {
  nextTick(draw)
})

// Lifecycle
let resizeObserver = null

onMounted(() => {
  nextTick(() => {
    handleResize()

    // Set up resize observer
    resizeObserver = new ResizeObserver(handleResize)
    if (containerRef.value) {
      resizeObserver.observe(containerRef.value)
    }
  })
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})
</script>

<template>
  <div class="constellation-view">
    <!-- Background -->
    <div class="bg-gradient"></div>

    <!-- Header -->
    <header class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <h1 class="title">Your Progress</h1>
      <button class="reset-btn" @click="resetView">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
          <path d="M3 3v5h5"/>
        </svg>
      </button>
    </header>

    <!-- Canvas Container -->
    <div
      ref="containerRef"
      class="canvas-container"
      @mousedown="handlePointerDown"
      @mousemove="handlePointerMove"
      @mouseup="handlePointerUp"
      @mouseleave="handlePointerUp"
      @wheel="handleWheel"
      @touchstart.passive="handleTouchStart"
      @touchmove.passive="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <canvas ref="canvasRef" class="brain-canvas"></canvas>
    </div>

    <!-- Belt Legend -->
    <div class="belt-legend">
      <div
        v-for="belt in BELT_ORDER"
        :key="belt"
        class="legend-item"
        :class="{ 'legend-item--active': belt === currentBelt }"
      >
        <span
          class="legend-dot"
          :style="{ background: BELT_COLORS[belt].fill, borderColor: BELT_COLORS[belt].stroke }"
        ></span>
        <span class="legend-label">{{ belt }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.constellation-view {
  position: fixed;
  inset: 0;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.bg-gradient {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% 30%, rgba(139, 92, 246, 0.08) 0%, transparent 50%),
    linear-gradient(to bottom, var(--bg-secondary) 0%, var(--bg-primary) 100%);
  pointer-events: none;
}

/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(1rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem 1rem;
}

.back-btn,
.reset-btn {
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

.back-btn:hover,
.reset-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
}

.back-btn svg,
.reset-btn svg {
  width: 20px;
  height: 20px;
}

.title {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

/* Canvas */
.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}

.brain-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Belt Legend */
.belt-legend {
  position: relative;
  z-index: 10;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px) + 80px) 1rem;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  opacity: 0.5;
  transition: all 0.2s ease;
}

.legend-item--active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid;
}

.legend-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: capitalize;
}

.legend-item--active .legend-label {
  color: var(--text-primary);
}

/* Responsive */
@media (max-width: 480px) {
  .header {
    padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 0.75rem 0.5rem 0.75rem;
  }

  .title {
    font-size: 1rem;
  }

  .back-btn,
  .reset-btn {
    min-width: 44px;
    min-height: 44px;
  }

  .belt-legend {
    gap: 0.375rem;
    padding: 0.5rem 0.75rem calc(0.5rem + env(safe-area-inset-bottom, 0px) + 70px) 0.75rem;
  }

  .legend-item {
    padding: 0.2rem 0.375rem;
  }

  .legend-dot {
    width: 8px;
    height: 8px;
  }

  .legend-label {
    font-size: 0.625rem;
  }
}
</style>
