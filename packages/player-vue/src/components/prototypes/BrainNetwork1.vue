<script setup>
/**
 * Prototype 1: Literal Brain Silhouette
 * Nodes fill a brain-shaped container, connections form between related LEGOs
 */
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  completedSeeds: { type: Number, default: 42 },
  totalSeeds: { type: Number, default: 668 },
  masteryLevel: { type: Number, default: 0.65 }, // 0-1 average mastery
})

const emit = defineEmits(['close'])

// Belt progression for color
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

// Generate mock nodes (LEGOs) positioned within brain shape
const generateNodes = (count) => {
  const nodes = []
  // Brain-shaped boundary using parametric curve
  for (let i = 0; i < count; i++) {
    // Random position, then constrain to brain shape
    let x, y, attempts = 0
    do {
      x = 50 + (Math.random() - 0.5) * 70
      y = 20 + Math.random() * 60
      attempts++
    } while (!isInsideBrain(x, y) && attempts < 50)

    // Mastery varies per node
    const mastery = 0.3 + Math.random() * 0.7

    nodes.push({
      id: i,
      x,
      y,
      mastery,
      active: i < props.completedSeeds,
      size: 2 + mastery * 3,
    })
  }
  return nodes
}

// Check if point is inside brain silhouette (simplified)
const isInsideBrain = (x, y) => {
  // Left hemisphere
  const leftCx = 35, leftCy = 45, leftRx = 28, leftRy = 35
  const inLeft = Math.pow((x - leftCx) / leftRx, 2) + Math.pow((y - leftCy) / leftRy, 2) < 1

  // Right hemisphere
  const rightCx = 65, rightCy = 45, rightRx = 28, rightRy = 35
  const inRight = Math.pow((x - rightCx) / rightRx, 2) + Math.pow((y - rightCy) / rightRy, 2) < 1

  return inLeft || inRight
}

// Generate connections between nearby nodes
const generateConnections = (nodes) => {
  const connections = []
  const activeNodes = nodes.filter(n => n.active)

  for (let i = 0; i < activeNodes.length; i++) {
    for (let j = i + 1; j < activeNodes.length; j++) {
      const a = activeNodes[i]
      const b = activeNodes[j]
      const dist = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2))

      // Connect if close enough
      if (dist < 15) {
        const strength = Math.min(a.mastery, b.mastery)
        connections.push({
          id: `${a.id}-${b.id}`,
          x1: a.x,
          y1: a.y,
          x2: b.x,
          y2: b.y,
          strength,
        })
      }
    }
  }
  return connections
}

const nodes = ref([])
const connections = ref([])
const isAnimated = ref(false)

onMounted(() => {
  nodes.value = generateNodes(100)
  connections.value = generateConnections(nodes.value)
  setTimeout(() => { isAnimated.value = true }, 100)
})

const activeNodeCount = computed(() => nodes.value.filter(n => n.active).length)
const avgMastery = computed(() => {
  const active = nodes.value.filter(n => n.active)
  if (!active.length) return 0
  return active.reduce((sum, n) => sum + n.mastery, 0) / active.length
})
</script>

<template>
  <div class="brain-network" :class="{ animated: isAnimated }">
    <div class="bg"></div>

    <header class="header">
      <button class="back-btn" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
      </button>
      <h1>Prototype 1: Brain Silhouette</h1>
    </header>

    <main class="main">
      <svg class="brain-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow1" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <!-- Brain outline gradient -->
          <linearGradient id="brainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" :stop-color="currentBelt.color" stop-opacity="0.1"/>
            <stop offset="100%" :stop-color="currentBelt.color" stop-opacity="0.05"/>
          </linearGradient>
        </defs>

        <!-- Brain silhouette outline -->
        <g class="brain-outline">
          <!-- Left hemisphere -->
          <ellipse cx="35" cy="45" rx="28" ry="35"
            fill="url(#brainGrad)"
            :stroke="currentBelt.color"
            stroke-width="0.5"
            stroke-opacity="0.3"/>
          <!-- Right hemisphere -->
          <ellipse cx="65" cy="45" rx="28" ry="35"
            fill="url(#brainGrad)"
            :stroke="currentBelt.color"
            stroke-width="0.5"
            stroke-opacity="0.3"/>
          <!-- Corpus callosum (connection) -->
          <ellipse cx="50" cy="45" rx="8" ry="20"
            fill="url(#brainGrad)"
            stroke="none"/>
        </g>

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
            :stroke-width="0.3 + conn.strength * 0.8"
            :stroke-opacity="0.2 + conn.strength * 0.4"
            stroke-linecap="round"
          />
        </g>

        <!-- Nodes -->
        <g class="nodes" filter="url(#glow1)">
          <circle
            v-for="node in nodes"
            :key="node.id"
            :cx="node.x"
            :cy="node.y"
            :r="node.active ? node.size : 0.5"
            :fill="node.active ? currentBelt.color : 'rgba(255,255,255,0.1)'"
            :opacity="node.active ? 0.6 + node.mastery * 0.4 : 0.2"
            class="node"
            :class="{ active: node.active }"
          />
        </g>
      </svg>

      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ activeNodeCount }}</span>
          <span class="stat-label">Nodes Active</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ connections.length }}</span>
          <span class="stat-label">Connections</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ Math.round(avgMastery * 100) }}%</span>
          <span class="stat-label">Avg Mastery</span>
        </div>
      </div>
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
}

.bg {
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at 50% 30%, rgba(100,100,120,0.08) 0%, transparent 60%);
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

.brain-svg {
  width: 100%;
  max-width: 350px;
  height: auto;
}

.node {
  transition: all 0.6s ease;
}

.node.active {
  animation: pulse 3s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

.connections line {
  transition: all 0.4s ease;
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
</style>
