<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

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

// ============================================
// TYPEWRITER STATUS MESSAGES
// Each stage has a sequence of messages that type out
// ============================================
const STAGE_MESSAGES = {
  awakening: [
    'initializing neural pathways',
    'warming up language engines',
  ],
  finding: [
    'locating your progress',
    'retrieving session data',
  ],
  preparing: [
    'preparing audio streams',
    'calibrating rhythm patterns',
  ],
  ready: [
    'ready',
  ]
}

// Current message state
const displayedLines = ref([]) // Lines already typed
const currentLine = ref('') // Line currently being typed
const cursorVisible = ref(true)
const isTyping = ref(false)

let typewriterInterval = null
let cursorInterval = null
let messageQueue = []
let charIndex = 0

// Cursor blink
onMounted(() => {
  cursorInterval = setInterval(() => {
    cursorVisible.value = !cursorVisible.value
  }, 530)
})

// Type out messages for current stage
const typeMessages = async (messages) => {
  messageQueue = [...messages]
  await typeNextMessage()
}

const typeNextMessage = () => {
  return new Promise((resolve) => {
    if (messageQueue.length === 0) {
      resolve()
      return
    }

    const message = messageQueue.shift()
    charIndex = 0
    currentLine.value = ''
    isTyping.value = true

    typewriterInterval = setInterval(() => {
      if (charIndex < message.length) {
        currentLine.value += message[charIndex]
        charIndex++
      } else {
        clearInterval(typewriterInterval)
        isTyping.value = false

        // Move current line to displayed lines (max 4 visible)
        displayedLines.value.push(currentLine.value)
        if (displayedLines.value.length > 4) {
          displayedLines.value.shift()
        }
        currentLine.value = ''

        // Small delay before next message
        setTimeout(() => {
          typeNextMessage().then(resolve)
        }, 400)
      }
    }, 35) // Typing speed - 35ms per char
  })
}

// Watch stage changes
watch(() => props.stage, async (newStage, oldStage) => {
  // Clear any ongoing typing
  if (typewriterInterval) clearInterval(typewriterInterval)

  // Get messages for this stage
  const messages = STAGE_MESSAGES[newStage] || []

  // Type them out
  await typeMessages(messages)

  // If ready, emit after transition
  if (newStage === 'ready') {
    setTimeout(() => emit('ready'), 1500)
  }
}, { immediate: true })

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

// Cleanup
onUnmounted(() => {
  if (typewriterInterval) clearInterval(typewriterInterval)
  if (cursorInterval) clearInterval(cursorInterval)
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
      <div class="firefly firefly-7"></div>
      <div class="firefly firefly-8"></div>
    </div>

    <!-- Terminal-style Status Display -->
    <div class="terminal-container">
      <div class="terminal-frame">
        <!-- Past lines (dimmed) -->
        <div
          v-for="(line, idx) in displayedLines"
          :key="idx"
          class="terminal-line terminal-line-past"
          :style="{ opacity: 0.3 + (idx / displayedLines.length) * 0.4 }"
        >
          <span class="line-prefix">›</span>
          <span class="line-text">{{ line }}</span>
          <span class="line-check">✓</span>
        </div>

        <!-- Current typing line -->
        <div v-if="currentLine || isTyping" class="terminal-line terminal-line-current">
          <span class="line-prefix">›</span>
          <span class="line-text">{{ currentLine }}</span>
          <span class="cursor" :class="{ visible: cursorVisible }">▌</span>
        </div>

        <!-- Waiting cursor when not typing -->
        <div v-else-if="stage !== 'ready'" class="terminal-line terminal-line-waiting">
          <span class="line-prefix">›</span>
          <span class="cursor" :class="{ visible: cursorVisible }">▌</span>
        </div>
      </div>
    </div>

    <!-- Torii gate silhouette emerges -->
    <div class="torii-reveal">
      <svg viewBox="0 0 120 100" class="torii-svg">
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

    <!-- Subtle scan line overlay for tech feel -->
    <div class="scanlines"></div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500&family=Noto+Sans+JP:wght@300;400&display=swap');

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
    #050508 0%,
    #0a0a12 30%,
    #0d0d18 60%,
    #080810 100%
  );
  overflow: hidden;
  transition: opacity 1s ease-out;
}

.awakening.stage-ready {
  opacity: 0;
  pointer-events: none;
}

/* Subtle scanlines for tech feel */
.scanlines {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.15) 2px,
    rgba(0, 0, 0, 0.15) 4px
  );
  pointer-events: none;
  opacity: 0.4;
}

/* ===========================================
   TERMINAL STATUS DISPLAY
   =========================================== */
.terminal-container {
  position: relative;
  z-index: 20;
  margin-bottom: 4rem;
}

.terminal-frame {
  min-width: 280px;
  max-width: 400px;
  padding: 1.5rem 2rem;
  background: rgba(10, 10, 18, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  backdrop-filter: blur(8px);
  box-shadow:
    0 0 40px rgba(0, 0, 0, 0.5),
    inset 0 0 20px rgba(255, 255, 255, 0.02);
}

.terminal-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.875rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.85);
}

.terminal-line-past {
  color: rgba(255, 255, 255, 0.5);
}

.terminal-line-current {
  color: var(--belt-glow, #fcd34d);
}

.terminal-line-waiting {
  color: rgba(255, 255, 255, 0.4);
}

.line-prefix {
  color: var(--belt-glow, #fcd34d);
  opacity: 0.7;
  font-weight: 500;
}

.line-text {
  flex: 1;
}

.line-check {
  color: rgba(120, 200, 120, 0.6);
  font-size: 0.75rem;
  margin-left: 0.5rem;
}

.cursor {
  color: var(--belt-glow, #fcd34d);
  opacity: 0;
  transition: opacity 0.1s;
  font-weight: 300;
  margin-left: -2px;
}

.cursor.visible {
  opacity: 1;
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
    rgba(180, 190, 210, 0.12) 0%,
    rgba(160, 170, 190, 0.06) 40%,
    transparent 70%
  );
  animation: mist-drift 25s ease-in-out infinite;
}

.mist-bank-1 {
  left: -50%;
  animation-delay: 0s;
}

.mist-bank-2 {
  left: -20%;
  animation-delay: -9s;
  opacity: 0.7;
}

.mist-bank-3 {
  left: 10%;
  animation-delay: -17s;
  opacity: 0.5;
}

/* Mist wisps - floating mid-level */
.mist-wisp {
  position: absolute;
  width: 300px;
  height: 150px;
  background: radial-gradient(
    ellipse at center,
    rgba(180, 190, 210, 0.1) 0%,
    transparent 70%
  );
  border-radius: 50%;
  animation: wisp-float 18s ease-in-out infinite;
}

.mist-wisp-1 { left: 10%; top: 50%; animation-delay: 0s; }
.mist-wisp-2 { left: 40%; top: 40%; animation-delay: -5s; width: 400px; }
.mist-wisp-3 { left: 70%; top: 55%; animation-delay: -10s; }
.mist-wisp-4 { left: 25%; top: 35%; animation-delay: -15s; width: 250px; }

/* Mist tendrils - highest, most ethereal */
.mist-tendril {
  position: absolute;
  width: 500px;
  height: 80px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(180, 190, 210, 0.05) 30%,
    rgba(180, 190, 210, 0.07) 50%,
    rgba(180, 190, 210, 0.05) 70%,
    transparent 100%
  );
  animation: tendril-drift 30s ease-in-out infinite;
}

.mist-tendril-1 { left: -10%; top: 25%; }
.mist-tendril-2 { right: -10%; top: 20%; animation-delay: -15s; animation-direction: reverse; }

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
   FIREFLIES - More of them, more magical
   =========================================== */
.fireflies {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.firefly {
  position: absolute;
  width: 3px;
  height: 3px;
  background: var(--belt-glow, #fcd34d);
  border-radius: 50%;
  box-shadow:
    0 0 6px 2px var(--belt-glow, #fcd34d),
    0 0 12px 4px rgba(252, 211, 77, 0.25);
  animation: firefly-dance 10s ease-in-out infinite;
  opacity: 0;
}

.firefly-1 { left: 12%; top: 65%; animation-delay: 0s; }
.firefly-2 { left: 78%; top: 42%; animation-delay: -1.2s; }
.firefly-3 { left: 42%; top: 72%; animation-delay: -2.5s; }
.firefly-4 { left: 88%; top: 58%; animation-delay: -3.8s; }
.firefly-5 { left: 22%; top: 38%; animation-delay: -5s; }
.firefly-6 { left: 65%; top: 68%; animation-delay: -6.2s; }
.firefly-7 { left: 35%; top: 45%; animation-delay: -7.5s; }
.firefly-8 { left: 55%; top: 55%; animation-delay: -8.8s; }

@keyframes firefly-dance {
  0%, 100% {
    transform: translate(0, 0);
    opacity: 0;
  }
  8% { opacity: 0.7; }
  20% {
    transform: translate(25px, -15px);
    opacity: 1;
  }
  40% {
    transform: translate(40px, -35px);
    opacity: 0.5;
  }
  60% {
    transform: translate(20px, -50px);
    opacity: 0.8;
  }
  80% {
    transform: translate(-15px, -30px);
    opacity: 0.6;
  }
  92% { opacity: 0.3; }
}

/* ===========================================
   TORII GATE REVEAL
   =========================================== */
.torii-reveal {
  position: absolute;
  bottom: 12%;
  left: 50%;
  transform: translateX(-50%);
  width: 100px;
  height: 85px;
  opacity: calc(1 - var(--mist-opacity) * 0.85);
  transition: opacity 2s ease-out;
}

.torii-svg {
  width: 100%;
  height: 100%;
}

.torii-gate {
  fill: rgba(20, 20, 35, 0.85);
  transition: fill 1.2s ease-out;
}

.stage-ready .torii-gate {
  fill: rgba(35, 35, 55, 0.9);
}

/* ===========================================
   RESPONSIVE
   =========================================== */
@media (max-width: 480px) {
  .terminal-frame {
    min-width: 260px;
    padding: 1.25rem 1.5rem;
  }

  .terminal-line {
    font-size: 0.8rem;
  }

  .torii-reveal {
    width: 70px;
    height: 60px;
    bottom: 18%;
  }
}
</style>
