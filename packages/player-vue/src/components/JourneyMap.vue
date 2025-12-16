<script setup>
import { ref, computed, onMounted } from 'vue'

// Props
const props = defineProps({
  completedSeeds: { type: Number, default: 42 },
  totalSeeds: { type: Number, default: 668 },
  currentStreak: { type: Number, default: 7 },
  learningVelocity: { type: Number, default: 1.2 }, // Seeds per day average
})

const emit = defineEmits(['close', 'startLearning'])

// Belt progression system (same as LearningPlayer)
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

// Current belt calculation
const currentBelt = computed(() => {
  const belts = BELT_CONFIG.belts
  for (let i = belts.length - 1; i >= 0; i--) {
    if (props.completedSeeds >= belts[i].seedsRequired) {
      return { ...belts[i], index: i }
    }
  }
  return { ...belts[0], index: 0 }
})

// Progress percentage (0-100) for the whole journey
const journeyProgress = computed(() => {
  return Math.min((props.completedSeeds / props.totalSeeds) * 100, 100)
})

// Determine which belt camps are reached
const beltCamps = computed(() => {
  return BELT_CONFIG.belts.map((belt, idx) => {
    const position = (belt.seedsRequired / props.totalSeeds) * 100
    const reached = props.completedSeeds >= belt.seedsRequired
    const isCurrent = currentBelt.value.name === belt.name
    return { ...belt, position, reached, isCurrent, idx }
  })
})

// Velocity indicator (steepness metaphor)
const velocityLabel = computed(() => {
  if (props.learningVelocity >= 2) return 'Blazing'
  if (props.learningVelocity >= 1.5) return 'Swift'
  if (props.learningVelocity >= 1) return 'Steady'
  if (props.learningVelocity >= 0.5) return 'Gradual'
  return 'Gentle'
})

// CSS variables for theming
const cssVars = computed(() => ({
  '--current-belt-color': currentBelt.value.color,
  '--current-belt-glow': currentBelt.value.glow,
  '--journey-progress': `${journeyProgress.value}%`,
}))

// Animation state
const pathAnimated = ref(false)
onMounted(() => {
  setTimeout(() => { pathAnimated.value = true }, 100)
})

// Path points for the mountain trail (SVG path data)
// This creates a winding path up the mountain
const pathData = `
  M 50 380
  Q 80 360, 100 340
  Q 140 300, 120 260
  Q 100 220, 150 180
  Q 200 140, 180 100
  Q 160 60, 200 40
`
</script>

<template>
  <div class="journey-map" :style="cssVars">
    <!-- Background layers -->
    <div class="bg-gradient"></div>
    <div class="bg-stars"></div>
    <div class="bg-noise"></div>

    <!-- Floating mist -->
    <div class="mist-container">
      <div class="mist-particle mist-1"></div>
      <div class="mist-particle mist-2"></div>
      <div class="mist-particle mist-3"></div>
    </div>

    <!-- Header -->
    <header class="header">
      <h1 class="title">Your Journey</h1>
      <div class="streak-badge" v-if="currentStreak > 0">
        <span class="streak-flame">🔥</span>
        <span class="streak-count">{{ currentStreak }}</span>
      </div>
    </header>

    <!-- Main Journey Visualization -->
    <main class="main">
      <!-- The Mountain SVG -->
      <svg class="mountain-svg" viewBox="0 0 400 420" preserveAspectRatio="xMidYMid meet">
        <!-- Mountain silhouette layers -->
        <defs>
          <!-- Glow filter for current position -->
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <!-- Pattern for the dotted path -->
          <pattern id="dotPattern" x="0" y="0" width="12" height="12" patternUnits="userSpaceOnUse">
            <circle cx="6" cy="6" r="2" fill="var(--current-belt-color)" opacity="0.8"/>
          </pattern>

          <!-- Gradient for mountain -->
          <linearGradient id="mountainGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
            <stop offset="100%" stop-color="rgba(255,255,255,0.03)"/>
          </linearGradient>
        </defs>

        <!-- Distant mountain range -->
        <path
          class="mountain-distant"
          d="M0,420 L0,180 Q100,120 200,150 Q300,100 400,130 L400,420 Z"
          fill="rgba(255,255,255,0.02)"
        />

        <!-- Main mountain -->
        <path
          class="mountain-main"
          d="M50,420 L150,80 Q200,20 250,80 L350,420 Z"
          fill="url(#mountainGrad)"
        />

        <!-- Snow cap / summit glow -->
        <path
          class="summit-glow"
          d="M170,100 Q200,30 230,100 L210,120 Q200,90 190,120 Z"
          fill="rgba(255,255,255,0.1)"
        />

        <!-- Torii gate at summit -->
        <g class="torii-summit" transform="translate(175, 45)">
          <!-- Main pillars -->
          <rect x="5" y="15" width="4" height="40" rx="1" fill="rgba(194,58,58,0.6)"/>
          <rect x="41" y="15" width="4" height="40" rx="1" fill="rgba(194,58,58,0.6)"/>
          <!-- Top beam (kasagi) -->
          <path d="M0,8 Q25,0 50,8 L48,14 Q25,8 2,14 Z" fill="rgba(194,58,58,0.7)"/>
          <!-- Tie beam (nuki) -->
          <rect x="3" y="18" width="44" height="3" rx="1" fill="rgba(194,58,58,0.5)"/>
        </g>

        <!-- The winding path (background track) -->
        <path
          class="path-track"
          :d="pathData"
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          stroke-width="8"
          stroke-linecap="round"
        />

        <!-- The progress path (animated) -->
        <path
          class="path-progress"
          :class="{ animated: pathAnimated }"
          :d="pathData"
          fill="none"
          stroke="var(--current-belt-color)"
          stroke-width="4"
          stroke-linecap="round"
          stroke-dasharray="8 6"
          :style="{ '--progress': journeyProgress }"
        />

        <!-- Belt camp markers -->
        <g v-for="camp in beltCamps" :key="camp.name" class="camp-marker">
          <!-- Calculate position along path (simplified - using vertical position) -->
          <g :transform="`translate(${70 + (camp.idx * 30) % 80}, ${380 - (camp.position * 3.4)})`">
            <!-- Camp circle -->
            <circle
              :r="camp.isCurrent ? 14 : 10"
              :fill="camp.reached ? camp.color : 'rgba(255,255,255,0.1)'"
              :stroke="camp.reached ? camp.colorDark : 'rgba(255,255,255,0.2)'"
              stroke-width="2"
              :filter="camp.isCurrent ? 'url(#glow)' : ''"
              :class="{ 'camp-current': camp.isCurrent, 'camp-reached': camp.reached }"
            />
            <!-- Flag for reached camps -->
            <g v-if="camp.reached && !camp.isCurrent" transform="translate(-4, -18)">
              <line x1="4" y1="0" x2="4" y2="12" stroke="white" stroke-width="1.5"/>
              <path d="M4,0 L12,3 L4,6 Z" :fill="camp.color"/>
            </g>
            <!-- Current position indicator -->
            <g v-if="camp.isCurrent" class="current-indicator">
              <circle r="20" fill="none" :stroke="camp.color" stroke-width="2" opacity="0.5">
                <animate attributeName="r" values="14;24;14" dur="2s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" repeatCount="indefinite"/>
              </circle>
            </g>
          </g>
        </g>

        <!-- Traveler marker (current position) -->
        <g class="traveler" :transform="`translate(${70 + (currentBelt.value.index * 30) % 80}, ${380 - (journeyProgress * 3.4)})`">
          <!-- Lantern glow -->
          <circle r="30" fill="var(--current-belt-glow)" opacity="0.3">
            <animate attributeName="opacity" values="0.3;0.5;0.3" dur="3s" repeatCount="indefinite"/>
          </circle>
          <!-- Figure silhouette (simple monk/traveler) -->
          <circle r="5" cy="-8" fill="var(--current-belt-color)"/>
          <path d="M-4,0 L0,12 L4,0" fill="var(--current-belt-color)" stroke="none"/>
        </g>
      </svg>

      <!-- Progress Stats Card -->
      <div class="stats-card">
        <div class="stat-row">
          <div class="stat">
            <span class="stat-value">{{ completedSeeds }}</span>
            <span class="stat-label">Seeds Mastered</span>
          </div>
          <div class="stat-divider"></div>
          <div class="stat">
            <span class="stat-value">{{ totalSeeds - completedSeeds }}</span>
            <span class="stat-label">Remaining</span>
          </div>
        </div>

        <div class="progress-section">
          <div class="progress-header">
            <span class="progress-label">Journey Progress</span>
            <span class="progress-percent">{{ journeyProgress.toFixed(1) }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: journeyProgress + '%' }"></div>
          </div>
        </div>

        <div class="belt-status">
          <div class="current-belt">
            <div
              class="belt-swatch"
              :style="{ background: currentBelt.color, boxShadow: `0 0 12px ${currentBelt.glow}` }"
            ></div>
            <div class="belt-info">
              <span class="belt-name">{{ currentBelt.label }}</span>
              <span class="belt-rank">{{ currentBelt.name }} belt</span>
            </div>
          </div>
          <div class="velocity-indicator">
            <span class="velocity-label">{{ velocityLabel }}</span>
            <div class="velocity-bars">
              <div
                v-for="i in 5"
                :key="i"
                class="velocity-bar"
                :class="{ active: i <= Math.ceil(learningVelocity * 2.5) }"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Continue Button -->
    <footer class="footer">
      <button class="continue-btn" @click="emit('startLearning')">
        <span>Continue Journey</span>
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
  --accent-soft: rgba(194, 58, 58, 0.15);
  --gold: #d4a853;

  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #0a0a0f);
  font-family: 'DM Sans', sans-serif;
  overflow: hidden;
  z-index: 100;
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 100% 80% at 50% 0%, rgba(194, 58, 58, 0.08) 0%, transparent 50%),
    radial-gradient(ellipse 80% 60% at 20% 100%, rgba(167, 139, 250, 0.05) 0%, transparent 40%),
    radial-gradient(ellipse 60% 40% at 80% 80%, rgba(212, 168, 83, 0.05) 0%, transparent 40%);
  pointer-events: none;
}

.bg-stars {
  position: fixed;
  inset: 0;
  background-image:
    radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(1px 1px at 40% 70%, rgba(255,255,255,0.3) 0%, transparent 100%),
    radial-gradient(1px 1px at 60% 20%, rgba(255,255,255,0.5) 0%, transparent 100%),
    radial-gradient(1px 1px at 80% 50%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(2px 2px at 15% 55%, rgba(255,255,255,0.3) 0%, transparent 100%),
    radial-gradient(1px 1px at 70% 85%, rgba(255,255,255,0.4) 0%, transparent 100%),
    radial-gradient(1px 1px at 35% 15%, rgba(255,255,255,0.5) 0%, transparent 100%),
    radial-gradient(1px 1px at 90% 40%, rgba(255,255,255,0.3) 0%, transparent 100%);
  pointer-events: none;
  animation: stars-twinkle 8s ease-in-out infinite;
}

@keyframes stars-twinkle {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
}

/* Mist */
.mist-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}

.mist-particle {
  position: absolute;
  width: 300px;
  height: 100px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255,255,255,0.03) 0%, transparent 70%);
  filter: blur(30px);
  animation: mist-drift 30s ease-in-out infinite;
}

.mist-1 { top: 50%; left: -10%; animation-delay: 0s; }
.mist-2 { top: 30%; left: 50%; animation-delay: -10s; width: 400px; }
.mist-3 { top: 70%; left: 70%; animation-delay: -20s; }

@keyframes mist-drift {
  0%, 100% { transform: translateX(0) translateY(0); opacity: 0.4; }
  50% { transform: translateX(80px) translateY(-20px); opacity: 0.6; }
}

/* Header */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  gap: 1rem;
}

.title {
  font-size: 1.25rem;
  font-weight: 600;
  color: white;
  margin: 0;
}

.streak-badge {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 149, 0, 0.15);
  border: 1px solid rgba(255, 149, 0, 0.3);
  border-radius: 100px;
}

.streak-flame {
  font-size: 0.875rem;
}

.streak-count {
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  font-weight: 700;
  color: #ff9500;
}

/* Main */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 1.5rem;
  position: relative;
  z-index: 10;
  overflow: hidden;
}

/* Mountain SVG */
.mountain-svg {
  width: 100%;
  max-width: 400px;
  height: auto;
  flex: 1;
  max-height: 50vh;
}

.mountain-distant {
  animation: mountain-sway 20s ease-in-out infinite;
}

@keyframes mountain-sway {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(2px); }
}

.summit-glow {
  animation: summit-pulse 4s ease-in-out infinite;
}

@keyframes summit-pulse {
  0%, 100% { opacity: 0.1; }
  50% { opacity: 0.2; }
}

/* Path animations */
.path-track {
  opacity: 0.5;
}

.path-progress {
  stroke-dashoffset: 400;
  transition: stroke-dashoffset 2s cubic-bezier(0.16, 1, 0.3, 1);
}

.path-progress.animated {
  stroke-dashoffset: calc(400 - (var(--progress) * 4));
}

/* Camp markers */
.camp-marker circle {
  transition: all 0.3s ease;
}

.camp-current {
  animation: camp-pulse 2s ease-in-out infinite;
}

@keyframes camp-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

/* Traveler */
.traveler {
  transition: transform 1s cubic-bezier(0.16, 1, 0.3, 1);
}

/* Stats Card */
.stats-card {
  width: 100%;
  max-width: 400px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  padding: 1.25rem;
  backdrop-filter: blur(20px);
  margin-top: 1rem;
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  margin-bottom: 1.25rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.stat-value {
  font-family: 'Space Mono', monospace;
  font-size: 1.75rem;
  font-weight: 700;
  color: white;
}

.stat-label {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);
}

.progress-section {
  margin-bottom: 1.25rem;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.progress-label {
  font-size: 0.8125rem;
  color: rgba(255, 255, 255, 0.6);
}

.progress-percent {
  font-family: 'Space Mono', monospace;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--current-belt-color);
}

.progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--current-belt-color) 50%, var(--gold) 100%);
  border-radius: 3px;
  transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
}

.belt-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.current-belt {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.belt-swatch {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  transition: all 0.3s ease;
}

.belt-info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.belt-name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: white;
}

.belt-rank {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  text-transform: capitalize;
}

.velocity-indicator {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.375rem;
}

.velocity-label {
  font-size: 0.75rem;
  color: var(--gold);
  font-weight: 500;
}

.velocity-bars {
  display: flex;
  gap: 3px;
}

.velocity-bar {
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.15);
  transition: all 0.3s ease;
}

.velocity-bar.active {
  background: var(--gold);
  box-shadow: 0 0 8px rgba(212, 168, 83, 0.4);
}

.velocity-bar:nth-child(1) { height: 8px; }
.velocity-bar:nth-child(2) { height: 11px; }
.velocity-bar:nth-child(3) { height: 14px; }
.velocity-bar:nth-child(4) { height: 17px; }
.velocity-bar:nth-child(5) { height: 20px; }

/* Footer */
.footer {
  padding: 1rem 1.5rem 2rem;
  position: relative;
  z-index: 10;
}

.continue-btn {
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem 2rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 16px;
  font-family: 'DM Sans', sans-serif;
  font-size: 1.0625rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 8px 32px rgba(194, 58, 58, 0.3);
}

.continue-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(194, 58, 58, 0.4);
}

.continue-btn:active {
  transform: translateY(0);
}

.continue-btn svg {
  width: 20px;
  height: 20px;
}

/* Responsive */
@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
  }

  .title {
    font-size: 1.125rem;
  }

  .main {
    padding: 0 1rem;
  }

  .stats-card {
    padding: 1rem;
    border-radius: 16px;
  }

  .stat-value {
    font-size: 1.5rem;
  }

  .footer {
    padding: 1rem;
  }

  .continue-btn {
    padding: 0.875rem 1.5rem;
    font-size: 1rem;
  }
}

@media (min-width: 768px) {
  .mountain-svg {
    max-height: 60vh;
  }

  .stats-card {
    padding: 1.5rem;
  }
}
</style>
