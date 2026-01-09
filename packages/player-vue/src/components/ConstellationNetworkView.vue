<script setup lang="ts">
/**
 * ConstellationNetworkView.vue - Pre-built Network with CSS Pan
 *
 * A simpler network visualization:
 * - Positions are PRE-CALCULATED (no runtime physics)
 * - Network PANS via CSS transform to center on hero
 * - Spatial relationships are FIXED (preserves memory)
 *
 * "quiero is always up-left of hablar" - like a real star map
 */

import { ref, computed, watch, onMounted, type PropType } from 'vue'
import type { ConstellationNode, ConstellationEdge, PathHighlight } from '../composables/usePrebuiltNetwork'

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
// HELPERS
// ============================================================================

function getPalette(belt: string) {
  return BELT_PALETTES[belt] || BELT_PALETTES.white
}

function isNodeInPath(nodeId: string): boolean {
  return props.currentPath?.nodeIds.includes(nodeId) ?? false
}

function isNodeResonating(nodeId: string): boolean {
  return props.resonatingNodeIds.includes(nodeId) && !isNodeInPath(nodeId)
}

function isEdgeInPath(edgeId: string): boolean {
  return props.currentPath?.edgeIds.includes(edgeId) ?? false
}

function getNodeOpacity(node: ConstellationNode): number {
  if (isNodeInPath(node.id)) return 1
  if (isNodeResonating(node.id)) return 0.4
  if (node.id === props.heroNodeId) return 1
  return 0.25
}

function getEdgeOpacity(edge: ConstellationEdge): number {
  if (isEdgeInPath(edge.id)) return 0.9
  // Base opacity - more visible, increases with strength
  return Math.min(0.4, 0.15 + Math.pow(edge.strength, 0.3) * 0.05)
}

function getEdgeWidth(edge: ConstellationEdge): number {
  if (isEdgeInPath(edge.id)) return 3.5
  // Base width - more prominent, increases with practice
  return Math.min(3, 1.2 + Math.pow(edge.strength, 0.4) * 0.4)
}

// Calculate curved path between two nodes
function getEdgePath(edge: ConstellationEdge): string {
  const source = props.nodes.find(n => n.id === edge.source)
  const target = props.nodes.find(n => n.id === edge.target)
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
      class="network-svg"
      viewBox="0 0 800 800"
      preserveAspectRatio="xMidYMid meet"
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
      </defs>

      <!-- Pan group - transforms to center on hero -->
      <g class="pan-group" :style="{ transform: panTransform }">
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
}

.pan-group {
  transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
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
