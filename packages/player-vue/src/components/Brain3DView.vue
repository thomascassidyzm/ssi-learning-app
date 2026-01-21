<script setup lang="ts">
/**
 * Brain3DView.vue - Three.js 3D Brain Visualization
 *
 * Integrates all Three.js brain composables into a working 3D visualization:
 * - useBrainScene: Scene, camera, renderer, controls
 * - useBrainNodes: GPU-instanced particle system for nodes
 * - useBrainEdges: GPU-instanced line system for edges
 * - useBrainInteraction: Raycasting for hover, click, search
 * - useBrainFirePath: Animated "fire path" phrase visualization
 * - useBrainReplay: Growth timelapse replay animation
 *
 * This component wires them all together with the same props interface
 * as the existing 2D BrainView for easy drop-in replacement.
 */

import { ref, computed, watch, onMounted, onUnmounted, type PropType } from 'vue'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// These types match the existing usePrebuiltNetwork types for compatibility
export interface ConstellationNode {
  id: string
  targetText: string
  knownText: string
  belt: string
  x: number
  y: number
  z?: number  // Optional Z for 3D positioning
  isComponent?: boolean
  parentLegoIds?: string[]
}

export interface ConstellationEdge {
  id: string
  source: string
  target: string
  strength: number
}

export interface PathHighlight {
  nodeIds: string[]
  edgeIds: string[]
  activeIndex: number
}

// =============================================================================
// COMPOSABLE IMPORTS (TODO: Import when composables are ready)
// =============================================================================

// TODO: Uncomment these imports when the composables are implemented
// import { useBrainScene } from '../composables/three/useBrainScene'
// import { useBrainNodes } from '../composables/three/useBrainNodes'
// import { useBrainEdges } from '../composables/three/useBrainEdges'
// import { useBrainInteraction } from '../composables/three/useBrainInteraction'
// import { useBrainFirePath } from '../composables/three/useBrainFirePath'
// import { useBrainReplay } from '../composables/three/useBrainReplay'

// =============================================================================
// PROPS & EMITS
// =============================================================================

const props = defineProps({
  /**
   * All constellation nodes with pre-calculated positions
   */
  nodes: {
    type: Array as PropType<ConstellationNode[]>,
    required: true,
  },
  /**
   * All constellation edges with strength values
   */
  edges: {
    type: Array as PropType<ConstellationEdge[]>,
    required: true,
  },
  /**
   * Set of revealed node IDs (null = all revealed)
   * Controls which nodes are visible vs ghost
   */
  revealedNodeIds: {
    type: Object as PropType<Set<string> | null>,
    default: null,
  },
  /**
   * Current path highlight for fire path animation
   * Contains nodeIds, edgeIds, and activeIndex
   */
  currentPath: {
    type: Object as PropType<PathHighlight | null>,
    default: null,
  },
  /**
   * Current belt level for accent color
   */
  beltLevel: {
    type: String,
    default: 'white',
  },
  /**
   * Node ID to fly to / focus on (for search integration)
   */
  searchNodeId: {
    type: String as PropType<string | null>,
    default: null,
  },
})

const emit = defineEmits<{
  /**
   * Emitted when a node is clicked/tapped
   */
  (e: 'node-tap', node: ConstellationNode): void
  /**
   * Emitted when a node is hovered (or null when hover ends)
   */
  (e: 'node-hover', node: ConstellationNode | null): void
}>()

// =============================================================================
// BELT COLOR PALETTE
// =============================================================================

const BELT_COLORS: Record<string, string> = {
  white: '#9ca3af',
  yellow: '#fbbf24',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  brown: '#a87848',
  black: '#d4a853',
}

const accentColor = computed(() => BELT_COLORS[props.beltLevel] || BELT_COLORS.white)

// =============================================================================
// DOM REFS
// =============================================================================

const containerRef = ref<HTMLElement | null>(null)

// =============================================================================
// COMPOSABLE STATE (TODO: Replace with actual composables)
// =============================================================================

// Placeholder state - will be replaced by actual composable returns
const isInitialized = ref(false)
const isLoading = ref(true)
const error = ref<string | null>(null)

// Controls state
const autoRotate = ref(true)

// Replay state
const isReplaying = ref(false)
const replayProgress = ref(0)
const replaySpeed = ref(1)

// Interaction state
const hoveredNode = ref<ConstellationNode | null>(null)
const tooltipPosition = ref({ top: '0px', left: '0px' })

// =============================================================================
// SCENE INITIALIZATION
// =============================================================================

/**
 * Initialize the Three.js scene and all subsystems
 * Called on mount after container is available
 */
async function initScene(): Promise<void> {
  if (!containerRef.value) {
    error.value = 'Container not available'
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = null

  try {
    // TODO: Initialize composables when they're ready
    // const scene = useBrainScene(containerRef)
    // const nodes = useBrainNodes(scene, props.nodes, props.revealedNodeIds)
    // const edges = useBrainEdges(scene, props.edges, props.nodes)
    // const interaction = useBrainInteraction(scene, nodes, edges)
    // const firePath = useBrainFirePath(scene, nodes, edges)
    // const replay = useBrainReplay(scene, nodes, edges)

    // Placeholder: Simulate initialization delay
    await new Promise(resolve => setTimeout(resolve, 500))

    isInitialized.value = true
    console.log('[Brain3DView] Scene initialized (placeholder)')

  } catch (err) {
    console.error('[Brain3DView] Failed to initialize scene:', err)
    error.value = err instanceof Error ? err.message : 'Failed to initialize 3D scene'
  } finally {
    isLoading.value = false
  }
}

/**
 * Dispose of all Three.js resources
 * Called on unmount to prevent memory leaks
 */
function disposeScene(): void {
  // TODO: Call dispose on all composables
  // scene.dispose()
  // nodes.dispose()
  // edges.dispose()
  // etc.

  isInitialized.value = false
  console.log('[Brain3DView] Scene disposed')
}

// =============================================================================
// CONTROL METHODS
// =============================================================================

/**
 * Toggle auto-rotation of the brain
 */
function toggleAutoRotate(): void {
  autoRotate.value = !autoRotate.value
  // TODO: Update scene controls
  // scene.controls.value.autoRotate = autoRotate.value
  console.log('[Brain3DView] Auto-rotate:', autoRotate.value)
}

/**
 * Start the growth replay animation
 */
function startReplay(): void {
  if (isReplaying.value) return

  isReplaying.value = true
  replayProgress.value = 0

  // TODO: Start actual replay via composable
  // replay.start(props.nodes, props.revealedNodeIds)

  console.log('[Brain3DView] Replay started')

  // Placeholder: Simulate replay progress
  const interval = setInterval(() => {
    replayProgress.value += 0.01
    if (replayProgress.value >= 1) {
      clearInterval(interval)
      stopReplay()
    }
  }, 50 / replaySpeed.value)
}

/**
 * Stop the replay animation
 */
function stopReplay(): void {
  isReplaying.value = false
  replayProgress.value = 0

  // TODO: Stop actual replay via composable
  // replay.stop()

  console.log('[Brain3DView] Replay stopped')
}

/**
 * Set replay speed multiplier
 */
function setSpeed(speed: number): void {
  replaySpeed.value = speed
  // TODO: Update replay composable speed
  // replay.setSpeed(speed)
  console.log('[Brain3DView] Replay speed:', speed)
}

/**
 * Fly camera to a specific node (for search)
 */
function flyToNode(nodeId: string): void {
  const node = props.nodes.find(n => n.id === nodeId)
  if (!node) {
    console.warn('[Brain3DView] Node not found:', nodeId)
    return
  }

  // TODO: Animate camera to node position via scene composable
  // scene.flyTo(node.x, node.y, node.z ?? 0)

  console.log('[Brain3DView] Flying to node:', nodeId)
}

// =============================================================================
// INTERACTION HANDLERS
// =============================================================================

/**
 * Handle mouse move for hover detection
 */
function handleMouseMove(event: MouseEvent): void {
  if (!containerRef.value || !isInitialized.value) return

  // Update tooltip position to follow cursor
  const rect = containerRef.value.getBoundingClientRect()
  tooltipPosition.value = {
    top: `${event.clientY - rect.top + 15}px`,
    left: `${event.clientX - rect.left + 15}px`,
  }

  // TODO: Raycast via interaction composable
  // const hit = interaction.raycast(event)
  // if (hit !== hoveredNode.value) {
  //   hoveredNode.value = hit
  //   emit('node-hover', hit)
  // }
}

/**
 * Handle click/tap for node selection
 */
function handleClick(event: MouseEvent): void {
  if (!isInitialized.value) return

  // TODO: Raycast via interaction composable
  // const hit = interaction.raycast(event)
  // if (hit) {
  //   emit('node-tap', hit)
  // }

  // Placeholder: Use hovered node if available
  if (hoveredNode.value) {
    emit('node-tap', hoveredNode.value)
  }
}

// =============================================================================
// WATCHERS
// =============================================================================

// Watch for search node changes and fly to it
watch(() => props.searchNodeId, (nodeId) => {
  if (nodeId) {
    flyToNode(nodeId)
  }
})

// Watch for current path changes and trigger fire path animation
watch(() => props.currentPath, (path) => {
  if (!path) {
    // TODO: Clear fire path via composable
    // firePath.clear()
    return
  }

  // TODO: Animate fire path via composable
  // firePath.animate(path.nodeIds, path.edgeIds, path.activeIndex)

  console.log('[Brain3DView] Fire path updated:', path.nodeIds.length, 'nodes')
}, { deep: true })

// Watch for nodes changes and update particle system
watch(() => props.nodes, (newNodes) => {
  if (!isInitialized.value) return

  // TODO: Update node positions via composable
  // nodes.updatePositions(newNodes)

  console.log('[Brain3DView] Nodes updated:', newNodes.length)
}, { deep: true })

// Watch for revealed nodes changes and update visibility
watch(() => props.revealedNodeIds, (revealed) => {
  if (!isInitialized.value) return

  // TODO: Update node visibility via composable
  // nodes.updateVisibility(revealed)

  console.log('[Brain3DView] Visibility updated:', revealed?.size ?? 'all')
}, { deep: true })

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(() => {
  initScene()
})

onUnmounted(() => {
  if (isReplaying.value) {
    stopReplay()
  }
  disposeScene()
})

// =============================================================================
// EXPOSE PUBLIC METHODS
// =============================================================================

defineExpose({
  /**
   * Fly camera to a specific node by ID
   */
  flyToNode,
  /**
   * Toggle auto-rotation
   */
  toggleAutoRotate,
  /**
   * Start growth replay
   */
  startReplay,
  /**
   * Stop growth replay
   */
  stopReplay,
})
</script>

<template>
  <div
    ref="containerRef"
    class="brain-3d-view"
    @mousemove="handleMouseMove"
    @click="handleClick"
  >
    <!-- Loading state -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>Initializing 3D visualization...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="error-overlay">
      <p class="error-message">{{ error }}</p>
      <button class="retry-btn" @click="initScene">Retry</button>
    </div>

    <!-- Three.js canvas renders here via composable -->
    <!-- The useBrainScene composable will append a canvas to containerRef -->

    <!-- Overlay UI -->
    <div v-if="isInitialized && !isLoading" class="brain-controls">
      <button
        class="control-btn"
        :class="{ active: autoRotate }"
        :style="autoRotate ? { borderColor: accentColor, color: accentColor } : {}"
        @click="toggleAutoRotate"
        title="Toggle auto-rotate"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
      <button
        class="control-btn"
        :class="{ active: isReplaying }"
        :style="isReplaying ? { borderColor: accentColor, color: accentColor } : {}"
        @click="isReplaying ? stopReplay() : startReplay()"
        title="Watch brain growth"
      >
        <svg v-if="!isReplaying" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
      </button>
    </div>

    <!-- Replay progress bar (when playing) -->
    <div v-if="isReplaying" class="replay-controls">
      <div class="progress-track">
        <div
          class="progress-bar"
          :style="{
            width: replayProgress * 100 + '%',
            backgroundColor: accentColor
          }"
        ></div>
      </div>
      <div class="speed-controls">
        <button
          v-for="speed in [1, 2, 4, 8]"
          :key="speed"
          class="speed-btn"
          :class="{ active: replaySpeed === speed }"
          :style="replaySpeed === speed ? { color: accentColor, borderColor: accentColor } : {}"
          @click="setSpeed(speed)"
        >
          {{ speed }}x
        </button>
      </div>
    </div>

    <!-- Tooltip (positioned near cursor) -->
    <div
      v-if="hoveredNode"
      class="node-tooltip"
      :style="tooltipPosition"
    >
      <span class="tooltip-target">{{ hoveredNode.targetText }}</span>
      <span v-if="hoveredNode.knownText" class="tooltip-known">{{ hoveredNode.knownText }}</span>
    </div>
  </div>
</template>

<style scoped>
.brain-3d-view {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 400px;
  background: linear-gradient(180deg, #0a0a0f 0%, #0f0f18 50%, #12121a 100%);
  overflow: hidden;
  user-select: none;
}

/* Three.js canvas will be appended as a child, ensure it fills container */
.brain-3d-view :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* ============================================
   LOADING & ERROR OVERLAYS
   ============================================ */

.loading-overlay,
.error-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: rgba(10, 10, 15, 0.95);
  z-index: 50;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-overlay p,
.error-overlay p {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.875rem;
}

.error-message {
  color: rgba(239, 68, 68, 0.9) !important;
  max-width: 300px;
  text-align: center;
}

.retry-btn {
  padding: 8px 20px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: white;
}

/* ============================================
   CONTROL BUTTONS
   ============================================ */

.brain-controls {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top, 0px));
  right: calc(16px + env(safe-area-inset-right, 0px));
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(10, 10, 15, 0.85);
  backdrop-filter: blur(12px);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.control-btn:active {
  transform: scale(0.95);
}

.control-btn.active {
  background: rgba(255, 255, 255, 0.08);
}

.control-btn svg {
  width: 20px;
  height: 20px;
}

/* ============================================
   REPLAY CONTROLS
   ============================================ */

.replay-controls {
  position: absolute;
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px;
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  min-width: 280px;
}

.progress-track {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.1s linear;
}

.speed-controls {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.speed-btn {
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.speed-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.speed-btn.active {
  background: rgba(255, 255, 255, 0.1);
  font-weight: 600;
}

/* ============================================
   NODE TOOLTIP
   ============================================ */

.node-tooltip {
  position: absolute;
  z-index: 100;
  padding: 10px 14px;
  background: rgba(10, 10, 15, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  pointer-events: none;
  max-width: 200px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.tooltip-target {
  display: block;
  color: rgba(255, 255, 255, 0.95);
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 2px;
}

.tooltip-known {
  display: block;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.8125rem;
}

/* ============================================
   MOBILE ADJUSTMENTS
   ============================================ */

@media (max-width: 480px) {
  .brain-controls {
    top: calc(12px + env(safe-area-inset-top, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    gap: 6px;
  }

  .control-btn {
    width: 40px;
    height: 40px;
  }

  .control-btn svg {
    width: 18px;
    height: 18px;
  }

  .replay-controls {
    min-width: unset;
    width: calc(100% - 32px);
    max-width: 320px;
    padding: 12px 16px;
    bottom: calc(80px + env(safe-area-inset-bottom, 0px));
  }

  .speed-btn {
    padding: 5px 10px;
    font-size: 0.7rem;
  }

  .node-tooltip {
    max-width: 160px;
    padding: 8px 12px;
  }

  .tooltip-target {
    font-size: 0.875rem;
  }

  .tooltip-known {
    font-size: 0.75rem;
  }
}

/* ============================================
   TOUCH DEVICE ADJUSTMENTS
   ============================================ */

@media (hover: none) and (pointer: coarse) {
  /* Hide hover tooltip on touch devices - use tap instead */
  .node-tooltip {
    display: none;
  }
}
</style>
