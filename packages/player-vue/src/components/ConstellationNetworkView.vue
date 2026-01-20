<script setup lang="ts">
/**
 * ConstellationNetworkView.vue - Pre-built Network with CSS Pan
 *
 * A simpler network visualization:
 * - Positions are PRE-CALCULATED (no runtime physics)
 * - Network PANS via CSS transform to center on hero
 * - Spatial relationships are FIXED (preserves memory)
 * - Manual pinch-zoom and drag-pan supported
 *
 * "quiero is always up-left of hablar" - like a real star map
 */

import { ref, computed, watch, onMounted, onUnmounted, nextTick, type PropType } from 'vue'
import type { ConstellationNode, ConstellationEdge, PathHighlight } from '../composables/usePrebuiltNetwork'

// ============================================================================
// TRAVELING PULSE TYPE
// ============================================================================

interface TravelingPulse {
  id: string
  edgeId: string
  pathD: string
  duration: number
  startTime: number
}

// ============================================================================
// BELT PALETTES
// ============================================================================

const BELT_PALETTES: Record<string, {
  glow: string
  core: string
  inner: string
  label: string
}> = {
  white: { glow: '#9ca3af', core: '#2a2a35', inner: '#ffffff', label: '#ffffffcc' },
  yellow: { glow: '#fbbf24', core: '#2a2518', inner: '#fbbf24', label: '#fbbf24cc' },
  orange: { glow: '#f97316', core: '#2a1a10', inner: '#f97316', label: '#f97316cc' },
  green: { glow: '#22c55e', core: '#102a1a', inner: '#22c55e', label: '#22c55ecc' },
  blue: { glow: '#3b82f6', core: '#101a2a', inner: '#3b82f6', label: '#3b82f6cc' },
  purple: { glow: '#8b5cf6', core: '#1a102a', inner: '#8b5cf6', label: '#8b5cf6cc' },
  brown: { glow: '#a87848', core: '#2a1a10', inner: '#a87848', label: '#a87848cc' },
  black: { glow: '#d4a853', core: '#2a2518', inner: '#d4a853', label: '#d4a853cc' },
}

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
  panTransform: {
    type: String,
    default: 'translate(0px, 0px)',
  },
  showPathLabels: {
    type: Boolean,
    default: false,
  },
  resonatingNodeIds: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  showFirePath: {
    type: Boolean,
    default: true,  // Fire path animation enabled by default
  },
  revealedNodeIds: {
    type: Set as unknown as PropType<Set<string> | null>,
    default: null,  // null = all nodes revealed, Set = only these are revealed
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
// ZOOM & PAN STATE
// ============================================================================

const svgRef = ref<SVGSVGElement | null>(null)

// User-controlled zoom and pan (independent of hero centering)
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

// Wheel zoom state (for disabling transition during wheel)
const isWheelZooming = ref(false)
let wheelZoomTimeout: number | null = null

// Is user actively interacting? (disables transition for responsiveness)
const isInteracting = computed(() => isDragging.value || isWheelZooming.value)

// ============================================================================
// TRAVELING PULSES STATE
// ============================================================================

const travelingPulses = ref<TravelingPulse[]>([])
let pulseIdCounter = 0
const PULSE_DURATION = 400 // ms for pulse to travel along edge

// Combined transform (user zoom/pan + hero centering)
const combinedTransform = computed(() => {
  // Parse the hero pan offset from panTransform prop
  const heroMatch = props.panTransform.match(/translate\((-?\d+\.?\d*)px,\s*(-?\d+\.?\d*)px\)/)
  const heroX = heroMatch ? parseFloat(heroMatch[1]) : 0
  const heroY = heroMatch ? parseFloat(heroMatch[2]) : 0

  // Combine: first apply hero centering, then user pan, then scale
  const totalX = heroX + userPan.value.x
  const totalY = heroY + userPan.value.y

  return `translate(${totalX}px, ${totalY}px) scale(${userScale.value})`
})

// ============================================================================
// MOUSE WHEEL ZOOM
// ============================================================================

function handleWheel(e: WheelEvent) {
  e.preventDefault()

  // Skip if interaction is disabled
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
  if (svgRef.value) {
    const rect = svgRef.value.getBoundingClientRect()
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
  // Skip if interaction is disabled
  if (props.disableInteraction) return

  // Only pan on left click, and not on nodes
  if (e.button !== 0) return
  if ((e.target as Element).closest('.node')) return

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
  // Skip if interaction is disabled
  if (props.disableInteraction) return

  // Don't prevent default - allow native scrolling to work when needed
  if ((e.target as Element).closest('.node')) return

  if (e.touches.length === 2) {
    // Pinch start
    initialPinchDistance.value = getTouchDistance(e)
    initialPinchScale.value = userScale.value
    e.preventDefault() // Prevent zoom for pinch only
  } else if (e.touches.length === 1) {
    // Single touch drag
    isDragging.value = true
    dragStart.value = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    dragPanStart.value = { ...userPan.value }
  }
}

function handleTouchMove(e: TouchEvent) {
  // Skip if interaction is disabled
  if (props.disableInteraction) return

  if (e.touches.length === 2 && initialPinchDistance.value > 0) {
    e.preventDefault()

    // Pinch zoom
    const currentDistance = getTouchDistance(e)
    const scale = currentDistance / initialPinchDistance.value
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialPinchScale.value * scale))

    // Zoom toward pinch center
    if (svgRef.value) {
      const rect = svgRef.value.getBoundingClientRect()
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
// RESET ZOOM/PAN
// ============================================================================

function resetZoomPan() {
  userScale.value = 1
  userPan.value = { x: 0, y: 0 }
}

// ============================================================================
// ZOOM/PAN CONTROLS (for buttons and keyboard)
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

// ============================================================================
// KEYBOARD CONTROLS
// ============================================================================

function handleKeyDown(e: KeyboardEvent) {
  // Don't handle if user is typing in an input
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

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
      // Reset zoom/pan
      e.preventDefault()
      resetZoomPan()
      break
  }
}

// Watch for hero changes - optionally reset user pan
watch(() => props.heroNodeId, () => {
  // Don't reset zoom, but could smooth the transition
  // For now, just let the combined transform handle it
})

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  // Add global mouse handlers for drag
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  // Add keyboard handlers for zoom/pan
  window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('keydown', handleKeyDown)
})

// ============================================================================
// HELPERS
// ============================================================================

function getPalette(belt: string) {
  return BELT_PALETTES[belt] || BELT_PALETTES.white
}

function isNodeInPath(nodeId: string): boolean {
  if (!props.currentPath) return false
  const idx = props.currentPath.nodeIds.indexOf(nodeId)
  if (idx === -1) return false
  // Only highlight nodes up to (and including) the active index
  return idx <= props.currentPath.activeIndex
}

function isNodeResonating(nodeId: string): boolean {
  return props.resonatingNodeIds.includes(nodeId) && !isNodeInPath(nodeId)
}

function isEdgeInPath(edgeId: string): boolean {
  if (!props.currentPath) return false
  const idx = props.currentPath.edgeIds.indexOf(edgeId)
  if (idx === -1) return false
  // Only highlight edges up to (activeIndex - 1) since edge[i] connects node[i] to node[i+1]
  return idx < props.currentPath.activeIndex
}

// Check if a node has been revealed (learned by user)
function isNodeRevealed(nodeId: string): boolean {
  // If no revealedNodeIds prop, all nodes are considered revealed
  if (!props.revealedNodeIds) return true
  return props.revealedNodeIds.has(nodeId)
}

function getNodeOpacity(node: ConstellationNode): number {
  // Unrevealed nodes: completely hide if hideUnrevealedNodes, otherwise very faint
  if (!isNodeRevealed(node.id)) {
    return props.hideUnrevealedNodes ? 0 : 0.08
  }
  // Hero node (current LEGO being learned) is brightest
  if (node.id === props.heroNodeId) return 1
  // Nodes actively in the current phrase path
  if (isNodeInPath(node.id)) return 1
  // Resonating nodes - fainter glimmer (contain words from phrase)
  if (isNodeResonating(node.id)) return 0.35
  // Component nodes are subtler
  if (node.isComponent) return 0.4
  // Default: revealed nodes should still be clearly visible
  return 0.55
}

/**
 * Get node size multiplier - component nodes are smaller
 */
function getNodeSize(node: ConstellationNode, isActive: boolean): {
  glow: number
  core: number
  inner: number
} {
  // Component nodes are 60% the size of regular nodes
  const scale = node.isComponent ? 0.6 : 1

  if (isActive) {
    return {
      glow: 22 * scale,
      core: 14 * scale,
      inner: 5 * scale,
    }
  }
  return {
    glow: 18 * scale,
    core: 12 * scale,
    inner: 4 * scale,
  }
}

function getEdgeOpacity(edge: ConstellationEdge): number {
  // If hideUnrevealedNodes is true, hide edges connected to unrevealed nodes
  if (props.hideUnrevealedNodes) {
    const sourceId = getEdgeNodeId(edge.source as string | { id: string })
    const targetId = getEdgeNodeId(edge.target as string | { id: string })
    if (!isNodeRevealed(sourceId) || !isNodeRevealed(targetId)) {
      return 0
    }
  }
  // Active path edges are bright
  if (isEdgeInPath(edge.id)) return 0.85
  // Background edges: subtle, Hebbian strength increases opacity slightly
  // Range: ~0.08 to ~0.25 (much more subtle than before)
  return Math.min(0.25, 0.08 + Math.sqrt(edge.strength) * 0.015)
}

function getEdgeWidth(edge: ConstellationEdge): number {
  // Active path edges are prominent
  if (isEdgeInPath(edge.id)) return 3
  // Background edges: thin, Hebbian strength increases width slightly
  // Range: ~0.5 to ~1.5 (much thinner than before)
  return Math.min(1.5, 0.5 + Math.sqrt(edge.strength) * 0.08)
}

// Helper to extract ID from edge source/target (D3 forceLink mutates these to object refs)
function getEdgeNodeId(ref: string | { id: string }): string {
  return typeof ref === 'string' ? ref : ref.id
}

// Calculate curved path between two nodes
function getEdgePath(edge: ConstellationEdge): string {
  const sourceId = getEdgeNodeId(edge.source as string | { id: string })
  const targetId = getEdgeNodeId(edge.target as string | { id: string })
  const source = props.nodes.find(n => n.id === sourceId)
  const target = props.nodes.find(n => n.id === targetId)
  if (!source || !target) return ''

  const x1 = source.x
  const y1 = source.y
  const x2 = target.x
  const y2 = target.y

  // Quadratic bezier with perpendicular offset
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)

  if (len === 0) return `M ${x1} ${y1} L ${x2} ${y2}`

  const curveAmount = Math.min(25, len * 0.12)
  const perpX = -dy / len
  const perpY = dx / len

  // Consistent curve direction based on edge ID hash
  const hash = edge.id.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const direction = hash % 2 === 0 ? 1 : -1

  const cpX = midX + perpX * curveAmount * direction
  const cpY = midY + perpY * curveAmount * direction

  return `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`
}

function handleNodeTap(node: ConstellationNode): void {
  emit('node-tap', node)
}

function handleNodeHover(node: ConstellationNode | null): void {
  emit('node-hover', node)
}

// ============================================================================
// TRAVELING PULSE LOGIC
// ============================================================================

/**
 * Spawn a traveling pulse along an edge
 */
function spawnPulse(edgeIndex: number): void {
  // Skip if fire path animation is disabled
  if (!props.showFirePath) return
  if (!props.currentPath) return

  const nodeIds = props.currentPath.nodeIds
  if (edgeIndex < 0 || edgeIndex >= nodeIds.length - 1) return

  const sourceId = nodeIds[edgeIndex]
  const targetId = nodeIds[edgeIndex + 1]

  // Find the edge (could be in either direction)
  const edgeId = `${sourceId}->${targetId}`
  const reverseEdgeId = `${targetId}->${sourceId}`
  const edge = props.edges.find(e => e.id === edgeId || e.id === reverseEdgeId)

  if (!edge) return

  // Get the path for this edge
  const pathD = getEdgePath(edge)
  if (!pathD) return

  // Create pulse
  const pulse: TravelingPulse = {
    id: `pulse-${pulseIdCounter++}`,
    edgeId: edge.id,
    pathD,
    duration: PULSE_DURATION,
    startTime: Date.now(),
  }

  travelingPulses.value.push(pulse)

  // Remove pulse after animation completes
  setTimeout(() => {
    travelingPulses.value = travelingPulses.value.filter(p => p.id !== pulse.id)
  }, PULSE_DURATION + 100)
}

/**
 * Clear all traveling pulses
 */
function clearPulses(): void {
  travelingPulses.value = []
}

// Watch for path activeIndex changes to spawn pulses
watch(
  () => props.currentPath?.activeIndex,
  (newIndex, oldIndex) => {
    if (newIndex === undefined || newIndex === null) return
    if (oldIndex === undefined || oldIndex === null) return

    // When activeIndex increases, spawn a pulse on the newly activated edge
    // Edge[i] connects node[i] to node[i+1], so when activeIndex goes to N,
    // we're activating node N, and the edge from node N-1 to node N should pulse
    if (newIndex > oldIndex && newIndex > 0) {
      spawnPulse(newIndex - 1)
    }
  }
)

// Clear pulses when path changes completely
watch(
  () => props.currentPath?.nodeIds,
  () => {
    clearPulses()
  },
  { deep: true }
)

// Computed for label visibility
const labelOpacity = computed(() => (node: ConstellationNode): number => {
  // Hide labels for unrevealed nodes
  if (!isNodeRevealed(node.id)) return 0
  if (props.showPathLabels) {
    if (isNodeInPath(node.id)) return 1
    if (isNodeResonating(node.id)) return 0.5
  }
  return 0
})

// Expose methods for parent components
defineExpose({
  resetZoomPan,
  zoomIn,
  zoomOut,
  userScale,
  userPan
})
</script>

<template>
  <div class="constellation-network">
    <!-- Network container with CSS transform for panning -->
    <svg
      ref="svgRef"
      class="network-svg"
      :class="{ 'is-interacting': isInteracting, 'is-dragging': isDragging }"
      viewBox="0 0 800 800"
      preserveAspectRatio="xMidYMid meet"
      @wheel="handleWheel"
      @mousedown="handleMouseDown"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
    >
      <!-- Defs for filters -->
      <defs>
        <!-- Glow filter for active nodes -->
        <filter id="constellation-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <!-- Active edge glow -->
        <filter id="edge-active-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <!-- Traveling pulse glow -->
        <filter id="pulse-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <!-- Brain boundary glow filter -->
        <filter id="brain-boundary-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Pan group - transforms to center on hero + user zoom/pan -->
      <g class="pan-group" :style="{ transform: combinedTransform }">

        <!-- Brain boundary outline (subtle, shows the "growing brain" shape) -->
        <path
          v-if="brainBoundarySvgPath"
          class="brain-boundary"
          :d="brainBoundarySvgPath"
          :stroke="brainBoundaryColor"
          stroke-width="1.5"
          fill="none"
          opacity="0.12"
          filter="url(#brain-boundary-glow)"
        />

        <!-- Edges layer -->
        <g class="edges-layer">
          <path
            v-for="edge in edges"
            :key="edge.id"
            :d="getEdgePath(edge)"
            class="edge"
            :class="{ 'edge-active': isEdgeInPath(edge.id) }"
            :stroke-width="getEdgeWidth(edge)"
            :opacity="getEdgeOpacity(edge)"
            :filter="isEdgeInPath(edge.id) ? 'url(#edge-active-glow)' : 'none'"
            fill="none"
            stroke-linecap="round"
          />
        </g>

        <!-- Traveling pulses layer -->
        <g class="pulses-layer">
          <circle
            v-for="pulse in travelingPulses"
            :key="pulse.id"
            class="traveling-pulse"
            r="8"
            fill="#fbbf24"
            filter="url(#pulse-glow)"
          >
            <!-- Animate the pulse along the edge path -->
            <animateMotion
              :dur="`${pulse.duration}ms`"
              fill="freeze"
              calcMode="linear"
            >
              <mpath :href="`#pulse-path-${pulse.id}`" />
            </animateMotion>
            <!-- Fade out at the end -->
            <animate
              attributeName="opacity"
              :dur="`${pulse.duration}ms`"
              values="1;1;0"
              keyTimes="0;0.7;1"
              fill="freeze"
            />
            <!-- Grow slightly at the end -->
            <animate
              attributeName="r"
              :dur="`${pulse.duration}ms`"
              values="6;8;12"
              keyTimes="0;0.7;1"
              fill="freeze"
            />
          </circle>
          <!-- Hidden paths for animateMotion to reference -->
          <path
            v-for="pulse in travelingPulses"
            :key="`path-${pulse.id}`"
            :id="`pulse-path-${pulse.id}`"
            :d="pulse.pathD"
            fill="none"
            stroke="none"
          />
        </g>

        <!-- Nodes layer -->
        <g class="nodes-layer">
          <g
            v-for="node in nodes"
            :key="node.id"
            class="node"
            :class="{
              'node-in-path': isNodeInPath(node.id),
              'node-hero': node.id === heroNodeId,
              'node-resonating': isNodeResonating(node.id),
              'node-component': node.isComponent,
              'node-unrevealed': !isNodeRevealed(node.id)
            }"
            :transform="`translate(${node.x}, ${node.y})`"
            :opacity="getNodeOpacity(node)"
            @click="handleNodeTap(node)"
            @mouseenter="handleNodeHover(node)"
            @mouseleave="handleNodeHover(null)"
          >
            <!-- Outer glow ring -->
            <circle
              class="node-glow"
              :r="getNodeSize(node, isNodeInPath(node.id) || node.id === heroNodeId).glow"
              fill="none"
              :stroke="getPalette(node.belt).glow"
              :stroke-width="isNodeInPath(node.id) || node.id === heroNodeId ? 3 : 2"
              :opacity="isNodeInPath(node.id) || node.id === heroNodeId ? 0.8 : (node.isComponent ? 0.4 : 0.6)"
              :filter="isNodeInPath(node.id) || node.id === heroNodeId ? 'url(#constellation-glow)' : 'none'"
            />

            <!-- Core circle -->
            <circle
              class="node-core"
              :r="getNodeSize(node, isNodeInPath(node.id) || node.id === heroNodeId).core"
              :fill="getPalette(node.belt).core"
              :stroke="getPalette(node.belt).glow"
              :stroke-width="isNodeInPath(node.id) || node.id === heroNodeId ? 2 : 1.5"
              :stroke-opacity="isNodeInPath(node.id) || node.id === heroNodeId ? 1 : 0.7"
            />

            <!-- Inner dot -->
            <circle
              class="node-inner"
              :r="getNodeSize(node, node.id === heroNodeId).inner"
              :fill="getPalette(node.belt).inner"
              :opacity="isNodeInPath(node.id) || node.id === heroNodeId ? 1 : 0.7"
            />
          </g>
        </g>

        <!-- Labels layer -->
        <g class="labels-layer">
          <text
            v-for="node in nodes"
            :key="`label-${node.id}`"
            :x="node.x"
            :y="node.y + (node.isComponent ? 18 : 28)"
            text-anchor="middle"
            class="node-label"
            :class="{ 'node-label-component': node.isComponent }"
            :fill="getPalette(node.belt).label"
            :opacity="labelOpacity(node)"
            :font-size="node.isComponent ? '9px' : '11px'"
          >
            {{ node.targetText }}
          </text>
        </g>
      </g>
    </svg>

    <!-- Zoom/Pan Controls -->
    <div class="network-controls">
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
.constellation-network {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.network-svg {
  width: 100%;
  height: 100%;
  display: block;
  cursor: grab;
  touch-action: none; /* Prevent browser handling of touch gestures */
}

.network-svg.is-dragging {
  cursor: grabbing;
}

.pan-group {
  transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  transform-origin: center center;
}

/* Disable transition during active interaction for responsiveness */
.network-svg.is-interacting .pan-group {
  transition: none;
}

.node {
  cursor: pointer;
  transition: opacity 0.3s ease;
}

.node-glow {
  transition: r 0.2s ease, stroke-width 0.2s ease, opacity 0.2s ease;
}

.node-core {
  transition: r 0.2s ease, stroke-width 0.2s ease;
}

.node-inner {
  transition: opacity 0.2s ease;
}

.edge {
  stroke: var(--network-edge-stroke, rgba(255, 255, 255, 0.1));
  transition: stroke 0.3s ease, stroke-width 0.3s ease, opacity 0.3s ease;
}

.edge-active {
  animation: edge-pulse 0.6s ease-in-out infinite alternate;
  stroke: var(--network-active-edge, #60a5fa) !important;
}

@keyframes edge-pulse {
  from {
    opacity: 0.5;
    stroke-width: 3px;
  }
  to {
    opacity: 1;
    stroke-width: 4.5px;
  }
}

/* Traveling pulse styling */
.traveling-pulse {
  pointer-events: none;
}

.pulses-layer {
  pointer-events: none;
}

/* Nodes in path should also pulse */
.node-in-path {
  animation: node-path-pulse 0.8s ease-in-out infinite alternate;
}

@keyframes node-path-pulse {
  from {
    filter: drop-shadow(0 0 8px rgba(96, 165, 250, 0.4));
  }
  to {
    filter: drop-shadow(0 0 16px rgba(96, 165, 250, 0.8));
  }
}

/* Hero node (current LEGO being learned) - prominent glow */
.node-hero:not(.node-in-path) {
  animation: node-hero-pulse 1.2s ease-in-out infinite alternate;
}

@keyframes node-hero-pulse {
  from {
    filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.5));
  }
  to {
    filter: drop-shadow(0 0 20px rgba(251, 191, 36, 0.8));
  }
}

/* Resonating nodes - subtle glimmer when they contain words from phrase */
.node-resonating:not(.node-in-path):not(.node-hero) {
  animation: node-resonate 1.5s ease-in-out infinite alternate;
}

@keyframes node-resonate {
  from {
    filter: drop-shadow(0 0 3px var(--network-node-stroke, rgba(255, 255, 255, 0.1)));
  }
  to {
    filter: drop-shadow(0 0 8px var(--network-node-stroke, rgba(255, 255, 255, 0.3)));
  }
}

.node-glow {
  transition: r 0.2s ease, stroke-width 0.2s ease, opacity 0.2s ease;
}

.node-label {
  font-family: system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
  pointer-events: none;
  transition: opacity 0.3s ease;
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
