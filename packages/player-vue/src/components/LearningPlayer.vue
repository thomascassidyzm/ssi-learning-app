<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

// Demo phrases for showcasing
const phrases = [
  { known: 'Hello, how are you?', target: 'Hola, ¿cómo estás?' },
  { known: 'I want to learn Spanish', target: 'Quiero aprender español' },
  { known: 'Where is the train station?', target: '¿Dónde está la estación de tren?' },
  { known: 'The weather is beautiful today', target: 'El tiempo está hermoso hoy' },
  { known: 'Can you help me please?', target: '¿Puedes ayudarme por favor?' },
]

// Phase enum
const Phase = {
  PROMPT: 'prompt',
  PAUSE: 'pause',
  VOICE_1: 'voice_1',
  VOICE_2: 'voice_2',
  TRANSITION: 'transition'
}

// Phase durations in ms
const phaseDurations = {
  [Phase.PROMPT]: 2500,
  [Phase.PAUSE]: 5000,
  [Phase.VOICE_1]: 2500,
  [Phase.VOICE_2]: 2500,
  [Phase.TRANSITION]: 800
}

// State
const theme = ref('dark')
const currentPhase = ref(Phase.PROMPT)
const currentPhraseIndex = ref(0)
const isPlaying = ref(true)
const pauseTimeRemaining = ref(5)
const itemsPracticed = ref(0)
const activeThread = ref(1)

// Computed
const currentPhrase = computed(() => phrases[currentPhraseIndex.value])
const sessionProgress = computed(() => (itemsPracticed.value + 1) / phrases.length)

const phaseLabel = computed(() => {
  switch (currentPhase.value) {
    case Phase.PROMPT: return 'Listen'
    case Phase.PAUSE: return 'Your turn'
    case Phase.VOICE_1: return 'Native speaker'
    case Phase.VOICE_2: return 'Native speaker'
    default: return ''
  }
})

const phaseInstruction = computed(() => {
  switch (currentPhase.value) {
    case Phase.PROMPT: return 'Hear the phrase in your language'
    case Phase.PAUSE: return 'Try to say it in the target language'
    case Phase.VOICE_1: return 'Listen to the native pronunciation'
    case Phase.VOICE_2: return 'Now see and hear the answer'
    default: return ''
  }
})

const showTargetText = computed(() => currentPhase.value === Phase.VOICE_2)

const isAudioPlaying = computed(() =>
  [Phase.PROMPT, Phase.VOICE_1, Phase.VOICE_2].includes(currentPhase.value)
)

// Ring animation progress (0-100) - only for PAUSE phase
const ringProgress = computed(() => {
  if (currentPhase.value !== Phase.PAUSE) return 0
  return ((5 - pauseTimeRemaining.value) / 5) * 100
})

// Timer intervals
let phaseTimer = null
let pauseCountdown = null

// Theme toggle
const toggleTheme = () => {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  localStorage.setItem('ssi-theme', theme.value)
}

// Phase progression
const advancePhase = () => {
  if (!isPlaying.value) return

  switch (currentPhase.value) {
    case Phase.PROMPT:
      currentPhase.value = Phase.PAUSE
      pauseTimeRemaining.value = 5
      startPauseCountdown()
      break
    case Phase.PAUSE:
      currentPhase.value = Phase.VOICE_1
      break
    case Phase.VOICE_1:
      currentPhase.value = Phase.VOICE_2
      break
    case Phase.VOICE_2:
      currentPhase.value = Phase.TRANSITION
      break
    case Phase.TRANSITION:
      currentPhraseIndex.value = (currentPhraseIndex.value + 1) % phrases.length
      itemsPracticed.value++
      activeThread.value = (activeThread.value % 3) + 1
      currentPhase.value = Phase.PROMPT
      break
  }
}

const startPauseCountdown = () => {
  if (pauseCountdown) clearInterval(pauseCountdown)
  pauseCountdown = setInterval(() => {
    if (pauseTimeRemaining.value > 0) {
      pauseTimeRemaining.value--
    }
  }, 1000)
}

const scheduleNextPhase = () => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (!isPlaying.value) return

  const duration = phaseDurations[currentPhase.value]
  phaseTimer = setTimeout(advancePhase, duration)
}

watch(currentPhase, () => {
  if (pauseCountdown && currentPhase.value !== Phase.PAUSE) {
    clearInterval(pauseCountdown)
    pauseCountdown = null
  }
  scheduleNextPhase()
})

const handlePause = () => {
  isPlaying.value = false
  if (phaseTimer) clearTimeout(phaseTimer)
  if (pauseCountdown) clearInterval(pauseCountdown)
}

const handleResume = () => {
  isPlaying.value = true
  scheduleNextPhase()
  if (currentPhase.value === Phase.PAUSE) {
    startPauseCountdown()
  }
}

const handleSkip = () => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (pauseCountdown) clearInterval(pauseCountdown)
  advancePhase()
}

const handleRevisit = () => {
  currentPhase.value = Phase.PROMPT
  pauseTimeRemaining.value = 5
}

onMounted(() => {
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  theme.value = savedTheme
  document.documentElement.setAttribute('data-theme', savedTheme)
  scheduleNextPhase()
})

onUnmounted(() => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (pauseCountdown) clearInterval(pauseCountdown)
})
</script>

<template>
  <div class="player" :class="{ 'is-paused': !isPlaying }">
    <!-- Atmospheric Background -->
    <div class="bg-atmosphere">
      <svg class="mountains" viewBox="0 0 1440 200" preserveAspectRatio="none">
        <path class="mountain-back" d="M0,200 L0,120 Q180,60 360,100 T720,80 T1080,110 T1440,90 L1440,200 Z"/>
        <path class="mountain-mid" d="M0,200 L0,140 Q240,90 480,130 T960,100 T1440,120 L1440,200 Z"/>
        <path class="mountain-front" d="M0,200 L0,160 Q360,120 720,150 T1440,140 L1440,200 Z"/>
      </svg>
    </div>

    <!-- Header -->
    <header class="header">
      <div class="brand">
        <span class="logo-text">
          <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
        </span>
        <span class="logo-bubble"></span>
      </div>

      <div class="session-badge">
        <div class="pulse-dot" :class="{ active: isPlaying }"></div>
        <span>Learning Session</span>
      </div>

      <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? 'Switch to light' : 'Switch to dark'">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/>
          <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
    </header>

    <!-- Main Learning Area -->
    <main class="main">
      <!-- Phase Indicator Strip -->
      <div class="phase-strip">
        <div class="phase-step" :class="{ active: currentPhase === Phase.PROMPT, complete: [Phase.PAUSE, Phase.VOICE_1, Phase.VOICE_2].includes(currentPhase) }">
          <div class="step-marker">1</div>
          <span>Listen</span>
        </div>
        <div class="phase-connector" :class="{ active: [Phase.PAUSE, Phase.VOICE_1, Phase.VOICE_2].includes(currentPhase) }"></div>
        <div class="phase-step" :class="{ active: currentPhase === Phase.PAUSE, complete: [Phase.VOICE_1, Phase.VOICE_2].includes(currentPhase) }">
          <div class="step-marker">2</div>
          <span>Speak</span>
        </div>
        <div class="phase-connector" :class="{ active: [Phase.VOICE_1, Phase.VOICE_2].includes(currentPhase) }"></div>
        <div class="phase-step" :class="{ active: [Phase.VOICE_1, Phase.VOICE_2].includes(currentPhase) }">
          <div class="step-marker">3</div>
          <span>Check</span>
        </div>
      </div>

      <!-- Known Text - Always visible above the ring -->
      <div class="known-section">
        <transition name="text-morph" mode="out-in">
          <p class="known-text" :key="currentPhrase.known">
            {{ currentPhrase.known }}
          </p>
        </transition>
      </div>

      <!-- Central Ring -->
      <div class="ring-area">
        <div class="ring-wrapper" :class="{ 'is-pause': currentPhase === Phase.PAUSE, 'is-audio': isAudioPlaying }">
          <!-- Outer glow ring -->
          <div class="ring-glow"></div>

          <!-- SVG Ring -->
          <svg class="ring-svg" viewBox="0 0 200 200">
            <!-- Track -->
            <circle class="ring-track" cx="100" cy="100" r="88" fill="none" stroke-width="2"/>
            <!-- Progress (PAUSE only) -->
            <circle
              class="ring-progress"
              cx="100" cy="100" r="88"
              fill="none"
              stroke-width="3"
              :stroke-dasharray="553"
              :stroke-dashoffset="553 - (ringProgress / 100) * 553"
              transform="rotate(-90 100 100)"
            />
            <!-- Decorative inner circle -->
            <circle class="ring-inner" cx="100" cy="100" r="70" fill="none" stroke-width="1"/>
          </svg>

          <!-- Center Content -->
          <div class="ring-content">
            <!-- Timer during PAUSE -->
            <template v-if="currentPhase === Phase.PAUSE">
              <div class="countdown">
                <span class="countdown-number">{{ pauseTimeRemaining }}</span>
                <span class="countdown-label">seconds</span>
              </div>
            </template>

            <!-- Audio indicator during playback -->
            <template v-else-if="isAudioPlaying">
              <div class="audio-visualizer" :class="{ playing: isPlaying }">
                <div class="bar"></div>
                <div class="bar"></div>
                <div class="bar"></div>
                <div class="bar"></div>
                <div class="bar"></div>
              </div>
            </template>

            <!-- Transition state -->
            <template v-else>
              <div class="transition-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </template>
          </div>
        </div>

        <!-- Phase instruction below ring -->
        <p class="phase-instruction">{{ phaseInstruction }}</p>
      </div>

      <!-- Target Text - Revealed during VOICE_2 -->
      <div class="target-section">
        <transition name="reveal">
          <p v-if="showTargetText" class="target-text" :key="currentPhrase.target">
            {{ currentPhrase.target }}
          </p>
        </transition>
      </div>
    </main>

    <!-- Control Bar -->
    <div class="controls">
      <button class="ctrl-btn" @click="handleRevisit" title="Hear again">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
        <span>Again</span>
      </button>

      <button class="ctrl-btn ctrl-btn--main" @click="isPlaying ? handlePause() : handleResume()">
        <div class="main-btn-inner">
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
        </div>
        <span>{{ isPlaying ? 'Pause' : 'Play' }}</span>
      </button>

      <button class="ctrl-btn" @click="handleSkip" title="Skip to next">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/>
          <line x1="19" y1="5" x2="19" y2="19"/>
        </svg>
        <span>Skip</span>
      </button>
    </div>

    <!-- Footer Progress -->
    <footer class="footer">
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: `${sessionProgress * 100}%` }">
          <div class="progress-glow"></div>
        </div>
      </div>
      <div class="footer-info">
        <div class="thread-dots">
          <span v-for="i in 3" :key="i" class="thread-dot" :class="{ active: i === activeThread }"></span>
        </div>
        <span class="progress-text">
          <strong>{{ itemsPracticed }}</strong> of <strong>{{ phrases.length }}</strong> phrases
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ============================================
   SSi Learning Player - Zen Dojo Edition
   Japanese minimalism meets focused learning
   ============================================ */

.player {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-primary);
  overflow: hidden;
  transition: background-color 0.4s ease;
}

/* Atmospheric Mountain Background */
.bg-atmosphere {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 200px;
  pointer-events: none;
  z-index: 0;
}

.mountains {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.mountain-back {
  fill: var(--bg-secondary);
  opacity: 0.3;
}

.mountain-mid {
  fill: var(--bg-secondary);
  opacity: 0.5;
}

.mountain-front {
  fill: var(--bg-secondary);
  opacity: 0.7;
}

/* ============ HEADER ============ */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1.25rem 1.5rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-text {
  font-family: 'Noto Sans JP', sans-serif;
  font-weight: 700;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}

.logo-say { color: var(--ssi-red); }
.logo-something { color: var(--text-primary); }
.logo-in { color: var(--ssi-red); }

.logo-bubble {
  width: 18px;
  height: 14px;
  border: 2px solid var(--ssi-red);
  border-radius: 3px;
  position: relative;
}

.logo-bubble::after {
  content: '';
  position: absolute;
  bottom: -5px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-right: 2px solid var(--ssi-red);
  border-bottom: 2px solid var(--ssi-red);
  transform: rotate(45deg);
  background: var(--bg-primary);
  transition: background-color 0.4s ease;
}

.session-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: all 0.3s ease;
}

.pulse-dot.active {
  background: var(--success);
  box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4);
  animation: pulse-ring 2s ease-out infinite;
}

@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.4); }
  70% { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
  100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
}

.theme-toggle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-medium);
  background: var(--bg-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
}

.theme-toggle:hover {
  border-color: var(--ssi-gold);
  transform: scale(1.05);
}

.theme-toggle svg {
  width: 18px;
  height: 18px;
  position: absolute;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.icon-sun {
  color: var(--ssi-gold);
  opacity: 0;
  transform: rotate(-90deg) scale(0);
}

.icon-moon {
  color: var(--text-secondary);
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

[data-theme="light"] .icon-sun {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

[data-theme="light"] .icon-moon {
  opacity: 0;
  transform: rotate(90deg) scale(0);
}

/* ============ MAIN AREA ============ */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem 1.5rem 2rem;
  position: relative;
  z-index: 1;
  gap: 1.5rem;
}

/* Phase Progress Strip */
.phase-strip {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 0.5rem;
}

.phase-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
  transition: all 0.3s ease;
}

.phase-step.active,
.phase-step.complete {
  opacity: 1;
}

.step-marker {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-elevated);
  border: 2px solid var(--border-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--text-muted);
  transition: all 0.3s ease;
}

.phase-step.active .step-marker {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
  color: white;
  box-shadow: 0 0 20px rgba(194, 58, 58, 0.4);
}

.phase-step.complete .step-marker {
  background: var(--success);
  border-color: var(--success);
  color: white;
}

.phase-step span {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.phase-step.active span {
  color: var(--ssi-red);
}

.phase-connector {
  width: 40px;
  height: 2px;
  background: var(--border-subtle);
  margin: 0 8px;
  margin-bottom: 20px;
  transition: all 0.3s ease;
}

.phase-connector.active {
  background: var(--success);
}

/* Known Text Section */
.known-section {
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 600px;
}

.known-text {
  font-family: 'Noto Sans JP', serif;
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: 400;
  color: var(--text-primary);
  text-align: center;
  line-height: 1.4;
  letter-spacing: -0.01em;
}

/* Ring Area */
.ring-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.ring-wrapper {
  position: relative;
  width: clamp(200px, 50vw, 260px);
  height: clamp(200px, 50vw, 260px);
}

.ring-glow {
  position: absolute;
  inset: -20px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--ssi-red-soft) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.5s ease;
}

.ring-wrapper.is-pause .ring-glow {
  opacity: 1;
  animation: glow-pulse 2s ease-in-out infinite;
}

@keyframes glow-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.05); opacity: 1; }
}

.ring-svg {
  width: 100%;
  height: 100%;
}

.ring-track {
  stroke: var(--border-subtle);
}

.ring-inner {
  stroke: var(--border-subtle);
  opacity: 0.5;
}

.ring-progress {
  stroke: var(--ssi-red);
  stroke-linecap: round;
  transition: stroke-dashoffset 1s linear;
  filter: drop-shadow(0 0 8px var(--ssi-red));
}

.ring-content {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Countdown */
.countdown {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.countdown-number {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: 4.5rem;
  font-weight: 300;
  line-height: 1;
  color: var(--ssi-red);
  text-shadow: 0 0 30px var(--ssi-red-soft);
}

.countdown-label {
  font-size: 0.6875rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: var(--text-muted);
  margin-top: 4px;
}

/* Audio Visualizer */
.audio-visualizer {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 40px;
}

.audio-visualizer .bar {
  width: 4px;
  height: 8px;
  background: var(--text-muted);
  border-radius: 2px;
  transition: all 0.15s ease;
}

.audio-visualizer.playing .bar {
  background: var(--ssi-red);
  animation: sound-bar 0.8s ease-in-out infinite;
}

.audio-visualizer.playing .bar:nth-child(1) { animation-delay: 0s; }
.audio-visualizer.playing .bar:nth-child(2) { animation-delay: 0.1s; }
.audio-visualizer.playing .bar:nth-child(3) { animation-delay: 0.2s; }
.audio-visualizer.playing .bar:nth-child(4) { animation-delay: 0.3s; }
.audio-visualizer.playing .bar:nth-child(5) { animation-delay: 0.4s; }

@keyframes sound-bar {
  0%, 100% { height: 8px; }
  50% { height: 32px; }
}

/* Transition Indicator */
.transition-indicator {
  display: flex;
  gap: 8px;
}

.transition-indicator span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: dot-bounce 1.4s ease-in-out infinite;
}

.transition-indicator span:nth-child(2) { animation-delay: 0.16s; }
.transition-indicator span:nth-child(3) { animation-delay: 0.32s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* Phase Instruction */
.phase-instruction {
  font-size: 0.875rem;
  color: var(--text-secondary);
  text-align: center;
  max-width: 280px;
}

/* Target Text Section */
.target-section {
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 600px;
}

.target-text {
  font-family: 'Noto Sans JP', serif;
  font-size: clamp(1.25rem, 4vw, 1.625rem);
  font-weight: 400;
  font-style: italic;
  color: var(--ssi-gold);
  text-align: center;
  line-height: 1.4;
}

/* ============ CONTROLS ============ */
.controls {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 1rem;
  padding: 1rem 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
}

.ctrl-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: 'Source Sans 3', sans-serif;
}

.ctrl-btn svg {
  width: 22px;
  height: 22px;
}

.ctrl-btn span {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.ctrl-btn:hover {
  background: var(--bg-elevated);
  border-color: var(--border-medium);
  color: var(--text-primary);
  transform: translateY(-2px);
}

.ctrl-btn--main {
  padding: 0;
  background: transparent;
  border: none;
}

.main-btn-inner {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 20px rgba(194, 58, 58, 0.4);
  transition: all 0.2s ease;
}

.main-btn-inner svg {
  width: 28px;
  height: 28px;
}

.ctrl-btn--main:hover .main-btn-inner {
  transform: scale(1.08);
  box-shadow: 0 6px 30px rgba(194, 58, 58, 0.5);
}

.ctrl-btn--main span {
  color: var(--text-secondary);
  margin-top: 8px;
}

/* ============ FOOTER ============ */
.footer {
  padding: 0 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
}

.progress-track {
  height: 4px;
  background: var(--bg-elevated);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 12px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-red) 0%, var(--ssi-gold) 100%);
  border-radius: 2px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
}

.progress-glow {
  position: absolute;
  right: 0;
  top: -4px;
  bottom: -4px;
  width: 20px;
  background: linear-gradient(90deg, transparent, var(--ssi-gold));
  filter: blur(4px);
}

.footer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.thread-dots {
  display: flex;
  gap: 6px;
}

.thread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--bg-elevated);
  transition: all 0.3s ease;
}

.thread-dot.active {
  background: var(--ssi-red);
  box-shadow: 0 0 8px var(--ssi-red-soft);
}

.progress-text {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.progress-text strong {
  color: var(--text-secondary);
  font-weight: 600;
}

/* ============ TRANSITIONS ============ */
.text-morph-enter-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.text-morph-leave-active {
  transition: all 0.25s ease;
}

.text-morph-enter-from {
  opacity: 0;
  transform: translateY(16px);
  filter: blur(4px);
}

.text-morph-leave-to {
  opacity: 0;
  transform: translateY(-8px);
  filter: blur(2px);
}

.reveal-enter-active {
  transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.reveal-leave-active {
  transition: all 0.3s ease;
}

.reveal-enter-from {
  opacity: 0;
  transform: translateY(24px) scale(0.95);
}

.reveal-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

/* ============ PAUSED STATE ============ */
.player.is-paused {
  /* Slight desaturation when paused */
}

.player.is-paused .ring-wrapper {
  opacity: 0.7;
}

/* ============ RESPONSIVE ============ */
@media (max-width: 480px) {
  .header {
    padding: 1rem;
  }

  .session-badge {
    display: none;
  }

  .phase-strip {
    transform: scale(0.85);
  }

  .controls {
    gap: 0.75rem;
  }

  .ctrl-btn {
    padding: 10px 14px;
  }

  .main-btn-inner {
    width: 56px;
    height: 56px;
  }
}
</style>
