<script setup lang="ts">
/**
 * NetworkInteractiveOverlay.vue - SVG Overlay for Canvas-Rendered Network
 *
 * This component sits on top of a Canvas-rendered network and handles:
 * - Selected/highlighted node rendering (full detail with glow)
 * - Search result highlights (subtle ring)
 * - Click/tap detection via invisible hit areas
 * - Fire path animation (nodes in current path)
 *
 * The overlay is position: absolute with pointer-events: none by default,
 * with only the hit areas having pointer-events: all for click detection.
 *
 * Coordinate transformation matches the Canvas zoom/pan state via
 * canvasScale and canvasPan props.
 */

import { computed, type PropType } from 'vue'
import type { ConstellationNode, PathHighlight } from '../composables/usePrebuiltNetwork'

// ============================================================================
// BELT PALETTES (copied from ConstellationNetworkView)
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
  selectedNodeId: {
    type: String as PropType<string | null>,
    default: null,
  },
  highlightedNodeIds: {
    type: Array as PropType<string[]>,
    default: () => [],
  },
  currentPath: {
    type: Object as PropType<PathHighlight | null>,
    default: null,
  },
  canvasScale: {
    type: Number,
    default: 1,
  },
  canvasPan: {
    type: Object as PropType<{ x: number; y: number }>,
    default: () => ({ x: 0, y: 0 }),
  },
})

const emit = defineEmits<{
  (e: 'node-tap', node: ConstellationNode): void
  (e: 'background-tap'): void
}>()

// ============================================================================
// COMPUTED: NODES TO RENDER
// ============================================================================

/**
 * Determine which nodes need SVG rendering (selected, highlighted, or in path)
 */
const interactiveNodes = computed(() => {
  const nodeSet = new Set<string>()

  // Add selected node
  if (props.selectedNodeId) {
    nodeSet.add(props.selectedNodeId)
  }

  // Add highlighted nodes (search results)
  for (const id of props.highlightedNodeIds) {
    nodeSet.add(id)
  }

  // Add nodes in current path (up to active index)
  if (props.currentPath) {
    const { nodeIds, activeIndex } = props.currentPath
    for (let i = 0; i <= activeIndex && i < nodeIds.length; i++) {
      nodeSet.add(nodeIds[i])
    }
  }

  // Map to actual node objects
  return props.nodes.filter(n => nodeSet.has(n.id))
})

/**
 * Check if a node is in the current path (for fire path animation)
 */
function isNodeInPath(nodeId: string): boolean {
  if (!props.currentPath) return false
  const idx = props.currentPath.nodeIds.indexOf(nodeId)
  if (idx === -1) return false
  return idx <= props.currentPath.activeIndex
}

/**
 * Check if a node is highlighted (search results, etc.)
 */
function isNodeHighlighted(nodeId: string): boolean {
  return props.highlightedNodeIds.includes(nodeId)
}

/**
 * Check if a node is selected
 */
function isNodeSelected(nodeId: string): boolean {
  return props.selectedNodeId === nodeId
}

// ============================================================================
// HELPERS
// ============================================================================

function getPalette(belt: string) {
  return BELT_PALETTES[belt] || BELT_PALETTES.white
}

/**
 * Get node size multiplier - component nodes are smaller
 * Same logic as ConstellationNetworkView
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

/**
 * Hit area radius - larger than visible node for easy tapping
 */
function getHitAreaRadius(node: ConstellationNode): number {
  const baseRadius = node.isComponent ? 20 : 30
  return baseRadius
}

// ============================================================================
// TRANSFORM
// ============================================================================

/**
 * Combined transform to match canvas zoom/pan
 */
const contentTransform = computed(() => {
  return `translate(${props.canvasPan.x}px, ${props.canvasPan.y}px) scale(${props.canvasScale})`
})

// ============================================================================
// EVENT HANDLERS
// ============================================================================

function handleNodeTap(node: ConstellationNode, event: MouseEvent | TouchEvent): void {
  event.stopPropagation()
  emit('node-tap', node)
}

function handleBackgroundTap(event: MouseEvent | TouchEvent): void {
  // Only emit if the click was directly on the SVG background, not bubbled from a node
  if (event.target === event.currentTarget) {
    emit('background-tap')
  }
}
</script>

<template>
  <svg
    class="network-interactive-overlay"
    viewBox="0 0 800 800"
    preserveAspectRatio="xMidYMid meet"
    @click="handleBackgroundTap"
    @touchend="handleBackgroundTap"
  >
    <!-- Defs for filters -->
    <defs>
      <!-- Glow filter for selected nodes -->
      <filter id="overlay-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Subtle glow for highlighted nodes (search results) -->
      <filter id="overlay-highlight-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- Content group - transforms to match canvas zoom/pan -->
    <g class="content-group" :style="{ transform: contentTransform }">

      <!-- Invisible hit areas for ALL nodes (for click detection) -->
      <g class="hit-areas-layer">
        <circle
          v-for="node in nodes"
          :key="`hit-${node.id}`"
          class="hit-area"
          :cx="node.x"
          :cy="node.y"
          :r="getHitAreaRadius(node)"
          fill="transparent"
          @click="(e) => handleNodeTap(node, e)"
          @touchend.prevent="(e) => handleNodeTap(node, e)"
        />
      </g>

      <!-- Visible nodes layer (only interactive nodes) -->
      <g class="visible-nodes-layer">
        <g
          v-for="node in interactiveNodes"
          :key="node.id"
          class="overlay-node"
          :class="{
            'node-selected': isNodeSelected(node.id),
            'node-highlighted': isNodeHighlighted(node.id) && !isNodeSelected(node.id),
            'node-in-path': isNodeInPath(node.id),
            'node-component': node.isComponent,
          }"
          :transform="`translate(${node.x}, ${node.y})`"
        >
          <!-- Outer glow ring -->
          <circle
            class="node-glow"
            :r="getNodeSize(node, isNodeSelected(node.id) || isNodeInPath(node.id)).glow"
            fill="none"
            :stroke="getPalette(node.belt).glow"
            :stroke-width="isNodeSelected(node.id) || isNodeInPath(node.id) ? 3 : 2"
            :opacity="isNodeSelected(node.id) || isNodeInPath(node.id) ? 0.9 : 0.75"
            :filter="isNodeSelected(node.id) ? 'url(#overlay-glow)' : (isNodeHighlighted(node.id) ? 'url(#overlay-highlight-glow)' : 'none')"
          />

          <!-- Core circle -->
          <circle
            class="node-core"
            :r="getNodeSize(node, isNodeSelected(node.id) || isNodeInPath(node.id)).core"
            :fill="getPalette(node.belt).core"
            :stroke="getPalette(node.belt).glow"
            :stroke-width="isNodeSelected(node.id) || isNodeInPath(node.id) ? 2 : 1.5"
            :stroke-opacity="isNodeSelected(node.id) || isNodeInPath(node.id) ? 1 : 0.85"
          />

          <!-- Inner dot -->
          <circle
            class="node-inner"
            :r="getNodeSize(node, isNodeSelected(node.id)).inner"
            :fill="getPalette(node.belt).inner"
            :opacity="isNodeSelected(node.id) || isNodeInPath(node.id) ? 1 : 0.85"
          />

          <!-- Highlight ring for search results -->
          <circle
            v-if="isNodeHighlighted(node.id) && !isNodeSelected(node.id) && !isNodeInPath(node.id)"
            class="highlight-ring"
            :r="getNodeSize(node, false).glow + 4"
            fill="none"
            stroke="rgba(96, 165, 250, 0.6)"
            stroke-width="2"
            stroke-dasharray="4 2"
          />
        </g>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.network-interactive-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.content-group {
  transform-origin: center center;
}

/* Hit areas layer - the only elements with pointer-events */
.hit-areas-layer {
  pointer-events: all;
}

.hit-area {
  cursor: pointer;
  pointer-events: all;
}

/* Visible nodes layer - no pointer events, just rendering */
.visible-nodes-layer {
  pointer-events: none;
}

.overlay-node {
  pointer-events: none;
}

/* Node styling */
.node-glow {
  transition: r 0.2s ease, stroke-width 0.2s ease, opacity 0.2s ease;
}

.node-core {
  transition: r 0.2s ease, stroke-width 0.2s ease;
}

.node-inner {
  transition: opacity 0.2s ease;
}

/* Selected node - prominent pulsing glow */
.node-selected {
  animation: node-selected-pulse 1.2s ease-in-out infinite alternate;
}

@keyframes node-selected-pulse {
  from {
    filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.5));
  }
  to {
    filter: drop-shadow(0 0 20px rgba(251, 191, 36, 0.8));
  }
}

/* Nodes in fire path - same animation as ConstellationNetworkView */
.node-in-path:not(.node-selected) {
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

/* Highlighted nodes (search results) - subtle animation */
.node-highlighted:not(.node-selected):not(.node-in-path) {
  animation: node-highlight-pulse 1.5s ease-in-out infinite alternate;
}

@keyframes node-highlight-pulse {
  from {
    filter: drop-shadow(0 0 4px rgba(96, 165, 250, 0.3));
  }
  to {
    filter: drop-shadow(0 0 10px rgba(96, 165, 250, 0.6));
  }
}

/* Highlight ring for search results */
.highlight-ring {
  animation: highlight-ring-rotate 4s linear infinite;
}

@keyframes highlight-ring-rotate {
  from {
    stroke-dashoffset: 0;
  }
  to {
    stroke-dashoffset: 24;
  }
}
</style>
