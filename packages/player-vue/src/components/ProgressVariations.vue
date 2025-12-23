<script setup>
/**
 * ProgressVariations.vue
 *
 * Mockups for different first-30-mins UX approaches.
 * Each variation has configurable parameters.
 *
 * Design Philosophy:
 * - Not measuring correctness (speed/confidence instead)
 * - Not "naff" (subtle, not trying too hard)
 * - Works for kids AND adults
 * - Celebrates that language is HARD but brains are wired for it
 */
import { ref, computed, watch, onMounted } from 'vue'

const props = defineProps({
  // Core progress data (from learner state)
  completedSeeds: { type: Number, default: 0 },
  totalSeeds: { type: Number, default: 668 },
  itemsPracticed: { type: Number, default: 0 },
  timeSpentSeconds: { type: Number, default: 0 },
  currentStreak: { type: Number, default: 1 },

  // Which variation to show
  variation: {
    type: String,
    default: 'emergence',
    validator: v => ['emergence', 'flow', 'constellation', 'minimal', 'momentum'].includes(v)
  }
})

// ========================================
// VARIATION 1: EMERGENCE (Organic Growth)
// ========================================
// No numbers. Just a seed growing into a tree.
// Subtle. Patient. "Your language is taking root."
const emergenceConfig = ref({
  showText: true,           // Show encouraging text
  animateGrowth: true,      // Animate the growth
  colorScheme: 'earth',     // 'earth', 'forest', 'sunset'
})

// Growth stage based on seeds (but we don't show the number)
const growthStage = computed(() => {
  const seeds = props.completedSeeds
  if (seeds === 0) return 'seed'      // Just planted
  if (seeds < 5) return 'sprout'      // First leaves
  if (seeds < 15) return 'seedling'   // Growing
  if (seeds < 40) return 'sapling'    // Getting taller
  if (seeds < 100) return 'young'     // Young tree
  if (seeds < 200) return 'mature'    // Full tree
  return 'ancient'                     // Mighty oak
})

const emergenceText = computed(() => {
  const stage = growthStage.value
  const texts = {
    seed: 'Planting the seed...',
    sprout: 'Taking root.',
    seedling: 'Growing steadily.',
    sapling: 'Reaching higher.',
    young: 'Strong roots now.',
    mature: 'Flourishing.',
    ancient: 'Deep roots, wide reach.'
  }
  return texts[stage]
})

// ========================================
// VARIATION 2: FLOW (Speed/Confidence)
// ========================================
// No right/wrong. Just rhythm and flow.
// Wave visualization that responds to practice.
// "Feel the rhythm. Trust your voice."
const flowConfig = ref({
  showWave: true,           // Show wave visualization
  showHeartbeat: false,     // Show heartbeat instead
  intensity: 'medium',      // 'calm', 'medium', 'intense'
})

// Wave intensity based on recent activity
const waveIntensity = computed(() => {
  // More items practiced = higher intensity
  if (props.itemsPracticed < 5) return 0.3
  if (props.itemsPracticed < 15) return 0.5
  if (props.itemsPracticed < 30) return 0.7
  return 0.9
})

const flowText = computed(() => {
  const intensity = waveIntensity.value
  if (intensity < 0.4) return 'Finding your rhythm...'
  if (intensity < 0.6) return 'In the flow.'
  if (intensity < 0.8) return 'Flowing freely.'
  return 'Completely immersed.'
})

// ========================================
// VARIATION 3: CONSTELLATION (Collective)
// ========================================
// You're one star among millions learning.
// Community. Not alone. Part of something bigger.
// "Millions of brains, all learning."
const constellationConfig = ref({
  showOthers: true,         // Show other learner stars
  showCounter: false,       // Show total learner count
  starColor: 'gold',        // 'gold', 'silver', 'warm'
})

// Simulated other learners (would be real-time in production)
const otherLearners = ref(847)  // People learning right now

const constellationText = computed(() => {
  if (props.completedSeeds === 0) return 'Joining the journey...'
  return `${otherLearners.value.toLocaleString()} others learning right now`
})

// ========================================
// VARIATION 4: MINIMAL (Almost Nothing)
// ========================================
// Pure learning. No chrome.
// The content IS the experience.
// Just the phrase, just the sound.
const minimalConfig = ref({
  showAnything: false,      // Show nothing but content
  subtleHint: true,         // Very subtle progress hint
})

// ========================================
// VARIATION 5: MOMENTUM (Movement/Energy)
// ========================================
// Ball rolling downhill, gathering speed.
// Kinetic energy metaphor.
// "Every word adds momentum."
const momentumConfig = ref({
  showOrb: true,            // Show the momentum orb
  showTrail: true,          // Show movement trail
  pulseOnPractice: true,    // Pulse when practicing
})

const momentumSize = computed(() => {
  // Orb grows with practice
  const base = 40
  const growth = Math.min(props.completedSeeds * 0.5, 60)
  return base + growth
})

const momentumText = computed(() => {
  if (props.completedSeeds === 0) return 'Building momentum...'
  if (props.completedSeeds < 10) return 'Gathering speed.'
  if (props.completedSeeds < 30) return 'Rolling now.'
  return 'Unstoppable.'
})

// ========================================
// SHARED: Time formatting
// ========================================
const formattedTime = computed(() => {
  const mins = Math.floor(props.timeSpentSeconds / 60)
  const secs = props.timeSpentSeconds % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
})

// ========================================
// Emit config changes for parameter tuning
// ========================================
const emit = defineEmits(['configChanged'])

watch([emergenceConfig, flowConfig, constellationConfig, minimalConfig, momentumConfig], () => {
  emit('configChanged', {
    emergence: emergenceConfig.value,
    flow: flowConfig.value,
    constellation: constellationConfig.value,
    minimal: minimalConfig.value,
    momentum: momentumConfig.value,
  })
}, { deep: true })
</script>

<template>
  <div class="progress-variation" :class="[`variation--${variation}`]">

    <!-- ========== EMERGENCE: Organic Growth ========== -->
    <div v-if="variation === 'emergence'" class="emergence">
      <div class="emergence-visual">
        <!-- Seed/Plant SVG that grows -->
        <svg viewBox="0 0 120 160" class="plant-svg" :class="[`stage--${growthStage}`]">
          <!-- Ground line -->
          <ellipse cx="60" cy="150" rx="50" ry="6" class="ground"/>

          <!-- Seed (always present, fades as grows) -->
          <ellipse cx="60" cy="145" rx="8" ry="5" class="seed"/>

          <!-- Sprout -->
          <g class="sprout-group" v-if="growthStage !== 'seed'">
            <path d="M60 145 Q60 130 60 115" class="stem"/>
            <path d="M60 125 Q50 115 40 120" class="leaf leaf-left"/>
            <path d="M60 125 Q70 115 80 120" class="leaf leaf-right"/>
          </g>

          <!-- Seedling (more leaves) -->
          <g class="seedling-group" v-if="['seedling', 'sapling', 'young', 'mature', 'ancient'].includes(growthStage)">
            <path d="M60 115 Q60 95 60 80" class="stem stem-upper"/>
            <path d="M60 100 Q45 85 35 90" class="leaf leaf-mid-left"/>
            <path d="M60 100 Q75 85 85 90" class="leaf leaf-mid-right"/>
            <path d="M60 85 Q55 75 48 78" class="leaf leaf-top-left"/>
            <path d="M60 85 Q65 75 72 78" class="leaf leaf-top-right"/>
          </g>

          <!-- Young tree (branches) -->
          <g class="young-group" v-if="['young', 'mature', 'ancient'].includes(growthStage)">
            <path d="M60 80 Q60 50 60 30" class="trunk"/>
            <path d="M60 60 Q40 45 25 50" class="branch"/>
            <path d="M60 60 Q80 45 95 50" class="branch"/>
            <path d="M60 40 Q50 30 38 35" class="branch branch-upper"/>
            <path d="M60 40 Q70 30 82 35" class="branch branch-upper"/>
            <!-- Canopy -->
            <circle cx="60" cy="25" r="25" class="canopy"/>
          </g>

          <!-- Mature (fuller canopy) -->
          <g class="mature-group" v-if="['mature', 'ancient'].includes(growthStage)">
            <circle cx="35" cy="40" r="18" class="canopy canopy-left"/>
            <circle cx="85" cy="40" r="18" class="canopy canopy-right"/>
            <circle cx="50" cy="20" r="15" class="canopy canopy-top-left"/>
            <circle cx="70" cy="20" r="15" class="canopy canopy-top-right"/>
          </g>
        </svg>
      </div>

      <p v-if="emergenceConfig.showText" class="emergence-text">
        {{ emergenceText }}
      </p>
    </div>

    <!-- ========== FLOW: Wave Visualization ========== -->
    <div v-if="variation === 'flow'" class="flow">
      <div class="flow-visual">
        <svg viewBox="0 0 200 60" class="wave-svg">
          <!-- Animated wave paths -->
          <path
            class="wave wave-1"
            :style="{ opacity: waveIntensity }"
            d="M0 30 Q25 10 50 30 T100 30 T150 30 T200 30"
          />
          <path
            class="wave wave-2"
            :style="{ opacity: waveIntensity * 0.7 }"
            d="M0 30 Q25 50 50 30 T100 30 T150 30 T200 30"
          />
          <path
            class="wave wave-3"
            :style="{ opacity: waveIntensity * 0.4 }"
            d="M0 35 Q25 15 50 35 T100 35 T150 35 T200 35"
          />
        </svg>
      </div>

      <p class="flow-text">{{ flowText }}</p>
    </div>

    <!-- ========== CONSTELLATION: Collective ========== -->
    <div v-if="variation === 'constellation'" class="constellation">
      <div class="constellation-visual">
        <div class="stars-container">
          <!-- Other learners (small dots) -->
          <div
            v-for="i in 12"
            :key="i"
            class="star star-other"
            :style="{
              left: `${10 + (i * 7) + Math.sin(i) * 5}%`,
              top: `${20 + Math.cos(i * 2) * 30}%`,
              animationDelay: `${i * 0.3}s`,
              opacity: 0.3 + Math.random() * 0.4
            }"
          />

          <!-- You (brighter, center) -->
          <div class="star star-you">
            <div class="star-core"/>
            <div class="star-glow"/>
          </div>
        </div>
      </div>

      <p v-if="constellationConfig.showOthers" class="constellation-text">
        {{ constellationText }}
      </p>
    </div>

    <!-- ========== MINIMAL: Almost Nothing ========== -->
    <div v-if="variation === 'minimal'" class="minimal">
      <!-- Intentionally almost empty -->
      <div v-if="minimalConfig.subtleHint" class="minimal-hint">
        <div class="minimal-dot" :class="{ active: itemsPracticed > 0 }"/>
      </div>
      <!-- That's it. The content is elsewhere. -->
    </div>

    <!-- ========== MOMENTUM: Energy Orb ========== -->
    <div v-if="variation === 'momentum'" class="momentum">
      <div class="momentum-visual">
        <div
          class="momentum-orb"
          :style="{
            width: `${momentumSize}px`,
            height: `${momentumSize}px`
          }"
        >
          <div class="orb-core"/>
          <div class="orb-ring ring-1"/>
          <div class="orb-ring ring-2"/>
          <div class="orb-ring ring-3"/>
        </div>

        <!-- Trail particles -->
        <div v-if="momentumConfig.showTrail" class="momentum-trail">
          <div
            v-for="i in 6"
            :key="i"
            class="trail-particle"
            :style="{
              animationDelay: `${i * 0.1}s`,
              opacity: 1 - (i * 0.15)
            }"
          />
        </div>
      </div>

      <p class="momentum-text">{{ momentumText }}</p>
    </div>

  </div>
</template>

<style scoped>
/* ========================================
   BASE STYLES
   ======================================== */
.progress-variation {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  min-height: 200px;
  font-family: 'DM Sans', -apple-system, sans-serif;
}

/* ========================================
   EMERGENCE: Organic Growth
   ======================================== */
.emergence {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.emergence-visual {
  width: 120px;
  height: 160px;
}

.plant-svg {
  width: 100%;
  height: 100%;
}

/* Ground */
.ground {
  fill: #3d3526;
  opacity: 0.6;
}

/* Seed */
.seed {
  fill: #8b7355;
  transition: opacity 1s ease;
}

.stage--sprout .seed,
.stage--seedling .seed,
.stage--sapling .seed,
.stage--young .seed,
.stage--mature .seed,
.stage--ancient .seed {
  opacity: 0.3;
}

/* Stems and trunks */
.stem, .trunk {
  stroke: #5a8f5a;
  stroke-width: 3;
  fill: none;
  stroke-linecap: round;
}

.stem-upper {
  stroke-width: 2.5;
}

.trunk {
  stroke: #6b4f36;
  stroke-width: 5;
}

/* Leaves */
.leaf {
  stroke: #4a9f4a;
  stroke-width: 2;
  fill: #5cb85c;
  opacity: 0.9;
}

/* Branches */
.branch {
  stroke: #6b4f36;
  stroke-width: 2;
  fill: none;
  stroke-linecap: round;
}

.branch-upper {
  stroke-width: 1.5;
}

/* Canopy */
.canopy {
  fill: #3d8f3d;
  opacity: 0.8;
}

.canopy-left, .canopy-right {
  opacity: 0.7;
}

.canopy-top-left, .canopy-top-right {
  opacity: 0.6;
  fill: #2d7f2d;
}

/* Animation for growth */
.sprout-group, .seedling-group, .young-group, .mature-group {
  animation: emerge 0.8s ease-out;
}

@keyframes emerge {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.emergence-text {
  font-size: 0.9375rem;
  color: #7a9f7a;
  font-style: italic;
  letter-spacing: 0.02em;
  margin: 0;
  opacity: 0.9;
}

/* ========================================
   FLOW: Wave Visualization
   ======================================== */
.flow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  width: 100%;
}

.flow-visual {
  width: 200px;
  height: 60px;
}

.wave-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

.wave {
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
}

.wave-1 {
  stroke: #6ea8d9;
  animation: wave-flow 3s ease-in-out infinite;
}

.wave-2 {
  stroke: #5a9fcf;
  animation: wave-flow 3s ease-in-out infinite 0.5s;
}

.wave-3 {
  stroke: #4a8fc5;
  animation: wave-flow 3s ease-in-out infinite 1s;
}

@keyframes wave-flow {
  0%, 100% {
    d: path("M0 30 Q25 10 50 30 T100 30 T150 30 T200 30");
  }
  50% {
    d: path("M0 30 Q25 50 50 30 T100 30 T150 30 T200 30");
  }
}

.flow-text {
  font-size: 0.9375rem;
  color: #6ea8d9;
  letter-spacing: 0.02em;
  margin: 0;
}

/* ========================================
   CONSTELLATION: Collective Journey
   ======================================== */
.constellation {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.constellation-visual {
  width: 160px;
  height: 120px;
  position: relative;
}

.stars-container {
  width: 100%;
  height: 100%;
  position: relative;
}

.star {
  position: absolute;
  border-radius: 50%;
}

.star-other {
  width: 4px;
  height: 4px;
  background: #d4a853;
  animation: star-twinkle 2s ease-in-out infinite;
}

@keyframes star-twinkle {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.2); }
}

.star-you {
  width: 20px;
  height: 20px;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.star-core {
  position: absolute;
  inset: 4px;
  background: #d4a853;
  border-radius: 50%;
  box-shadow: 0 0 10px #d4a853;
}

.star-glow {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(212, 168, 83, 0.4) 0%, transparent 70%);
  animation: star-pulse 2s ease-in-out infinite;
}

@keyframes star-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.5); opacity: 0.3; }
}

.constellation-text {
  font-size: 0.8125rem;
  color: #a89060;
  letter-spacing: 0.02em;
  margin: 0;
  opacity: 0.8;
}

/* ========================================
   MINIMAL: Almost Nothing
   ======================================== */
.minimal {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
}

.minimal-hint {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.minimal-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  transition: all 0.5s ease;
}

.minimal-dot.active {
  background: rgba(255, 255, 255, 0.4);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.2);
}

/* ========================================
   MOMENTUM: Energy Orb
   ======================================== */
.momentum {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
}

.momentum-visual {
  position: relative;
  width: 120px;
  height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.momentum-orb {
  position: relative;
  border-radius: 50%;
  transition: all 0.5s ease;
}

.orb-core {
  position: absolute;
  inset: 20%;
  background: radial-gradient(circle at 30% 30%, #ff9f6a, #e85a3c);
  border-radius: 50%;
  box-shadow:
    0 0 20px rgba(232, 90, 60, 0.6),
    inset 0 -4px 8px rgba(0, 0, 0, 0.2);
}

.orb-ring {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(255, 159, 106, 0.3);
  border-radius: 50%;
  animation: orb-rotate 4s linear infinite;
}

.ring-1 {
  transform: rotateX(60deg);
}

.ring-2 {
  transform: rotateX(60deg) rotateY(30deg);
  animation-duration: 5s;
  animation-direction: reverse;
}

.ring-3 {
  transform: rotateX(60deg) rotateY(-30deg);
  animation-duration: 6s;
}

@keyframes orb-rotate {
  from { transform: rotateX(60deg) rotateZ(0deg); }
  to { transform: rotateX(60deg) rotateZ(360deg); }
}

.momentum-trail {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.trail-particle {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff9f6a;
  animation: trail-float 2s ease-out infinite;
}

@keyframes trail-float {
  0% {
    transform: translateX(0) translateY(0) scale(1);
    opacity: 0.6;
  }
  100% {
    transform: translateX(-30px) translateY(-40px) scale(0);
    opacity: 0;
  }
}

.momentum-text {
  font-size: 0.9375rem;
  color: #e89060;
  letter-spacing: 0.02em;
  margin: 0;
}
</style>
