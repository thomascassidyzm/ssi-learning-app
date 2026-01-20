<script setup lang="ts">
/**
 * CanvasNetworkView.vue - Canvas+SVG Hybrid Network Visualization
 *
 * A high-performance network visualization that combines:
 * - Canvas layer for static rendering (nodes + edges) - GPU-accelerated via CSS transforms
 * - SVG overlay for interactive elements (hit areas, selections)
 * - Smooth pan/zoom via CSS transforms (no re-render on pan/zoom)
 *
 * This replaces SVG-only ConstellationNetworkView for butter-smooth performance
 * on large networks.
 */

import { ref, computed, watch, onMounted, onUnmounted, nextTick, type PropType } from 'vue'
import type { ConstellationNode, ConstellationEdge, PathHighlight } from '../composables/usePrebuiltNetwork'
import { renderNetwork, clear, setupCanvasForRetina } from '../composables/useCanvasNetwork'
import NetworkInteractiveOverlay from './NetworkInteractiveOverlay.vue'

// ============================================================================
// PROPS
// ============================================================================

const props = defineProps({
  nodes: {
    type: Array as PropType<ConstellationNode[]>,
    required: true,
  },
  edges: {
    type: Array as PropType<ConstellationEdge[]>,
    required: true,
  },
  heroNodeId: {
    type: String as PropType<string | null>,
    default: null,
  },
  currentPath: {
    type: Object as PropType<PathHighlight | null>,
    default: null,
  },
  revealedNodeIds: {
    type: Set as unknown as PropType<Set<string> | null>,
    default: null,  // null = all nodes revealed, Set = only these are revealed
  },
  showPathLabels: {
    type: Boolean,
    default: false,
  },
  brainBoundarySvgPath: {
    type: String,
    default: '',  // SVG path data for brain boundary (optional)
  },
  brainBoundaryColor: {
    type: String,
    default: '#ffffff',  // Color for brain boundary outline
  },
  disableInteraction: {
    type: Boolean,
    default: false,  // When true, disables zoom/drag - fixed view only
  },
  hideUnrevealedNodes: {
    type: Boolean,
    default: false,  // When true, unrevealed nodes are completely hidden (not ghost)
  },
})

const emit = defineEmits<{
  (e: 'node-tap', node: ConstellationNode): void
  (e: 'node-hover', node: ConstellationNode | null): void
}>()

// ============================================================================
// REFS
// ============================================================================

const containerRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const ctx = ref<CanvasRenderingContext2D | null>(null)

// Container dimensions
const containerWidth = ref(800)
const containerHeight = ref(800)

// ============================================================================
// ZOOM & PAN STATE
// ============================================================================

// User-controlled zoom and pan
const userScale = ref(1)
const userPan = ref({ x: 0, y: 0 })

// Zoom constraints
const MIN_SCALE = 0.3
const MAX_SCALE = 3

// Pan state for drag
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })
const dragPanStart = ref({ x: 0, y: 0 })

// Touch state for pinch-zoom
const initialPinchDistance = ref(0)
const initialPinchScale = ref(1)
const initialPinchPan = ref({ x: 0, y: 0 })

// Wheel zoom state (for disabling transition during wheel)
const isWheelZooming = ref(false)
let wheelZoomTimeout: number | null = null

// Is user actively interacting? (disables transition for responsiveness)
const isInteracting = computed(() => isDragging.value || isWheelZooming.value)

// Internal selected node (for overlay coordination)
const internalSelectedId = ref<string | null>(null)

// Search highlights (stub for future search feature)
const searchHighlights = ref<Set<string>>(new Set())

// ============================================================================
// CANVAS TRANSFORM (CSS-based for GPU acceleration)
// ============================================================================

/**
 * Combined CSS transform for the canvas element.
 * Uses translate + scale for GPU-accelerated smooth pan/zoom.
 * The canvas content is rendered at 1:1, and we use CSS to transform it.
 */
const canvasTransform = computed(() => {
  return `translate(${userPan.value.x}px, ${userPan.value.y}px) scale(${userScale.value})`
})

/**
 * Transform origin - center of the container for intuitive zoom
 */
const transformOrigin = computed(() => {
  return `${containerWidth.value / 2}px ${containerHeight.value / 2}px`
})

// ============================================================================
// CANVAS SETUP
// ============================================================================

/**
 * Initialize canvas with proper devicePixelRatio for retina displays
 */
function setupCanvas() {
  if (!canvasRef.value || !containerRef.value) return

  const canvas = canvasRef.value
  const container = containerRef.value
  const dpr = window.devicePixelRatio || 1

  // Get container dimensions
  const rect = container.getBoundingClientRect()
  containerWidth.value = rect.width
  containerHeight.value = rect.height

  // Set canvas size accounting for device pixel ratio
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr

  // Set display size via CSS
  canvas.style.width = `${rect.width}px`
  canvas.style.height = `${rect.height}px`

  // Get context and scale for retina
  const context = canvas.getContext('2d')
  if (context) {
    context.scale(dpr, dpr)
    ctx.value = context
  }

  // Trigger initial render
  renderCanvas()
}

/**
 * Handle container resize
 */
function handleResize() {
  setupCanvas()
}

// ============================================================================
// CANVAS RENDERING
// ============================================================================

/**
 * Main render function - called when nodes/edges/revealed state changes
 * NOT called on pan/zoom (CSS transform handles that)
 */
function renderCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return

  // Render brain boundary if provided (before network)
  if (props.brainBoundarySvgPath && ctx.value) {
    renderBrainBoundary(ctx.value, props.brainBoundarySvgPath, props.brainBoundaryColor)
  }

  // Build revealed set - use prop or treat all as revealed
  const revealedSet = props.revealedNodeIds || new Set(props.nodes.map(n => n.id))

  // Use the composable's render function
  renderNetwork(
    canvas,
    props.nodes,
    props.edges,
    revealedSet,
    {
      hideUnrevealed: props.hideUnrevealedNodes,
      ghostOpacity: 0.15,
      revealedOpacity: 0.5,
    }
  )
}

/**
 * Render brain boundary as a subtle outline
 */
function renderBrainBoundary(
  context: CanvasRenderingContext2D,
  pathData: string,
  color: string
) {
  context.save()

  // Parse SVG path and draw on canvas
  const path = new Path2D(pathData)

  // Subtle glow effect
  context.shadowColor = color
  context.shadowBlur = 4
  context.strokeStyle = color
  context.globalAlpha = 0.12
  context.lineWidth = 1.5
  context.stroke(path)

  context.restore()
}

// ============================================================================
// HELPERS - Only what's still needed locally
// ============================================================================

/**
 * Check if a node should be visible (for hit area pointer-events)
 */
function getNodeOpacity(node: ConstellationNode): number {
  const isRevealed = !props.revealedNodeIds || props.revealedNodeIds.has(node.id)
  if (!isRevealed) {
    return props.hideUnrevealedNodes ? 0 : 0.15
  }
  return 0.5
}

// ============================================================================
// MOUSE WHEEL ZOOM
// ============================================================================

function handleWheel(e: WheelEvent) {
  e.preventDefault()

  if (props.disableInteraction) return

  // Mark as zooming to disable transition
  isWheelZooming.value = true
  if (wheelZoomTimeout) clearTimeout(wheelZoomTimeout)
  wheelZoomTimeout = window.setTimeout(() => {
    isWheelZooming.value = false
  }, 150)

  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
  const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, userScale.value * zoomFactor))

  // Zoom toward cursor position
  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    const cursorX = e.clientX - rect.left - rect.width / 2
    const cursorY = e.clientY - rect.top - rect.height / 2

    const scaleDiff = newScale - userScale.value
    userPan.value = {
      x: userPan.value.x - cursorX * scaleDiff / userScale.value,
      y: userPan.value.y - cursorY * scaleDiff / userScale.value
    }
  }

  userScale.value = newScale
}

// ============================================================================
// MOUSE DRAG PAN
// ============================================================================

function handleMouseDown(e: MouseEvent) {
  if (props.disableInteraction) return

  // Only pan on left click, and not on nodes
  if (e.button !== 0) return
  if ((e.target as Element).closest('.interactive-node')) return

  isDragging.value = true
  dragStart.value = { x: e.clientX, y: e.clientY }
  dragPanStart.value = { ...userPan.value }
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging.value) return

  const dx = e.clientX - dragStart.value.x
  const dy = e.clientY - dragStart.value.y

  userPan.value = {
    x: dragPanStart.value.x + dx / userScale.value,
    y: dragPanStart.value.y + dy / userScale.value
  }
}

function handleMouseUp() {
  isDragging.value = false
}

// ============================================================================
// TOUCH GESTURES (PINCH-ZOOM & DRAG-PAN)
// ============================================================================

function getTouchDistance(e: TouchEvent): number {
  if (e.touches.length < 2) return 0
  const dx = e.touches[0].clientX - e.touches[1].clientX
  const dy = e.touches[0].clientY - e.touches[1].clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function getTouchCenter(e: TouchEvent): { x: number; y: number } {
  if (e.touches.length < 2) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  return {
    x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
    y: (e.touches[0].clientY + e.touches[1].clientY) / 2
  }
}

function handleTouchStart(e: TouchEvent) {
  if (props.disableInteraction) return

  if ((e.target as Element).closest('.interactive-node')) return

  if (e.touches.length === 2) {
    // Pinch start
    initialPinchDistance.value = getTouchDistance(e)
    initialPinchScale.value = userScale.value
    initialPinchPan.value = { ...userPan.value }
    e.preventDefault()
  } else if (e.touches.length === 1) {
    // Single touch drag
    isDragging.value = true
    dragStart.value = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    dragPanStart.value = { ...userPan.value }
  }
}

function handleTouchMove(e: TouchEvent) {
  if (props.disableInteraction) return

  if (e.touches.length === 2 && initialPinchDistance.value > 0) {
    e.preventDefault()

    // Pinch zoom
    const currentDistance = getTouchDistance(e)
    const scale = currentDistance / initialPinchDistance.value
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialPinchScale.value * scale))

    // Zoom toward pinch center
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      const center = getTouchCenter(e)
      const cursorX = center.x - rect.left - rect.width / 2
      const cursorY = center.y - rect.top - rect.height / 2

      const scaleDiff = newScale - userScale.value
      userPan.value = {
        x: userPan.value.x - cursorX * scaleDiff / userScale.value,
        y: userPan.value.y - cursorY * scaleDiff / userScale.value
      }
    }

    userScale.value = newScale
  } else if (e.touches.length === 1 && isDragging.value) {
    // Single touch pan
    const dx = e.touches[0].clientX - dragStart.value.x
    const dy = e.touches[0].clientY - dragStart.value.y

    userPan.value = {
      x: dragPanStart.value.x + dx / userScale.value,
      y: dragPanStart.value.y + dy / userScale.value
    }
  }
}

function handleTouchEnd(e: TouchEvent) {
  if (e.touches.length === 0) {
    isDragging.value = false
    initialPinchDistance.value = 0
  } else if (e.touches.length === 1) {
    // Switching from pinch to single touch
    initialPinchDistance.value = 0
    isDragging.value = true
    dragStart.value = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    dragPanStart.value = { ...userPan.value }
  }
}

// ============================================================================
// KEYBOARD CONTROLS
// ============================================================================

const ZOOM_STEP = 1.2
const PAN_STEP = 50

function zoomIn() {
  userScale.value = Math.min(MAX_SCALE, userScale.value * ZOOM_STEP)
}

function zoomOut() {
  userScale.value = Math.max(MIN_SCALE, userScale.value / ZOOM_STEP)
}

function panLeft() {
  userPan.value = { x: userPan.value.x + PAN_STEP / userScale.value, y: userPan.value.y }
}

function panRight() {
  userPan.value = { x: userPan.value.x - PAN_STEP / userScale.value, y: userPan.value.y }
}

function panUp() {
  userPan.value = { x: userPan.value.x, y: userPan.value.y + PAN_STEP / userScale.value }
}

function panDown() {
  userPan.value = { x: userPan.value.x, y: userPan.value.y - PAN_STEP / userScale.value }
}

function resetZoomPan() {
  userScale.value = 1
  userPan.value = { x: 0, y: 0 }
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (props.disableInteraction) return

  switch (e.key) {
    case '+':
    case '=':
      e.preventDefault()
      zoomIn()
      break
    case '-':
    case '_':
      e.preventDefault()
      zoomOut()
      break
    case 'ArrowLeft':
      e.preventDefault()
      panLeft()
      break
    case 'ArrowRight':
      e.preventDefault()
      panRight()
      break
    case 'ArrowUp':
      e.preventDefault()
      panUp()
      break
    case 'ArrowDown':
      e.preventDefault()
      panDown()
      break
    case '0':
      e.preventDefault()
      resetZoomPan()
      break
  }
}

// ============================================================================
// NODE INTERACTION HANDLERS
// ============================================================================

function handleNodeTap(node: ConstellationNode) {
  internalSelectedId.value = node.id
  emit('node-tap', node)
}

function handleNodeHover(node: ConstellationNode | null) {
  emit('node-hover', node)
}

function handleBackgroundTap() {
  internalSelectedId.value = null
}

// ============================================================================
// WATCHERS - Re-render canvas when data changes
// ============================================================================

// Re-render when nodes/edges change
watch(
  () => [props.nodes, props.edges],
  () => {
    nextTick(() => renderCanvas())
  },
  { deep: true }
)

// Re-render when revealed nodes change
watch(
  () => props.revealedNodeIds,
  () => {
    nextTick(() => renderCanvas())
  },
  { deep: true }
)

// Re-render when current path changes
watch(
  () => props.currentPath,
  () => {
    nextTick(() => renderCanvas())
  },
  { deep: true }
)

// Re-render when hero changes
watch(
  () => props.heroNodeId,
  () => {
    nextTick(() => renderCanvas())
  }
)

// Re-render when hideUnrevealedNodes changes
watch(
  () => props.hideUnrevealedNodes,
  () => {
    nextTick(() => renderCanvas())
  }
)

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  // Setup canvas
  nextTick(() => {
    setupCanvas()
  })

  // Add global handlers
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', handleResize)

  if (wheelZoomTimeout) {
    clearTimeout(wheelZoomTimeout)
  }
})

// ============================================================================
// EXPOSE
// ============================================================================

defineExpose({
  resetZoomPan,
  zoomIn,
  zoomOut,
  userScale,
  userPan,
  renderCanvas,
})
</script>

<template>
  <div
    ref="containerRef"
    class="canvas-network-view"
    :class="{ 'is-interacting': isInteracting, 'is-dragging': isDragging }"
    @wheel="handleWheel"
    @mousedown="handleMouseDown"
    @touchstart="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
  >
    <!-- Canvas layer for static rendering -->
    <canvas
      ref="canvasRef"
      class="network-canvas"
      :style="{
        transform: canvasTransform,
        transformOrigin: transformOrigin,
      }"
    />

    <!-- SVG overlay for interactive elements -->
    <NetworkInteractiveOverlay
      class="interactive-overlay"
      :style="{
        transform: canvasTransform,
        transformOrigin: transformOrigin,
      }"
      :nodes="nodes"
      :selected-node-id="internalSelectedId"
      :highlighted-node-ids="searchHighlights ? Array.from(searchHighlights) : []"
      :current-path="currentPath"
      :canvas-scale="userScale"
      :canvas-pan="userPan"
      @node-tap="handleNodeTap"
      @background-tap="handleBackgroundTap"
    />

    <!-- Zoom/Pan Controls -->
    <div v-if="!disableInteraction" class="network-controls">
      <button
        class="control-btn"
        @click="zoomIn"
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button
        class="control-btn"
        @click="zoomOut"
        title="Zoom out (-)"
        aria-label="Zoom out"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </button>
      <button
        class="control-btn"
        @click="resetZoomPan"
        title="Center network (0)"
        aria-label="Center network"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.canvas-network-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  cursor: grab;
  touch-action: none; /* Prevent browser handling of touch gestures */
}

.canvas-network-view.is-dragging {
  cursor: grabbing;
}

.network-canvas {
  position: absolute;
  top: 0;
  left: 0;
  will-change: transform;
  /* Smooth transitions when not actively interacting */
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Disable transition during active interaction for responsiveness */
.canvas-network-view.is-interacting .network-canvas {
  transition: none;
}

.interactive-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none; /* Let clicks pass through to hit areas only */
  will-change: transform;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.canvas-network-view.is-interacting .interactive-overlay {
  transition: none;
}

/* ============================================================================
   ZOOM/PAN CONTROLS
   ============================================================================ */

.network-controls {
  position: absolute;
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 10;
}

.control-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: var(--bg-elevated, rgba(30, 30, 40, 0.7));
  backdrop-filter: blur(8px);
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  transition: all 0.2s ease;
}

.control-btn:hover {
  background: var(--bg-card, rgba(60, 60, 80, 0.8));
  color: var(--text-primary, rgba(255, 255, 255, 0.95));
  transform: scale(1.05);
}

.control-btn:active {
  transform: scale(0.95);
}

.control-btn svg {
  width: 20px;
  height: 20px;
}

/* Hide on mobile (touch gestures work well there) */
@media (max-width: 768px) {
  .network-controls {
    display: none;
  }
}
</style>
