<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { SPANISH_PODS, SCAFFOLDING_STAGES } from '../data/listeningPods'

// ============================================================================
// Listening Pod Player — 7-Stage Scaffolding
//
// Each sentence goes through 7 stages with decreasing support:
// Stage 1: Slow → Translation → Slow → Fast  (x3)
// Stage 2: Slow → Translation → Fast          (x3)
// Stage 3: Slow → Translation → Fast → Fast   (x3)
// Stage 4: Fast → Translation → Fast           (x3)
// Stage 5: Slow → Fast                         (x3)
// Stage 6: Fast → Fast                         (x3)
// Stage 7: Fast                                (x1)
//
// Slow = 0.8x, Fast = 1.6x
// Uses Web Speech API for TTS until real audio is generated
// ============================================================================

const emit = defineEmits(['close'])

// ============================================================================
// State
// ============================================================================

const selectedPodIndex = ref(-1) // -1 = pod list view
const isPlaying = ref(false)
const isPaused = ref(false)

// Current playback position within a pod
const currentSentenceIndex = ref(0)
const currentStageIndex = ref(0)
const currentRepeat = ref(0)
const currentStepIndex = ref(0)

// Audio
let speechSynth = null
let currentUtterance = null
let playbackCancelled = false

// ============================================================================
// Computed
// ============================================================================

const pods = computed(() => SPANISH_PODS.pods)
const selectedPod = computed(() => selectedPodIndex.value >= 0 ? pods.value[selectedPodIndex.value] : null)
const currentSentence = computed(() => {
  if (!selectedPod.value) return null
  return selectedPod.value.sentences[currentSentenceIndex.value] || null
})
const currentStage = computed(() => SCAFFOLDING_STAGES[currentStageIndex.value])
const currentStep = computed(() => currentStage.value?.steps[currentStepIndex.value] || null)

const totalSentences = computed(() => selectedPod.value?.sentences.length || 0)

// Overall progress: how far through the pod
const podProgress = computed(() => {
  if (!selectedPod.value) return 0
  const totalStages = 7
  const sentencesDone = currentSentenceIndex.value
  const stageProgress = currentStageIndex.value / totalStages
  return Math.round(((sentencesDone + stageProgress) / totalSentences.value) * 100)
})

// Stage progress label
const stageLabel = computed(() => {
  if (!currentStage.value) return ''
  const stage = currentStageIndex.value + 1
  const repeat = currentRepeat.value + 1
  const maxRepeats = currentStage.value.repeats
  return `Stage ${stage}/7 — Rep ${repeat}/${maxRepeats}`
})

// What's currently being played
const nowPlayingLabel = computed(() => {
  if (!currentStep.value) return ''
  if (currentStep.value.type === 'translation') return 'Translation'
  return currentStep.value.speed === 0.8 ? 'Slow (0.8x)' : 'Fast (1.6x)'
})

// Difficulty badge color
const difficultyColor = (difficulty) => {
  switch (difficulty) {
    case 'beginner': return '#4ade80'
    case 'beginner-intermediate': return '#facc15'
    case 'intermediate': return '#f97316'
    default: return '#94a3b8'
  }
}

// ============================================================================
// TTS Playback (temporary until real audio is generated)
// ============================================================================

const getSpanishVoice = () => {
  if (!speechSynth) return null
  const voices = speechSynth.getVoices()
  return voices.find(v => v.lang.startsWith('es')) || null
}

const getEnglishVoice = () => {
  if (!speechSynth) return null
  const voices = speechSynth.getVoices()
  return voices.find(v => v.lang.startsWith('en')) || null
}

const speak = (text, lang, rate = 1) => {
  return new Promise((resolve, reject) => {
    if (playbackCancelled) { resolve(); return }
    if (!speechSynth) { resolve(); return }

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = rate

    const voice = lang === 'es' ? getSpanishVoice() : getEnglishVoice()
    if (voice) utterance.voice = voice

    utterance.onend = () => resolve()
    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') {
        resolve()
      } else {
        console.warn('[PodPlayer] Speech error:', e.error)
        resolve() // Don't reject, just continue
      }
    }

    currentUtterance = utterance
    speechSynth.speak(utterance)
  })
}

const wait = (ms) => new Promise(resolve => {
  if (playbackCancelled) { resolve(); return }
  setTimeout(resolve, ms)
})

// Play a single step (target at speed, or translation)
const playStep = async (sentence, step) => {
  if (playbackCancelled) return

  if (step.type === 'translation') {
    await speak(sentence.known, 'en', 1)
  } else {
    await speak(sentence.target, 'es', step.speed)
  }

  // Brief gap between steps
  await wait(600)
}

// Play one full repeat of a stage for a sentence
const playStageRepeat = async (sentence, stage) => {
  for (let s = 0; s < stage.steps.length; s++) {
    if (playbackCancelled) return
    currentStepIndex.value = s
    await playStep(sentence, stage.steps[s])
  }
}

// Play one full sentence through all 7 stages
const playSentence = async (sentenceIndex) => {
  const sentence = selectedPod.value.sentences[sentenceIndex]
  if (!sentence) return

  currentSentenceIndex.value = sentenceIndex

  for (let stg = 0; stg < SCAFFOLDING_STAGES.length; stg++) {
    if (playbackCancelled) return
    currentStageIndex.value = stg
    const stage = SCAFFOLDING_STAGES[stg]

    for (let rep = 0; rep < stage.repeats; rep++) {
      if (playbackCancelled) return
      currentRepeat.value = rep
      await playStageRepeat(sentence, stage)
      // Gap between repeats
      await wait(800)
    }

    // Gap between stages
    await wait(1200)
  }
}

// Play the entire pod
const playPod = async () => {
  if (!selectedPod.value) return

  playbackCancelled = false
  isPlaying.value = true
  isPaused.value = false

  for (let i = currentSentenceIndex.value; i < selectedPod.value.sentences.length; i++) {
    if (playbackCancelled) break
    await playSentence(i)
    // Gap between sentences
    await wait(1500)
  }

  isPlaying.value = false
  isPaused.value = false
}

// ============================================================================
// Controls
// ============================================================================

const selectPod = (index) => {
  selectedPodIndex.value = index
  resetPlayback()
}

const goBack = () => {
  stopPlayback()
  selectedPodIndex.value = -1
}

const togglePlayback = () => {
  if (isPlaying.value && !isPaused.value) {
    // Pause
    isPaused.value = true
    speechSynth?.pause()
  } else if (isPaused.value) {
    // Resume
    isPaused.value = false
    speechSynth?.resume()
  } else {
    // Start
    playPod()
  }
}

const stopPlayback = () => {
  playbackCancelled = true
  isPlaying.value = false
  isPaused.value = false
  speechSynth?.cancel()
}

const resetPlayback = () => {
  stopPlayback()
  currentSentenceIndex.value = 0
  currentStageIndex.value = 0
  currentRepeat.value = 0
  currentStepIndex.value = 0
}

const skipSentence = () => {
  if (!selectedPod.value) return
  const next = currentSentenceIndex.value + 1
  if (next < selectedPod.value.sentences.length) {
    stopPlayback()
    currentSentenceIndex.value = next
    currentStageIndex.value = 0
    currentRepeat.value = 0
    currentStepIndex.value = 0
    playPod()
  }
}

const prevSentence = () => {
  if (currentSentenceIndex.value > 0) {
    stopPlayback()
    currentSentenceIndex.value--
    currentStageIndex.value = 0
    currentRepeat.value = 0
    currentStepIndex.value = 0
    playPod()
  }
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(() => {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    speechSynth = window.speechSynthesis
    // Voices may load async
    speechSynth.getVoices()
    if (speechSynth.onvoiceschanged !== undefined) {
      speechSynth.onvoiceschanged = () => speechSynth.getVoices()
    }
  }
})

onUnmounted(() => {
  stopPlayback()
})
</script>

<template>
  <div class="pod-player">
    <!-- Deep Space Background -->
    <div class="space-gradient"></div>
    <div class="bg-noise"></div>

    <!-- Pod List View -->
    <div v-if="selectedPodIndex === -1" class="pod-list-view">
      <header class="header">
        <div class="header-stack">
          <div class="brand-row">
            <div class="brand">
              <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
            </div>
          </div>
          <div class="pod-badge-row">
            <span class="pod-badge">Listening Pods</span>
            <span class="pod-count">{{ pods.length }} pods · 66 sentences</span>
          </div>
        </div>
      </header>

      <div class="pod-grid">
        <button
          v-for="(pod, index) in pods"
          :key="pod.id"
          class="pod-card"
          @click="selectPod(index)"
        >
          <div class="pod-card-header">
            <span class="pod-number">{{ pod.id }}</span>
            <span class="pod-difficulty" :style="{ color: difficultyColor(pod.difficulty) }">
              {{ pod.difficulty }}
            </span>
          </div>
          <div class="pod-card-title">{{ pod.title }}</div>
          <div class="pod-card-scene">{{ pod.scene }}</div>
          <div class="pod-card-meta">{{ pod.sentences.length }} sentences</div>
        </button>
      </div>
    </div>

    <!-- Pod Player View -->
    <div v-else class="pod-player-view">
      <header class="header">
        <button class="back-btn" @click="goBack">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div class="header-info">
          <div class="pod-title">{{ selectedPod.title }}</div>
          <div class="pod-scene-label">{{ selectedPod.scene }} · {{ totalSentences }} sentences</div>
        </div>
      </header>

      <!-- Sentence Display -->
      <div class="sentence-area">
        <!-- Sentence list (teleprompter style) -->
        <div class="sentence-list">
          <div
            v-for="(sentence, idx) in selectedPod.sentences"
            :key="sentence.id"
            class="sentence-row"
            :class="{
              current: idx === currentSentenceIndex,
              done: idx < currentSentenceIndex,
              future: idx > currentSentenceIndex
            }"
          >
            <span class="sentence-speaker">{{ sentence.speaker }}</span>
            <span class="sentence-target">{{ sentence.target }}</span>
            <span v-if="idx === currentSentenceIndex && isPlaying" class="sentence-known">
              {{ sentence.known }}
            </span>
          </div>
        </div>
      </div>

      <!-- Stage indicator -->
      <div v-if="isPlaying || isPaused" class="stage-indicator">
        <div class="stage-dots">
          <span
            v-for="s in 7"
            :key="s"
            class="stage-dot"
            :class="{ active: s - 1 === currentStageIndex, done: s - 1 < currentStageIndex }"
          ></span>
        </div>
        <div class="stage-text">{{ stageLabel }}</div>
        <div class="now-playing">{{ nowPlayingLabel }}</div>
      </div>

      <!-- Progress bar -->
      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: podProgress + '%' }"></div>
        </div>
        <span class="progress-text">Sentence {{ currentSentenceIndex + 1 }}/{{ totalSentences }}</span>
      </div>

      <!-- Controls -->
      <div class="controls">
        <button class="control-btn" @click="prevSentence" :disabled="currentSentenceIndex === 0">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <polygon points="19 20 9 12 19 4"/>
            <line x1="5" y1="4" x2="5" y2="20" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>

        <button class="play-btn" @click="togglePlayback">
          <svg v-if="isPlaying && !isPaused" viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
            <polygon points="5 3 19 12 5 21"/>
          </svg>
        </button>

        <button class="control-btn" @click="skipSentence" :disabled="currentSentenceIndex >= totalSentences - 1">
          <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
            <polygon points="5 4 15 12 5 20"/>
            <line x1="19" y1="4" x2="19" y2="20" stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pod-player {
  --safe-area-top: env(safe-area-inset-top, 0px);
  --safe-area-bottom: env(safe-area-inset-bottom, 0px);

  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #08080c);
  font-family: var(--font-body, 'DM Sans', system-ui, sans-serif);
  color: #e8e4df;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* ============ DEEP SPACE BACKGROUNDS ============ */
.space-gradient {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 120% 80% at 20% 10%, rgba(30, 20, 50, 0.8) 0%, transparent 50%),
    radial-gradient(ellipse 100% 60% at 80% 90%, rgba(20, 30, 50, 0.6) 0%, transparent 40%),
    radial-gradient(ellipse 80% 80% at 50% 50%, rgba(10, 10, 20, 1) 0%, #08080c 100%);
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
  padding: calc(var(--safe-area-top) + 12px) 16px 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-stack {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brand-row {
  display: flex;
  align-items: center;
}

.brand {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.02em;
}

.logo-say { color: #e8e4df; }
.logo-something { color: #e8e4df; opacity: 0.7; }
.logo-in { color: #e8e4df; opacity: 0.5; margin-left: 2px; }

.pod-badge-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pod-badge {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #f97316;
  background: rgba(249, 115, 22, 0.12);
  padding: 3px 8px;
  border-radius: 4px;
}

.pod-count {
  font-size: 0.75rem;
  color: rgba(232, 228, 223, 0.4);
}

.back-btn {
  background: none;
  border: none;
  color: #e8e4df;
  padding: 8px;
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.15s;
}
.back-btn:hover { background: rgba(255,255,255,0.06); }

.header-info {
  flex: 1;
}

.pod-title {
  font-size: 1rem;
  font-weight: 600;
  color: #e8e4df;
}

.pod-scene-label {
  font-size: 0.75rem;
  color: rgba(232, 228, 223, 0.5);
}

/* ============ POD GRID ============ */
.pod-list-view {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.pod-grid {
  padding: 8px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pod-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 16px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  color: #e8e4df;
}
.pod-card:hover {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.1);
}

.pod-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.pod-number {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(232, 228, 223, 0.4);
  background: rgba(255, 255, 255, 0.06);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
}

.pod-difficulty {
  font-size: 0.688rem;
  font-weight: 500;
  text-transform: capitalize;
}

.pod-card-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 2px;
}

.pod-card-scene {
  font-size: 0.813rem;
  color: rgba(232, 228, 223, 0.5);
  margin-bottom: 6px;
}

.pod-card-meta {
  font-size: 0.75rem;
  color: rgba(232, 228, 223, 0.35);
}

/* ============ POD PLAYER VIEW ============ */
.pod-player-view {
  position: relative;
  z-index: 10;
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* ============ SENTENCE AREA ============ */
.sentence-area {
  flex: 1;
  padding: 8px 16px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.sentence-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sentence-row {
  padding: 12px 14px;
  border-radius: 10px;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sentence-row.current {
  background: rgba(249, 115, 22, 0.1);
  border-left: 3px solid #f97316;
  padding-left: 11px;
}

.sentence-row.done {
  opacity: 0.4;
}

.sentence-row.future {
  opacity: 0.6;
}

.sentence-speaker {
  font-size: 0.688rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(232, 228, 223, 0.35);
}

.sentence-target {
  font-size: 1.063rem;
  font-weight: 500;
  line-height: 1.4;
  color: #e8e4df;
}

.sentence-known {
  font-size: 0.875rem;
  color: rgba(232, 228, 223, 0.5);
  font-style: italic;
  margin-top: 2px;
}

/* ============ STAGE INDICATOR ============ */
.stage-indicator {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.stage-dots {
  display: flex;
  gap: 6px;
}

.stage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  transition: all 0.2s;
}

.stage-dot.active {
  background: #f97316;
  box-shadow: 0 0 8px rgba(249, 115, 22, 0.4);
}

.stage-dot.done {
  background: rgba(249, 115, 22, 0.4);
}

.stage-text {
  font-size: 0.75rem;
  color: rgba(232, 228, 223, 0.5);
  font-weight: 500;
}

.now-playing {
  font-size: 0.688rem;
  color: #f97316;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ============ PROGRESS ============ */
.progress-container {
  padding: 0 16px 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #f97316;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: rgba(232, 228, 223, 0.4);
  white-space: nowrap;
}

/* ============ CONTROLS ============ */
.controls {
  padding: 12px 16px calc(var(--safe-area-bottom) + 16px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
}

.control-btn {
  background: none;
  border: none;
  color: #e8e4df;
  padding: 10px;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s, opacity 0.15s;
  opacity: 0.7;
}
.control-btn:hover { background: rgba(255,255,255,0.06); opacity: 1; }
.control-btn:disabled { opacity: 0.2; cursor: default; }
.control-btn:disabled:hover { background: none; }

.play-btn {
  background: #f97316;
  border: none;
  color: #fff;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  box-shadow: 0 4px 20px rgba(249, 115, 22, 0.3);
}
.play-btn:hover { background: #ea580c; }
.play-btn:active { transform: scale(0.95); }
</style>
