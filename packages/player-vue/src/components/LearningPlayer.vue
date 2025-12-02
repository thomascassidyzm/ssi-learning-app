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
    case Phase.VOICE_1: return 'Native voice'
    case Phase.VOICE_2: return 'Native voice'
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
      // Move to next phrase
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

// Watch phase changes to schedule next
watch(currentPhase, () => {
  if (pauseCountdown && currentPhase.value !== Phase.PAUSE) {
    clearInterval(pauseCountdown)
    pauseCountdown = null
  }
  scheduleNextPhase()
})

// Controls
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
  // Reset to start of current phrase
  currentPhase.value = Phase.PROMPT
  pauseTimeRemaining.value = 5
}

// Lifecycle
onMounted(() => {
  // Load saved theme
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  theme.value = savedTheme
  document.documentElement.setAttribute('data-theme', savedTheme)

  // Start the demo
  scheduleNextPhase()
})

onUnmounted(() => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (pauseCountdown) clearInterval(pauseCountdown)
})
</script>

<template>
  <div class="player">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <span class="logo">SSi</span>
        <span class="session-label">Learning Session</span>
      </div>
      <div class="header-right">
        <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
          <svg v-if="theme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/>
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <main class="main">
      <!-- Known Text - ALWAYS visible, positioned ABOVE the ring -->
      <div class="known-text-container">
        <transition name="fade" mode="out-in">
          <p class="known-text" :key="currentPhrase.known">
            {{ currentPhrase.known }}
          </p>
        </transition>
      </div>

      <!-- Progress Ring -->
      <div class="ring-container">
        <!-- Phase Label -->
        <div class="phase-label" :class="{ 'is-pause': currentPhase === Phase.PAUSE }">
          {{ phaseLabel }}
        </div>

        <!-- SVG Ring -->
        <div class="ring-wrapper">
          <svg class="ring" viewBox="0 0 200 200">
            <!-- Background track -->
            <circle
              class="ring-track"
              cx="100"
              cy="100"
              r="90"
              fill="none"
              stroke-width="3"
            />
            <!-- Progress arc (only during PAUSE) -->
            <circle
              class="ring-progress"
              cx="100"
              cy="100"
              r="90"
              fill="none"
              stroke-width="3"
              :stroke-dasharray="565.48"
              :stroke-dashoffset="565.48 - (ringProgress / 100) * 565.48"
              transform="rotate(-90 100 100)"
            />
          </svg>

          <!-- Center Content -->
          <div class="ring-center">
            <!-- Timer during PAUSE -->
            <div v-if="currentPhase === Phase.PAUSE" class="timer">
              {{ pauseTimeRemaining }}
            </div>

            <!-- Speaker icon during audio -->
            <div v-else-if="isAudioPlaying" class="speaker-icon" :class="{ 'is-playing': isPlaying }">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              </svg>
            </div>

            <!-- Transition indicator -->
            <div v-else class="transition-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        </div>
      </div>

      <!-- Target Text - only during VOICE_2 -->
      <div class="target-text-container">
        <transition name="slide-up">
          <p v-if="showTargetText" class="target-text" :key="currentPhrase.target">
            {{ currentPhrase.target }}
          </p>
        </transition>
      </div>
    </main>

    <!-- Control Bar -->
    <div class="control-bar">
      <button class="control-btn" @click="handleRevisit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
        </svg>
        <span>Revisit</span>
      </button>

      <button class="control-btn control-btn--primary" @click="isPlaying ? handlePause() : handleResume()">
        <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>{{ isPlaying ? 'Pause' : 'Play' }}</span>
      </button>

      <button class="control-btn" @click="handleSkip">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 4 15 12 5 20 5 4"/>
          <line x1="19" y1="5" x2="19" y2="19"/>
        </svg>
        <span>Skip</span>
      </button>
    </div>

    <!-- Footer Progress -->
    <footer class="footer">
      <div class="progress-info">
        <span class="progress-label">Session Progress</span>
        <span class="progress-count">{{ itemsPracticed }} / {{ phrases.length }}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${sessionProgress * 100}%` }"></div>
      </div>
      <div class="thread-indicator">
        <span
          v-for="i in 3"
          :key="i"
          class="thread-dot"
          :class="{ active: i === activeThread }"
        ></span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.player {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--bg-primary);
  padding: 1.5rem;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 1rem;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.logo {
  font-family: var(--font-display);
  font-size: 1.5rem;
  color: var(--ssi-red);
  font-weight: 400;
}

.session-label {
  font-size: 0.875rem;
  color: var(--text-tertiary);
  padding-left: 0.75rem;
  border-left: 1px solid var(--border-subtle);
}

.theme-toggle {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border-subtle);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.theme-toggle:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.theme-toggle svg {
  width: 20px;
  height: 20px;
}

/* Main */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2rem;
  padding: 2rem 0;
}

/* Known Text - ABOVE the ring */
.known-text-container {
  min-height: 4rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.known-text {
  font-family: var(--font-display);
  font-size: clamp(1.5rem, 4vw, 2.25rem);
  color: var(--text-primary);
  text-align: center;
  line-height: 1.3;
  max-width: 600px;
}

/* Ring */
.ring-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.phase-label {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  transition: color 0.3s ease;
}

.phase-label.is-pause {
  color: var(--ssi-red);
}

.ring-wrapper {
  position: relative;
  width: clamp(180px, 40vw, 240px);
  height: clamp(180px, 40vw, 240px);
}

.ring {
  width: 100%;
  height: 100%;
}

.ring-track {
  stroke: var(--border-subtle);
}

.ring-progress {
  stroke: var(--ssi-red);
  transition: stroke-dashoffset 1s linear;
}

.ring-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.timer {
  font-family: var(--font-display);
  font-size: 4rem;
  color: var(--ssi-red);
  line-height: 1;
}

.speaker-icon {
  width: 48px;
  height: 48px;
  color: var(--text-secondary);
  transition: color 0.3s ease;
}

.speaker-icon.is-playing {
  color: var(--ssi-red);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}

.transition-dots {
  display: flex;
  gap: 6px;
}

.transition-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: dotPulse 1.2s ease-in-out infinite;
}

.transition-dots span:nth-child(2) { animation-delay: 0.2s; }
.transition-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotPulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

/* Target Text - BELOW the ring */
.target-text-container {
  min-height: 4rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.target-text {
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 3.5vw, 1.75rem);
  font-style: italic;
  color: var(--ssi-red);
  text-align: center;
  line-height: 1.3;
  max-width: 600px;
}

/* Control Bar */
.control-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 1rem;
  padding: 1.5rem 0;
}

.control-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: 1rem;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: var(--font-body);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.control-btn svg {
  width: 24px;
  height: 24px;
}

.control-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--border-light);
}

.control-btn--primary {
  background: var(--ssi-red-soft);
  border-color: transparent;
  color: var(--ssi-red);
}

.control-btn--primary:hover {
  background: var(--ssi-red);
  color: white;
}

/* Footer */
.footer {
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress-label {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.progress-count {
  font-size: 0.875rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.progress-bar {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--ssi-red);
  border-radius: 2px;
  transition: width 0.5s var(--ease-out-expo);
}

.thread-indicator {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 1rem;
}

.thread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  transition: all 0.3s ease;
}

.thread-dot.active {
  background: var(--ssi-red);
  box-shadow: 0 0 8px var(--ssi-red-glow);
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active {
  transition: all 0.4s var(--ease-out-expo);
}

.slide-up-leave-active {
  transition: all 0.3s ease;
}

.slide-up-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.slide-up-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
