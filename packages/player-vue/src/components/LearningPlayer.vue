<script setup>
import { ref, computed, onMounted, onUnmounted, watch, shallowRef } from 'vue'
import {
  CycleOrchestrator,
  AudioController,
  CyclePhase,
  DEFAULT_CONFIG,
} from '@ssi/core'
import SessionComplete from './SessionComplete.vue'

// ============================================
// DEMO DATA - Real Italian course audio from SSi
// Audio files bundled locally in /public/audio/
// ============================================

const AUDIO_BASE_URL = '/audio'

const createDemoItem = (id, known, target, audio) => ({
  lego: {
    id: `L${id}`,
    type: 'A',
    new: false,
    lego: { known, target },
    audioRefs: {
      known: { id: audio.source.id, url: `${AUDIO_BASE_URL}/${audio.source.id}.mp3` },
      target: {
        voice1: { id: audio.target1.id, url: `${AUDIO_BASE_URL}/${audio.target1.id}.mp3` },
        voice2: { id: audio.target2.id, url: `${AUDIO_BASE_URL}/${audio.target2.id}.mp3` },
      },
    },
  },
  phrase: {
    id: `P${id}`,
    phraseType: 'practice',
    phrase: { known, target },
    audioRefs: {
      known: { id: audio.source.id, url: `${AUDIO_BASE_URL}/${audio.source.id}.mp3` },
      target: {
        voice1: { id: audio.target1.id, url: `${AUDIO_BASE_URL}/${audio.target1.id}.mp3` },
        voice2: { id: audio.target2.id, url: `${AUDIO_BASE_URL}/${audio.target2.id}.mp3` },
      },
    },
    wordCount: target.split(' ').length,
    containsLegos: [`L${id}`],
  },
  seed: {
    seed_id: `S${id}`,
    seed_pair: { known, target },
    legos: [],
  },
  thread_id: 1,
  mode: 'practice',
  // Store durations for pause calculation
  audioDurations: {
    source: audio.source.duration,
    target1: audio.target1.duration,
    target2: audio.target2.duration,
  },
})

// Real Italian course demo items with audio UUIDs
const demoItems = [
  createDemoItem('001',
    'I want to speak Italian with you now.',
    'Voglio parlare italiano con te adesso.',
    {
      source: { id: '0B3EB395-78B0-36CD-8F4E-5836D47DDCC6', duration: 2.06 },
      target1: { id: '0E6545AE-78B0-AC07-8F4E-C266E5A3F142', duration: 2.48 },
      target2: { id: '0D53FF62-78B0-E115-8F4E-628B5399FA29', duration: 3.29 },
    }
  ),
  createDemoItem('002',
    'I speak Italian now.',
    'Parlo italiano adesso.',
    {
      source: { id: 'F1A4B92A-78B0-36CD-8F4E-D4F89A95F5C4', duration: 1.52 },
      target1: { id: 'EAF65674-78B0-AC07-8F4E-F3336C6EDDB8', duration: 2.46 },
      target2: { id: 'A4268ED0-78B0-E115-8F4E-681C8EF03175', duration: 2.27 },
    }
  ),
  createDemoItem('003',
    'If I speak Italian now.',
    'Se parlo italiano adesso.',
    {
      source: { id: '609DBB08-78B0-36CD-8F4E-16C1CB6F920A', duration: 1.65 },
      target1: { id: '7A4A5844-78B0-AC07-8F4E-79803B6E0188', duration: 2.53 },
      target2: { id: '29298269-78B0-E115-8F4E-8E7985F16946', duration: 2.38 },
    }
  ),
  createDemoItem('004',
    "I'd like to be able to speak Italian.",
    'Vorrei potere parlare italiano.',
    {
      source: { id: 'AFF9FCD7-78B0-36CD-8F4E-5644712602D5', duration: 2.19 },
      target1: { id: 'F8FD1CC8-78B0-AC07-8F4E-2C0059DFAB65', duration: 2.69 },
      target2: { id: 'E645EAB0-78B0-E115-8F4E-B6BDBF413689', duration: 2.32 },
    }
  ),
  createDemoItem('005',
    'You speak Italian very well.',
    'Parli italiano molto bene.',
    {
      source: { id: 'E28D5521-78B0-36CD-8F4E-1194C85BC7A0', duration: 1.78 },
      target1: { id: 'B91B1D58-78B0-AC07-8F4E-4A953003E5D0', duration: 2.66 },
      target2: { id: '1A6B10E7-78B0-E115-8F4E-BE8F3310BC8B', duration: 2.38 },
    }
  ),
]

// ============================================
// BELT PROGRESSION SYSTEM
// Parametrized martial arts progression
// ============================================

const BELT_CONFIG = {
  totalSeeds: 668,

  // Belt thresholds - seeds required to ACHIEVE each belt
  // Early belts come quickly for motivation
  belts: [
    { name: 'white',   seedsRequired: 0,   color: '#f5f5f5', colorDark: '#e0e0e0', glow: 'rgba(245, 245, 245, 0.3)' },
    { name: 'yellow',  seedsRequired: 8,   color: '#fcd34d', colorDark: '#f59e0b', glow: 'rgba(252, 211, 77, 0.4)' },
    { name: 'orange',  seedsRequired: 20,  color: '#fb923c', colorDark: '#ea580c', glow: 'rgba(251, 146, 60, 0.4)' },
    { name: 'green',   seedsRequired: 40,  color: '#4ade80', colorDark: '#16a34a', glow: 'rgba(74, 222, 128, 0.4)' },
    { name: 'blue',    seedsRequired: 80,  color: '#60a5fa', colorDark: '#2563eb', glow: 'rgba(96, 165, 250, 0.4)' },
    { name: 'purple',  seedsRequired: 150, color: '#a78bfa', colorDark: '#7c3aed', glow: 'rgba(167, 139, 250, 0.4)' },
    { name: 'brown',   seedsRequired: 280, color: '#a8856c', colorDark: '#78350f', glow: 'rgba(168, 133, 108, 0.4)' },
    { name: 'black',   seedsRequired: 400, color: '#1f1f1f', colorDark: '#0a0a0a', glow: 'rgba(255, 255, 255, 0.15)' },
  ]
}

// Simulated completed seeds (in real app, this comes from user state)
const completedSeeds = ref(42) // Demo: Green belt territory

// Belt computations
const currentBelt = computed(() => {
  const belts = BELT_CONFIG.belts
  for (let i = belts.length - 1; i >= 0; i--) {
    if (completedSeeds.value >= belts[i].seedsRequired) {
      return { ...belts[i], index: i }
    }
  }
  return { ...belts[0], index: 0 }
})

const nextBelt = computed(() => {
  const nextIndex = currentBelt.value.index + 1
  if (nextIndex >= BELT_CONFIG.belts.length) return null
  return BELT_CONFIG.belts[nextIndex]
})

const beltProgress = computed(() => {
  if (!nextBelt.value) return 100 // Already at black belt
  const current = currentBelt.value.seedsRequired
  const next = nextBelt.value.seedsRequired
  const progress = (completedSeeds.value - current) / (next - current)
  return Math.min(Math.max(progress * 100, 0), 100)
})

// CSS custom properties for belt theming
const beltCssVars = computed(() => ({
  '--belt-color': currentBelt.value.color,
  '--belt-color-dark': currentBelt.value.colorDark,
  '--belt-glow': currentBelt.value.glow,
}))

// ============================================
// CORE ENGINE INTEGRATION
// Using @ssi/core CycleOrchestrator
// ============================================

// Create mock audio controller (no actual audio for now)
const audioController = shallowRef(null)
const orchestrator = shallowRef(null)

// Map core CyclePhase to UI phases (for backward compatibility)
const Phase = {
  PROMPT: 'prompt',      // Maps to CyclePhase.PROMPT
  SPEAK: 'speak',        // Maps to CyclePhase.PAUSE
  VOICE_1: 'voice_1',    // Maps to CyclePhase.VOICE_1
  VOICE_2: 'voice_2',    // Maps to CyclePhase.VOICE_2
}

// Map core phases to UI phases
const corePhaseToUiPhase = (corePhase) => {
  switch (corePhase) {
    case CyclePhase.PROMPT: return Phase.PROMPT
    case CyclePhase.PAUSE: return Phase.SPEAK
    case CyclePhase.VOICE_1: return Phase.VOICE_1
    case CyclePhase.VOICE_2: return Phase.VOICE_2
    case CyclePhase.IDLE: return Phase.PROMPT
    case CyclePhase.TRANSITION: return Phase.VOICE_2
    default: return Phase.PROMPT
  }
}

// State
const theme = ref('dark')
const currentPhase = ref(Phase.PROMPT)
const currentItemIndex = ref(0)
const isPlaying = ref(false) // Start paused until engine ready
const itemsPracticed = ref(0)
const showSessionComplete = ref(false)

// Smooth ring progress (0-100) - continuous animation
const ringProgressRaw = ref(0)
let ringAnimationFrame = null
let pauseStartTime = 0
let pauseDuration = DEFAULT_CONFIG.cycle.pause_duration_ms

// Session timer
const sessionSeconds = ref(0)
let sessionTimerInterval = null

const formattedSessionTime = computed(() => {
  const mins = Math.floor(sessionSeconds.value / 60)
  const secs = sessionSeconds.value % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
})

// Computed
const currentItem = computed(() => demoItems[currentItemIndex.value])
const currentPhrase = computed(() => ({
  known: currentItem.value?.phrase.phrase.known || '',
  target: currentItem.value?.phrase.phrase.target || '',
}))
const sessionProgress = computed(() => (itemsPracticed.value + 1) / demoItems.length)
const showTargetText = computed(() => currentPhase.value === Phase.VOICE_2)

// Phase symbols/icons - CORRECT ORDER
const phaseInfo = computed(() => {
  switch (currentPhase.value) {
    case Phase.PROMPT:
      return { icon: 'speaker', label: 'Listen', instruction: 'Hear the phrase' }
    case Phase.SPEAK:
      return { icon: 'mic', label: 'Speak', instruction: 'Say it in the target language' }
    case Phase.VOICE_1:
      return { icon: 'ear', label: 'Listen', instruction: 'Listen to the answer' }
    case Phase.VOICE_2:
      return { icon: 'eye', label: 'Read', instruction: 'See and hear the answer' }
    default:
      return { icon: 'speaker', label: '', instruction: '' }
  }
})

// Ring progress for SPEAK phase only (0-100)
const ringProgress = computed(() => {
  if (currentPhase.value !== Phase.SPEAK) return 0
  return ringProgressRaw.value
})

// Smooth ring animation using requestAnimationFrame
const animateRing = () => {
  if (!isPlaying.value || currentPhase.value !== Phase.SPEAK) {
    ringAnimationFrame = null
    return
  }

  const elapsed = Date.now() - pauseStartTime
  const progress = Math.min((elapsed / pauseDuration) * 100, 100)

  ringProgressRaw.value = progress

  if (progress < 100) {
    ringAnimationFrame = requestAnimationFrame(animateRing)
  }
}

const startRingAnimation = (duration) => {
  pauseStartTime = Date.now()
  pauseDuration = duration || DEFAULT_CONFIG.cycle.pause_duration_ms
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

// ============================================
// REAL AUDIO CONTROLLER
// Plays actual MP3 audio from S3
// ============================================

class RealAudioController {
  constructor() {
    this.endedCallbacks = new Set()
    this.audio = null  // Single reusable Audio element for mobile compatibility
    this.currentCleanup = null
    this.preloadedUrls = new Set()
  }

  async play(audioRef) {
    // Stop any currently playing audio and cleanup handlers
    this.stop()

    const url = audioRef?.url
    if (!url) {
      console.warn('[AudioController] No URL in audioRef:', audioRef)
      this._notifyEnded()
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      // Reuse or create Audio element - reusing helps with mobile autoplay
      if (!this.audio) {
        this.audio = new Audio()
      }

      const onEnded = () => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.currentCleanup = null
        this._notifyEnded()
        resolve()
      }

      const onError = (e) => {
        console.error('[AudioController] Error playing:', url, e)
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
        this.currentCleanup = null
        // On error, still notify so cycle can continue
        this._notifyEnded()
        resolve()
      }

      // Remove any stale listeners first
      this.audio.removeEventListener('ended', this._lastEndedHandler)
      this.audio.removeEventListener('error', this._lastErrorHandler)

      // Track handlers for cleanup
      this._lastEndedHandler = onEnded
      this._lastErrorHandler = onError

      this.audio.addEventListener('ended', onEnded)
      this.audio.addEventListener('error', onError)

      // Store cleanup
      this.currentCleanup = () => {
        this.audio?.removeEventListener('ended', onEnded)
        this.audio?.removeEventListener('error', onError)
      }

      // Set source and play
      this.audio.src = url
      this.audio.load()

      const playPromise = this.audio.play()
      if (playPromise) {
        playPromise.catch((e) => {
          // NotAllowedError means autoplay blocked - this is expected on mobile
          if (e.name === 'NotAllowedError') {
            console.warn('[AudioController] Autoplay blocked, waiting for audio to be ready')
            // Don't trigger error handler, just wait - user needs to interact
            // For now, advance anyway to keep cycle moving
            onError(e)
          } else {
            onError(e)
          }
        })
      }
    })
  }

  _notifyEnded() {
    // Snapshot callbacks to avoid issues if callbacks modify the Set
    const callbacks = [...this.endedCallbacks]
    for (const cb of callbacks) {
      try { cb() } catch (e) { console.error(e) }
    }
  }

  stop() {
    if (this.currentCleanup) {
      this.currentCleanup()
      this.currentCleanup = null
    }
    if (this.audio) {
      this.audio.pause()
      this.audio.currentTime = 0
      // Don't null the audio element - reuse it for mobile compatibility
    }
  }

  async preload(audioRef) {
    const url = audioRef?.url
    if (!url || this.preloadedUrls.has(url)) return

    // Create a temporary Audio element just to trigger browser caching
    const audio = new Audio()
    audio.preload = 'auto'
    audio.src = url
    audio.load()
    this.preloadedUrls.add(url)
  }

  isPreloaded(audioRef) {
    return this.preloadedUrls.has(audioRef?.url)
  }

  isPlaying() {
    return this.audio && !this.audio.paused
  }

  getCurrentTime() {
    return this.audio?.currentTime || 0
  }

  onEnded(cb) { this.endedCallbacks.add(cb) }
  offEnded(cb) { this.endedCallbacks.delete(cb) }
}

// ============================================
// ENGINE EVENT HANDLING
// ============================================

const handleCycleEvent = (event) => {
  console.log('[CycleEvent]', event.type, event.phase, event.data)

  switch (event.type) {
    case 'phase_changed':
      currentPhase.value = corePhaseToUiPhase(event.phase)
      break

    case 'pause_started':
      // Start the ring animation for the SPEAK phase
      startRingAnimation(event.data?.duration)
      break

    case 'item_completed':
      itemsPracticed.value++
      // Move to next item
      currentItemIndex.value = (currentItemIndex.value + 1) % demoItems.length
      const nextItem = demoItems[currentItemIndex.value]

      // Update pause duration for next item (2x target audio length)
      // Unless turbo mode is active
      if (!turboActive.value && nextItem.audioDurations) {
        const pauseMs = Math.round(nextItem.audioDurations.target1 * 2 * 1000)
        orchestrator.value?.updateConfig({ pause_duration_ms: pauseMs })
      }

      setTimeout(() => {
        if (isPlaying.value && orchestrator.value) {
          orchestrator.value.startItem(nextItem)
        }
      }, 300)
      break

    case 'cycle_stopped':
      isPlaying.value = false
      break

    case 'error':
      console.error('[CycleOrchestrator Error]', event.data?.error)
      break
  }
}

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
  if (orchestrator.value) {
    orchestrator.value.stop()
  }
  if (ringAnimationFrame) {
    cancelAnimationFrame(ringAnimationFrame)
  }
}

const handleResume = () => {
  isPlaying.value = true
  if (orchestrator.value && currentItem.value) {
    // Set pause duration for current item (2x target audio length)
    if (!turboActive.value && currentItem.value.audioDurations) {
      const pauseMs = Math.round(currentItem.value.audioDurations.target1 * 2 * 1000)
      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
    }
    orchestrator.value.startItem(currentItem.value)
  }
}

const handleSkip = () => {
  if (orchestrator.value) {
    orchestrator.value.skipPhase()
  }
}

const handleRevisit = () => {
  // Restart current item from beginning
  ringProgressRaw.value = 0
  if (orchestrator.value && currentItem.value) {
    orchestrator.value.startItem(currentItem.value)
  }
}

// Mode toggles
const turboActive = ref(false)
const listeningMode = ref(false)

const toggleTurbo = () => {
  turboActive.value = !turboActive.value
  // Update orchestrator config for faster timings
  if (orchestrator.value) {
    if (turboActive.value) {
      // Turbo mode: fixed 2s pause
      orchestrator.value.updateConfig({ pause_duration_ms: 2000 })
    } else {
      // Normal mode: 2x target audio duration
      const item = currentItem.value
      const pauseMs = item?.audioDurations
        ? Math.round(item.audioDurations.target1 * 2 * 1000)
        : 5000 // Fallback
      orchestrator.value.updateConfig({ pause_duration_ms: pauseMs })
    }
  }
}

const toggleListening = () => listeningMode.value = !listeningMode.value

// ============================================
// PAUSE/RESUME HANDLERS
// ============================================

const showPausedSummary = () => {
  // Stop playback and show summary
  if (orchestrator.value) {
    orchestrator.value.stop()
  }
  isPlaying.value = false
  showSessionComplete.value = true
}

const handleResumeLearning = () => {
  // Hide summary and continue the infinite stream
  showSessionComplete.value = false
  isPlaying.value = true
  if (orchestrator.value && currentItem.value) {
    orchestrator.value.startItem(currentItem.value)
  }
}

// ============================================
// LIFECYCLE
// ============================================

onMounted(() => {
  // Initialize theme
  const savedTheme = localStorage.getItem('ssi-theme') || 'dark'
  theme.value = savedTheme
  document.documentElement.setAttribute('data-theme', savedTheme)

  // Create real audio controller for S3 audio playback
  audioController.value = new RealAudioController()

  // Calculate default pause duration from first item (2x target audio)
  const defaultPauseDuration = Math.round(demoItems[0].audioDurations.target1 * 2 * 1000)

  // Create CycleOrchestrator with dynamic pause duration
  const demoConfig = {
    ...DEFAULT_CONFIG.cycle,
    pause_duration_ms: defaultPauseDuration,  // 2x target audio length
    transition_gap_ms: 300,   // Shorter gap between phases
  }
  orchestrator.value = new CycleOrchestrator(
    audioController.value,
    demoConfig
  )

  // Subscribe to events
  orchestrator.value.addEventListener(handleCycleEvent)

  // Preload first few items
  for (const item of demoItems.slice(0, 3)) {
    audioController.value.preload(item.phrase.audioRefs.known)
    audioController.value.preload(item.phrase.audioRefs.target.voice1)
    audioController.value.preload(item.phrase.audioRefs.target.voice2)
  }

  // Start session timer
  sessionTimerInterval = setInterval(() => {
    if (isPlaying.value) sessionSeconds.value++
  }, 1000)

  // Don't auto-start - wait for user to click play
  // This also respects browser autoplay policies
  isPlaying.value = false
})

onUnmounted(() => {
  if (orchestrator.value) {
    orchestrator.value.removeEventListener(handleCycleEvent)
    orchestrator.value.stop()
  }
  if (ringAnimationFrame) cancelAnimationFrame(ringAnimationFrame)
  if (sessionTimerInterval) clearInterval(sessionTimerInterval)
})
</script>

<template>
  <!-- Paused Summary Overlay -->
  <Transition name="session-complete">
    <SessionComplete
      v-if="showSessionComplete"
      :items-practiced="itemsPracticed"
      :time-spent-seconds="sessionSeconds"
      :current-belt="currentBelt"
      :belt-progress="beltProgress"
      :completed-seeds="completedSeeds"
      :next-belt="nextBelt"
      @resume="handleResumeLearning"
    />
  </Transition>

  <div
    class="player"
    :class="[`belt-${currentBelt.name}`, { 'is-paused': !isPlaying }]"
    :style="beltCssVars"
    v-show="!showSessionComplete"
  >
    <!-- Moonlit Dojo Background Layers -->
    <div class="bg-gradient"></div>
    <div class="bg-belt-wash"></div>
    <div class="bg-noise"></div>

    <!-- Silhouette Landscape - Extended Height -->
    <div class="landscape">
      <svg class="landscape-svg" viewBox="0 0 1440 400" preserveAspectRatio="xMidYMax slice">
        <!-- Very distant peaks (barely visible) -->
        <path class="mountain mountain--distant" d="M0,400 L0,120 Q180,60 360,100 Q540,30 720,80 Q900,20 1080,70 Q1260,10 1440,60 L1440,400 Z"/>
        <!-- Distant mountains -->
        <path class="mountain mountain--far" d="M0,400 L0,180 Q120,140 240,160 Q360,100 480,140 Q600,80 720,120 Q840,60 960,110 Q1080,50 1200,90 Q1320,40 1440,80 L1440,400 Z"/>
        <!-- Mid mountains -->
        <path class="mountain mountain--mid" d="M0,400 L0,260 Q180,210 360,240 Q540,180 720,220 Q900,160 1080,200 Q1260,140 1440,180 L1440,400 Z"/>
        <!-- Near hills (darkest) -->
        <path class="mountain mountain--near" d="M0,400 L0,320 Q240,290 480,310 Q720,280 960,300 Q1200,270 1440,300 L1440,400 Z"/>
        <!-- Torii gate silhouette -->
        <g class="torii" transform="translate(1180, 260)">
          <rect x="0" y="0" width="5" height="50"/>
          <rect x="40" y="0" width="5" height="50"/>
          <rect x="-6" y="0" width="57" height="5"/>
          <rect x="-2" y="9" width="49" height="3"/>
          <path d="M-10,-6 Q22,-16 54,-6" stroke-width="5" fill="none" stroke="currentColor"/>
        </g>
        <!-- Ninja silhouette - walking the path -->
        <g class="ninja-figure" transform="translate(280, 295)">
          <circle cx="10" cy="3" r="3.5"/>
          <path d="M10,7 L10,18 M10,10 L3,16 M10,10 L17,14 M10,18 L5,28 M10,18 L15,27"/>
          <path d="M6,-1 L14,-1 L18,-4" stroke-width="1" fill="none"/>
        </g>
      </svg>
    </div>

    <!-- Dust motes / fireflies - barely visible, slowly rising -->
    <div class="dust-motes">
      <div class="mote mote-1"></div>
      <div class="mote mote-2"></div>
      <div class="mote mote-3"></div>
      <div class="mote mote-4"></div>
      <div class="mote mote-5"></div>
      <div class="mote mote-6"></div>
      <div class="mote mote-7"></div>
      <div class="mote mote-8"></div>
    </div>

    <!-- Floating mist particles -->
    <div class="mist-container">
      <div class="mist-particle mist-1"></div>
      <div class="mist-particle mist-2"></div>
      <div class="mist-particle mist-3"></div>
      <div class="mist-particle mist-4"></div>
    </div>

    <!-- Header -->
    <header class="header">
      <div class="brand">
        <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
      </div>

      <!-- Belt Indicator - Zen Style -->
      <div class="belt-indicator">
        <div class="belt-knot">
          <svg viewBox="0 0 32 16" class="belt-svg">
            <!-- Belt fabric -->
            <rect x="0" y="5" width="32" height="6" rx="1" class="belt-fabric"/>
            <!-- Knot center -->
            <circle cx="16" cy="8" r="4" class="belt-knot-center"/>
            <!-- Belt tails -->
            <path d="M12 8 L8 14 L6 14" class="belt-tail" />
            <path d="M20 8 L24 14 L26 14" class="belt-tail" />
          </svg>
        </div>
        <div class="belt-progress-ring">
          <svg viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" class="belt-progress-track" />
            <circle
              cx="18" cy="18" r="15"
              class="belt-progress-fill"
              :stroke-dasharray="94.25"
              :stroke-dashoffset="94.25 - (beltProgress / 100) * 94.25"
              transform="rotate(-90 18 18)"
            />
          </svg>
          <span class="belt-seed-count">{{ completedSeeds }}</span>
        </div>
      </div>

      <div class="header-right">
        <button class="session-timer" @click="showPausedSummary" title="Pause &amp; Summary">
          <span class="timer-value">{{ formattedSessionTime }}</span>
          <svg class="timer-end-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12" rx="1"/>
          </svg>
        </button>

        <button class="theme-toggle" @click="toggleTheme">
          <div class="toggle-track">
            <div class="toggle-thumb" :class="{ light: theme === 'light' }"></div>
          </div>
        </button>
      </div>
    </header>

    <!-- Main Content - Fixed Layout -->
    <main class="main">
      <!-- 4-Phase Indicator: Speaker → Mic → Ear → Eye -->
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
          <!-- Phase 1: Speaker (playing audio) -->
          <svg v-if="idx === 0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
          <!-- Phase 2: Mic (learner speaking) -->
          <svg v-else-if="idx === 1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <!-- Phase 3: Ear (listening to answer) -->
          <svg v-else-if="idx === 2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10.5"/>
            <circle cx="12" cy="22" r="1" fill="currentColor"/>
          </svg>
          <!-- Phase 4: Eye (see and hear) -->
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
            <!-- Speaker (Phase 1: Hear prompt) -->
            <svg v-if="phaseInfo.icon === 'speaker'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
            <!-- Mic (Phase 2: Learner speaks) -->
            <svg v-else-if="phaseInfo.icon === 'mic'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <!-- Ear (Phase 3: Listen to answer) -->
            <svg v-else-if="phaseInfo.icon === 'ear'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10.5"/>
              <circle cx="12" cy="22" r="1" fill="currentColor"/>
            </svg>
            <!-- Eye (Phase 4: See and hear) -->
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
        title="Listening Mode"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
          <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
        </svg>
      </button>

      <div class="transport-controls">
        <button class="transport-btn" @click="handleRevisit" title="Revisit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
          </svg>
        </button>

        <!-- Main Play/Stop Button -->
        <button
          class="transport-btn transport-btn--main"
          @click="isPlaying ? handlePause() : handleResume()"
          :title="isPlaying ? 'Stop' : 'Play'"
        >
          <svg v-if="isPlaying" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
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

    <!-- Footer -->
    <footer class="footer">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${sessionProgress * 100}%` }"></div>
      </div>
      <div class="footer-stats">
        <span>{{ itemsPracticed }} / {{ demoItems.length }}</span>
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

/* Belt color wash - REMOVED for Schindler's List restraint */
.bg-belt-wash {
  display: none;
}

.bg-noise {
  position: fixed;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
  z-index: 0;
}

/* ============ MOONLIT LANDSCAPE ============ */
.landscape {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50vh;
  max-height: 400px;
  pointer-events: none;
  z-index: 1;
  opacity: var(--mountain-opacity, 1);
  transition: opacity 0.5s ease;
}

.landscape-svg {
  width: 100%;
  height: 100%;
}

.mountain {
  transition: fill 0.5s ease;
}

.mountain--distant {
  fill: rgba(255, 255, 255, 0.015);
}

.mountain--far {
  fill: rgba(255, 255, 255, 0.03);
}

.mountain--mid {
  fill: rgba(255, 255, 255, 0.05);
}

.mountain--near {
  fill: rgba(255, 255, 255, 0.08);
}

/* Belt-colored accent on mountain ridges - the "Schindler's flower" */
.mountain--mid {
  filter: drop-shadow(0 -1px 3px var(--belt-glow));
}

.mountain--near {
  filter: drop-shadow(0 -2px 6px var(--belt-glow));
}

/* Black belt = pure zen, no color accents */
.belt-black .mountain--mid,
.belt-black .mountain--near {
  filter: none;
}

.torii {
  fill: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.06);
}

.ninja-figure {
  fill: rgba(255, 255, 255, 0.1);
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Light theme landscape */
[data-theme="light"] .mountain--distant {
  fill: rgba(0, 0, 0, 0.02);
}

[data-theme="light"] .mountain--far {
  fill: rgba(0, 0, 0, 0.04);
}

[data-theme="light"] .mountain--mid {
  fill: rgba(0, 0, 0, 0.07);
}

[data-theme="light"] .mountain--near {
  fill: rgba(0, 0, 0, 0.12);
}

[data-theme="light"] .torii {
  fill: rgba(0, 0, 0, 0.08);
  color: rgba(0, 0, 0, 0.08);
}

[data-theme="light"] .ninja-figure {
  fill: rgba(0, 0, 0, 0.15);
  stroke: rgba(0, 0, 0, 0.15);
}

/* ============ FLOATING MIST ============ */
.mist-container {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
}

.mist-particle {
  position: absolute;
  width: 300px;
  height: 100px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(255,255,255,0.04) 0%, transparent 70%);
  filter: blur(30px);
  animation: mist-drift 30s ease-in-out infinite;
}

.mist-1 {
  top: 60%;
  left: -10%;
  animation-delay: 0s;
  animation-duration: 35s;
}

.mist-2 {
  top: 70%;
  left: 30%;
  animation-delay: -8s;
  animation-duration: 40s;
  width: 400px;
  opacity: 0.7;
}

.mist-3 {
  top: 55%;
  left: 60%;
  animation-delay: -15s;
  animation-duration: 32s;
  width: 250px;
}

.mist-4 {
  top: 75%;
  left: 80%;
  animation-delay: -22s;
  animation-duration: 38s;
  width: 350px;
  opacity: 0.5;
}

@keyframes mist-drift {
  0%, 100% {
    transform: translateX(0) translateY(0) scale(1);
    opacity: 0.4;
  }
  25% {
    transform: translateX(50px) translateY(-20px) scale(1.1);
    opacity: 0.6;
  }
  50% {
    transform: translateX(100px) translateY(10px) scale(1);
    opacity: 0.3;
  }
  75% {
    transform: translateX(30px) translateY(-10px) scale(1.05);
    opacity: 0.5;
  }
}

[data-theme="light"] .mist-particle {
  background: radial-gradient(ellipse, rgba(0,0,0,0.02) 0%, transparent 70%);
}

/* ============ DUST MOTES / FIREFLIES ============ */
.dust-motes {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  overflow: hidden;
}

.mote {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  /* Belt-colored fireflies - bioluminescent glow */
  background: var(--belt-color);
  box-shadow: 0 0 8px var(--belt-glow), 0 0 16px var(--belt-glow);
  animation: mote-rise 20s ease-in-out infinite;
  transition: background 0.5s ease, box-shadow 0.5s ease;
}

/* Black belt = subtle white fireflies, pure zen */
.belt-black .mote {
  background: rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.2);
}

/* Distribute motes across the scene */
.mote-1 { left: 10%; bottom: 20%; animation-delay: 0s; animation-duration: 22s; }
.mote-2 { left: 25%; bottom: 35%; animation-delay: -4s; animation-duration: 18s; }
.mote-3 { left: 40%; bottom: 15%; animation-delay: -8s; animation-duration: 25s; }
.mote-4 { left: 55%; bottom: 28%; animation-delay: -12s; animation-duration: 20s; }
.mote-5 { left: 70%; bottom: 22%; animation-delay: -3s; animation-duration: 24s; }
.mote-6 { left: 85%; bottom: 32%; animation-delay: -16s; animation-duration: 19s; }
.mote-7 { left: 15%; bottom: 40%; animation-delay: -7s; animation-duration: 23s; opacity: 0.6; }
.mote-8 { left: 60%; bottom: 45%; animation-delay: -11s; animation-duration: 21s; opacity: 0.5; }

@keyframes mote-rise {
  0% {
    transform: translateY(0) translateX(0) scale(1);
    opacity: 0;
  }
  10% {
    opacity: 0.6;
  }
  50% {
    transform: translateY(-100px) translateX(15px) scale(0.8);
    opacity: 0.4;
  }
  90% {
    opacity: 0.2;
  }
  100% {
    transform: translateY(-200px) translateX(-10px) scale(0.5);
    opacity: 0;
  }
}

/* Light theme motes - still use belt colors but slightly more visible */
[data-theme="light"] .mote {
  background: var(--belt-color);
  box-shadow: 0 0 6px var(--belt-glow), 0 0 12px var(--belt-glow);
  opacity: 0.7;
}

/* Light theme black belt - subtle grey motes */
[data-theme="light"] .belt-black .mote {
  background: rgba(0, 0, 0, 0.2);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.1);
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
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  color: var(--text-secondary);
  padding: 0.5rem 1rem;
  background: var(--bg-card);
  border-radius: 100px;
  border: 1px solid var(--border-subtle);
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-timer:hover {
  background: var(--bg-elevated);
  border-color: var(--accent);
  color: var(--text-primary);
}

.session-timer:hover .timer-end-icon {
  opacity: 1;
  color: var(--accent);
}

.timer-end-icon {
  width: 14px;
  height: 14px;
  opacity: 0.5;
  transition: all 0.2s ease;
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

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* ============ BELT INDICATOR ============ */
.belt-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0.75rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 100px;
  transition: all 0.3s ease;
}

.belt-knot {
  width: 32px;
  height: 16px;
}

.belt-svg {
  width: 100%;
  height: 100%;
}

.belt-fabric {
  fill: var(--belt-color);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2));
  transition: fill 0.5s ease;
}

.belt-knot-center {
  fill: var(--belt-color-dark);
  transition: fill 0.5s ease;
}

.belt-tail {
  stroke: var(--belt-color);
  stroke-width: 2;
  stroke-linecap: round;
  fill: none;
  transition: stroke 0.5s ease;
}

/* Special styling for black belt - gold accents */
.belt-black .belt-knot-center {
  fill: #d4a853;
}

.belt-progress-ring {
  position: relative;
  width: 36px;
  height: 36px;
}

.belt-progress-ring svg {
  width: 100%;
  height: 100%;
}

.belt-progress-track {
  fill: none;
  stroke: var(--border-medium);
  stroke-width: 3;
}

.belt-progress-fill {
  fill: none;
  stroke: var(--belt-color);
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.5s ease;
  filter: drop-shadow(0 0 4px var(--belt-glow));
}

.belt-seed-count {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Space Mono', monospace;
  font-size: 0.625rem;
  font-weight: 700;
  color: var(--text-secondary);
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
  z-index: 10;
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

/* Moonlight glow - always subtly present */
.ring-container::before {
  content: '';
  position: absolute;
  inset: -60px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 60%);
  animation: moonlight-pulse 8s ease-in-out infinite;
  pointer-events: none;
}

@keyframes moonlight-pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.05); }
}

[data-theme="light"] .ring-container::before {
  background: radial-gradient(circle, rgba(212, 168, 83, 0.1) 0%, transparent 60%);
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

/* Main Play/Stop Button - Prominent */
.transport-btn--main {
  width: 56px;
  height: 56px;
  background: var(--accent);
  color: white;
  border-radius: 50%;
  box-shadow: 0 4px 16px var(--accent-glow);
  transition: all 0.2s ease;
}

.transport-btn--main svg {
  width: 22px;
  height: 22px;
}

.transport-btn--main:hover {
  background: var(--accent);
  color: white;
  transform: scale(1.1);
  box-shadow: 0 6px 24px var(--accent-glow);
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
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .brand {
    font-size: 1rem;
  }

  .belt-indicator {
    order: 3;
    width: 100%;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    margin-top: 0.25rem;
  }

  .header-right {
    gap: 0.5rem;
  }

  .session-timer {
    padding: 0.375rem 0.75rem;
    font-size: 0.75rem;
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

  .transport-btn--main {
    width: 48px;
    height: 48px;
  }

  .transport-btn--main svg {
    width: 18px;
    height: 18px;
  }
}

/* ============ SESSION COMPLETE TRANSITION ============ */
.session-complete-enter-active {
  animation: session-complete-in 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.session-complete-leave-active {
  animation: session-complete-out 0.3s ease-in;
}

@keyframes session-complete-in {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes session-complete-out {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(1.05);
  }
}
</style>
