<script setup>
/**
 * JourneyMap - Brain Network Visualization
 *
 * Visualizes learning progress as an organic neural network where:
 * - Nodes = LEGOs (learning units)
 * - Connections = relationships between LEGOs (same SEED, shared components)
 * - Node color/opacity = mastery level
 * - Clusters = SEED families
 *
 * Features:
 * - Pinch-to-zoom and scroll wheel zoom
 * - Pan/drag navigation
 * - Tap node for details
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  completedSeeds: { type: Number, default: 42 },
  totalSeeds: { type: Number, default: 668 },
  currentStreak: { type: Number, default: 7 },
  learningVelocity: { type: Number, default: 1.2 },
})

const emit = defineEmits(['close', 'startLearning'])

// Belt progression for colors
const BELTS = [
  { seeds: 0,   color: '#f5f5f5', label: 'Beginner' },
  { seeds: 8,   color: '#fcd34d', label: 'Explorer' },
  { seeds: 20,  color: '#fb923c', label: 'Apprentice' },
  { seeds: 40,  color: '#4ade80', label: 'Practitioner' },
  { seeds: 80,  color: '#60a5fa', label: 'Adept' },
  { seeds: 150, color: '#a78bfa', label: 'Master' },
  { seeds: 280, color: '#a8856c', label: 'Expert' },
  { seeds: 400, color: '#1f1f1f', label: 'Sensei' },
]

const currentBelt = computed(() => {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (props.completedSeeds >= BELTS[i].seeds) return { ...BELTS[i], index: i }
  }
  return { ...BELTS[0], index: 0 }
})

// Mock LEGO data - in production this comes from the database
const generateMockLegos = () => {
  const legos = []
  const seedFamilies = ['Greetings', 'Numbers', 'Colors', 'Food', 'Travel', 'Family', 'Time', 'Weather']

  for (let i = 0; i < props.completedSeeds; i++) {
    const familyIndex = i % seedFamilies.length
    legos.push({
      id: `lego-${i}`,
      phrase: getMockPhrase(i),
      translation: getMockTranslation(i),
      family: seedFamilies[familyIndex],
      familyIndex,
      mastery: 0.2 + Math.random() * 0.8,
      lastPracticed: getRandomDate(),
      practiceCount: Math.floor(Math.random() * 20) + 1,
    })
  }
  return legos
}

const getMockPhrase = (i) => {
  const phrases = ['Buongiorno', 'Grazie', 'Come stai', 'Mi chiamo', 'Voglio', 'Posso', 'Dove', 'Quanto costa', 'Per favore', 'Arrivederci']
  return phrases[i % phrases.length] + (i >= phrases.length ? ` ${Math.floor(i / phrases.length) + 1}` : '')
}

const getMockTranslation = (i) => {
  const translations = ['Good morning', 'Thank you', 'How are you', 'My name is', 'I want', 'Can I', 'Where', 'How much', 'Please', 'Goodbye']
  return translations[i % translations.length]
}

const getRandomDate = () => {
  const days = Math.floor(Math.random() * 14)
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// Interpolate node color from grey to vibrant based on mastery
const getNodeColor = (mastery) => {
  const hex = currentBelt.value.color
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  // Get grey value from CSS variable (60 for dark, 180 for light)
  const computedStyle = getComputedStyle(document.documentElement)
  const grey = parseInt(computedStyle.getPropertyValue('--node-grey')) || 60
  const t = mastery

  const finalR = Math.round(grey + (r - grey) * t)
  const finalG = Math.round(grey + (g - grey) * t)
  const finalB = Math.round(grey + (b - grey) * t)

  return `rgb(${finalR}, ${finalG}, ${finalB})`
}

// Network state
const nodes = ref([])
const connections = ref([])
const legos = ref([])

// Zoom and pan state
const scale = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const lastPanPoint = ref({ x: 0, y: 0 })

// Selected node
const selectedNode = ref(null)
const showNodeDetail = ref(false)

// SVG reference
const svgRef = ref(null)
const containerRef = ref(null)

// Initialize network
const initNetwork = () => {
  legos.value = generateMockLegos()

  const nodeList = []
  const numClusters = 8
  const nodesPerCluster = Math.ceil(legos.value.length / numClusters)

  legos.value.forEach((lego, index) => {
    const cluster = lego.familyIndex
    const clusterAngle = (cluster / numClusters) * Math.PI * 2
    const clusterRadius = 25
    const cx = 50 + Math.cos(clusterAngle) * clusterRadius
    const cy = 50 + Math.sin(clusterAngle) * clusterRadius

    const nodeAngle = Math.random() * Math.PI * 2
    const nodeRadius = Math.random() * 12
    const x = cx + Math.cos(nodeAngle) * nodeRadius
    const y = cy + Math.sin(nodeAngle) * nodeRadius

    nodeList.push({
      id: lego.id,
      x,
      y,
      vx: 0,
      vy: 0,
      cluster,
      mastery: lego.mastery,
      size: 1.5 + lego.mastery * 2,
      lego,
    })
  })

  nodes.value = nodeList
  initConnections()
}

const initConnections = () => {
  const conns = []
  const nodeList = nodes.value

  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const a = nodeList[i]
      const b = nodeList[j]
      const dist = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))

      const sameCluster = a.cluster === b.cluster
      const threshold = sameCluster ? 15 : 8

      if (dist < threshold && Math.random() > (sameCluster ? 0.3 : 0.85)) {
        const strength = sameCluster
          ? Math.min(a.mastery, b.mastery)
          : Math.min(a.mastery, b.mastery) * 0.4

        conns.push({
          id: `${a.id}-${b.id}`,
          source: a.id,
          target: b.id,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          strength,
        })
      }
    }
  }

  connections.value = conns
}

// Force simulation
let animationFrame = null
const simulate = () => {
  const nodeList = nodes.value
  const alpha = 0.08

  for (const node of nodeList) {
    // Centering force
    const dx = 50 - node.x
    const dy = 50 - node.y
    node.vx += dx * 0.001
    node.vy += dy * 0.001

    // Repulsion from other nodes
    for (const other of nodeList) {
      if (node.id === other.id) continue
      const ddx = node.x - other.x
      const ddy = node.y - other.y
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1
      if (dist < 8) {
        const force = (8 - dist) * 0.03
        node.vx += (ddx / dist) * force
        node.vy += (ddy / dist) * force
      }
    }

    // Apply velocity with damping
    node.x += node.vx * alpha
    node.y += node.vy * alpha
    node.vx *= 0.92
    node.vy *= 0.92

    // Boundary
    node.x = Math.max(8, Math.min(92, node.x))
    node.y = Math.max(8, Math.min(92, node.y))
  }

  // Update connection positions
  connections.value = connections.value.map(conn => {
    const source = nodeList.find(n => n.id === conn.source)
    const target = nodeList.find(n => n.id === conn.target)
    return {
      ...conn,
      x1: source?.x || conn.x1,
      y1: source?.y || conn.y1,
      x2: target?.x || conn.x2,
      y2: target?.y || conn.y2,
    }
  })

  animationFrame = requestAnimationFrame(simulate)
}

// Zoom controls
const zoomIn = () => {
  scale.value = Math.min(scale.value * 1.3, 5)
}

const zoomOut = () => {
  scale.value = Math.max(scale.value / 1.3, 0.5)
}

const resetView = () => {
  scale.value = 1
  panX.value = 0
  panY.value = 0
}

// Mouse wheel zoom
const handleWheel = (e) => {
  e.preventDefault()
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  scale.value = Math.max(0.5, Math.min(5, scale.value * delta))
}

// Touch zoom (pinch)
let initialPinchDistance = null
let initialScale = 1

const handleTouchStart = (e) => {
  if (e.touches.length === 2) {
    initialPinchDistance = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    )
    initialScale = scale.value
  } else if (e.touches.length === 1 && scale.value > 1) {
    isPanning.value = true
    lastPanPoint.value = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
}

const handleTouchMove = (e) => {
  if (e.touches.length === 2 && initialPinchDistance) {
    e.preventDefault()
    const currentDistance = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    )
    const pinchScale = currentDistance / initialPinchDistance
    scale.value = Math.max(0.5, Math.min(5, initialScale * pinchScale))
  } else if (e.touches.length === 1 && isPanning.value) {
    const dx = e.touches[0].clientX - lastPanPoint.value.x
    const dy = e.touches[0].clientY - lastPanPoint.value.y
    panX.value += dx
    panY.value += dy
    lastPanPoint.value = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
}

const handleTouchEnd = () => {
  initialPinchDistance = null
  isPanning.value = false
}

// Mouse pan
const handleMouseDown = (e) => {
  if (scale.value > 1) {
    isPanning.value = true
    lastPanPoint.value = { x: e.clientX, y: e.clientY }
  }
}

const handleMouseMove = (e) => {
  if (isPanning.value) {
    const dx = e.clientX - lastPanPoint.value.x
    const dy = e.clientY - lastPanPoint.value.y
    panX.value += dx
    panY.value += dy
    lastPanPoint.value = { x: e.clientX, y: e.clientY }
  }
}

const handleMouseUp = () => {
  isPanning.value = false
}

// Node interaction
const handleNodeClick = (node) => {
  selectedNode.value = node
  showNodeDetail.value = true

  // Haptic feedback
  if (navigator.vibrate) {
    navigator.vibrate(10)
  }
}

const closeNodeDetail = () => {
  showNodeDetail.value = false
  selectedNode.value = null
}

// Computed transform
const transformStyle = computed(() => ({
  transform: `scale(${scale.value}) translate(${panX.value / scale.value}px, ${panY.value / scale.value}px)`,
  transformOrigin: 'center center',
}))

// Stats
const avgMastery = computed(() => {
  if (!nodes.value.length) return 0
  return nodes.value.reduce((sum, n) => sum + n.mastery, 0) / nodes.value.length
})

// Lifecycle
onMounted(() => {
  initNetwork()
  simulate()
})

onUnmounted(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
})

// Watch for prop changes
watch(() => props.completedSeeds, () => {
  initNetwork()
})
</script>

<template>
  <div class="journey-map">
    <div class="bg"></div>
    <div class="glow-orb"></div>

    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <h1 class="title">Your Network</h1>
        <div class="subtitle">{{ nodes.length }} nodes · {{ connections.length }} connections</div>
      </div>
      <div class="streak-badge" v-if="currentStreak > 0">
        <span class="streak-icon">🔥</span>
        <span class="streak-num">{{ currentStreak }}</span>
      </div>
    </header>

    <!-- Network Canvas -->
    <main
      class="main"
      ref="containerRef"
      @wheel.passive="handleWheel"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @mousedown="handleMouseDown"
      @mousemove="handleMouseMove"
      @mouseup="handleMouseUp"
      @mouseleave="handleMouseUp"
    >
      <svg
        ref="svgRef"
        class="network-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
        :style="transformStyle"
      >
        <defs>
          <radialGradient id="centerGlow">
            <stop offset="0%" :stop-color="currentBelt.color" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <!-- Center glow -->
        <circle cx="50" cy="50" r="35" fill="url(#centerGlow)"/>

        <!-- Connections -->
        <g class="connections">
          <line
            v-for="conn in connections"
            :key="conn.id"
            :x1="conn.x1"
            :y1="conn.y1"
            :x2="conn.x2"
            :y2="conn.y2"
            :stroke="currentBelt.color"
            :stroke-width="0.15 + conn.strength * 0.4"
            :stroke-opacity="0.1 + conn.strength * 0.3"
            stroke-linecap="round"
          />
        </g>

        <!-- Nodes -->
        <g class="nodes">
          <circle
            v-for="node in nodes"
            :key="node.id"
            :cx="node.x"
            :cy="node.y"
            :r="node.size"
            :fill="getNodeColor(node.mastery)"
            :opacity="0.3 + node.mastery * 0.7"
            class="node"
            :class="{ selected: selectedNode?.id === node.id }"
            @click.stop="handleNodeClick(node)"
          />
        </g>

        <!-- Cluster labels (visible when zoomed) -->
        <g class="cluster-labels" v-if="scale >= 1.5">
          <text
            v-for="(family, i) in ['Greetings', 'Numbers', 'Colors', 'Food', 'Travel', 'Family', 'Time', 'Weather']"
            :key="family"
            :x="50 + Math.cos((i / 8) * Math.PI * 2) * 38"
            :y="50 + Math.sin((i / 8) * Math.PI * 2) * 38"
            class="cluster-label"
            font-size="2.5"
            text-anchor="middle"
            font-weight="500"
          >
            {{ family }}
          </text>
        </g>
      </svg>

      <!-- Zoom Controls -->
      <div class="zoom-controls">
        <button class="zoom-btn" @click="zoomIn" title="Zoom in">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35M11 8v6M8 11h6"/>
          </svg>
        </button>
        <button class="zoom-btn" @click="zoomOut" title="Zoom out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35M8 11h6"/>
          </svg>
        </button>
        <button class="zoom-btn" @click="resetView" title="Reset view" v-if="scale !== 1 || panX !== 0 || panY !== 0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
      </div>

      <!-- Zoom indicator -->
      <div class="zoom-indicator" v-if="scale !== 1">
        {{ Math.round(scale * 100) }}%
      </div>
    </main>

    <!-- Stats Panel -->
    <div class="stats-panel">
      <div class="stat">
        <span class="stat-value">{{ completedSeeds }}</span>
        <span class="stat-label">Seeds</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <span class="stat-value">{{ Math.round(avgMastery * 100) }}%</span>
        <span class="stat-label">Mastery</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <div class="belt-indicator" :style="{ background: currentBelt.color }"></div>
        <span class="stat-label">{{ currentBelt.label }}</span>
      </div>
    </div>

    <!-- Continue Button -->
    <footer class="footer">
      <button class="continue-btn" @click="emit('startLearning')">
        <span>Continue Learning</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </footer>

    <!-- Node Detail Sheet -->
    <Transition name="sheet">
      <div v-if="showNodeDetail && selectedNode" class="node-detail-overlay" @click="closeNodeDetail">
        <div class="node-detail-sheet" @click.stop>
          <div class="sheet-handle"></div>

          <div class="sheet-header">
            <div class="sheet-node-indicator" :style="{ background: getNodeColor(selectedNode.mastery) }"></div>
            <div class="sheet-title-group">
              <h3 class="sheet-phrase">{{ selectedNode.lego.phrase }}</h3>
              <p class="sheet-translation">{{ selectedNode.lego.translation }}</p>
            </div>
            <button class="sheet-close" @click="closeNodeDetail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div class="sheet-content">
            <div class="sheet-stat-row">
              <div class="sheet-stat">
                <span class="sheet-stat-value">{{ Math.round(selectedNode.mastery * 100) }}%</span>
                <span class="sheet-stat-label">Mastery</span>
              </div>
              <div class="sheet-stat">
                <span class="sheet-stat-value">{{ selectedNode.lego.practiceCount }}</span>
                <span class="sheet-stat-label">Practices</span>
              </div>
              <div class="sheet-stat">
                <span class="sheet-stat-value">{{ selectedNode.lego.lastPracticed }}</span>
                <span class="sheet-stat-label">Last Seen</span>
              </div>
            </div>

            <div class="sheet-mastery-bar">
              <div class="sheet-mastery-fill" :style="{ width: (selectedNode.mastery * 100) + '%', background: currentBelt.color }"></div>
            </div>

            <div class="sheet-family">
              <span class="sheet-family-label">Family:</span>
              <span class="sheet-family-value">{{ selectedNode.lego.family }}</span>
            </div>
          </div>

          <button class="sheet-practice-btn" @click="emit('startLearning'); closeNodeDetail()">
            Practice This
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.journey-map {
  position: fixed;
  inset: 0;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  font-family: 'DM Sans', -apple-system, sans-serif;
  overflow: hidden;
  user-select: none;
}

.bg {
  position: fixed;
  inset: 0;
  background: var(--network-bg);
}

.glow-orb {
  position: fixed;
  top: 40%;
  left: 50%;
  width: 300px;
  height: 300px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, var(--glow-soft) 0%, transparent 70%);
  animation: breathe 4s ease-in-out infinite;
  pointer-events: none;
}

@keyframes breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
  50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.7; }
}

/* Header */
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  position: relative;
  z-index: 10;
}

.header-left {
  display: flex;
  flex-direction: column;
}

.title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.subtitle {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.125rem;
}

.streak-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 149, 0, 0.12);
  border: 1px solid rgba(255, 149, 0, 0.25);
  border-radius: 100px;
}

.streak-icon { font-size: 0.875rem; }

.streak-num {
  font-size: 0.875rem;
  font-weight: 700;
  color: #ff9500;
}

/* Main canvas area */
.main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}

.main:active {
  cursor: grabbing;
}

.network-svg {
  width: 90%;
  max-width: 400px;
  height: auto;
  transition: transform 0.1s ease-out;
}

.node {
  cursor: pointer;
  transition: r 0.2s ease, opacity 0.2s ease;
}

.node:hover {
  opacity: 1 !important;
}

.node.selected {
  stroke: var(--text-primary);
  stroke-width: 0.5;
}

.cluster-label {
  fill: var(--text-muted);
}

/* Zoom controls */
.zoom-controls {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.zoom-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid var(--border-medium);
  background: var(--bg-elevated);
  backdrop-filter: blur(8px);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.zoom-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.zoom-btn svg {
  width: 20px;
  height: 20px;
}

.zoom-indicator {
  position: absolute;
  left: 1rem;
  top: 1rem;
  padding: 0.375rem 0.75rem;
  background: var(--bg-elevated);
  backdrop-filter: blur(8px);
  border-radius: 8px;
  font-family: 'Space Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}

/* Stats panel */
.stats-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 1rem;
  margin: 0 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.stat-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-divider {
  width: 1px;
  height: 32px;
  background: var(--border-medium);
}

.belt-indicator {
  width: 20px;
  height: 20px;
  border-radius: 6px;
}

/* Footer */
.footer {
  padding: 1rem 1.5rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px) + 80px);
}

.continue-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 0.875rem 1.75rem;
  background: var(--gradient-accent);
  color: var(--text-inverse);
  border: none;
  border-radius: 14px;
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: var(--glow-accent);
}

.continue-btn:hover {
  transform: translateY(-2px);
}

.continue-btn:active {
  transform: scale(0.98);
}

.continue-btn svg {
  width: 18px;
  height: 18px;
}

/* Node Detail Sheet */
.node-detail-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  z-index: 100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.node-detail-sheet {
  width: 100%;
  max-width: 500px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-bottom: none;
  border-radius: 24px 24px 0 0;
  padding: 0.75rem 1.5rem 2rem;
  padding-bottom: calc(2rem + env(safe-area-inset-bottom, 0px));
}

.sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border-medium);
  border-radius: 2px;
  margin: 0 auto 1.25rem;
}

.sheet-header {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.sheet-node-indicator {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  flex-shrink: 0;
}

.sheet-title-group {
  flex: 1;
  min-width: 0;
}

.sheet-phrase {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.25rem;
}

.sheet-translation {
  font-size: 0.9375rem;
  color: var(--text-muted);
  margin: 0;
}

.sheet-close {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}

.sheet-close svg {
  width: 18px;
  height: 18px;
}

.sheet-content {
  margin-bottom: 1.5rem;
}

.sheet-stat-row {
  display: flex;
  justify-content: space-around;
  margin-bottom: 1.25rem;
}

.sheet-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.sheet-stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--text-primary);
}

.sheet-stat-label {
  font-size: 0.6875rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.sheet-mastery-bar {
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.sheet-mastery-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.sheet-family {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.sheet-family-label {
  color: var(--text-muted);
}

.sheet-family-value {
  color: var(--text-secondary);
  font-weight: 500;
}

.sheet-practice-btn {
  width: 100%;
  padding: 0.875rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  color: var(--text-primary);
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.sheet-practice-btn:hover {
  background: var(--bg-card);
}

/* Sheet transition */
.sheet-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.sheet-leave-active {
  transition: all 0.25s ease-in;
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .node-detail-sheet,
.sheet-leave-to .node-detail-sheet {
  transform: translateY(100%);
}

/* Responsive */
@media (max-width: 480px) {
  .header { padding: 0.75rem 1rem; }
  .title { font-size: 1.125rem; }
  .stats-panel { margin: 0 0.75rem; gap: 1rem; }
  .stat-value { font-size: 1.125rem; }
  .footer { padding: 0.75rem 1rem; padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px) + 76px); }
  .zoom-controls { right: 0.5rem; }
  .zoom-btn { width: 36px; height: 36px; }
}
</style>
