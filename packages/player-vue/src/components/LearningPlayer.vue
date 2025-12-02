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
const pauseTimerFrozen = ref(false) // Track if timer reached end
const itemsPracticed = ref(0)
const activeThread = ref(1)

// Session timer
const sessionSeconds = ref(0)
let sessionTimerInterval = null

const formattedSessionTime = computed(() => {
  const mins = Math.floor(sessionSeconds.value / 60)
  const secs = sessionSeconds.value % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

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

// Ring animation progress (0-100) - fills up during PAUSE, stays full at end
const ringProgress = computed(() => {
  if (currentPhase.value !== Phase.PAUSE) return pauseTimerFrozen.value ? 100 : 0
  // Timer counts down from 5 to 0, so progress goes from 0% to 100%
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
      pauseTimerFrozen.value = false
      startPauseCountdown()
      break
    case Phase.PAUSE:
      pauseTimerFrozen.value = true // Keep ring full
      currentPhase.value = Phase.VOICE_1
      break
    case Phase.VOICE_1:
      currentPhase.value = Phase.VOICE_2
      break
    case Phase.VOICE_2:
      currentPhase.value = Phase.TRANSITION
      break
    case Phase.TRANSITION:
      pauseTimerFrozen.value = false // Reset for next phrase
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

// Mode toggles
const turboActive = ref(false)
const listeningMode = ref(false)

const toggleTurbo = () => {
  turboActive.value = !turboActive.value
}

const toggleListening = () => {
  listeningMode.value = !listeningMode.value
}

onMounted(() => {
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  theme.value = savedTheme
  document.documentElement.setAttribute('data-theme', savedTheme)
  scheduleNextPhase()
  // Start session timer
  sessionTimerInterval = setInterval(() => {
    if (isPlaying.value) {
      sessionSeconds.value++
    }
  }, 1000)
})

onUnmounted(() => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (pauseCountdown) clearInterval(pauseCountdown)
  if (sessionTimerInterval) clearInterval(sessionTimerInterval)
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

      <!-- Session Timer -->
      <div class="session-timer">
        <svg class="timer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
        <span class="timer-value">{{ formattedSessionTime }}</span>
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

      <!-- KNOWN LANGUAGE ZONE -->
      <div class="zone zone--known">
        <div class="zone-label">Your Language</div>
        <transition name="text-morph" mode="out-in">
          <p class="known-text" :key="currentPhrase.known">
            {{ currentPhrase.known }}
          </p>
        </transition>
      </div>

      <!-- Central Ring with Big Play Button -->
      <div class="ring-area">
        <div
          class="ring-wrapper"
          :class="{
            'is-pause': currentPhase === Phase.PAUSE,
            'is-audio': isAudioPlaying,
            'is-complete': pauseTimerFrozen && currentPhase !== Phase.PAUSE
          }"
        >
          <!-- Outer glow ring -->
          <div class="ring-glow"></div>

          <!-- SVG Ring - enhanced -->
          <svg class="ring-svg" viewBox="0 0 200 200">
            <!-- Outer track -->
            <circle class="ring-track" cx="100" cy="100" r="92" fill="none" stroke-width="2"/>
            <!-- Main progress ring -->
            <circle
              class="ring-progress"
              cx="100" cy="100" r="92"
              fill="none"
              stroke-width="6"
              :stroke-dasharray="578"
              :stroke-dashoffset="578 - (ringProgress / 100) * 578"
              transform="rotate(-90 100 100)"
            />
            <!-- Inner decorative ring -->
            <circle class="ring-inner" cx="100" cy="100" r="82" fill="none" stroke-width="1"/>
          </svg>

          <!-- BIG Central Play/Stop Button -->
          <button
            class="big-play-btn"
            @click="isPlaying ? handlePause() : handleResume()"
            :class="{ playing: isPlaying }"
          >
            <!-- Play icon -->
            <svg v-if="!isPlaying" class="play-icon" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
            <!-- Stop icon (square) -->
            <svg v-else class="stop-icon" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
          </button>
        </div>

        <!-- Phase instruction below ring -->
        <p class="phase-instruction">{{ phaseInstruction }}</p>
      </div>

      <!-- TARGET LANGUAGE ZONE -->
      <div class="zone zone--target">
        <div class="zone-label">Target Language</div>
        <transition name="reveal">
          <p v-if="showTargetText" class="target-text" :key="currentPhrase.target">
            {{ currentPhrase.target }}
          </p>
          <p v-else class="target-placeholder">...</p>
        </transition>
      </div>
    </main>

    <!-- Control Bar - Pill Segments -->
    <div class="control-bar">
      <!-- Left mode: Listening -->
      <button
        class="mode-btn mode-btn--listening"
        :class="{ active: listeningMode }"
        @click="toggleListening"
        title="Listening Mode"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>
      </button>

      <!-- Main transport controls -->
      <div class="transport-pill">
        <button class="transport-btn" @click="handleRevisit" title="Revisit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </button>

        <button
          class="transport-btn transport-btn--main"
          @click="isPlaying ? handlePause() : handleResume()"
        >
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <rect x="5" y="3" width="4" height="18" rx="1"/>
            <rect x="15" y="3" width="4" height="18" rx="1"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6 3 20 12 6 21 6 3"/>
          </svg>
        </button>

        <button class="transport-btn" @click="handleSkip" title="Skip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/>
            <line x1="19" y1="5" x2="19" y2="19"/>
          </svg>
        </button>
      </div>

      <!-- Right mode: Turbo -->
      <button
        class="mode-btn mode-btn--turbo"
        :class="{ active: turboActive }"
        @click="toggleTurbo"
        title="Turbo Boost"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
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

/* Session Timer */
.session-timer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 24px;
  font-family: 'Source Sans 3', sans-serif;
}

.timer-icon {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
}

.timer-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  min-width: 48px;
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

/* Language Zones */
.zone {
  width: 100%;
  max-width: 700px;
  padding: 1.5rem 2rem;
  border-radius: 16px;
  text-align: center;
  position: relative;
}

.zone-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

/* Known Zone - Top */
.zone--known {
  background: linear-gradient(180deg, var(--bg-card) 0%, transparent 100%);
  border: 1px solid var(--border-subtle);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
}

.known-text {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: clamp(1.5rem, 5vw, 2.25rem);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
  letter-spacing: -0.01em;
}

/* Target Zone - Bottom */
.zone--target {
  background: linear-gradient(0deg, rgba(212, 168, 83, 0.08) 0%, transparent 100%);
  border: 1px solid rgba(212, 168, 83, 0.2);
  border-top: none;
  border-radius: 0 0 16px 16px;
  min-height: 100px;
}

.target-text {
  font-family: 'Noto Sans JP', sans-serif;
  font-size: clamp(1.25rem, 4vw, 1.875rem);
  font-weight: 500;
  color: var(--ssi-gold);
  line-height: 1.4;
}

.target-placeholder {
  font-size: 2rem;
  color: var(--text-muted);
  letter-spacing: 0.5em;
  opacity: 0.3;
}

/* Ring Area */
.ring-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin: -1rem 0; /* Overlap with zones */
  position: relative;
  z-index: 5;
}

.ring-wrapper {
  position: relative;
  width: clamp(160px, 40vw, 220px);
  height: clamp(160px, 40vw, 220px);
}

.ring-glow {
  position: absolute;
  inset: -30px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--ssi-red-soft) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.5s ease;
}

.ring-wrapper.is-pause .ring-glow {
  opacity: 1;
  animation: glow-pulse 2s ease-in-out infinite;
}

.ring-wrapper.is-complete .ring-glow {
  opacity: 0.5;
  background: radial-gradient(circle, rgba(74, 222, 128, 0.3) 0%, transparent 70%);
}

@keyframes glow-pulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.1); opacity: 1; }
}

.ring-svg {
  width: 100%;
  height: 100%;
}

.ring-track {
  stroke: var(--border-medium);
  opacity: 0.5;
}

.ring-inner {
  stroke: var(--border-subtle);
  opacity: 0.3;
}

.ring-progress {
  stroke: var(--ssi-red);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.1s linear;
  filter: drop-shadow(0 0 12px var(--ssi-red));
}

/* When timer complete, turn progress green */
.ring-wrapper.is-complete .ring-progress {
  stroke: var(--success);
  filter: drop-shadow(0 0 12px rgba(74, 222, 128, 0.6));
}

/* Big Central Play/Stop Button */
.big-play-btn {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 80px;
  height: 80px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    0 4px 20px rgba(194, 58, 58, 0.4),
    inset 0 2px 0 rgba(255,255,255,0.15);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.big-play-btn:hover {
  transform: translate(-50%, -50%) scale(1.08);
  box-shadow:
    0 8px 32px rgba(194, 58, 58, 0.5),
    inset 0 2px 0 rgba(255,255,255,0.2);
}

.big-play-btn:active {
  transform: translate(-50%, -50%) scale(0.98);
}

.big-play-btn svg {
  width: 32px;
  height: 32px;
}

.big-play-btn .play-icon {
  margin-left: 4px; /* Optical centering for play triangle */
}

/* Phase Instruction */
.phase-instruction {
  font-size: 0.875rem;
  color: var(--text-secondary);
  text-align: center;
  max-width: 280px;
  margin-top: 0.5rem;
}

/* ============ CONTROLS - PILL SEGMENTS ============ */
.control-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  padding: 1rem 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
}

/* Mode buttons (Listening & Turbo) */
.mode-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 1px solid var(--border-medium);
  background: var(--bg-card);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.mode-btn svg {
  width: 20px;
  height: 20px;
}

.mode-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: scale(1.08);
  border-color: var(--text-muted);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

/* Listening mode active */
.mode-btn--listening.active {
  background: rgba(74, 222, 128, 0.15);
  border-color: #4ade80;
  color: #4ade80;
  box-shadow: 0 0 20px rgba(74, 222, 128, 0.3);
}

/* Turbo mode active */
.mode-btn--turbo.active {
  background: rgba(212, 168, 83, 0.2);
  border-color: var(--ssi-gold);
  color: var(--ssi-gold);
  box-shadow: 0 0 20px rgba(212, 168, 83, 0.4);
  animation: turbo-pulse 1.5s ease-in-out infinite;
}

@keyframes turbo-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(212, 168, 83, 0.4); }
  50% { box-shadow: 0 0 30px rgba(212, 168, 83, 0.6); }
}

/* Transport pill container */
.transport-pill {
  display: flex;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
  padding: 6px;
  gap: 4px;
}

.transport-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.transport-btn svg {
  width: 18px;
  height: 18px;
}

.transport-btn:hover {
  background: var(--bg-elevated);
  color: var(--text-primary);
  transform: scale(1.1);
}

/* Main play/stop button */
.transport-btn--main {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  color: white;
  box-shadow: 0 4px 16px rgba(194, 58, 58, 0.4);
}

.transport-btn--main svg {
  width: 22px;
  height: 22px;
}

.transport-btn--main:hover {
  background: linear-gradient(135deg, var(--ssi-red-light) 0%, var(--ssi-red) 100%);
  transform: scale(1.05);
  box-shadow: 0 6px 24px rgba(194, 58, 58, 0.5);
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

/* Desktop / Chromebook optimization */
@media (min-width: 768px) {
  .main {
    padding: 2rem 3rem;
    gap: 1rem;
  }

  .zone {
    max-width: 800px;
    padding: 2rem 3rem;
  }

  .ring-wrapper {
    width: 200px;
    height: 200px;
  }

  .big-play-btn {
    width: 90px;
    height: 90px;
  }

  .big-play-btn svg {
    width: 36px;
    height: 36px;
  }

  .control-bar {
    gap: 16px;
    padding: 1.5rem 2rem 2rem;
  }

  .mode-btn {
    width: 52px;
    height: 52px;
  }

  .transport-btn {
    width: 48px;
    height: 48px;
  }

  .transport-btn--main {
    width: 60px;
    height: 60px;
  }
}

/* Large desktop */
@media (min-width: 1200px) {
  .zone {
    max-width: 900px;
  }

  .known-text {
    font-size: 2.5rem;
  }

  .target-text {
    font-size: 2rem;
  }
}

/* Mobile */
@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
  }

  .logo-text {
    font-size: 1rem;
  }

  .session-timer {
    padding: 6px 12px;
  }

  .timer-value {
    font-size: 0.875rem;
  }

  .theme-toggle {
    width: 36px;
    height: 36px;
  }

  .main {
    padding: 0.5rem 1rem 1rem;
    gap: 0.75rem;
  }

  .phase-strip {
    transform: scale(0.8);
    margin-bottom: 0;
  }

  .zone {
    padding: 1rem 1.25rem;
  }

  .zone-label {
    font-size: 0.625rem;
    margin-bottom: 0.5rem;
  }

  .ring-wrapper {
    width: 140px;
    height: 140px;
  }

  .big-play-btn {
    width: 64px;
    height: 64px;
  }

  .big-play-btn svg {
    width: 26px;
    height: 26px;
  }

  .control-bar {
    gap: 8px;
    padding: 0.75rem 1rem 1rem;
  }

  .mode-btn {
    width: 40px;
    height: 40px;
  }

  .mode-btn svg {
    width: 18px;
    height: 18px;
  }

  .transport-pill {
    padding: 4px;
    gap: 2px;
  }

  .transport-btn {
    width: 36px;
    height: 36px;
  }

  .transport-btn svg {
    width: 16px;
    height: 16px;
  }

  .transport-btn--main {
    width: 44px;
    height: 44px;
  }

  .transport-btn--main svg {
    width: 18px;
    height: 18px;
  }

  .footer {
    padding: 0 1rem 1rem;
  }
}
</style>
