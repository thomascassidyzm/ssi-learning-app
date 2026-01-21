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
// COMPOSABLE IMPORTS
// =============================================================================

import { useBrainScene } from '../composables/useBrainScene'
import { useBrainNodes, type BrainNode, type Belt } from '../composables/useBrainNodes'
import { useBrainEdges, type BrainEdge } from '../composables/useBrainEdges'
import { useBrainInteraction } from '../composables/useBrainInteraction'
import { useBrainFirePath } from '../composables/useBrainFirePath'
import { useBrainReplay } from '../composables/useBrainReplay'

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
// COMPOSABLE INITIALIZATION
// =============================================================================

// Initialize all composables
const brainScene = useBrainScene()
const brainNodes = useBrainNodes()
const brainEdges = useBrainEdges()
const brainInteraction = useBrainInteraction()
const brainFirePath = useBrainFirePath()
const brainReplay = useBrainReplay()

// =============================================================================
// LOCAL STATE
// =============================================================================

// Loading/error state
const isLoading = ref(true)
const error = ref<string | null>(null)

// Computed state from composables
const isInitialized = computed(() => brainScene.isInitialized.value)
const autoRotate = computed(() => brainScene.isAutoRotating.value)
const isReplaying = computed(() => brainReplay.isPlaying.value)
const replayProgress = computed(() => brainReplay.progress.value)
const replaySpeed = computed(() => brainReplay.currentSpeed.value)

// Interaction state
const hoveredNode = ref<ConstellationNode | null>(null)
const tooltipPosition = ref({ top: '0px', left: '0px' })

// =============================================================================
// SCENE INITIALIZATION
// =============================================================================

/**
 * Convert ConstellationNode to BrainNode format
 */
function toBrainNode(node: ConstellationNode): BrainNode {
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    targetText: node.targetText,
    knownText: node.knownText,
    belt: node.belt as Belt,
    isComponent: node.isComponent ?? false,
    usageCount: 0,
  }
}

/**
 * Convert ConstellationEdge to BrainEdge format
 */
function toBrainEdge(edge: ConstellationEdge): BrainEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    strength: edge.strength,
  }
}

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
    // 1. Initialize the scene (creates renderer, camera, controls)
    brainScene.init(containerRef.value)

    if (!brainScene.scene.value || !brainScene.camera.value || !brainScene.renderer.value) {
      throw new Error('Failed to initialize Three.js scene')
    }

    // 2. Convert props.nodes to BrainNode format and create particle system
    const brainNodeData = props.nodes.map(toBrainNode)
    const containerWidth = containerRef.value.clientWidth
    const containerHeight = containerRef.value.clientHeight
    const pointsObject = brainNodes.createNodes(brainNodeData, containerWidth, containerHeight)

    // Add points to scene
    brainScene.scene.value.add(pointsObject)

    // 3. Convert props.edges to BrainEdge format and create line system
    const brainEdgeData = props.edges.map(toBrainEdge)
    const linesObject = brainEdges.createEdges(
      brainEdgeData,
      (nodeId: string) => brainNodes.getNodePosition(nodeId)
    )

    // Add lines to scene
    brainScene.scene.value.add(linesObject)

    // 4. Initialize interaction layer (raycasting, hover, click)
    brainInteraction.init(
      brainScene.camera.value,
      brainScene.renderer.value,
      pointsObject,
      brainNodeData.map((n, index) => ({ ...n, pointIndex: index }))
    )

    // 5. Wire up interaction event handlers
    brainInteraction.onNodeHover((event) => {
      if (event.node) {
        // Convert back to ConstellationNode format for emit
        const constellationNode = props.nodes.find(n => n.id === event.node!.id)
        hoveredNode.value = constellationNode ?? null

        // Update tooltip position
        if (event.screenPosition) {
          const rect = containerRef.value?.getBoundingClientRect()
          if (rect) {
            tooltipPosition.value = {
              top: `${event.screenPosition.y - rect.top + 15}px`,
              left: `${event.screenPosition.x - rect.left + 15}px`,
            }
          }
        }

        emit('node-hover', constellationNode ?? null)
      } else {
        hoveredNode.value = null
        emit('node-hover', null)
      }
    })

    brainInteraction.onNodeClick((event) => {
      const constellationNode = props.nodes.find(n => n.id === event.node.id)
      if (constellationNode) {
        emit('node-tap', constellationNode)
      }
    })

    // 6. Initialize fire path animation system
    // Note: useBrainFirePath expects a prebuilt network-like object, so we'll create a compatible wrapper
    const networkWrapper = {
      nodes: ref(brainNodeData),
      edges: ref(brainEdgeData),
    }
    brainFirePath.init(networkWrapper as any)

    // 7. Initialize replay system
    const nodeSystemWrapper = {
      nodes: ref(brainNodeData),
      highlightNode: brainNodes.highlightNode,
      unhighlightNode: brainNodes.unhighlightNode,
      getNodePosition: brainNodes.getNodePosition,
      updateNodeBrightness: brainNodes.updateNodeBrightness,
    }
    const edgeSystemWrapper = {
      setEdgeGlow: brainEdges.setEdgeGlow,
      unhighlightAll: brainEdges.unhighlightAll,
      getEdgeIdBetweenNodes: brainEdges.getEdgeIdBetweenNodes,
    }
    brainReplay.init(nodeSystemWrapper, edgeSystemWrapper, brainScene.camera.value)

    // Set OrbitControls reference for camera animation during replay
    if (brainScene.controls.value) {
      brainReplay.setControls(brainScene.controls.value)
    }

    // 8. Start the render loop
    brainScene.startLoop()

    console.log('[Brain3DView] Scene initialized with', props.nodes.length, 'nodes and', props.edges.length, 'edges')

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
  // Stop replay if running
  if (brainReplay.isPlaying.value) {
    brainReplay.stopReplay()
  }

  // Stop fire path animation if running
  if (brainFirePath.isPlaying.value) {
    brainFirePath.stopFirePath()
  }

  // Dispose all composables in reverse order
  brainReplay.dispose()
  brainFirePath.reset()
  brainInteraction.dispose()
  brainEdges.dispose()
  brainNodes.dispose()
  brainScene.dispose()

  console.log('[Brain3DView] Scene disposed')
}

// =============================================================================
// CONTROL METHODS
// =============================================================================

/**
 * Toggle auto-rotation of the brain
 */
function toggleAutoRotate(): void {
  brainScene.setAutoRotate(!brainScene.isAutoRotating.value)
  console.log('[Brain3DView] Auto-rotate:', brainScene.isAutoRotating.value)
}

/**
 * Start the growth replay animation
 */
function startReplay(): void {
  if (brainReplay.isPlaying.value) return

  brainReplay.startReplay(brainReplay.currentSpeed.value)
    .then(() => {
      console.log('[Brain3DView] Replay completed')
    })
    .catch((err) => {
      if (err.message !== 'Replay stopped') {
        console.error('[Brain3DView] Replay error:', err)
      }
    })
}

/**
 * Stop the replay animation
 */
function stopReplay(): void {
  brainReplay.stopReplay()
  console.log('[Brain3DView] Replay stopped')
}

/**
 * Set replay speed multiplier
 */
function setSpeed(speed: number): void {
  brainReplay.setSpeed(speed)
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

  // Use the interaction composable's fly-to functionality
  brainInteraction.flyToNode(nodeId)
    .then(() => {
      console.log('[Brain3DView] Flew to node:', nodeId)
    })
}

// =============================================================================
// INTERACTION HANDLERS
// =============================================================================

// Note: Mouse move and click events are handled by the brainInteraction composable
// via event listeners attached to the renderer's DOM element during init().
// The callbacks update hoveredNode and emit events - see initScene() for details.

// These handlers are kept for any fallback or additional processing needed
function handleMouseMove(_event: MouseEvent): void {
  // Handled by brainInteraction composable
}

function handleClick(_event: MouseEvent): void {
  // Handled by brainInteraction composable
}

// =============================================================================
// WATCHERS
// =============================================================================

// Watch for search node changes and fly to it
watch(() => props.searchNodeId, (nodeId) => {
  if (nodeId && brainScene.isInitialized.value) {
    brainInteraction.flyToNode(nodeId)
  }
})

// Watch for current path changes and trigger fire path animation
watch(() => props.currentPath, (path) => {
  if (!brainScene.isInitialized.value) return

  if (!path) {
    // Clear fire path
    brainFirePath.stopFirePath()
    brainEdges.unhighlightAll()
    brainNodes.unhighlightAll()
    return
  }

  // Calculate animation duration based on number of nodes
  // Roughly 200ms per node for a natural pace
  const duration = Math.max(1000, path.nodeIds.length * 200)

  // Highlight the path nodes
  brainNodes.highlightNodes(path.nodeIds)

  // Highlight the path edges
  brainEdges.highlightPath(path.edgeIds)

  // Play the fire path animation
  brainFirePath.playFirePath({
    nodeIds: path.nodeIds,
    duration,
  }).then(() => {
    // Animation complete - keep the highlights visible
    console.log('[Brain3DView] Fire path animation complete')
  })

  console.log('[Brain3DView] Fire path updated:', path.nodeIds.length, 'nodes')
}, { deep: true })

// Watch for revealed nodes changes and update visibility
watch(() => props.revealedNodeIds, (revealed) => {
  if (!brainScene.isInitialized.value) return

  // Update node brightness based on revealed state
  for (const node of props.nodes) {
    const isRevealed = revealed === null || revealed.has(node.id)
    const brightness = isRevealed ? 0.5 : 0.1
    brainNodes.updateNodeBrightness(node.id, brightness)
  }

  console.log('[Brain3DView] Visibility updated:', revealed?.size ?? 'all')
}, { deep: true })

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(() => {
  initScene()
})

onUnmounted(() => {
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
