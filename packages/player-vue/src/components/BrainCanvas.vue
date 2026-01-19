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

// Belt colors
const BELT_COLORS = {
  white: { fill: '#f5f5f5', stroke: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.5)' },
  yellow: { fill: '#fcd34d', stroke: '#f59e0b', glow: 'rgba(252, 211, 77, 0.5)' },
  orange: { fill: '#fb923c', stroke: '#ea580c', glow: 'rgba(251, 146, 60, 0.5)' },
  green: { fill: '#4ade80', stroke: '#16a34a', glow: 'rgba(74, 222, 128, 0.5)' },
  blue: { fill: '#60a5fa', stroke: '#2563eb', glow: 'rgba(96, 165, 250, 0.5)' },
  purple: { fill: '#a78bfa', stroke: '#7c3aed', glow: 'rgba(167, 139, 250, 0.5)' },
  brown: { fill: '#a8856c', stroke: '#78716c', glow: 'rgba(168, 133, 108, 0.5)' },
  black: { fill: '#374151', stroke: '#1f2937', glow: 'rgba(55, 65, 81, 0.5)' }
}

const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']

// Brain outline path (normalized 0-1 coordinates)
// Simplified brain shape - left hemisphere view
const BRAIN_PATH = [
  { x: 0.5, y: 0.95 },   // Brain stem bottom
  { x: 0.45, y: 0.85 },  // Brain stem
  { x: 0.35, y: 0.78 },  // Cerebellum
  { x: 0.2, y: 0.7 },    // Back lower
  { x: 0.1, y: 0.55 },   // Back middle
  { x: 0.08, y: 0.4 },   // Back upper
  { x: 0.12, y: 0.25 },  // Top back
  { x: 0.25, y: 0.12 },  // Top
  { x: 0.45, y: 0.05 },  // Top front
  { x: 0.65, y: 0.08 },  // Frontal top
  { x: 0.8, y: 0.18 },   // Frontal upper
  { x: 0.9, y: 0.35 },   // Frontal middle
  { x: 0.88, y: 0.5 },   // Frontal lower
  { x: 0.8, y: 0.65 },   // Temporal
  { x: 0.65, y: 0.75 },  // Lower temporal
  { x: 0.55, y: 0.85 },  // Near stem
  { x: 0.5, y: 0.95 },   // Back to stem
]

// Belt regions within the brain (normalized coordinates for center of each region)
const BELT_REGIONS = {
  white:  { cx: 0.48, cy: 0.82, rx: 0.08, ry: 0.06 },  // Brain stem area
  yellow: { cx: 0.32, cy: 0.72, rx: 0.10, ry: 0.08 },  // Cerebellum
  orange: { cx: 0.18, cy: 0.55, rx: 0.08, ry: 0.12 },  // Occipital (back)
  green:  { cx: 0.22, cy: 0.32, rx: 0.10, ry: 0.12 },  // Parietal (top back)
  blue:   { cx: 0.45, cy: 0.18, rx: 0.15, ry: 0.10 },  // Top/Motor cortex
  purple: { cx: 0.72, cy: 0.25, rx: 0.12, ry: 0.12 },  // Frontal upper
  brown:  { cx: 0.82, cy: 0.48, rx: 0.08, ry: 0.14 },  // Frontal middle
  black:  { cx: 0.7, cy: 0.68, rx: 0.12, ry: 0.10 },   // Temporal
}

// Pre-calculate node positions based on their belt
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

  // Position nodes within their belt region
  BELT_ORDER.forEach(belt => {
    const nodes = nodesByBelt[belt]
    const region = BELT_REGIONS[belt]

    nodes.forEach((node, i) => {
      // Distribute nodes in a spiral/scattered pattern within region
      const count = nodes.length
      const angle = (i / Math.max(count, 1)) * Math.PI * 2 + (i * 0.5)
      const radiusFactor = 0.3 + (i % 3) * 0.25 // Vary distance from center

      const x = region.cx + Math.cos(angle) * region.rx * radiusFactor
      const y = region.cy + Math.sin(angle) * region.ry * radiusFactor

      positions.set(node.id, { x, y, belt: node.belt, node })
    })
  })

  return positions
})

// Draw the brain visualization
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

  // Calculate brain dimensions (fit to canvas with padding)
  const padding = 40
  const brainW = w - padding * 2
  const brainH = h - padding * 2
  const brainX = padding
  const brainY = padding

  // Draw brain outline (subtle)
  ctx.beginPath()
  BRAIN_PATH.forEach((p, i) => {
    const x = brainX + p.x * brainW
    const y = brainY + p.y * brainH
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.closePath()
  ctx.fillStyle = 'rgba(30, 30, 40, 0.3)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Draw belt region backgrounds (subtle)
  BELT_ORDER.forEach(belt => {
    const region = BELT_REGIONS[belt]
    const colors = BELT_COLORS[belt]
    const isCurrentBelt = belt === props.currentBelt

    const cx = brainX + region.cx * brainW
    const cy = brainY + region.cy * brainH
    const rx = region.rx * brainW
    const ry = region.ry * brainH

    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
    ctx.fillStyle = isCurrentBelt
      ? `${colors.glow.replace('0.5', '0.15')}`
      : 'rgba(255, 255, 255, 0.02)'
    ctx.fill()

    if (isCurrentBelt) {
      ctx.strokeStyle = colors.stroke
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.3
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  })

  // Draw connections (dendrites)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1

  nodePositions.value.forEach((pos, nodeId) => {
    const node = pos.node
    if (node.connections) {
      node.connections.forEach(targetId => {
        const targetPos = nodePositions.value.get(targetId)
        if (targetPos) {
          const x1 = brainX + pos.x * brainW
          const y1 = brainY + pos.y * brainH
          const x2 = brainX + targetPos.x * brainW
          const y2 = brainY + targetPos.y * brainH

          ctx.beginPath()
          ctx.moveTo(x1, y1)
          // Curved line for organic feel
          const midX = (x1 + x2) / 2 + (Math.random() - 0.5) * 20
          const midY = (y1 + y2) / 2 + (Math.random() - 0.5) * 20
          ctx.quadraticCurveTo(midX, midY, x2, y2)
          ctx.stroke()
        }
      })
    }
  })

  // Draw nodes
  nodePositions.value.forEach((pos, nodeId) => {
    const colors = BELT_COLORS[pos.belt] || BELT_COLORS.white
    const x = brainX + pos.x * brainW
    const y = brainY + pos.y * brainH
    const isCurrentBelt = pos.belt === props.currentBelt
    const radius = isCurrentBelt ? 6 : 4

    // Glow for current belt nodes
    if (isCurrentBelt) {
      ctx.beginPath()
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
      ctx.fillStyle = colors.glow
      ctx.fill()
    }

    // Node circle
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = colors.fill
    ctx.fill()
    ctx.strokeStyle = colors.stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
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
  <div class="brain-canvas-view">
    <!-- Background -->
    <div class="bg-gradient"></div>

    <!-- Header -->
    <header class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>
      <h1 class="title">Your Learning Brain</h1>
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
.brain-canvas-view {
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
