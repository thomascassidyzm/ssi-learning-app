<script setup>
/**
 * Prototype 2: Organic Force-Directed Network
 * Nodes cluster organically based on relationships, grows outward from center
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  completedSeeds: { type: Number, default: 42 },
  totalSeeds: { type: Number, default: 668 },
})

const emit = defineEmits(['close'])

// Belt colors
const BELTS = [
  { seeds: 0,   color: '#f5f5f5', glow: 'rgba(245,245,245,0.4)' },
  { seeds: 8,   color: '#fcd34d', glow: 'rgba(252,211,77,0.4)' },
  { seeds: 20,  color: '#fb923c', glow: 'rgba(251,146,60,0.4)' },
  { seeds: 40,  color: '#4ade80', glow: 'rgba(74,222,128,0.4)' },
  { seeds: 80,  color: '#60a5fa', glow: 'rgba(96,165,250,0.4)' },
  { seeds: 150, color: '#a78bfa', glow: 'rgba(167,139,250,0.4)' },
  { seeds: 280, color: '#a8856c', glow: 'rgba(168,133,108,0.4)' },
  { seeds: 400, color: '#1f1f1f', glow: 'rgba(255,255,255,0.2)' },
]

const currentBelt = computed(() => {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (props.completedSeeds >= BELTS[i].seeds) return BELTS[i]
  }
  return BELTS[0]
})

// Interpolate node color from faded to vibrant based on mastery
const getNodeColor = (mastery) => {
  // Parse the belt color
  const hex = currentBelt.value.color
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  // Low mastery: desaturated, darker (blend toward grey)
  // High mastery: full vibrant color
  const grey = 80 // Base grey for low mastery
  const t = mastery // 0 = grey, 1 = full color

  const finalR = Math.round(grey + (r - grey) * t)
  const finalG = Math.round(grey + (g - grey) * t)
  const finalB = Math.round(grey + (b - grey) * t)

  return `rgb(${finalR}, ${finalG}, ${finalB})`
}

// Force-directed simulation
const nodes = ref([])
const connections = ref([])

// Initialize nodes with clusters (simulating SEED families)
const initNodes = () => {
  const nodeList = []
  const numClusters = 8 // SEED families
  const nodesPerCluster = Math.ceil(props.completedSeeds / numClusters)

  for (let cluster = 0; cluster < numClusters; cluster++) {
    // Cluster center position (arranged in a circle)
    const angle = (cluster / numClusters) * Math.PI * 2
    const clusterRadius = 25
    const cx = 50 + Math.cos(angle) * clusterRadius
    const cy = 50 + Math.sin(angle) * clusterRadius

    for (let i = 0; i < nodesPerCluster; i++) {
      const nodeIndex = cluster * nodesPerCluster + i
      if (nodeIndex >= props.completedSeeds) break

      // Position within cluster
      const nodeAngle = Math.random() * Math.PI * 2
      const nodeRadius = Math.random() * 12
      const x = cx + Math.cos(nodeAngle) * nodeRadius
      const y = cy + Math.sin(nodeAngle) * nodeRadius

      const mastery = 0.3 + Math.random() * 0.7

      nodeList.push({
        id: nodeIndex,
        x,
        y,
        vx: 0,
        vy: 0,
        cluster,
        mastery,
        size: 1.5 + mastery * 2,
      })
    }
  }

  return nodeList
}

// Generate connections (within cluster = strong, cross-cluster = weak)
const initConnections = (nodeList) => {
  const conns = []

  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const a = nodeList[i]
      const b = nodeList[j]
      const dist = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))

      // Same cluster = likely connected
      const sameCluster = a.cluster === b.cluster
      const threshold = sameCluster ? 15 : 8

      if (dist < threshold && Math.random() > (sameCluster ? 0.3 : 0.8)) {
        const strength = sameCluster
          ? Math.min(a.mastery, b.mastery)
          : Math.min(a.mastery, b.mastery) * 0.5

        conns.push({
          id: `${a.id}-${b.id}`,
          source: a.id,
          target: b.id,
          strength,
        })
      }
    }
  }

  return conns
}

// Simple force simulation
let animationFrame = null
const simulate = () => {
  const nodeList = nodes.value
  const alpha = 0.1

  // Apply forces
  for (const node of nodeList) {
    // Centering force
    const dx = 50 - node.x
    const dy = 50 - node.y
    node.vx += dx * 0.002
    node.vy += dy * 0.002

    // Repulsion from other nodes
    for (const other of nodeList) {
      if (node.id === other.id) continue
      const ddx = node.x - other.x
      const ddy = node.y - other.y
      const dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1
      if (dist < 10) {
        const force = (10 - dist) * 0.05
        node.vx += (ddx / dist) * force
        node.vy += (ddy / dist) * force
      }
    }

    // Apply velocity with damping
    node.x += node.vx * alpha
    node.y += node.vy * alpha
    node.vx *= 0.9
    node.vy *= 0.9

    // Boundary
    node.x = Math.max(10, Math.min(90, node.x))
    node.y = Math.max(10, Math.min(90, node.y))
  }

  // Update connections
  connections.value = connections.value.map(conn => {
    const source = nodeList.find(n => n.id === conn.source)
    const target = nodeList.find(n => n.id === conn.target)
    return {
      ...conn,
      x1: source?.x || 0,
      y1: source?.y || 0,
      x2: target?.x || 0,
      y2: target?.y || 0,
    }
  })

  animationFrame = requestAnimationFrame(simulate)
}

onMounted(() => {
  nodes.value = initNodes()
  connections.value = initConnections(nodes.value)

  // Initialize connection positions
  connections.value = connections.value.map(conn => {
    const source = nodes.value.find(n => n.id === conn.source)
    const target = nodes.value.find(n => n.id === conn.target)
    return {
      ...conn,
      x1: source?.x || 0,
      y1: source?.y || 0,
      x2: target?.x || 0,
      y2: target?.y || 0,
    }
  })

  // Start simulation
  simulate()
})

onUnmounted(() => {
  if (animationFrame) cancelAnimationFrame(animationFrame)
})

const avgMastery = computed(() => {
  if (!nodes.value.length) return 0
  return nodes.value.reduce((sum, n) => sum + n.mastery, 0) / nodes.value.length
})
</script>

<template>
  <div class="brain-network">
    <div class="bg"></div>
    <div class="glow-orb"></div>

    <header class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1>Prototype 2: Organic Clusters</h1>
    </header>

    <main class="main">
      <svg class="network-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow2" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1.5" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <radialGradient id="centerGlow">
            <stop offset="0%" :stop-color="currentBelt.color" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <!-- Center glow -->
        <circle cx="50" cy="50" r="40" fill="url(#centerGlow)"/>

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
            :stroke-width="0.2 + conn.strength * 0.6"
            :stroke-opacity="0.15 + conn.strength * 0.35"
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
          />
        </g>

        <!-- Cluster labels (optional visual) -->
        <g class="cluster-hints">
          <text
            v-for="i in 8"
            :key="i"
            :x="50 + Math.cos((i - 1) / 8 * Math.PI * 2) * 38"
            :y="50 + Math.sin((i - 1) / 8 * Math.PI * 2) * 38"
            fill="rgba(255,255,255,0.15)"
            font-size="3"
            text-anchor="middle"
          >
            S{{ i }}
          </text>
        </g>
      </svg>

      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ nodes.length }}</span>
          <span class="stat-label">Nodes</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ connections.length }}</span>
          <span class="stat-label">Connections</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ Math.round(avgMastery * 100) }}%</span>
          <span class="stat-label">Mastery</span>
        </div>
      </div>

      <p class="hint">Nodes cluster by SEED family, connections form with practice</p>
    </main>
  </div>
</template>

<style scoped>
.brain-network {
  position: fixed;
  inset: 0;
  background: #050508;
  display: flex;
  flex-direction: column;
  font-family: 'DM Sans', -apple-system, sans-serif;
  overflow: hidden;
}

.bg {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 50%, rgba(80,80,100,0.06) 0%, transparent 50%);
}

.glow-orb {
  position: fixed;
  top: 50%;
  left: 50%;
  width: 300px;
  height: 300px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle, rgba(100,100,150,0.08) 0%, transparent 70%);
  animation: breathe 4s ease-in-out infinite;
  pointer-events: none;
}

@keyframes breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.5; }
  50% { transform: translate(-50%, -50%) scale(1.1); opacity: 0.8; }
}

.header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  position: relative;
  z-index: 10;
}

.back-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

.header h1 {
  font-size: 1rem;
  font-weight: 600;
  color: rgba(255,255,255,0.9);
  margin: 0;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.network-svg {
  width: 100%;
  max-width: 380px;
  height: auto;
}

.node {
  transition: r 0.3s ease;
}

.stats {
  display: flex;
  gap: 2rem;
  margin-top: 2rem;
  padding: 1rem 1.5rem;
  background: rgba(255,255,255,0.03);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.06);
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
  color: white;
}

.stat-label {
  font-size: 0.625rem;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hint {
  margin-top: 1rem;
  font-size: 0.75rem;
  color: rgba(255,255,255,0.3);
  text-align: center;
}
</style>
