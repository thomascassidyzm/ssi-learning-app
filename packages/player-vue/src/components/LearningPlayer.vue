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

// 4 Distinct Phases
const Phase = {
  PROMPT: 'prompt',      // Hear prompt in known language
  SPEAK: 'speak',        // Learner speaks (countdown)
  VOICE_1: 'voice_1',    // Model voice 1
  VOICE_2: 'voice_2',    // Model voice 2 + show text
}

// Phase durations in ms
const phaseDurations = {
  [Phase.PROMPT]: 2500,
  [Phase.SPEAK]: 5000,
  [Phase.VOICE_1]: 2500,
  [Phase.VOICE_2]: 2500,
}

// State
const theme = ref('dark')
const currentPhase = ref(Phase.PROMPT)
const currentPhraseIndex = ref(0)
const isPlaying = ref(true)
const itemsPracticed = ref(0)

// Smooth ring progress (0-100) - continuous animation
const ringProgressRaw = ref(0)
let ringAnimationFrame = null
let phaseStartTime = 0

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
const showTargetText = computed(() => currentPhase.value === Phase.VOICE_2)

// Phase symbols/icons
const phaseInfo = computed(() => {
  switch (currentPhase.value) {
    case Phase.PROMPT:
      return { icon: 'ear', label: 'Listen', instruction: 'Hear the phrase' }
    case Phase.SPEAK:
      return { icon: 'mic', label: 'Speak', instruction: 'Say it in the target language' }
    case Phase.VOICE_1:
      return { icon: 'speaker', label: 'Check', instruction: 'Listen to the answer' }
    case Phase.VOICE_2:
      return { icon: 'eye', label: 'Read', instruction: 'See and hear the answer' }
    default:
      return { icon: 'ear', label: '', instruction: '' }
  }
})

// Ring progress for SPEAK phase only (0-100)
const ringProgress = computed(() => {
  if (currentPhase.value !== Phase.SPEAK) return 0
  return ringProgressRaw.value
})

// Timer intervals
let phaseTimer = null

// Smooth ring animation using requestAnimationFrame
const animateRing = () => {
  if (!isPlaying.value || currentPhase.value !== Phase.SPEAK) {
    ringAnimationFrame = null
    return
  }

  const elapsed = Date.now() - phaseStartTime
  const duration = phaseDurations[Phase.SPEAK]
  const progress = Math.min((elapsed / duration) * 100, 100)

  ringProgressRaw.value = progress

  if (progress < 100) {
    ringAnimationFrame = requestAnimationFrame(animateRing)
  }
}

const startRingAnimation = () => {
  phaseStartTime = Date.now()
  ringProgressRaw.value = 0
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  ringAnimationFrame = requestAnimationFrame(animateRing)
}

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
      currentPhase.value = Phase.SPEAK
      startRingAnimation()
      break
    case Phase.SPEAK:
      currentPhase.value = Phase.VOICE_1
      break
    case Phase.VOICE_1:
      currentPhase.value = Phase.VOICE_2
      break
    case Phase.VOICE_2:
      // Move to next phrase
      currentPhraseIndex.value = (currentPhraseIndex.value + 1) % phrases.length
      itemsPracticed.value++
      currentPhase.value = Phase.PROMPT
      break
  }
}

const scheduleNextPhase = () => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (!isPlaying.value) return

  const duration = phaseDurations[currentPhase.value]
  phaseTimer = setTimeout(advancePhase, duration)
}

watch(currentPhase, () => {
  scheduleNextPhase()
})

// Tap on ring to toggle play/stop
const handleRingTap = () => {
  if (isPlaying.value) {
    handlePause()
  } else {
    handleResume()
  }
}

const handlePause = () => {
  isPlaying.value = false
  if (phaseTimer) clearTimeout(phaseTimer)
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
}

const handleResume = () => {
  isPlaying.value = true
  if (currentPhase.value === Phase.SPEAK) {
    // Resume ring animation from where it was
    const elapsed = (ringProgressRaw.value / 100) * phaseDurations[Phase.SPEAK]
    phaseStartTime = Date.now() - elapsed
    ringAnimationFrame = requestAnimationFrame(animateRing)
  }
  scheduleNextPhase()
}

const handleSkip = () => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  advancePhase()
}

const handleRevisit = () => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  ringProgressRaw.value = 0
  currentPhase.value = Phase.PROMPT
  scheduleNextPhase()
}

// Mode toggles
const turboActive = ref(false)
const listeningMode = ref(false)

const toggleTurbo = () => turboActive.value = !turboActive.value
const toggleListening = () => listeningMode.value = !listeningMode.value

onMounted(() => {
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  theme.value = savedTheme
  document.documentElement.setAttribute('data-theme', savedTheme)
  scheduleNextPhase()

  sessionTimerInterval = setInterval(() => {
    if (isPlaying.value) sessionSeconds.value++
  }, 1000)
})

onUnmounted(() => {
  if (phaseTimer) clearTimeout(phaseTimer)
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  if (sessionTimerInterval) clearInterval(sessionTimerInterval)
})
</script>

<template>
  <div class="player" :class="{ 'is-paused': !isPlaying }">
    <!-- Subtle gradient background -->
    <div class="bg-gradient"></div>
    <div class="bg-noise"></div>

    <!-- Header -->
    <header class="header">
      <div class="brand">
        <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
      </div>

      <div class="session-timer">
        <span class="timer-value">{{ formattedSessionTime }}</span>
      </div>

      <button class="theme-toggle" @click="toggleTheme">
        <div class="toggle-track">
          <div class="toggle-thumb" :class="{ light: theme === 'light' }"></div>
        </div>
      </button>
    </header>

    <!-- Main Content - Fixed Layout -->
    <main class="main">
      <!-- 4-Phase Indicator -->
      <div class="phase-dots">
        <div
          v-for="(phase, idx) in ['prompt', 'speak', 'voice_1', 'voice_2']"
          :key="phase"
          class="phase-dot"
          :class="{
            active: currentPhase === phase,
            complete: Object.values(Phase).indexOf(currentPhase) > idx
          }"
        >
          <!-- Phase symbols -->
          <svg v-if="idx === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <svg v-else-if="idx === 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
          <svg v-else-if="idx === 2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
      </div>

      <!-- Known Language Text - Fixed Height -->
      <div class="text-zone text-zone--known">
        <transition name="text-fade" mode="out-in">
          <p class="known-text" :key="currentPhrase.known">
            {{ currentPhrase.known }}
          </p>
        </transition>
      </div>

      <!-- Central Ring - Tap to Stop/Play -->
      <div
        class="ring-container"
        @click="handleRingTap"
        :class="{
          'is-speak': currentPhase === Phase.SPEAK,
          'is-paused': !isPlaying
        }"
      >
        <!-- Ambient glow -->
        <div class="ring-ambient"></div>

        <!-- SVG Ring -->
        <svg class="ring-svg" viewBox="0 0 200 200">
          <!-- Background track -->
          <circle
            class="ring-track"
            cx="100" cy="100" r="90"
            fill="none"
            stroke-width="4"
          />
          <!-- Progress arc - smooth continuous -->
          <circle
            class="ring-progress"
            cx="100" cy="100" r="90"
            fill="none"
            stroke-width="4"
            :stroke-dasharray="565.48"
            :stroke-dashoffset="565.48 - (ringProgress / 100) * 565.48"
            transform="rotate(-90 100 100)"
          />
          <!-- Inner decorative ring -->
          <circle
            class="ring-inner"
            cx="100" cy="100" r="78"
            fill="none"
            stroke-width="1"
          />
        </svg>

        <!-- Center content -->
        <div class="ring-center">
          <!-- Show play button when paused -->
          <div v-if="!isPlaying" class="play-indicator">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3"/>
            </svg>
          </div>
          <!-- Phase icon when playing -->
          <div v-else class="phase-icon" :class="currentPhase">
            <svg v-if="phaseInfo.icon === 'ear'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
            <svg v-else-if="phaseInfo.icon === 'mic'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            </svg>
            <svg v-else-if="phaseInfo.icon === 'speaker'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </div>
        </div>

        <!-- Phase label below -->
        <div class="ring-label">{{ phaseInfo.instruction }}</div>
      </div>

      <!-- Target Language Text - Fixed Height (Always Reserved) -->
      <div class="text-zone text-zone--target">
        <transition name="text-reveal" mode="out-in">
          <p v-if="showTargetText" class="target-text" :key="currentPhrase.target">
            {{ currentPhrase.target }}
          </p>
          <p v-else class="target-placeholder" key="placeholder">&nbsp;</p>
        </transition>
      </div>
    </main>

    <!-- Control Bar -->
    <div class="control-bar">
      <button
        class="mode-btn"
        :class="{ active: listeningMode }"
        @click="toggleListening"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>
      </button>

      <div class="transport-controls">
        <button class="transport-btn" @click="handleRevisit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </button>

        <button class="transport-btn" @click="handleSkip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/>
            <line x1="19" y1="5" x2="19" y2="19"/>
          </svg>
        </button>
      </div>

      <button
        class="mode-btn mode-btn--turbo"
        :class="{ active: turboActive }"
        @click="toggleTurbo"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      </button>
    </div>

    <!-- Footer -->
    <footer class="footer">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${sessionProgress * 100}%` }"></div>
      </div>
      <div class="footer-stats">
        <span>{{ itemsPracticed }} / {{ phrases.length }}</span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* ============================================
   SSi Learning Player - Zen Sanctuary Edition
   Refined minimalism, premium feel
   ============================================ */

@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

.player {
  --accent: #c23a3a;
  --accent-soft: rgba(194, 58, 58, 0.15);
  --accent-glow: rgba(194, 58, 58, 0.4);
  --gold: #d4a853;
  --gold-soft: rgba(212, 168, 83, 0.15);
  --success: #22c55e;

  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary);
  font-family: 'DM Sans', sans-serif;
  overflow: hidden;
}

/* Backgrounds */
.bg-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 50% at 50% -20%, var(--accent-soft) 0%, transparent 50%),
    radial-gradient(ellipse 60% 40% at 80% 100%, var(--gold-soft) 0%, transparent 40%);
  pointer-events: none;
  z-index: 0;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
  z-index: 0;
}

/* ============ HEADER ============ */
.header {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
}

.brand {
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 1.125rem;
  letter-spacing: -0.02em;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

.session-timer {
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  background: var(--bg-card);
  border-radius: 100px;
  border: 1px solid var(--border-subtle);
}

.timer-value {
  font-variant-numeric: tabular-nums;
}

.theme-toggle {
  width: 48px;
  height: 28px;
  padding: 0;
  border: none;
  background: var(--bg-card);
  border-radius: 100px;
  cursor: pointer;
  position: relative;
  border: 1px solid var(--border-subtle);
}

.toggle-track {
  width: 100%;
  height: 100%;
  position: relative;
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.toggle-thumb.light {
  transform: translateX(20px);
  background: var(--gold);
}

/* ============ MAIN - FIXED LAYOUT ============ */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 1rem 1.5rem;
  position: relative;
  z-index: 1;
  gap: 1.5rem;
}

/* 4-Phase Dots */
.phase-dots {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.5rem;
}

.phase-dot {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 2px solid var(--border-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.phase-dot svg {
  width: 16px;
  height: 16px;
  color: var(--text-muted);
  transition: all 0.3s ease;
}

.phase-dot.active {
  background: var(--accent);
  border-color: var(--accent);
  box-shadow: 0 0 20px var(--accent-glow);
}

.phase-dot.active svg {
  color: white;
}

.phase-dot.complete {
  background: var(--success);
  border-color: var(--success);
}

.phase-dot.complete svg {
  color: white;
}

/* Text Zones - FIXED HEIGHT */
.text-zone {
  width: 100%;
  max-width: 600px;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.text-zone--known {
  /* Known language styling */
}

.known-text {
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.3;
}

.text-zone--target {
  min-height: 80px; /* Always reserve space */
}

.target-text {
  font-size: clamp(1.25rem, 4vw, 1.75rem);
  font-weight: 600;
  color: var(--gold);
  line-height: 1.3;
}

.target-placeholder {
  height: 1.75rem; /* Match target text height */
  opacity: 0;
}

/* ============ RING - THE HERO ============ */
.ring-container {
  position: relative;
  width: 200px;
  height: 200px;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.ring-container:hover {
  transform: scale(1.02);
}

.ring-container:active {
  transform: scale(0.98);
}

.ring-ambient {
  position: absolute;
  inset: -40px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--accent-soft) 0%, transparent 70%);
  opacity: 0;
  transition: opacity 0.5s ease;
}

.ring-container.is-speak .ring-ambient {
  opacity: 1;
  animation: ambient-breathe 3s ease-in-out infinite;
}

@keyframes ambient-breathe {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.1); opacity: 1; }
}

.ring-svg {
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 4px 20px rgba(0,0,0,0.15));
}

.ring-track {
  stroke: var(--border-medium);
  opacity: 0.4;
}

.ring-progress {
  stroke: var(--accent);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.05s linear; /* Super smooth */
  filter: drop-shadow(0 0 8px var(--accent-glow));
}

.ring-inner {
  stroke: var(--border-subtle);
  opacity: 0.3;
}

.ring-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.ring-container.is-paused .ring-center {
  background: var(--accent);
  border-color: var(--accent);
}

.play-indicator {
  color: white;
}

.play-indicator svg {
  width: 40px;
  height: 40px;
  margin-left: 4px; /* Optical centering */
}

.phase-icon {
  color: var(--text-secondary);
  transition: all 0.3s ease;
}

.phase-icon svg {
  width: 36px;
  height: 36px;
}

.phase-icon.speak {
  color: var(--accent);
  animation: icon-pulse 1.5s ease-in-out infinite;
}

@keyframes icon-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.ring-label {
  position: absolute;
  bottom: -32px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  transition: opacity 0.3s ease;
}

.ring-container.is-paused .ring-label {
  opacity: 0.5;
}

/* ============ CONTROLS ============ */
.control-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 2rem;
  padding: 1rem 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
}

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
  transform: scale(1.05);
  border-color: var(--text-muted);
}

.mode-btn.active {
  background: rgba(74, 222, 128, 0.15);
  border-color: var(--success);
  color: var(--success);
  box-shadow: 0 0 16px rgba(74, 222, 128, 0.3);
}

.mode-btn--turbo.active {
  background: var(--gold-soft);
  border-color: var(--gold);
  color: var(--gold);
  box-shadow: 0 0 16px rgba(212, 168, 83, 0.4);
}

.transport-controls {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
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

/* ============ FOOTER ============ */
.footer {
  padding: 0 1.5rem 1.5rem;
  position: relative;
  z-index: 10;
}

.progress-bar {
  height: 3px;
  background: var(--bg-elevated);
  border-radius: 2px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent) 0%, var(--gold) 100%);
  border-radius: 2px;
  transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.footer-stats {
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: 'Space Mono', monospace;
}

/* ============ TRANSITIONS ============ */
.text-fade-enter-active,
.text-fade-leave-active {
  transition: all 0.3s ease;
}

.text-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.text-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.text-reveal-enter-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.text-reveal-leave-active {
  transition: all 0.2s ease;
}

.text-reveal-enter-from {
  opacity: 0;
  transform: scale(0.95);
}

.text-reveal-leave-to {
  opacity: 0;
}

/* ============ PAUSED STATE ============ */
.player.is-paused .ring-ambient {
  opacity: 0 !important;
}

/* ============ RESPONSIVE ============ */
@media (min-width: 768px) {
  .main {
    gap: 2rem;
  }

  .ring-container {
    width: 240px;
    height: 240px;
  }

  .ring-center {
    width: 140px;
    height: 140px;
  }

  .phase-icon svg {
    width: 44px;
    height: 44px;
  }

  .play-indicator svg {
    width: 48px;
    height: 48px;
  }

  .text-zone {
    min-height: 100px;
  }

  .known-text {
    font-size: 2.25rem;
  }

  .target-text {
    font-size: 1.875rem;
  }

  .phase-dots {
    gap: 1.5rem;
  }

  .phase-dot {
    width: 44px;
    height: 44px;
  }

  .phase-dot svg {
    width: 20px;
    height: 20px;
  }
}

@media (max-width: 480px) {
  .header {
    padding: 0.75rem 1rem;
  }

  .brand {
    font-size: 1rem;
  }

  .main {
    padding: 0.75rem 1rem;
    gap: 1rem;
  }

  .ring-container {
    width: 160px;
    height: 160px;
  }

  .ring-center {
    width: 100px;
    height: 100px;
  }

  .phase-icon svg {
    width: 28px;
    height: 28px;
  }

  .play-indicator svg {
    width: 32px;
    height: 32px;
  }

  .ring-label {
    font-size: 0.75rem;
    bottom: -28px;
  }

  .text-zone {
    min-height: 60px;
  }

  .phase-dots {
    gap: 0.75rem;
  }

  .phase-dot {
    width: 32px;
    height: 32px;
  }

  .phase-dot svg {
    width: 14px;
    height: 14px;
  }

  .control-bar {
    gap: 1rem;
    padding: 0.75rem 1rem 1rem;
  }

  .mode-btn {
    width: 42px;
    height: 42px;
  }

  .transport-btn {
    width: 38px;
    height: 38px;
  }
}
</style>
