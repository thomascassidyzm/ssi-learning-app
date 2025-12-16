<script setup>
/**
 * Prototype 3: Radial Neural Growth
 * Network grows outward from center like neural dendrites
 * Rings represent belt levels, branches reach toward next ring
 */
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  completedSeeds: { type: Number, default: 42 },
  totalSeeds: { type: Number, default: 668 },
})

const emit = defineEmits(['close'])

// Belt progression as concentric rings
const BELTS = [
  { seeds: 0,   color: '#f5f5f5', label: 'Beginner', ring: 0 },
  { seeds: 8,   color: '#fcd34d', label: 'Explorer', ring: 1 },
  { seeds: 20,  color: '#fb923c', label: 'Apprentice', ring: 2 },
  { seeds: 40,  color: '#4ade80', label: 'Practitioner', ring: 3 },
  { seeds: 80,  color: '#60a5fa', label: 'Adept', ring: 4 },
  { seeds: 150, color: '#a78bfa', label: 'Master', ring: 5 },
  { seeds: 280, color: '#a8856c', label: 'Expert', ring: 6 },
  { seeds: 400, color: '#1f1f1f', label: 'Sensei', ring: 7 },
]

const currentBelt = computed(() => {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (props.completedSeeds >= BELTS[i].seeds) return { ...BELTS[i], index: i }
  }
  return { ...BELTS[0], index: 0 }
})

const nextBelt = computed(() => {
  const idx = currentBelt.value.index
  return idx < BELTS.length - 1 ? BELTS[idx + 1] : null
})

const progressToNext = computed(() => {
  const current = BELTS[currentBelt.value.index]
  const next = nextBelt.value
  if (!next) return 1
  return (props.completedSeeds - current.seeds) / (next.seeds - current.seeds)
})

// Generate dendrite branches
const generateBranches = () => {
  const branches = []
  const numMainBranches = 6
  const maxRing = currentBelt.value.index + 1

  for (let b = 0; b < numMainBranches; b++) {
    const baseAngle = (b / numMainBranches) * Math.PI * 2 - Math.PI / 2
    const branch = {
      id: b,
      segments: [],
    }

    let x = 50
    let y = 50
    let angle = baseAngle
    let currentRing = 0

    // Grow outward with some randomness
    while (currentRing < maxRing) {
      const segmentLength = 5 + Math.random() * 3
      const angleVariation = (Math.random() - 0.5) * 0.4

      const newAngle = angle + angleVariation
      const newX = x + Math.cos(newAngle) * segmentLength
      const newY = y + Math.sin(newAngle) * segmentLength

      // Check which ring we're in
      const distFromCenter = Math.sqrt(Math.pow(newX - 50, 2) + Math.pow(newY - 50, 2))
      const ringRadius = 6 // radius per ring
      const newRing = Math.floor(distFromCenter / ringRadius)

      const mastery = 0.4 + Math.random() * 0.6
      const thickness = 0.5 + mastery * 1.5

      branch.segments.push({
        x1: x,
        y1: y,
        x2: newX,
        y2: newY,
        ring: Math.min(newRing, maxRing - 1),
        mastery,
        thickness,
      })

      // Add sub-branches occasionally
      if (Math.random() > 0.6 && currentRing < maxRing - 1) {
        const subAngle = newAngle + (Math.random() > 0.5 ? 0.5 : -0.5)
        const subLength = 3 + Math.random() * 2
        const subX = newX + Math.cos(subAngle) * subLength
        const subY = newY + Math.sin(subAngle) * subLength

        branch.segments.push({
          x1: newX,
          y1: newY,
          x2: subX,
          y2: subY,
          ring: Math.min(newRing, maxRing - 1),
          mastery: mastery * 0.7,
          thickness: thickness * 0.6,
          isSubBranch: true,
        })
      }

      x = newX
      y = newY
      angle = newAngle
      currentRing = newRing

      // Stop if we're going too far
      if (distFromCenter > 45) break
    }

    branches.push(branch)
  }

  return branches
}

// Generate nodes at branch endpoints and junctions
const generateNodes = (branches) => {
  const nodes = []
  let id = 0

  for (const branch of branches) {
    for (const seg of branch.segments) {
      // Node at end of each segment
      nodes.push({
        id: id++,
        x: seg.x2,
        y: seg.y2,
        mastery: seg.mastery,
        size: 1 + seg.mastery * 1.5,
        ring: seg.ring,
      })
    }
  }

  return nodes
}

const branches = ref([])
const nodes = ref([])
const isAnimated = ref(false)

onMounted(() => {
  branches.value = generateBranches()
  nodes.value = generateNodes(branches.value)
  setTimeout(() => { isAnimated.value = true }, 100)
})

// Ring radii for visual reference
const ringRadii = computed(() => {
  return BELTS.slice(1).map((belt, i) => ({
    radius: (i + 1) * 6,
    color: belt.color,
    reached: props.completedSeeds >= belt.seeds,
    label: belt.label,
  }))
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
      <h1>Prototype 3: Radial Dendrites</h1>
    </header>

    <main class="main">
      <svg class="network-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow3" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="1" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <radialGradient id="coreGlow">
            <stop offset="0%" :stop-color="currentBelt.color" stop-opacity="0.4"/>
            <stop offset="100%" stop-color="transparent"/>
          </radialGradient>
        </defs>

        <!-- Belt ring guides -->
        <g class="rings">
          <circle
            v-for="ring in ringRadii"
            :key="ring.radius"
            cx="50"
            cy="50"
            :r="ring.radius"
            fill="none"
            :stroke="ring.reached ? ring.color : 'rgba(255,255,255,0.05)'"
            :stroke-width="ring.reached ? 0.3 : 0.15"
            :stroke-opacity="ring.reached ? 0.4 : 0.3"
            stroke-dasharray="1 2"
          />
        </g>

        <!-- Center core -->
        <circle cx="50" cy="50" r="8" fill="url(#coreGlow)"/>
        <circle cx="50" cy="50" r="3" :fill="currentBelt.color" opacity="0.8"/>

        <!-- Dendrite branches -->
        <g class="branches" filter="url(#glow3)">
          <g v-for="branch in branches" :key="branch.id">
            <line
              v-for="(seg, i) in branch.segments"
              :key="i"
              :x1="seg.x1"
              :y1="seg.y1"
              :x2="seg.x2"
              :y2="seg.y2"
              :stroke="BELTS[Math.min(seg.ring, BELTS.length - 1)].color"
              :stroke-width="seg.thickness"
              :stroke-opacity="0.4 + seg.mastery * 0.5"
              stroke-linecap="round"
              class="segment"
              :class="{ sub: seg.isSubBranch }"
            />
          </g>
        </g>

        <!-- Nodes at junctions -->
        <g class="nodes">
          <circle
            v-for="node in nodes"
            :key="node.id"
            :cx="node.x"
            :cy="node.y"
            :r="node.size"
            :fill="BELTS[Math.min(node.ring, BELTS.length - 1)].color"
            :opacity="0.5 + node.mastery * 0.5"
            class="node"
          />
        </g>

        <!-- Current belt label -->
        <text
          x="50"
          y="96"
          text-anchor="middle"
          :fill="currentBelt.color"
          font-size="4"
          font-weight="600"
          opacity="0.8"
        >
          {{ currentBelt.label }}
        </text>
      </svg>

      <div class="progress-info">
        <div class="current-ring">
          <div class="ring-swatch" :style="{ background: currentBelt.color }"></div>
          <span class="ring-label">{{ currentBelt.label }}</span>
        </div>
        <div class="progress-bar" v-if="nextBelt">
          <div class="progress-fill" :style="{ width: (progressToNext * 100) + '%', background: nextBelt.color }"></div>
        </div>
        <div class="next-ring" v-if="nextBelt">
          <span class="ring-label dim">{{ nextBelt.label }}</span>
          <div class="ring-swatch dim" :style="{ background: nextBelt.color }"></div>
        </div>
      </div>

      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ completedSeeds }}</span>
          <span class="stat-label">Seeds</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ nodes.length }}</span>
          <span class="stat-label">Nodes</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ branches.length }}</span>
          <span class="stat-label">Dendrites</span>
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
  background:
    radial-gradient(ellipse at 50% 45%, rgba(100,80,120,0.08) 0%, transparent 50%);
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
  max-width: 350px;
  height: auto;
}

.segment {
  transition: stroke-opacity 0.4s ease;
}

.node {
  transition: all 0.4s ease;
}

.animated .segment {
  animation: fadeIn 0.6s ease-out forwards;
  opacity: 0;
}

.animated .node {
  animation: popIn 0.4s ease-out forwards;
  opacity: 0;
  transform-origin: center;
}

@keyframes fadeIn {
  to { opacity: 1; }
}

@keyframes popIn {
  to { opacity: 1; transform: scale(1); }
}

.progress-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1.5rem;
  width: 100%;
  max-width: 280px;
}

.current-ring, .next-ring {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ring-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.ring-swatch.dim {
  opacity: 0.4;
}

.ring-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(255,255,255,0.8);
}

.ring-label.dim {
  opacity: 0.4;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255,255,255,0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.stats {
  display: flex;
  gap: 2rem;
  margin-top: 1.5rem;
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
