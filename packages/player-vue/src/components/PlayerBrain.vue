<script setup lang="ts">
/**
 * PlayerBrain.vue - Lightweight 3D Brain for Playback Mode
 *
 * Stripped-down version of Brain3DView for ambient display during learning.
 * - No controls, no wireframe, no replay
 * - Just nodes + edges + fire path animation
 * - Nodes appear as LEGOs are introduced
 * - Fire path animates when phrases play
 *
 * Uses same composables as Brain3DView for consistency.
 */

import { ref, computed, watch, onMounted, onUnmounted, type PropType } from 'vue'
import * as THREE from 'three'

import { useBrainScene } from '../composables/useBrainScene'
import { useBrainNodes, type BrainNode, type Belt } from '../composables/useBrainNodes'
import { useBrainEdges, type BrainEdge } from '../composables/useBrainEdges'
import { useBrainInteraction } from '../composables/useBrainInteraction'
import { useBrainFirePath } from '../composables/useBrainFirePath'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

import type { NetworkNode, NetworkEdge, PathHighlight } from '../composables/usePrebuiltNetwork'

function getEdgeNodeId(nodeRef: string | { id: string }): string {
  return typeof nodeRef === 'string' ? nodeRef : nodeRef.id
}

// =============================================================================
// PROPS & EMITS
// =============================================================================

const props = defineProps({
  nodes: {
    type: Array as PropType<NetworkNode[]>,
    required: true,
  },
  edges: {
    type: Array as PropType<NetworkEdge[]>,
    required: true,
  },
  revealedNodeIds: {
    type: Object as PropType<Set<string> | null>,
    default: null,
  },
  currentPath: {
    type: Object as PropType<PathHighlight | null>,
    default: null,
  },
  beltLevel: {
    type: String,
    default: 'white',
  },
})

const emit = defineEmits<{
  (e: 'node-tap', node: NetworkNode): void
}>()

// =============================================================================
// BELT COLORS
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
// DOM & STATE
// =============================================================================

const containerRef = ref<HTMLElement | null>(null)
const isInitialized = ref(false)
const hoveredNode = ref<NetworkNode | null>(null)
const tooltipPosition = ref({ top: '0px', left: '0px' })

// Track previously revealed node IDs to detect newly revealed nodes
const previouslyRevealedIds = ref<Set<string>>(new Set())

// =============================================================================
// COMPOSABLES
// =============================================================================

const brainScene = useBrainScene()
const brainNodes = useBrainNodes()
const brainEdges = useBrainEdges()
const brainInteraction = useBrainInteraction()
const brainFirePath = useBrainFirePath()

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Check if a node should be visible.
 * Handles both regular nodes (check revealedNodeIds) and component nodes
 * (auto-visible if any parent is revealed).
 */
function isNodeVisible(node: NetworkNode, revealed: Set<string>): boolean {
  // Regular nodes: check if explicitly revealed
  if (!node.isComponent) {
    return revealed.has(node.id)
  }
  // Component nodes: visible if ANY parent LEGO is revealed
  if (node.parentLegoIds && node.parentLegoIds.length > 0) {
    return node.parentLegoIds.some(parentId => revealed.has(parentId))
  }
  return false
}

/**
 * Check if a node ID is visible (for edge filtering).
 */
function isNodeIdVisible(nodeId: string, revealed: Set<string>): boolean {
  if (revealed.has(nodeId)) return true
  const node = props.nodes.find(n => n.id === nodeId)
  if (node?.isComponent && node.parentLegoIds) {
    return node.parentLegoIds.some(parentId => revealed.has(parentId))
  }
  return false
}

function getFilteredNodes(): NetworkNode[] {
  const revealed = props.revealedNodeIds
  if (revealed === null) return props.nodes
  return props.nodes.filter(node => isNodeVisible(node, revealed))
}

function getFilteredEdges(): NetworkEdge[] {
  const revealed = props.revealedNodeIds
  if (revealed === null) return props.edges
  return props.edges.filter(edge => {
    const sourceId = getEdgeNodeId(edge.source)
    const targetId = getEdgeNodeId(edge.target)
    return isNodeIdVisible(sourceId, revealed) && isNodeIdVisible(targetId, revealed)
  })
}

function toBrainNode(node: NetworkNode): BrainNode {
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

function toBrainEdge(edge: NetworkEdge): BrainEdge {
  return {
    id: edge.id,
    source: getEdgeNodeId(edge.source),
    target: getEdgeNodeId(edge.target),
    strength: edge.strength,
  }
}

// =============================================================================
// SCENE INIT
// =============================================================================

async function initScene(): Promise<void> {
  if (!containerRef.value) return

  try {
    brainScene.init(containerRef.value)

    if (!brainScene.scene.value || !brainScene.camera.value || !brainScene.renderer.value) {
      throw new Error('Failed to initialize scene')
    }

    const filteredNodes = getFilteredNodes()
    const filteredEdges = getFilteredEdges()
    const brainNodeData = filteredNodes.map(toBrainNode)
    const brainEdgeData = filteredEdges.map(toBrainEdge)
    const containerWidth = containerRef.value.clientWidth
    const containerHeight = containerRef.value.clientHeight

    // Create nodes (no wireframe for light mode)
    const pointsObject = brainNodes.createNodes(brainNodeData, containerWidth, containerHeight, brainEdgeData)
    brainScene.scene.value.add(pointsObject)

    // Create edges
    const linesObject = brainEdges.createEdges(
      brainEdgeData,
      (nodeId: string) => brainNodes.getNodePosition(nodeId)
    )
    brainScene.scene.value.add(linesObject)

    // Initialize interaction
    brainInteraction.init(
      brainScene.camera.value,
      brainScene.renderer.value,
      pointsObject,
      brainNodeData.map((n, index) => ({ ...n, pointIndex: index }))
    )

    // Hover handler
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
      } else {
        hoveredNode.value = null
      }
    })

    // Click handler
    brainInteraction.onNodeClick((event) => {
      const constellationNode = props.nodes.find(n => n.id === event.node.id)
      if (constellationNode) {
        emit('node-tap', constellationNode)
      }
    })

    // Fire path system
    const networkWrapper = {
      nodes: ref(brainNodeData),
      edges: ref(brainEdgeData),
    }
    brainFirePath.init(networkWrapper as any)

    // Update loop for animations
    brainScene.onUpdate((deltaTime) => {
      brainNodes.update(deltaTime)
      brainEdges.update(deltaTime)  // Update edge animations (new edge glow decay)

      if (brainFirePath.isPlaying.value) {
        for (const [nodeId, state] of brainFirePath.nodeStates.value) {
          if (state.isFiring) {
            brainNodes.updateNodeBrightness(nodeId, state.brightness)
          } else if (state.brightness <= 1.0) {
            brainNodes.updateNodeBrightness(nodeId, 0.50)
          }
        }

        for (const [edgeId, state] of brainFirePath.edgeStates.value) {
          brainEdges.setEdgeGlow(edgeId, state.glowIntensity)
        }
      }
    })

    // Enable auto-rotate for ambient feel
    brainScene.setAutoRotate(true)

    isInitialized.value = true
    brainScene.startLoop()

    console.log('[PlayerBrain] Initialized with', filteredNodes.length, 'nodes')

  } catch (err) {
    console.error('[PlayerBrain] Init failed:', err)
  }
}

function disposeScene(): void {
  if (brainFirePath.isPlaying.value) brainFirePath.stopFirePath()
  brainFirePath.reset()
  brainInteraction.dispose()
  brainEdges.dispose()
  brainNodes.dispose()
  brainScene.dispose()
  isInitialized.value = false
}

function rebuildNodesAndEdges(): void {
  if (!brainScene.scene.value || !containerRef.value) return

  const oldPointsObject = brainNodes.getPointsObject()
  if (oldPointsObject) brainScene.scene.value.remove(oldPointsObject)
  const oldLinesObject = brainEdges.lineSegments.value
  if (oldLinesObject) brainScene.scene.value.remove(oldLinesObject)

  brainInteraction.dispose()
  brainEdges.dispose()
  brainNodes.dispose()

  const filteredNodes = getFilteredNodes()
  const filteredEdges = getFilteredEdges()
  const brainNodeData = filteredNodes.map(toBrainNode)
  const brainEdgeData = filteredEdges.map(toBrainEdge)
  const containerWidth = containerRef.value.clientWidth
  const containerHeight = containerRef.value.clientHeight

  const pointsObject = brainNodes.createNodes(brainNodeData, containerWidth, containerHeight, brainEdgeData)
  brainScene.scene.value.add(pointsObject)

  const linesObject = brainEdges.createEdges(
    brainEdgeData,
    (nodeId: string) => brainNodes.getNodePosition(nodeId)
  )
  brainScene.scene.value.add(linesObject)

  brainInteraction.init(
    brainScene.camera.value!,
    brainScene.renderer.value!,
    pointsObject,
    brainNodeData.map((n, index) => ({ ...n, pointIndex: index }))
  )

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
    } else {
      hoveredNode.value = null
    }
  })

  brainInteraction.onNodeClick((event) => {
    const constellationNode = props.nodes.find(n => n.id === event.node.id)
    if (constellationNode) {
      emit('node-tap', constellationNode)
    }
  })

  console.log('[PlayerBrain] Rebuilt with', filteredNodes.length, 'nodes')
}

// =============================================================================
// WATCHERS
// =============================================================================

// Rebuild when revealed nodes change, and animate edges for newly revealed nodes
watch(() => props.revealedNodeIds, (newRevealed) => {
  if (!isInitialized.value || !newRevealed) return

  // Find newly revealed node IDs (nodes in new set but not in previous)
  const newNodeIds: string[] = []
  for (const id of newRevealed) {
    if (!previouslyRevealedIds.value.has(id)) {
      newNodeIds.push(id)
    }
  }

  // Rebuild the nodes and edges
  rebuildNodesAndEdges()

  // Animate edges for newly revealed nodes
  // This creates a "glow pulse" on edges that just became visible
  for (const nodeId of newNodeIds) {
    brainEdges.animateEdgesForNode(nodeId, 800)
  }

  // Update the tracking set for next comparison
  previouslyRevealedIds.value = new Set(newRevealed)
}, { deep: true })

// Fire path animation when currentPath changes
watch(() => props.currentPath, (path) => {
  if (!isInitialized.value) return

  if (!path) {
    brainFirePath.stopFirePath()
    brainEdges.unhighlightAll()
    brainEdges.setDimmed(false)
    brainNodes.restoreAllNodesBrightness()
    return
  }

  brainNodes.setAllNodesBrightness(0.50)
  brainEdges.setDimmed(true)

  const duration = Math.max(1000, path.nodeIds.length * 200)
  brainEdges.highlightPath(path.edgeIds)

  brainFirePath.playFirePath({
    nodeIds: path.nodeIds,
    duration,
  })
}, { deep: true })

// =============================================================================
// LIFECYCLE
// =============================================================================

onMounted(() => initScene())
onUnmounted(() => disposeScene())
</script>

<template>
  <div ref="containerRef" class="player-brain">
    <!-- Tooltip on hover -->
    <div v-if="hoveredNode" class="node-tooltip" :style="tooltipPosition">
      <span class="tooltip-target">{{ hoveredNode.targetText }}</span>
      <span v-if="hoveredNode.knownText" class="tooltip-known">{{ hoveredNode.knownText }}</span>
    </div>
  </div>
</template>

<style scoped>
.player-brain {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: auto;
}

.player-brain :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

.node-tooltip {
  position: absolute;
  z-index: 100;
  padding: 8px 12px;
  background: rgba(10, 10, 15, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  pointer-events: none;
  max-width: 180px;
}

.tooltip-target {
  display: block;
  color: rgba(255, 255, 255, 0.95);
  font-size: 0.875rem;
  font-weight: 600;
}

.tooltip-known {
  display: block;
  color: rgba(255, 255, 255, 0.5);
  font-size: 0.75rem;
  margin-top: 2px;
}

/* Hide tooltip on touch devices */
@media (hover: none) and (pointer: coarse) {
  .node-tooltip {
    display: none;
  }
}
</style>
