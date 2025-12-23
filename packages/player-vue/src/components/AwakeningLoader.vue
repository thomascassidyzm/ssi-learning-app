<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const props = defineProps({
  stage: {
    type: String,
    default: 'awakening', // awakening, finding, preparing, ready
  },
  beltColor: {
    type: String,
    default: '#fcd34d' // Yellow belt default
  }
})

const emit = defineEmits(['ready'])

// Status messages - appear like brushstrokes
const STAGES = {
  awakening: { message: 'Awakening', dots: true },
  finding: { message: 'Finding your place', dots: true },
  preparing: { message: 'Preparing your session', dots: true },
  ready: { message: 'Ready', dots: false }
}

const stageConfig = computed(() => STAGES[props.stage] || STAGES.awakening)

// Animated dots for loading states
const dots = ref('')
let dotsInterval = null

onMounted(() => {
  dotsInterval = setInterval(() => {
    if (stageConfig.value.dots) {
      dots.value = dots.value.length >= 3 ? '' : dots.value + '.'
    } else {
      dots.value = ''
    }
  }, 400)
})

// Cleanup
import { onUnmounted } from 'vue'
onUnmounted(() => {
  if (dotsInterval) clearInterval(dotsInterval)
})

// Mist intensity based on stage
const mistIntensity = computed(() => {
  switch (props.stage) {
    case 'awakening': return 1.0
    case 'finding': return 0.7
    case 'preparing': return 0.4
    case 'ready': return 0
    default: return 1.0
  }
})

// When stage becomes 'ready', emit after transition
watch(() => props.stage, (newStage) => {
  if (newStage === 'ready') {
    setTimeout(() => emit('ready'), 1200) // Wait for mist to clear
  }
})
</script>

<template>
  <div
    class="awakening"
    :class="[`stage-${stage}`]"
    :style="{ '--belt-glow': beltColor, '--mist-opacity': mistIntensity }"
  >
    <!-- Rising Mist Layers - Clear from bottom up -->
    <div class="mist-layer mist-ground">
      <div class="mist-bank mist-bank-1"></div>
      <div class="mist-bank mist-bank-2"></div>
      <div class="mist-bank mist-bank-3"></div>
    </div>

    <div class="mist-layer mist-mid">
      <div class="mist-wisp mist-wisp-1"></div>
      <div class="mist-wisp mist-wisp-2"></div>
      <div class="mist-wisp mist-wisp-3"></div>
      <div class="mist-wisp mist-wisp-4"></div>
    </div>

    <div class="mist-layer mist-high">
      <div class="mist-tendril mist-tendril-1"></div>
      <div class="mist-tendril mist-tendril-2"></div>
    </div>

    <!-- Fireflies dancing through the mist -->
    <div class="fireflies">
      <div class="firefly firefly-1"></div>
      <div class="firefly firefly-2"></div>
      <div class="firefly firefly-3"></div>
      <div class="firefly firefly-4"></div>
      <div class="firefly firefly-5"></div>
      <div class="firefly firefly-6"></div>
    </div>

    <!-- Status Message - Brushstroke Style -->
    <div class="status-container">
      <div class="status-message" :key="stage">
        <span class="status-text">{{ stageConfig.message }}</span>
        <span class="status-dots">{{ dots }}</span>
      </div>

      <!-- Subtle progress indicator -->
      <div class="progress-breath">
        <div class="breath-circle"></div>
      </div>
    </div>

    <!-- Torii gate silhouette emerges -->
    <div class="torii-reveal">
      <svg viewBox="0 0 120 100" class="torii-svg">
        <!-- Outer glow when ready -->
        <defs>
          <filter id="torii-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <g class="torii-gate" :filter="stage === 'ready' ? 'url(#torii-glow)' : ''">
          <!-- Main pillars -->
          <path d="M25,35 L22,85 L28,85 L25,35 Z" />
          <path d="M95,35 L92,85 L98,85 L95,35 Z" />
          <!-- Kasagi (top beam) with elegant curve -->
          <path d="M5,20 Q60,5 115,20 L112,28 Q60,15 8,28 Z" />
          <!-- Nuki (tie beam) -->
          <rect x="18" y="35" width="84" height="6" rx="2" />
          <!-- Gakuzuka (tablet) -->
          <rect x="50" y="25" width="20" height="10" rx="2" />
        </g>
      </svg>
    </div>
  </div>
</template>

<style scoped>
.awakening {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    180deg,
    #0a0a12 0%,
    #0d0d18 30%,
    #12121f 60%,
    #0a0a12 100%
  );
  overflow: hidden;
  transition: opacity 0.8s ease-out;
}

.awakening.stage-ready {
  opacity: 0;
  pointer-events: none;
}

/* ===========================================
   MIST LAYERS - Rising and clearing effect
   =========================================== */
.mist-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: opacity 1.5s ease-out, transform 1.5s ease-out;
}

.mist-ground {
  bottom: 0;
  height: 50%;
  opacity: calc(var(--mist-opacity) * 0.9);
  transform: translateY(calc((1 - var(--mist-opacity)) * 100%));
}

.mist-mid {
  opacity: calc(var(--mist-opacity) * 0.6);
  transform: translateY(calc((1 - var(--mist-opacity)) * 50%));
}

.mist-high {
  opacity: calc(var(--mist-opacity) * 0.3);
  transform: translateY(calc((1 - var(--mist-opacity)) * 30%));
}

/* Mist banks - thick ground fog */
.mist-bank {
  position: absolute;
  bottom: 0;
  width: 200%;
  height: 40%;
  background: radial-gradient(
    ellipse 100% 100% at 50% 100%,
    rgba(200, 210, 230, 0.15) 0%,
    rgba(180, 190, 210, 0.08) 40%,
    transparent 70%
  );
  animation: mist-drift 20s ease-in-out infinite;
}

.mist-bank-1 {
  left: -50%;
  animation-delay: 0s;
}

.mist-bank-2 {
  left: -20%;
  animation-delay: -7s;
  opacity: 0.7;
}

.mist-bank-3 {
  left: 10%;
  animation-delay: -14s;
  opacity: 0.5;
}

/* Mist wisps - floating mid-level */
.mist-wisp {
  position: absolute;
  width: 300px;
  height: 150px;
  background: radial-gradient(
    ellipse at center,
    rgba(200, 210, 230, 0.12) 0%,
    transparent 70%
  );
  border-radius: 50%;
  animation: wisp-float 15s ease-in-out infinite;
}

.mist-wisp-1 { left: 10%; top: 50%; animation-delay: 0s; }
.mist-wisp-2 { left: 40%; top: 40%; animation-delay: -4s; width: 400px; }
.mist-wisp-3 { left: 70%; top: 55%; animation-delay: -8s; }
.mist-wisp-4 { left: 25%; top: 35%; animation-delay: -12s; width: 250px; }

/* Mist tendrils - highest, most ethereal */
.mist-tendril {
  position: absolute;
  width: 500px;
  height: 80px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(200, 210, 230, 0.06) 30%,
    rgba(200, 210, 230, 0.08) 50%,
    rgba(200, 210, 230, 0.06) 70%,
    transparent 100%
  );
  animation: tendril-drift 25s ease-in-out infinite;
}

.mist-tendril-1 { left: -10%; top: 25%; }
.mist-tendril-2 { right: -10%; top: 20%; animation-delay: -12s; animation-direction: reverse; }

@keyframes mist-drift {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(10%); }
}

@keyframes wisp-float {
  0%, 100% {
    transform: translate(0, 0) scale(1);
    opacity: 0.8;
  }
  25% { transform: translate(20px, -10px) scale(1.05); }
  50% {
    transform: translate(10px, -20px) scale(1.1);
    opacity: 1;
  }
  75% { transform: translate(-10px, -10px) scale(1.05); }
}

@keyframes tendril-drift {
  0%, 100% { transform: translateX(0) skewX(0deg); }
  50% { transform: translateX(100px) skewX(2deg); }
}

/* ===========================================
   FIREFLIES - Dancing through the mist
   =========================================== */
.fireflies {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.firefly {
  position: absolute;
  width: 4px;
  height: 4px;
  background: var(--belt-glow, #fcd34d);
  border-radius: 50%;
  box-shadow:
    0 0 6px 2px var(--belt-glow, #fcd34d),
    0 0 12px 4px rgba(252, 211, 77, 0.3);
  animation: firefly-dance 8s ease-in-out infinite;
  opacity: 0;
}

.firefly-1 { left: 15%; top: 60%; animation-delay: 0s; }
.firefly-2 { left: 75%; top: 45%; animation-delay: -1.5s; }
.firefly-3 { left: 45%; top: 70%; animation-delay: -3s; }
.firefly-4 { left: 85%; top: 55%; animation-delay: -4.5s; }
.firefly-5 { left: 25%; top: 40%; animation-delay: -6s; }
.firefly-6 { left: 60%; top: 65%; animation-delay: -7s; }

@keyframes firefly-dance {
  0%, 100% {
    transform: translate(0, 0);
    opacity: 0;
  }
  10% { opacity: 0.8; }
  25% {
    transform: translate(30px, -20px);
    opacity: 1;
  }
  50% {
    transform: translate(15px, -40px);
    opacity: 0.6;
  }
  75% {
    transform: translate(-20px, -25px);
    opacity: 0.9;
  }
  90% { opacity: 0.4; }
}

/* ===========================================
   STATUS MESSAGE - Brushstroke aesthetic
   =========================================== */
.status-container {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2rem;
}

.status-message {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 1.5rem;
  font-weight: 300;
  letter-spacing: 0.15em;
  color: rgba(255, 255, 255, 0.85);
  text-transform: lowercase;
  animation: message-appear 0.8s ease-out;
}

.status-text {
  display: inline-block;
}

.status-dots {
  display: inline-block;
  width: 2em;
  text-align: left;
  opacity: 0.6;
}

@keyframes message-appear {
  from {
    opacity: 0;
    transform: translateY(10px);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

/* Progress breath - subtle pulsing circle */
.progress-breath {
  position: relative;
  width: 60px;
  height: 60px;
}

.breath-circle {
  position: absolute;
  inset: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  animation: breath 3s ease-in-out infinite;
}

.breath-circle::before {
  content: '';
  position: absolute;
  inset: 8px;
  border: 1px solid var(--belt-glow, #fcd34d);
  border-radius: 50%;
  opacity: 0.4;
  animation: breath 3s ease-in-out infinite reverse;
}

@keyframes breath {
  0%, 100% {
    transform: scale(1);
    opacity: 0.3;
  }
  50% {
    transform: scale(1.15);
    opacity: 0.6;
  }
}

/* Stage-specific states */
.stage-ready .progress-breath {
  animation: breath-complete 0.6s ease-out forwards;
}

@keyframes breath-complete {
  to {
    transform: scale(1.5);
    opacity: 0;
  }
}

/* ===========================================
   TORII GATE REVEAL
   =========================================== */
.torii-reveal {
  position: absolute;
  bottom: 15%;
  left: 50%;
  transform: translateX(-50%);
  width: 120px;
  height: 100px;
  opacity: calc(1 - var(--mist-opacity) * 0.8);
  transition: opacity 2s ease-out;
}

.torii-svg {
  width: 100%;
  height: 100%;
}

.torii-gate {
  fill: rgba(15, 15, 25, 0.9);
  transition: fill 1s ease-out;
}

.stage-ready .torii-gate {
  fill: rgba(30, 30, 45, 0.95);
}

/* ===========================================
   RESPONSIVE
   =========================================== */
@media (max-width: 480px) {
  .status-message {
    font-size: 1.2rem;
  }

  .progress-breath {
    width: 50px;
    height: 50px;
  }

  .torii-reveal {
    width: 80px;
    height: 70px;
    bottom: 20%;
  }
}
</style>
