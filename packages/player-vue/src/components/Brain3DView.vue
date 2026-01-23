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
import * as THREE from 'three'

// =============================================================================
// COMPOSABLE IMPORTS
// =============================================================================

import { useBrainScene } from '../composables/useBrainScene'
import { useBrainNodes, type BrainNode, type Belt } from '../composables/useBrainNodes'
import { useBrainEdges, type BrainEdge } from '../composables/useBrainEdges'
import { useBrainInteraction } from '../composables/useBrainInteraction'
import { useBrainFirePath } from '../composables/useBrainFirePath'
import { useBrainReplay } from '../composables/useBrainReplay'
import { useBrainWireframe } from '../composables/useBrainWireframe'

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
  source: string | { id: string }  // Can be string ID or object with id
  target: string | { id: string }  // Can be string ID or object with id
  strength: number
}

// Helper to extract ID from source/target (handles both string and object formats)
function getEdgeNodeId(nodeRef: string | { id: string }): string {
  return typeof nodeRef === 'string' ? nodeRef : nodeRef.id
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
  /**
   * Currently selected node ID (dims all other nodes when set)
   */
  selectedNodeId: {
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
const brainWireframe = useBrainWireframe({
  opacity: 0,  // Invisible scaffold - brain shape emerges from nodes
  color: '#4a90d9',
  vertexSize: 0,  // No visible vertices on scaffold
  glowIntensity: 0,
})

// =============================================================================
// LOCAL STATE
// =============================================================================

// Loading/error state
const isLoading = ref(true)
const error = ref<string | null>(null)

// Computed state from composables
const isInitialized = computed(() => brainScene.isInitialized.value)
const autoRotate = computed(() => brainScene.isAutoRotating.value)
// Replay functionality removed - keeping imports for potential future use
// const isReplaying = computed(() => brainReplay.isPlaying.value)
// const replayProgress = computed(() => brainReplay.progress.value)
// const replaySpeed = computed(() => brainReplay.currentSpeed.value)

// Interaction state
const hoveredNode = ref<ConstellationNode | null>(null)
const tooltipPosition = ref({ top: '0px', left: '0px' })

// Track if scene base infrastructure is initialized (vs nodes/edges)
const sceneInitialized = ref(false)

// =============================================================================
// NODE/EDGE FILTERING
// =============================================================================

/**
 * Get the set of revealed node IDs.
 * If revealedNodeIds is null, returns null (show all nodes).
 * Otherwise returns the set of revealed IDs.
 */
function getRevealedSet(): Set<string> | null {
  return props.revealedNodeIds
}

/**
 * Filter nodes to only include revealed nodes.
 * If revealedNodeIds is null (testing mode), show all nodes.
 */
function getFilteredNodes(): ConstellationNode[] {
  const revealed = getRevealedSet()
  if (revealed === null) {
    // Testing mode: show all nodes
    return props.nodes
  }
  // Filter to only revealed nodes
  return props.nodes.filter(node => revealed.has(node.id))
}

/**
 * Filter edges to only include edges where BOTH source and target are revealed.
 * If revealedNodeIds is null (testing mode), show all edges.
 */
function getFilteredEdges(): ConstellationEdge[] {
  const revealed = getRevealedSet()
  if (revealed === null) {
    // Testing mode: show all edges
    return props.edges
  }
  // Filter to only edges where both endpoints are revealed
  // Handle both string IDs and object references for source/target
  return props.edges.filter(edge => {
    const sourceId = getEdgeNodeId(edge.source)
    const targetId = getEdgeNodeId(edge.target)
    return revealed.has(sourceId) && revealed.has(targetId)
  })
}

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
 * Handles source/target being either string IDs or objects with id property
 */
function toBrainEdge(edge: ConstellationEdge): BrainEdge {
  return {
    id: edge.id,
    source: getEdgeNodeId(edge.source),
    target: getEdgeNodeId(edge.target),
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

    // 2. Create and add the wireframe brain shape FIRST (renders behind nodes)
    // Wireframe encases the node network with recognizable brain silhouette
    const wireframeMesh = brainWireframe.createWireframe(350, 280, 220)
    brainScene.scene.value.add(wireframeMesh)
    // Set belt level for appropriate brain size (grows with learning progress)
    brainWireframe.setBeltLevel(props.beltLevel as any)

    // 3. Get filtered nodes and edges based on revealedNodeIds
    const filteredNodes = getFilteredNodes()
    const filteredEdges = getFilteredEdges()

    // 4. Convert to BrainNode and BrainEdge formats
    const brainNodeData = filteredNodes.map(toBrainNode)
    const brainEdgeData = filteredEdges.map(toBrainEdge)
    const containerWidth = containerRef.value.clientWidth
    const containerHeight = containerRef.value.clientHeight

    // 5. Create particle system with organic tree positioning
    // Pass edges so connected nodes cluster together (force-directed layout)
    const pointsObject = brainNodes.createNodes(brainNodeData, containerWidth, containerHeight, brainEdgeData)

    // Add points to scene
    brainScene.scene.value.add(pointsObject)

    // 6. Create line system for edges (uses positions from brainNodes)
    const linesObject = brainEdges.createEdges(
      brainEdgeData,
      (nodeId: string) => brainNodes.getNodePosition(nodeId)
    )

    // Add lines to scene
    brainScene.scene.value.add(linesObject)

    // 6. Initialize interaction layer (raycasting, hover, click)
    brainInteraction.init(
      brainScene.camera.value,
      brainScene.renderer.value,
      pointsObject,
      brainNodeData.map((n, index) => ({ ...n, pointIndex: index }))
    )

    // 7. Wire up interaction event handlers
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

    // 8. Initialize fire path animation system
    // Note: useBrainFirePath expects a prebuilt network-like object, so we'll create a compatible wrapper
    const networkWrapper = {
      nodes: ref(brainNodeData),
      edges: ref(brainEdgeData),
    }
    brainFirePath.init(networkWrapper as any)

    // 9. Initialize replay system
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

    // 10. Register node update callback for pulse animations and fire path
    brainScene.onUpdate((deltaTime) => {
      // Update node pulse animations (for highlighted nodes)
      brainNodes.update(deltaTime)

      // Apply fire path animation states when playing
      if (brainFirePath.isPlaying.value) {
        // Apply node brightness from fire path states
        // Only update for nodes that are actively firing - others stay dimmed
        for (const [nodeId, state] of brainFirePath.nodeStates.value) {
          if (state.isFiring) {
            // Node is actively firing - apply the bright glow
            brainNodes.updateNodeBrightness(nodeId, state.brightness)
          } else if (state.brightness <= 1.0) {
            // Node has finished firing - return to dimmed state
            brainNodes.updateNodeBrightness(nodeId, 0.50)
          }
        }

        // Apply edge glow from fire path states
        for (const [edgeId, state] of brainFirePath.edgeStates.value) {
          brainEdges.setEdgeGlow(edgeId, state.glowIntensity)
        }
      }
    })

    // 11. Mark scene as initialized and start the render loop
    sceneInitialized.value = true
    brainScene.startLoop()

    console.log('[Brain3DView] Scene initialized with', filteredNodes.length, 'nodes and', filteredEdges.length, 'edges')
    console.log('[Brain3DView] Props received:', props.nodes.length, 'nodes,', props.edges.length, 'edges')
    if (filteredEdges.length > 0) {
      console.log('[Brain3DView] Sample edge:', filteredEdges[0])
    }
    if (filteredEdges.length === 0 && props.edges.length > 0) {
      console.log('[Brain3DView] WARNING: Props have edges but filtered is empty - check revealedNodeIds')
      console.log('[Brain3DView] Sample props edge:', props.edges[0])
    }

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
  brainWireframe.dispose()
  brainScene.dispose()

  sceneInitialized.value = false
  console.log('[Brain3DView] Scene disposed')
}

/**
 * Rebuild nodes and edges when revealedNodeIds changes.
 * This removes old objects from the scene and creates new ones
 * with the updated filtered set of nodes/edges.
 */
function rebuildNodesAndEdges(): void {
  if (!brainScene.scene.value || !brainScene.camera.value || !brainScene.renderer.value || !containerRef.value) {
    console.warn('[Brain3DView] Cannot rebuild: scene not ready')
    return
  }

  // 1. Remove old nodes and edges from scene
  const oldPointsObject = brainNodes.getPointsObject()
  if (oldPointsObject) {
    brainScene.scene.value.remove(oldPointsObject)
  }
  const oldLinesObject = brainEdges.lineSegments.value
  if (oldLinesObject) {
    brainScene.scene.value.remove(oldLinesObject)
  }

  // 2. Dispose old composable resources (but keep scene intact)
  brainInteraction.dispose()
  brainEdges.dispose()
  brainNodes.dispose()

  // 3. Get new filtered nodes and edges
  const filteredNodes = getFilteredNodes()
  const filteredEdges = getFilteredEdges()

  // 4. Convert to BrainNode and BrainEdge formats
  const brainNodeData = filteredNodes.map(toBrainNode)
  const brainEdgeData = filteredEdges.map(toBrainEdge)
  const containerWidth = containerRef.value.clientWidth
  const containerHeight = containerRef.value.clientHeight

  // 5. Create new particle system with organic tree positioning
  // Pass edges so connected nodes cluster together (force-directed layout)
  const pointsObject = brainNodes.createNodes(brainNodeData, containerWidth, containerHeight, brainEdgeData)
  brainScene.scene.value.add(pointsObject)

  // 6. Create new edge system with filtered edges
  const linesObject = brainEdges.createEdges(
    brainEdgeData,
    (nodeId: string) => brainNodes.getNodePosition(nodeId)
  )

  brainScene.scene.value.add(linesObject)

  // 6. Re-initialize interaction layer with new nodes
  brainInteraction.init(
    brainScene.camera.value,
    brainScene.renderer.value,
    pointsObject,
    brainNodeData.map((n, index) => ({ ...n, pointIndex: index }))
  )

  // Re-wire event handlers
  brainInteraction.onNodeHover((event) => {
    if (event.node) {
      const constellationNode = props.nodes.find(n => n.id === event.node!.id)
      hoveredNode.value = constellationNode ?? null
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

  console.log('[Brain3DView] Rebuilt with', filteredNodes.length, 'nodes and', filteredEdges.length, 'edges')
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
 * Reset camera to fit the entire brain in view
 * Resets zoom, position, and temporarily pauses auto-rotate
 */
function fitToScreen(): void {
  if (!brainScene.controls.value) {
    console.warn('[Brain3DView] Controls not available for fit-to-screen')
    return
  }

  // Reset the OrbitControls to initial state
  brainScene.controls.value.reset()

  console.log('[Brain3DView] Camera reset to fit screen')
}

// Replay functionality removed - keeping methods commented for potential future use
// function startReplay(): void { ... }
// function stopReplay(): void { ... }
// function setSpeed(speed: number): void { ... }

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

// Watch for selected node changes - dim all other nodes when a node is selected
// This creates focus on the selected node before any phrase plays
watch(() => props.selectedNodeId, (nodeId, oldNodeId) => {
  if (!brainScene.isInitialized.value) return

  if (!nodeId) {
    // No node selected - restore all nodes to normal brightness (unless path is active)
    if (!props.currentPath) {
      console.log('[Brain3DView] No node selected, restoring brightness')
      brainNodes.restoreAllNodesBrightness()
      brainEdges.setDimmed(false)
    }
    return
  }

  // Node selected - dim all OTHER nodes, keep selected node bright
  console.log('[Brain3DView] Node selected:', nodeId, '- dimming other nodes')
  const excludeIds = new Set([nodeId])
  brainNodes.setAllNodesBrightness(0.50, excludeIds)
  brainEdges.setDimmed(true)
})

// Watch for current path changes and trigger fire path animation
watch(() => props.currentPath, (path) => {
  console.log('[Brain3DView] currentPath changed:', path ? `${path.nodeIds.length} nodes` : 'null')
  if (!brainScene.isInitialized.value) {
    console.log('[Brain3DView] Scene not initialized, skipping')
    return
  }

  if (!path) {
    // Clear fire path - but only restore brightness if no node is selected
    console.log('[Brain3DView] Clearing fire path')
    brainFirePath.stopFirePath()
    brainEdges.unhighlightAll()

    if (props.selectedNodeId) {
      // Node still selected - keep dimmed state but re-brighten selected node
      console.log('[Brain3DView] Path cleared but node still selected, keeping dim')
      const excludeIds = new Set([props.selectedNodeId])
      brainNodes.setAllNodesBrightness(0.50, excludeIds)
    } else {
      // No node selected - restore everything to normal
      console.log('[Brain3DView] Restoring brightness')
      brainEdges.setDimmed(false)
      brainNodes.unhighlightAll()
      brainNodes.restoreAllNodesBrightness()
    }
    return
  }

  // Ensure nodes are dimmed for fire path, but exclude selected node
  console.log('[Brain3DView] Setting up fire path animation')
  console.log('[Brain3DView] Checking if path nodes exist in 3D scene...')
  const existingNodes = path.nodeIds.filter(id => brainNodes.hasNode(id))
  const missingNodes = path.nodeIds.filter(id => !brainNodes.hasNode(id))
  console.log('[Brain3DView] Path nodes in scene:', existingNodes.length, '/', path.nodeIds.length)
  if (missingNodes.length > 0) {
    console.log('[Brain3DView] Missing nodes (not revealed?):', missingNodes)
  }

  // Dim ALL nodes - fire path animation will brighten them one at a time as they fire
  console.log('[Brain3DView] Dimming all nodes for fire path animation')
  brainNodes.setAllNodesBrightness(0.50)
  brainEdges.setDimmed(true)

  // Calculate animation duration based on number of nodes
  // Roughly 200ms per node for a natural pace
  const duration = Math.max(1000, path.nodeIds.length * 200)

  // Highlight the path edges
  brainEdges.highlightPath(path.edgeIds)

  // Play the fire path animation
  brainFirePath.playFirePath({
    nodeIds: path.nodeIds,
    duration,
  }).then(() => {
    // Animation complete - keep path nodes visible but dimmed
    console.log('[Brain3DView] Fire path animation complete')
  })

  console.log('[Brain3DView] Fire path updated:', path.nodeIds.length, 'nodes')
}, { deep: true })

// Watch for revealed nodes changes and rebuild nodes/edges
watch(() => props.revealedNodeIds, (_revealed, _oldRevealed) => {
  if (!sceneInitialized.value || !brainScene.scene.value || !containerRef.value) return

  // Rebuild nodes and edges with new filtered set
  rebuildNodesAndEdges()
}, { deep: true })

// Watch for belt level changes and update wireframe color (edges stay neutral)
watch(accentColor, (newColor) => {
  if (sceneInitialized.value) {
    brainWireframe.setColor(newColor)
  }
})

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
   * Reset camera to fit entire brain in view
   */
  fitToScreen,
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
        @click="fitToScreen"
        title="Fit to screen"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3"/>
          <path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
          <path d="M3 16v3a2 2 0 0 0 2 2h3"/>
          <path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
        </svg>
      </button>
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
  border: 3px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
  border-top-color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-overlay p,
.error-overlay p {
  color: var(--text-secondary, rgba(255, 255, 255, 0.6));
  font-size: 0.875rem;
}

.error-message {
  color: rgba(239, 68, 68, 0.9) !important;
  max-width: 300px;
  text-align: center;
}

.retry-btn {
  padding: 8px 20px;
  background: var(--bg-interactive, rgba(255, 255, 255, 0.1));
  border: 1px solid var(--border-hover, rgba(255, 255, 255, 0.2));
  border-radius: 8px;
  color: var(--text-primary, rgba(255, 255, 255, 0.8));
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn:hover {
  background: var(--bg-interactive-hover, rgba(255, 255, 255, 0.15));
  color: var(--text-primary, white);
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
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.15));
  background: var(--bg-overlay, rgba(10, 10, 15, 0.85));
  backdrop-filter: blur(12px);
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.control-btn:hover {
  background: var(--bg-interactive-hover, rgba(255, 255, 255, 0.1));
  color: var(--text-primary, white);
}

.control-btn:active {
  transform: scale(0.95);
}

.control-btn.active {
  background: var(--bg-interactive, rgba(255, 255, 255, 0.08));
}

.control-btn svg {
  width: 20px;
  height: 20px;
}

/* ============================================
   NODE TOOLTIP
   ============================================ */

.node-tooltip {
  position: absolute;
  z-index: 100;
  padding: 10px 14px;
  background: var(--bg-overlay, rgba(10, 10, 15, 0.95));
  backdrop-filter: blur(12px);
  border: 1px solid var(--border-default, rgba(255, 255, 255, 0.15));
  border-radius: 10px;
  pointer-events: none;
  max-width: 200px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.tooltip-target {
  display: block;
  color: var(--text-primary, rgba(255, 255, 255, 0.95));
  font-size: 0.9375rem;
  font-weight: 600;
  margin-bottom: 2px;
}

.tooltip-known {
  display: block;
  color: var(--text-secondary, rgba(255, 255, 255, 0.5));
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
