<script setup lang="ts">
/**
 * NetworkInteractiveOverlay.vue - SVG Overlay for Canvas-Rendered Network
 *
 * This component sits on top of a Canvas-rendered network and provides:
 * - Selection/highlight RINGS only (not full nodes - those are on canvas)
 * - Click/tap detection via invisible hit areas
 *
 * Visual indicators rendered:
 * - Selected node: Pulsing glow ring (belt-colored) around the canvas node
 * - Fire path nodes: Blue pulsing ring around nodes in the current path
 * - Search results: Subtle dashed ring for highlighted nodes
 *
 * The canvas renders all actual nodes - this overlay only adds selection
 * indicators like a selection outline in a design tool.
 *
 * The overlay is position: absolute with pointer-events: none by default,
 * with only the hit areas having pointer-events: all for click detection.
 *
 * Coordinate transformation matches the Canvas zoom/pan state via
 * canvasScale and canvasPan props.
 */

import { computed, type PropType } from 'vue'
import type { NetworkNode, PathHighlight } from '../composables/usePrebuiltNetwork'

// ============================================================================
// BELT GLOW COLORS (for highlight rings only - nodes are rendered on canvas)
// ============================================================================

const BELT_GLOW_COLORS: Record<string, string> = {
  white: '#9ca3af',
  yellow: '#fbbf24',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  brown: '#a87848',
  black: '#d4a853',
}

// ============================================================================
// PROPS
// ============================================================================

const props = defineProps({
  nodes: {
    type: Array as PropType<NetworkNode[]>,
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
  (e: 'node-tap', node: NetworkNode): void
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

function getGlowColor(belt: string): string {
  return BELT_GLOW_COLORS[belt] || BELT_GLOW_COLORS.white
}

/**
 * Get the ring radius for highlighting - sits outside the canvas-rendered node
 * The canvas renders nodes at approximately 12-14px radius for core
 * We want the ring to sit AROUND that, so we use a larger radius
 */
function getHighlightRingRadius(node: NetworkNode): number {
  // Component nodes are 60% the size of regular nodes
  const scale = node.isComponent ? 0.6 : 1
  // Ring sits outside the node (node core is ~12-14px, we want ring at ~20-22px)
  return 20 * scale
}

/**
 * Hit area radius - larger than visible node for easy tapping
 */
function getHitAreaRadius(node: NetworkNode): number {
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

function handleNodeTap(node: NetworkNode, event: MouseEvent | TouchEvent): void {
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

      <!-- Highlight rings layer (only interactive nodes - nodes are rendered on canvas) -->
      <g class="highlight-rings-layer">
        <!-- Selected node ring - prominent pulsing glow halo -->
        <circle
          v-for="node in interactiveNodes.filter(n => isNodeSelected(n.id))"
          :key="`selected-${node.id}`"
          class="selection-ring"
          :cx="node.x"
          :cy="node.y"
          :r="getHighlightRingRadius(node)"
          fill="none"
          :stroke="getGlowColor(node.belt)"
          stroke-width="3"
          opacity="0.9"
          filter="url(#overlay-glow)"
        />

        <!-- Path nodes ring - blue pulsing halo for fire path -->
        <circle
          v-for="node in interactiveNodes.filter(n => isNodeInPath(n.id) && !isNodeSelected(n.id))"
          :key="`path-${node.id}`"
          class="path-ring"
          :cx="node.x"
          :cy="node.y"
          :r="getHighlightRingRadius(node)"
          fill="none"
          stroke="rgba(96, 165, 250, 0.8)"
          stroke-width="2.5"
          filter="url(#overlay-highlight-glow)"
        />

        <!-- Highlighted nodes ring - subtle dashed ring for search results -->
        <circle
          v-for="node in interactiveNodes.filter(n => isNodeHighlighted(n.id) && !isNodeSelected(n.id) && !isNodeInPath(n.id))"
          :key="`highlight-${node.id}`"
          class="highlight-ring"
          :cx="node.x"
          :cy="node.y"
          :r="getHighlightRingRadius(node) + 4"
          fill="none"
          stroke="rgba(96, 165, 250, 0.6)"
          stroke-width="2"
          stroke-dasharray="4 2"
          filter="url(#overlay-highlight-glow)"
        />
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

/* Highlight rings layer - no pointer events, just visual indicators */
.highlight-rings-layer {
  pointer-events: none;
}

/* Selection ring - prominent pulsing glow around selected node */
.selection-ring {
  animation: selection-pulse 1.2s ease-in-out infinite alternate;
}

@keyframes selection-pulse {
  from {
    opacity: 0.7;
    stroke-width: 2.5;
  }
  to {
    opacity: 1;
    stroke-width: 4;
  }
}

/* Path ring - blue pulsing for fire path nodes */
.path-ring {
  animation: path-pulse 0.8s ease-in-out infinite alternate;
}

@keyframes path-pulse {
  from {
    opacity: 0.5;
    stroke-width: 2;
  }
  to {
    opacity: 0.9;
    stroke-width: 3;
  }
}

/* Highlight ring for search results - rotating dashed ring */
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
