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
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
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

function getNodeOpacity(node: ConstellationNode): number {
  if (isNodeInPath(node.id)) return 1
  if (isNodeResonating(node.id)) return 0.4
  if (node.id === props.heroNodeId) return 1
  return 0.25
}

function getEdgeOpacity(edge: ConstellationEdge): number {
  if (isEdgeInPath(edge.id)) return 1
  // Base opacity - visible even at low strength
  return Math.min(0.6, 0.25 + Math.pow(edge.strength, 0.3) * 0.1)
}

function getEdgeWidth(edge: ConstellationEdge): number {
  if (isEdgeInPath(edge.id)) return 4
  // Base width - visible even at low strength
  return Math.min(3.5, 1.5 + Math.pow(edge.strength, 0.4) * 0.5)
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
  if (props.showPathLabels) {
    if (isNodeInPath(node.id)) return 1
    if (isNodeResonating(node.id)) return 0.5
  }
  return 0
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
      </defs>

      <!-- Pan group - transforms to center on hero + user zoom/pan -->
      <g class="pan-group" :style="{ transform: combinedTransform }">
        <!-- Edges layer -->
        <g class="edges-layer">
          <path
            v-for="edge in edges"
            :key="edge.id"
            :d="getEdgePath(edge)"
            :stroke="isEdgeInPath(edge.id) ? '#60a5fa' : '#ffffff'"
            :stroke-width="getEdgeWidth(edge)"
            :opacity="getEdgeOpacity(edge)"
            :filter="isEdgeInPath(edge.id) ? 'url(#edge-active-glow)' : 'none'"
            fill="none"
            stroke-linecap="round"
            class="edge"
            :class="{ 'edge-active': isEdgeInPath(edge.id) }"
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
            :class="{ 'node-in-path': isNodeInPath(node.id) }"
            :transform="`translate(${node.x}, ${node.y})`"
            :opacity="getNodeOpacity(node)"
            @click="handleNodeTap(node)"
            @mouseenter="handleNodeHover(node)"
            @mouseleave="handleNodeHover(null)"
          >
            <!-- Outer glow ring -->
            <circle
              class="node-glow"
              :r="isNodeInPath(node.id) ? 22 : 18"
              fill="none"
              :stroke="getPalette(node.belt).glow"
              :stroke-width="isNodeInPath(node.id) ? 3 : 2"
              :opacity="isNodeInPath(node.id) ? 0.8 : 0.4"
              :filter="isNodeInPath(node.id) ? 'url(#constellation-glow)' : 'none'"
            />

            <!-- Core circle -->
            <circle
              class="node-core"
              :r="isNodeInPath(node.id) ? 14 : 12"
              :fill="getPalette(node.belt).core"
              :stroke="getPalette(node.belt).glow"
              :stroke-width="isNodeInPath(node.id) ? 2 : 1.5"
              :stroke-opacity="isNodeInPath(node.id) ? 1 : 0.5"
            />

            <!-- Inner dot -->
            <circle
              class="node-inner"
              r="4"
              :fill="getPalette(node.belt).inner"
              :opacity="isNodeInPath(node.id) ? 1 : 0.5"
            />
          </g>
        </g>

        <!-- Labels layer -->
        <g class="labels-layer">
          <text
            v-for="node in nodes"
            :key="`label-${node.id}`"
            :x="node.x"
            :y="node.y + 28"
            text-anchor="middle"
            class="node-label"
            :fill="getPalette(node.belt).label"
            :opacity="labelOpacity(node)"
          >
            {{ node.targetText }}
          </text>
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.constellation-network {
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
  transition: stroke 0.3s ease, stroke-width 0.3s ease, opacity 0.3s ease;
}

.edge-active {
  animation: edge-pulse 0.6s ease-in-out infinite alternate;
  stroke: #60a5fa !important;
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
</style>
