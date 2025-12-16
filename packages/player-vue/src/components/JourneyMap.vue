<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  completedSeeds: { type: Number, default: 42 },
  totalSeeds: { type: Number, default: 668 },
  currentStreak: { type: Number, default: 7 },
  learningVelocity: { type: Number, default: 1.2 },
})

const emit = defineEmits(['close', 'startLearning'])

// Belt progression - these become topographic contour levels
const BELT_CONFIG = {
  belts: [
    { name: 'white',   seedsRequired: 0,   color: '#f5f5f5', colorDark: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.3)', label: 'Beginner' },
    { name: 'yellow',  seedsRequired: 8,   color: '#fcd34d', colorDark: '#f59e0b', glow: 'rgba(252, 211, 77, 0.4)', label: 'Explorer' },
    { name: 'orange',  seedsRequired: 20,  color: '#fb923c', colorDark: '#ea580c', glow: 'rgba(251, 146, 60, 0.4)', label: 'Apprentice' },
    { name: 'green',   seedsRequired: 40,  color: '#4ade80', colorDark: '#16a34a', glow: 'rgba(74, 222, 128, 0.4)', label: 'Practitioner' },
    { name: 'blue',    seedsRequired: 80,  color: '#60a5fa', colorDark: '#2563eb', glow: 'rgba(96, 165, 250, 0.4)', label: 'Adept' },
    { name: 'purple',  seedsRequired: 150, color: '#a78bfa', colorDark: '#7c3aed', glow: 'rgba(167, 139, 250, 0.4)', label: 'Master' },
    { name: 'brown',   seedsRequired: 280, color: '#a8856c', colorDark: '#78350f', glow: 'rgba(168, 133, 108, 0.4)', label: 'Expert' },
    { name: 'black',   seedsRequired: 400, color: '#1f1f1f', colorDark: '#0a0a0a', glow: 'rgba(255, 255, 255, 0.15)', label: 'Sensei' },
  ]
}

// SVG dimensions
const SVG_WIDTH = 400
const SVG_HEIGHT = 500
const MOUNTAIN_TOP = 60
const MOUNTAIN_BOTTOM = 460
const MOUNTAIN_LEFT = 60
const MOUNTAIN_RIGHT = 340
const MOUNTAIN_CENTER = SVG_WIDTH / 2

// Current belt
const currentBelt = computed(() => {
  const belts = BELT_CONFIG.belts
  for (let i = belts.length - 1; i >= 0; i--) {
    if (props.completedSeeds >= belts[i].seedsRequired) {
      return { ...belts[i], index: i }
    }
  }
  return { ...belts[0], index: 0 }
})

// Progress 0-1
const progress = computed(() => Math.min(props.completedSeeds / props.totalSeeds, 1))

// Belt contour lines - horizontal bands across the mountain
const contourLines = computed(() => {
  return BELT_CONFIG.belts.map((belt, idx) => {
    const progressY = belt.seedsRequired / props.totalSeeds
    const y = MOUNTAIN_BOTTOM - (progressY * (MOUNTAIN_BOTTOM - MOUNTAIN_TOP))

    // Mountain width at this elevation (narrower at top)
    const widthRatio = 1 - (progressY * 0.7)
    const halfWidth = ((MOUNTAIN_RIGHT - MOUNTAIN_LEFT) / 2) * widthRatio
    const left = MOUNTAIN_CENTER - halfWidth
    const right = MOUNTAIN_CENTER + halfWidth

    const reached = props.completedSeeds >= belt.seedsRequired
    const isCurrent = currentBelt.value.name === belt.name

    return {
      ...belt,
      y,
      left,
      right,
      reached,
      isCurrent,
      idx
    }
  })
})

// Generate snaking path based on velocity
// High velocity = steep/direct, Low velocity = lots of switchbacks
const generatePath = computed(() => {
  const points = []
  const steps = 50

  // Velocity affects how much the path snakes
  // velocity 2+ = almost straight up
  // velocity 0.5 = lots of switchbacks
  const snakiness = Math.max(0.2, Math.min(2, 2.5 - props.learningVelocity))
  const amplitude = 80 * snakiness // Max horizontal deviation
  const frequency = 3 + (snakiness * 2) // How many S-curves

  for (let i = 0; i <= steps; i++) {
    const t = i / steps // 0 to 1

    // Y position (bottom to top)
    const y = MOUNTAIN_BOTTOM - (t * (MOUNTAIN_BOTTOM - MOUNTAIN_TOP))

    // Mountain width at this Y (narrower at top)
    const widthRatio = 1 - (t * 0.7)
    const maxDeviation = amplitude * widthRatio

    // Sinusoidal X offset for snaking
    const xOffset = Math.sin(t * Math.PI * frequency) * maxDeviation
    const x = MOUNTAIN_CENTER + xOffset

    points.push({ x, y, t })
  }

  return points
})

// Convert points to SVG path
const pathData = computed(() => {
  const pts = generatePath.value
  if (pts.length < 2) return ''

  let d = `M ${pts[0].x} ${pts[0].y}`

  // Use quadratic curves for smooth path
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1]
    const curr = pts[i]
    const cpX = (prev.x + curr.x) / 2
    const cpY = (prev.y + curr.y) / 2
    d += ` Q ${prev.x} ${prev.y}, ${cpX} ${cpY}`
  }

  // Final point
  const last = pts[pts.length - 1]
  d += ` L ${last.x} ${last.y}`

  return d
})

// Traveler position along the path
const travelerPosition = computed(() => {
  const pts = generatePath.value
  const idx = Math.floor(progress.value * (pts.length - 1))
  return pts[idx] || pts[0]
})

// Path length for animation (approximate)
const pathLength = computed(() => {
  const pts = generatePath.value
  let len = 0
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i-1].x
    const dy = pts[i].y - pts[i-1].y
    len += Math.sqrt(dx*dx + dy*dy)
  }
  return len
})

// Velocity description
const velocityLabel = computed(() => {
  if (props.learningVelocity >= 2) return 'Blazing'
  if (props.learningVelocity >= 1.5) return 'Swift'
  if (props.learningVelocity >= 1) return 'Steady'
  if (props.learningVelocity >= 0.5) return 'Gradual'
  return 'Gentle'
})

// CSS vars
const cssVars = computed(() => ({
  '--belt-color': currentBelt.value.color,
  '--belt-glow': currentBelt.value.glow,
  '--path-length': pathLength.value,
  '--progress': progress.value,
}))

// Animation
const isAnimated = ref(false)
onMounted(() => {
  setTimeout(() => { isAnimated.value = true }, 100)
})
</script>

<template>
  <div class="journey-map" :style="cssVars">
    <!-- Atmospheric background -->
    <div class="bg-gradient"></div>
    <div class="bg-stars"></div>
    <div class="bg-noise"></div>

    <!-- Mist layers -->
    <div class="mist mist-1"></div>
    <div class="mist mist-2"></div>

    <!-- Header -->
    <header class="header">
      <h1 class="title">Your Journey</h1>
      <div class="streak-badge" v-if="currentStreak > 0">
        <span class="streak-icon">🔥</span>
        <span class="streak-num">{{ currentStreak }}</span>
      </div>
    </header>

    <!-- Mountain Visualization -->
    <main class="main">
      <svg
        class="mountain-svg"
        :viewBox="`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <!-- Glow filter -->
          <filter id="travelerGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <!-- Mountain gradient -->
          <linearGradient id="mountainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>
            <stop offset="100%" stop-color="rgba(255,255,255,0.02)"/>
          </linearGradient>

          <!-- Path gradient -->
          <linearGradient id="pathGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.1)"/>
            <stop offset="100%" stop-color="rgba(255,255,255,0.3)"/>
          </linearGradient>
        </defs>

        <!-- Mountain silhouette -->
        <path
          class="mountain-shape"
          :d="`M ${MOUNTAIN_LEFT - 40} ${MOUNTAIN_BOTTOM + 20}
               L ${MOUNTAIN_CENTER} ${MOUNTAIN_TOP - 20}
               L ${MOUNTAIN_RIGHT + 40} ${MOUNTAIN_BOTTOM + 20} Z`"
          fill="url(#mountainGrad)"
        />

        <!-- Torii gate at summit -->
        <g class="torii" :transform="`translate(${MOUNTAIN_CENTER - 25}, ${MOUNTAIN_TOP - 10})`">
          <rect x="5" y="15" width="3" height="35" fill="rgba(194,58,58,0.5)"/>
          <rect x="42" y="15" width="3" height="35" fill="rgba(194,58,58,0.5)"/>
          <path d="M0,8 Q25,0 50,8 L48,14 Q25,7 2,14 Z" fill="rgba(194,58,58,0.6)"/>
          <rect x="4" y="17" width="42" height="3" fill="rgba(194,58,58,0.4)"/>
        </g>

        <!-- Contour lines (belt levels) -->
        <g class="contours">
          <g v-for="contour in contourLines" :key="contour.name">
            <!-- Contour line -->
            <line
              :x1="contour.left"
              :y1="contour.y"
              :x2="contour.right"
              :y2="contour.y"
              :stroke="contour.reached ? contour.color : 'rgba(255,255,255,0.1)'"
              :stroke-width="contour.isCurrent ? 3 : 1.5"
              stroke-linecap="round"
              :opacity="contour.reached ? 0.8 : 0.3"
              class="contour-line"
              :class="{ reached: contour.reached, current: contour.isCurrent }"
            />

            <!-- Belt label on right -->
            <text
              v-if="contour.reached || contour.idx <= currentBelt.index + 1"
              :x="contour.right + 8"
              :y="contour.y + 4"
              class="contour-label"
              :fill="contour.reached ? contour.color : 'rgba(255,255,255,0.3)'"
              :font-weight="contour.isCurrent ? '700' : '400'"
            >
              {{ contour.label }}
            </text>
          </g>
        </g>

        <!-- The snaking path (background track) -->
        <path
          class="path-track"
          :d="pathData"
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          stroke-width="12"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <!-- The progress path (traveled portion) -->
        <path
          class="path-progress"
          :class="{ animated: isAnimated }"
          :d="pathData"
          fill="none"
          stroke="url(#pathGrad)"
          stroke-width="4"
          stroke-linecap="round"
          stroke-linejoin="round"
          :stroke-dasharray="pathLength"
          :stroke-dashoffset="pathLength * (1 - progress)"
        />

        <!-- Dotted overlay on traveled path -->
        <path
          class="path-dots"
          :class="{ animated: isAnimated }"
          :d="pathData"
          fill="none"
          stroke="var(--belt-color)"
          stroke-width="3"
          stroke-linecap="round"
          stroke-dasharray="2 8"
          :style="{ strokeDashoffset: pathLength * (1 - progress) }"
        />

        <!-- Traveler marker -->
        <g
          class="traveler"
          :transform="`translate(${travelerPosition.x}, ${travelerPosition.y})`"
          filter="url(#travelerGlow)"
        >
          <!-- Glow ring -->
          <circle r="20" fill="var(--belt-glow)" opacity="0.4">
            <animate attributeName="r" values="16;24;16" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.4;0.2;0.4" dur="2s" repeatCount="indefinite"/>
          </circle>
          <!-- Inner marker -->
          <circle r="8" fill="var(--belt-color)"/>
          <circle r="4" fill="white" opacity="0.9"/>
        </g>
      </svg>

      <!-- Stats panel -->
      <div class="stats-panel">
        <div class="stat-row">
          <div class="stat">
            <span class="stat-value">{{ completedSeeds }}</span>
            <span class="stat-label">Seeds</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <span class="stat-value">{{ Math.round(progress * 100) }}%</span>
            <span class="stat-label">Complete</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <span class="stat-value velocity">{{ velocityLabel }}</span>
            <span class="stat-label">Pace</span>
          </div>
        </div>

        <div class="current-belt">
          <div class="belt-swatch" :style="{ background: currentBelt.color }"></div>
          <span class="belt-name">{{ currentBelt.label }}</span>
          <span class="belt-rank">{{ currentBelt.name }} belt</span>
        </div>
      </div>
    </main>

    <!-- Continue button -->
    <footer class="footer">
      <button class="continue-btn" @click="emit('startLearning')">
        <span>Continue Climbing</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </footer>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.journey-map {
  --accent: #c23a3a;
  --gold: #d4a853;

  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #050508;
  font-family: 'DM Sans', -apple-system, sans-serif;
  overflow: hidden;
}

/* Layered backgrounds for depth */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    /* Warm glow from summit */
    radial-gradient(ellipse 70% 40% at 50% 15%, rgba(194, 58, 58, 0.08) 0%, transparent 60%),
    /* Subtle side accents */
    radial-gradient(ellipse 50% 50% at 10% 60%, rgba(167, 139, 250, 0.03) 0%, transparent 50%),
    radial-gradient(ellipse 50% 50% at 90% 70%, rgba(212, 168, 83, 0.03) 0%, transparent 50%),
    /* Base gradient */
    linear-gradient(to bottom, #0a0a0f 0%, #050508 100%);
  pointer-events: none;
}

.bg-stars {
  position: fixed;
  inset: 0;
  background-image:
    /* Bright stars */
    radial-gradient(1.5px 1.5px at 12% 18%, rgba(255,255,255,0.6) 0%, transparent 100%),
    radial-gradient(1px 1px at 28% 42%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(1.5px 1.5px at 45% 8%, rgba(255,255,255,0.5) 0%, transparent 100%),
    radial-gradient(1px 1px at 62% 35%, rgba(255,255,255,0.35) 0%, transparent 100%),
    radial-gradient(1.2px 1.2px at 78% 22%, rgba(255,255,255,0.45) 0%, transparent 100%),
    radial-gradient(1px 1px at 88% 55%, rgba(255,255,255,0.3) 0%, transparent 100%),
    /* Dimmer stars */
    radial-gradient(0.8px 0.8px at 22% 65%, rgba(255,255,255,0.2) 0%, transparent 100%),
    radial-gradient(0.8px 0.8px at 55% 52%, rgba(255,255,255,0.2) 0%, transparent 100%),
    radial-gradient(0.8px 0.8px at 72% 48%, rgba(255,255,255,0.2) 0%, transparent 100%);
  animation: starfield 8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes starfield {
  0%, 100% { opacity: 0.8; }
  50% { opacity: 1; }
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.02;
  pointer-events: none;
}

/* Layered mist for atmospheric depth */
.mist {
  position: fixed;
  width: 100%;
  pointer-events: none;
}

.mist-1 {
  bottom: 0;
  height: 200px;
  background: linear-gradient(
    to top,
    rgba(5, 5, 8, 1) 0%,
    rgba(5, 5, 8, 0.9) 30%,
    rgba(10, 10, 15, 0.4) 70%,
    transparent 100%
  );
}

.mist-2 {
  bottom: 100px;
  height: 150px;
  background: linear-gradient(
    to top,
    rgba(10, 10, 15, 0.6) 0%,
    transparent 100%
  );
  opacity: 0.7;
  filter: blur(30px);
  animation: mistDrift 12s ease-in-out infinite alternate;
}

@keyframes mistDrift {
  0% { transform: translateX(-5%); opacity: 0.7; }
  100% { transform: translateX(5%); opacity: 0.5; }
}

/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
}

.title {
  font-size: 1.125rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  margin: 0;
  letter-spacing: -0.01em;
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

.streak-icon { font-size: 0.8125rem; }

.streak-num {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #ff9500;
}

/* Main */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 1rem;
  position: relative;
  z-index: 10;
  min-height: 0;
}

/* Mountain SVG */
.mountain-svg {
  width: 100%;
  max-width: 380px;
  height: auto;
  flex: 1;
  min-height: 0;
}

.mountain-shape {
  filter: drop-shadow(0 0 60px rgba(255,255,255,0.03));
}

/* Torii */
.torii {
  opacity: 0.9;
  filter: drop-shadow(0 0 8px rgba(194, 58, 58, 0.4));
}

/* Contour lines */
.contour-line {
  transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}

.contour-line.current {
  filter: drop-shadow(0 0 8px var(--belt-color));
}

.contour-label {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 9px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

/* Path */
.path-track {
  opacity: 0.4;
}

.path-progress {
  transition: stroke-dashoffset 2s cubic-bezier(0.16, 1, 0.3, 1);
  filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.3));
}

.path-progress:not(.animated) {
  stroke-dashoffset: var(--path-length) !important;
}

.path-dots {
  transition: stroke-dashoffset 2s cubic-bezier(0.16, 1, 0.3, 1);
  animation: marchingAnts 0.8s linear infinite;
  filter: drop-shadow(0 0 3px var(--belt-glow));
}

@keyframes marchingAnts {
  to { stroke-dashoffset: -10; }
}

/* Traveler */
.traveler {
  transition: transform 1.2s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Stats panel */
.stats-panel {
  width: 100%;
  max-width: 340px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.02) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 20px;
  padding: 1.25rem;
  margin-top: 1rem;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  margin-bottom: 1rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.375rem;
  font-weight: 700;
  color: white;
  letter-spacing: -0.02em;
}

.stat-value.velocity {
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: var(--gold);
}

.stat-label {
  font-size: 0.625rem;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.stat-divider {
  width: 1px;
  height: 28px;
  background: linear-gradient(
    to bottom,
    transparent,
    rgba(255, 255, 255, 0.12),
    transparent
  );
}

.current-belt {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.belt-swatch {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  box-shadow:
    0 0 12px var(--belt-glow),
    inset 0 1px 1px rgba(255, 255, 255, 0.3);
}

.belt-name {
  flex: 1;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.belt-rank {
  font-size: 0.6875rem;
  color: rgba(255, 255, 255, 0.35);
  text-transform: capitalize;
}

/* Footer */
.footer {
  padding: 1rem 1.5rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px) + 80px);
  position: relative;
  z-index: 10;
}

.continue-btn {
  width: 100%;
  max-width: 340px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 0.875rem 1.75rem;
  background: linear-gradient(145deg, #d44545 0%, #b83232 100%);
  color: white;
  border: none;
  border-radius: 14px;
  font-family: 'DM Sans', -apple-system, sans-serif;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 4px 16px rgba(194, 58, 58, 0.35),
    0 8px 24px rgba(194, 58, 58, 0.2),
    inset 0 1px 1px rgba(255, 255, 255, 0.2);
  -webkit-tap-highlight-color: transparent;
}

.continue-btn:hover {
  transform: translateY(-2px);
  box-shadow:
    0 6px 20px rgba(194, 58, 58, 0.45),
    0 12px 32px rgba(194, 58, 58, 0.25),
    inset 0 1px 1px rgba(255, 255, 255, 0.2);
}

.continue-btn:active {
  transform: scale(0.98);
}

.continue-btn svg {
  width: 18px;
  height: 18px;
  stroke-width: 2.5;
}

/* Responsive */
@media (max-width: 480px) {
  .header { padding: 0.75rem 1rem; }
  .title { font-size: 1rem; }
  .main { padding: 0 0.75rem; }
  .mountain-svg { max-width: 340px; }
  .stats-panel {
    padding: 1rem;
    max-width: 300px;
  }
  .stat-row { gap: 1rem; }
  .stat-value { font-size: 1.25rem; }
  .stat-label { font-size: 0.5625rem; }
  .footer {
    padding: 0.75rem 1rem;
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px) + 76px);
  }
  .continue-btn {
    max-width: 300px;
    padding: 0.75rem 1.5rem;
    font-size: 0.875rem;
  }
}

@media (min-width: 768px) {
  .mountain-svg { max-width: 420px; }
  .stats-panel { max-width: 380px; padding: 1.5rem; }
  .footer { padding-bottom: calc(1.5rem + 88px); }
}
</style>
