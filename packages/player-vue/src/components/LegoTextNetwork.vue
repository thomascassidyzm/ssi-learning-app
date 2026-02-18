<script setup lang="ts">
/**
 * LegoTextNetwork.vue - Text-as-Visual Background for Learning Player
 *
 * LEGO text fragments float in the background as dimmed, elegant typography.
 * As new LEGOs are introduced, they drift in and visually link to existing ones.
 * The words themselves ARE the visualization — pedagogically honest,
 * showing vocabulary connecting in real time.
 *
 * Pure CSS/SVG — no WebGL, no Three.js. Lightweight first load.
 */

import { ref, computed, watch, onMounted, onUnmounted, nextTick, type PropType } from 'vue'
import type { NetworkNode, NetworkEdge, PathHighlight } from '../composables/usePrebuiltNetwork'

// =============================================================================
// PROPS
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
// LAYOUT STATE
// =============================================================================

const containerRef = ref<HTMLElement | null>(null)
const containerSize = ref({ width: 0, height: 0 })

// Track which nodes have been revealed (for entrance animation timing)
const revealedOrder = ref<string[]>([])
const revealTimestamps = ref<Map<string, number>>(new Map())

// =============================================================================
// POSITIONED NODES — scatter text across the viewport
// =============================================================================

interface PositionedNode {
  id: string
  targetText: string
  knownText: string
  x: number  // percentage 0-100
  y: number  // percentage 0-100
  isRevealed: boolean
  isOnPath: boolean
  isComponent: boolean
  revealIndex: number  // order of reveal for stagger animation
  fontSize: number     // rem units — components smaller
}

// Stable positions derived from node data (seeded by node index)
// Uses a golden-angle spiral to distribute nodes organically
const positionedNodes = computed(() => {
  const nodes = props.nodes
  const revealed = props.revealedNodeIds
  const path = props.currentPath
  const pathNodeIds = new Set(path?.nodeIds || [])

  // Margin from edges (% of viewport)
  const margin = 12
  const usableW = 100 - margin * 2
  const usableH = 100 - margin * 2

  // Golden angle distribution for organic feel
  const goldenAngle = 137.508 // degrees
  const maxRadius = 38 // % from center

  return nodes.map((node, i) => {
    // Spiral position from center
    const angle = (i * goldenAngle * Math.PI) / 180
    const r = Math.min(maxRadius, 8 + Math.sqrt(i) * 7)
    const cx = 50 + r * Math.cos(angle)
    const cy = 50 + r * Math.sin(angle)

    // Clamp to usable area
    const x = Math.max(margin, Math.min(100 - margin, cx))
    const y = Math.max(margin, Math.min(100 - margin, cy))

    const isRevealed = revealed ? revealed.has(node.id) : false
    const revealIdx = revealedOrder.value.indexOf(node.id)

    return {
      id: node.id,
      targetText: node.targetText,
      knownText: node.knownText,
      x,
      y,
      isRevealed,
      isOnPath: pathNodeIds.has(node.id),
      isComponent: node.isComponent || false,
      revealIndex: revealIdx >= 0 ? revealIdx : 999,
      fontSize: node.isComponent ? 0.75 : 1.1,
    } as PositionedNode
  })
})

// Only show revealed nodes (others don't exist yet)
const visibleNodes = computed(() =>
  positionedNodes.value.filter(n => n.isRevealed)
)

// =============================================================================
// EDGES between revealed nodes
// =============================================================================

interface PositionedEdge {
  id: string
  x1: number; y1: number
  x2: number; y2: number
  isOnPath: boolean
  strength: number
}

const visibleEdges = computed(() => {
  const nodeMap = new Map<string, PositionedNode>()
  visibleNodes.value.forEach(n => nodeMap.set(n.id, n))

  const path = props.currentPath
  const pathEdgeIds = new Set(path?.edgeIds || [])

  return props.edges
    .map(edge => {
      const srcId = typeof edge.source === 'string' ? edge.source : edge.source.id
      const tgtId = typeof edge.target === 'string' ? edge.target : edge.target.id
      const src = nodeMap.get(srcId)
      const tgt = nodeMap.get(tgtId)
      if (!src || !tgt) return null

      return {
        id: edge.id,
        x1: src.x,
        y1: src.y,
        x2: tgt.x,
        y2: tgt.y,
        isOnPath: pathEdgeIds.has(edge.id),
        strength: edge.strength,
      } as PositionedEdge
    })
    .filter(Boolean) as PositionedEdge[]
})

// =============================================================================
// TRACK REVEAL ORDER for staggered entrance animations
// =============================================================================

watch(() => props.revealedNodeIds, (newIds) => {
  if (!newIds) return
  const now = Date.now()
  for (const id of newIds) {
    if (!revealTimestamps.value.has(id)) {
      revealTimestamps.value.set(id, now)
      revealedOrder.value.push(id)
    }
  }
}, { immediate: true, deep: true })

// =============================================================================
// RECENTLY REVEALED — for glow pulse on new arrivals
// =============================================================================

const recentlyRevealed = ref<Set<string>>(new Set())

watch(() => props.revealedNodeIds, (newIds, oldIds) => {
  if (!newIds || !oldIds) return
  const fresh = new Set<string>()
  for (const id of newIds) {
    if (!oldIds.has(id)) fresh.add(id)
  }
  if (fresh.size > 0) {
    recentlyRevealed.value = new Set([...recentlyRevealed.value, ...fresh])
    // Clear "recently" status after animation completes
    setTimeout(() => {
      recentlyRevealed.value = new Set(
        [...recentlyRevealed.value].filter(id => !fresh.has(id))
      )
    }, 2000)
  }
}, { deep: true })

// =============================================================================
// RESIZE OBSERVER
// =============================================================================

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (containerRef.value) {
    containerSize.value = {
      width: containerRef.value.clientWidth,
      height: containerRef.value.clientHeight,
    }
    resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) {
        containerSize.value = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        }
      }
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})
</script>

<template>
  <div ref="containerRef" class="lego-text-network">
    <!-- SVG layer for connection lines -->
    <svg class="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line
        v-for="edge in visibleEdges"
        :key="edge.id"
        :x1="edge.x1"
        :y1="edge.y1"
        :x2="edge.x2"
        :y2="edge.y2"
        :class="{ 'edge-active': edge.isOnPath }"
        :style="{
          stroke: edge.isOnPath ? accentColor : 'rgba(255,255,255,0.06)',
          strokeWidth: edge.isOnPath ? 0.15 : 0.05,
        }"
      />
    </svg>

    <!-- Text nodes layer -->
    <div
      v-for="node in visibleNodes"
      :key="node.id"
      class="text-node"
      :class="{
        'is-on-path': node.isOnPath,
        'is-component': node.isComponent,
        'is-new': recentlyRevealed.has(node.id),
      }"
      :style="{
        left: node.x + '%',
        top: node.y + '%',
        fontSize: node.fontSize + 'rem',
        '--accent': accentColor,
        animationDelay: (node.revealIndex * 0.15) + 's',
      }"
      @click="emit('node-tap', props.nodes.find(n => n.id === node.id)!)"
    >
      <span class="target-text">{{ node.targetText }}</span>
    </div>
  </div>
</template>

<style scoped>
.lego-text-network {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

/* ─── Edge lines ─── */
.edge-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.edge-layer line {
  transition: stroke 0.6s ease, stroke-width 0.6s ease;
}

.edge-layer line.edge-active {
  filter: drop-shadow(0 0 3px var(--accent, #9ca3af));
}

/* ─── Text nodes ─── */
.text-node {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  cursor: default;
  white-space: nowrap;
  font-family: 'Inter', system-ui, sans-serif;
  font-weight: 300;
  letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.12);
  transition: color 0.6s ease, text-shadow 0.6s ease, transform 0.6s ease;
  animation: text-arrive 0.8s ease-out both;
  user-select: none;
}

.text-node .target-text {
  display: block;
}

/* Component LEGOs — smaller, dimmer */
.text-node.is-component {
  font-weight: 200;
  color: rgba(255, 255, 255, 0.07);
}

/* Active on fire path — accent glow */
.text-node.is-on-path {
  color: var(--accent, #9ca3af);
  text-shadow: 0 0 20px var(--accent, #9ca3af), 0 0 40px rgba(255, 255, 255, 0.1);
  transform: translate(-50%, -50%) scale(1.08);
  font-weight: 400;
}

/* Recently introduced — pulse glow */
.text-node.is-new {
  animation: text-arrive 0.8s ease-out both, text-pulse 1.5s ease-in-out 0.8s;
}

/* ─── Animations ─── */
@keyframes text-arrive {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.7) translateY(10px);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1) translateY(0);
    filter: blur(0);
  }
}

@keyframes text-pulse {
  0% {
    color: var(--accent, #9ca3af);
    text-shadow: 0 0 30px var(--accent, #9ca3af);
  }
  100% {
    color: rgba(255, 255, 255, 0.12);
    text-shadow: none;
  }
}
</style>
