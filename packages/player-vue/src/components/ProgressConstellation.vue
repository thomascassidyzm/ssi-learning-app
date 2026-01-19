<script setup lang="ts">
/**
 * ProgressConstellation.vue - Static constellation view with search
 *
 * Shows completed learning progress as a beautiful constellation:
 * - Nodes clustered by belt color
 * - Static view (no drag/zoom for performance)
 * - Search to find and highlight specific nodes
 * - Same visual style as ConstellationNetworkView
 */

import { ref, computed, watch } from 'vue'

interface ProgressNode {
  id: string
  label: string
  belt: string
  x?: number
  y?: number
  connections?: string[]
}

const props = defineProps({
  // Completed nodes to display
  completedNodes: {
    type: Array as () => ProgressNode[],
    default: () => []
  },
  // Current belt level
  currentBelt: {
    type: String,
    default: 'white'
  }
})

const emit = defineEmits(['close', 'selectNode'])

// Search state
const searchQuery = ref('')
const searchResults = ref<ProgressNode[]>([])
const highlightedNodeId = ref<string | null>(null)

// Belt palettes - same as ConstellationNetworkView
const BELT_PALETTES: Record<string, { glow: string; core: string; inner: string }> = {
  white: { glow: '#9ca3af', core: '#2a2a35', inner: '#ffffff' },
  yellow: { glow: '#fbbf24', core: '#2a2518', inner: '#fbbf24' },
  orange: { glow: '#f97316', core: '#2a1a10', inner: '#f97316' },
  green: { glow: '#22c55e', core: '#102a1a', inner: '#22c55e' },
  blue: { glow: '#3b82f6', core: '#101a2a', inner: '#3b82f6' },
  purple: { glow: '#8b5cf6', core: '#1a102a', inner: '#8b5cf6' },
  brown: { glow: '#a87848', core: '#2a1a10', inner: '#a87848' },
  black: { glow: '#d4a853', core: '#2a2518', inner: '#d4a853' },
}

const BELT_ORDER = ['white', 'yellow', 'orange', 'green', 'blue', 'purple', 'brown', 'black']

// Belt cluster positions - flowing pattern
const BELT_CLUSTERS: Record<string, { cx: number; cy: number; radius: number }> = {
  white:  { cx: 400, cy: 400, radius: 70 },   // Center
  yellow: { cx: 280, cy: 300, radius: 65 },   // Upper left
  orange: { cx: 220, cy: 450, radius: 60 },   // Left
  green:  { cx: 320, cy: 580, radius: 65 },   // Lower left
  blue:   { cx: 500, cy: 550, radius: 70 },   // Lower right
  purple: { cx: 580, cy: 380, radius: 65 },   // Right
  brown:  { cx: 520, cy: 230, radius: 60 },   // Upper right
  black:  { cx: 380, cy: 180, radius: 70 },   // Top
}

// Generate demo nodes if none provided
const demoNodes = computed((): ProgressNode[] => {
  if (props.completedNodes.length > 0) return props.completedNodes

  const nodes: ProgressNode[] = []
  const currentBeltIndex = BELT_ORDER.indexOf(props.currentBelt)

  const sampleLabels: Record<string, string[]> = {
    white: ['I want', 'to speak', 'Italian', 'with you', 'now', 'please', 'thank you', 'yes'],
    yellow: ['I speak', 'you speak', 'he speaks', 'we speak', 'today', 'tomorrow', 'here', 'there', 'good', 'very', 'well', 'a little'],
    orange: ['I would like', 'to be able', 'to learn', 'to understand', 'something', 'nothing', 'everything', 'more', 'less', 'always', 'never', 'sometimes', 'often', 'maybe', 'probably', 'certainly', 'of course', 'definitely', 'absolutely', 'really'],
    green: ['because', 'although', 'however', 'therefore', 'meanwhile', 'afterwards', 'before', 'during', 'since', 'until', 'while', 'unless', 'whether', 'whenever', 'wherever', 'whoever', 'whatever', 'whichever', 'anyway', 'somehow', 'anywhere', 'everywhere', 'nowhere', 'somewhere', 'anyone', 'everyone', 'someone', 'no one', 'anything', 'everything', 'something', 'nothing', 'anyway', 'anyhow', 'otherwise', 'nonetheless', 'nevertheless', 'furthermore', 'moreover', 'besides'],
    blue: Array.from({ length: 50 }, (_, i) => `phrase ${i + 1}`),
    purple: Array.from({ length: 50 }, (_, i) => `advanced ${i + 1}`),
    brown: Array.from({ length: 50 }, (_, i) => `expert ${i + 1}`),
    black: Array.from({ length: 50 }, (_, i) => `master ${i + 1}`),
  }

  BELT_ORDER.forEach((belt, beltIndex) => {
    if (beltIndex <= currentBeltIndex) {
      const labels = sampleLabels[belt] || []
      const count = beltIndex === currentBeltIndex
        ? Math.floor(labels.length * 0.6)
        : labels.length

      for (let i = 0; i < Math.min(count, labels.length); i++) {
        nodes.push({
          id: `${belt}-${i}`,
          label: labels[i],
          belt,
          connections: i > 0 ? [`${belt}-${i - 1}`] :
            (beltIndex > 0 ? [`${BELT_ORDER[beltIndex - 1]}-0`] : [])
        })
      }
    }
  })

  return nodes
})

// Position nodes within their belt clusters
const positionedNodes = computed(() => {
  const nodes = demoNodes.value

  // Group by belt
  const nodesByBelt: Record<string, ProgressNode[]> = {}
  BELT_ORDER.forEach(belt => nodesByBelt[belt] = [])

  nodes.forEach(node => {
    const belt = node.belt || 'white'
    if (nodesByBelt[belt]) {
      nodesByBelt[belt].push(node)
    }
  })

  // Position each node
  const positioned: ProgressNode[] = []

  BELT_ORDER.forEach(belt => {
    const beltNodes = nodesByBelt[belt]
    const cluster = BELT_CLUSTERS[belt]

    beltNodes.forEach((node, i) => {
      const count = beltNodes.length
      // Golden angle spiral for nice distribution
      const goldenAngle = Math.PI * (3 - Math.sqrt(5))
      const angle = i * goldenAngle
      const radiusFactor = 0.25 + (Math.sqrt(i / Math.max(count, 1))) * 0.65

      positioned.push({
        ...node,
        x: cluster.cx + Math.cos(angle) * cluster.radius * radiusFactor,
        y: cluster.cy + Math.sin(angle) * cluster.radius * radiusFactor
      })
    })
  })

  return positioned
})

// Get palette for a belt
function getPalette(belt: string) {
  return BELT_PALETTES[belt] || BELT_PALETTES.white
}

// Check if node is highlighted (from search)
function isHighlighted(nodeId: string): boolean {
  return highlightedNodeId.value === nodeId
}

// Check if node matches search
function matchesSearch(nodeId: string): boolean {
  if (!searchQuery.value) return false
  return searchResults.value.some(n => n.id === nodeId)
}

// Get node opacity
function getNodeOpacity(node: ProgressNode): number {
  if (isHighlighted(node.id)) return 1
  if (matchesSearch(node.id)) return 0.9
  if (searchQuery.value && !matchesSearch(node.id)) return 0.15
  return 0.7
}

// Search handler
function handleSearch() {
  if (!searchQuery.value.trim()) {
    searchResults.value = []
    highlightedNodeId.value = null
    return
  }

  const query = searchQuery.value.toLowerCase()
  searchResults.value = positionedNodes.value.filter(node =>
    node.label.toLowerCase().includes(query)
  )
}

// Select a search result
function selectResult(node: ProgressNode) {
  highlightedNodeId.value = node.id
  emit('selectNode', node)
}

// Clear search
function clearSearch() {
  searchQuery.value = ''
  searchResults.value = []
  highlightedNodeId.value = null
}

// Watch search query
watch(searchQuery, handleSearch)

// Edge path calculation
function getEdgePath(fromId: string, toId: string): string {
  const from = positionedNodes.value.find(n => n.id === fromId)
  const to = positionedNodes.value.find(n => n.id === toId)
  if (!from || !to || !from.x || !from.y || !to.x || !to.y) return ''

  const x1 = from.x, y1 = from.y
  const x2 = to.x, y2 = to.y

  // Slight curve
  const midX = (x1 + x2) / 2
  const midY = (y1 + y2) / 2
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return `M ${x1} ${y1} L ${x2} ${y2}`

  const curveAmount = Math.min(20, len * 0.1)
  const perpX = -dy / len, perpY = dx / len
  const hash = (fromId + toId).split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  const direction = hash % 2 === 0 ? 1 : -1

  const cpX = midX + perpX * curveAmount * direction
  const cpY = midY + perpY * curveAmount * direction

  return `M ${x1} ${y1} Q ${cpX} ${cpY} ${x2} ${y2}`
}

// Get all edges
const edges = computed(() => {
  const result: { id: string; from: string; to: string; path: string }[] = []

  positionedNodes.value.forEach(node => {
    if (node.connections) {
      node.connections.forEach(targetId => {
        const target = positionedNodes.value.find(n => n.id === targetId)
        if (target) {
          result.push({
            id: `${node.id}-${targetId}`,
            from: node.id,
            to: targetId,
            path: getEdgePath(node.id, targetId)
          })
        }
      })
    }
  })

  return result
})

function getEdgeOpacity(edge: { from: string; to: string }): number {
  if (isHighlighted(edge.from) || isHighlighted(edge.to)) return 0.6
  if (matchesSearch(edge.from) || matchesSearch(edge.to)) return 0.4
  if (searchQuery.value) return 0.05
  return 0.15
}
</script>

<template>
  <div class="progress-constellation">
    <!-- Header with search -->
    <header class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>

      <div class="search-container">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="M21 21l-4.35-4.35"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Search phrases..."
        />
        <button v-if="searchQuery" class="clear-btn" @click="clearSearch">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- Search results dropdown -->
    <div v-if="searchResults.length > 0" class="search-results">
      <button
        v-for="result in searchResults.slice(0, 8)"
        :key="result.id"
        class="search-result"
        :class="{ 'search-result--active': highlightedNodeId === result.id }"
        @click="selectResult(result)"
      >
        <span
          class="result-dot"
          :style="{ background: getPalette(result.belt).glow }"
        ></span>
        <span class="result-label">{{ result.label }}</span>
        <span class="result-belt">{{ result.belt }}</span>
      </button>
    </div>

    <!-- Constellation SVG -->
    <svg class="constellation-svg" viewBox="0 0 800 800" preserveAspectRatio="xMidYMid meet">
      <!-- Defs -->
      <defs>
        <filter id="progress-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="progress-glow-strong" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Background nebula hints for each cluster -->
      <g class="nebula-layer">
        <circle
          v-for="belt in BELT_ORDER"
          :key="`nebula-${belt}`"
          :cx="BELT_CLUSTERS[belt].cx"
          :cy="BELT_CLUSTERS[belt].cy"
          :r="BELT_CLUSTERS[belt].radius * 1.3"
          :fill="`${getPalette(belt).glow}08`"
          class="nebula"
        />
      </g>

      <!-- Edges layer -->
      <g class="edges-layer">
        <path
          v-for="edge in edges"
          :key="edge.id"
          :d="edge.path"
          stroke="#ffffff"
          :stroke-width="isHighlighted(edge.from) || isHighlighted(edge.to) ? 2 : 1"
          :opacity="getEdgeOpacity(edge)"
          fill="none"
          stroke-linecap="round"
        />
      </g>

      <!-- Nodes layer -->
      <g class="nodes-layer">
        <g
          v-for="node in positionedNodes"
          :key="node.id"
          class="node"
          :class="{
            'node--highlighted': isHighlighted(node.id),
            'node--matched': matchesSearch(node.id)
          }"
          :transform="`translate(${node.x}, ${node.y})`"
          :opacity="getNodeOpacity(node)"
          @click="selectResult(node)"
        >
          <!-- Outer glow ring -->
          <circle
            class="node-glow"
            :r="isHighlighted(node.id) ? 20 : 16"
            fill="none"
            :stroke="getPalette(node.belt).glow"
            :stroke-width="isHighlighted(node.id) ? 3 : 2"
            :opacity="isHighlighted(node.id) ? 0.9 : 0.6"
            :filter="isHighlighted(node.id) ? 'url(#progress-glow-strong)' : 'url(#progress-glow)'"
          />

          <!-- Core circle -->
          <circle
            class="node-core"
            :r="isHighlighted(node.id) ? 12 : 10"
            :fill="getPalette(node.belt).core"
            :stroke="getPalette(node.belt).glow"
            :stroke-width="isHighlighted(node.id) ? 2 : 1.5"
          />

          <!-- Inner dot -->
          <circle
            class="node-inner"
            :r="isHighlighted(node.id) ? 4 : 3"
            :fill="getPalette(node.belt).inner"
          />

          <!-- Label (only for highlighted) -->
          <text
            v-if="isHighlighted(node.id)"
            class="node-label"
            :y="28"
            text-anchor="middle"
            :fill="getPalette(node.belt).glow"
          >
            {{ node.label }}
          </text>
        </g>
      </g>
    </svg>

    <!-- Belt legend -->
    <div class="belt-legend">
      <div
        v-for="belt in BELT_ORDER"
        :key="belt"
        class="legend-item"
        :class="{ 'legend-item--active': belt === currentBelt }"
      >
        <span class="legend-dot" :style="{ background: getPalette(belt).glow }"></span>
        <span class="legend-label">{{ belt }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.progress-constellation {
  position: fixed;
  inset: 0;
  background: linear-gradient(to bottom, #0a0a12 0%, #12121a 100%);
  display: flex;
  flex-direction: column;
  z-index: 100;
}

/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: calc(0.75rem + env(safe-area-inset-top, 0px)) 1rem 0.75rem 1rem;
}

.back-btn {
  width: 40px;
  height: 40px;
  min-width: 44px;
  min-height: 44px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

/* Search */
.search-container {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  width: 18px;
  height: 18px;
  color: rgba(255, 255, 255, 0.4);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 0.625rem 2.5rem 0.625rem 2.5rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #fff;
  font-size: 0.9375rem;
  outline: none;
  transition: all 0.2s ease;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.search-input:focus {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.clear-btn {
  position: absolute;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.clear-btn svg {
  width: 14px;
  height: 14px;
}

/* Search results */
.search-results {
  position: absolute;
  top: calc(60px + env(safe-area-inset-top, 0px));
  left: 1rem;
  right: 1rem;
  background: rgba(20, 20, 30, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 0.5rem;
  z-index: 20;
  backdrop-filter: blur(12px);
  max-height: 300px;
  overflow-y: auto;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.search-result:hover,
.search-result--active {
  background: rgba(255, 255, 255, 0.08);
}

.result-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.result-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-belt {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
  text-transform: capitalize;
}

/* Constellation SVG */
.constellation-svg {
  flex: 1;
  width: 100%;
  height: 100%;
}

.nebula {
  transition: opacity 0.3s ease;
}

.node {
  cursor: pointer;
  transition: opacity 0.3s ease;
}

.node-glow {
  transition: all 0.3s ease;
}

.node-core {
  transition: all 0.3s ease;
}

.node-inner {
  transition: all 0.3s ease;
}

.node-label {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 11px;
  font-weight: 500;
  pointer-events: none;
}

/* Belt legend */
.belt-legend {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px) + 80px) 1rem;
  flex-wrap: wrap;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  opacity: 0.5;
  transition: all 0.2s ease;
}

.legend-item--active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.08);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-label {
  font-size: 0.6875rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  text-transform: capitalize;
}

.legend-item--active .legend-label {
  color: #fff;
}

/* Responsive */
@media (max-width: 480px) {
  .header {
    padding: calc(0.5rem + env(safe-area-inset-top, 0px)) 0.75rem 0.5rem 0.75rem;
  }

  .search-input {
    font-size: 0.875rem;
    padding: 0.5rem 2.25rem;
  }

  .search-icon {
    width: 16px;
    height: 16px;
    left: 10px;
  }

  .belt-legend {
    gap: 0.375rem;
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom, 0px) + 70px);
  }

  .legend-item {
    padding: 0.2rem 0.375rem;
  }

  .legend-dot {
    width: 6px;
    height: 6px;
  }

  .legend-label {
    font-size: 0.625rem;
  }
}
</style>
