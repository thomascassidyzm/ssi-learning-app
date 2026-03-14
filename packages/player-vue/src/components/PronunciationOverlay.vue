<script setup>
import { ref, computed, inject, onMounted, onUnmounted, watch, nextTick } from 'vue'
import {
  extractPitchContour,
  compareProsody,
  getNativePitchContour,
  AudioRecorder,
} from '@ssi/core/audio'
import ProsodyFeedback from './ProsodyFeedback.vue'

// ============================================================================
// Pronunciation Overlay - Record-compare-feedback loop on completed phrases
// Pulls BUILD + USE phrases, sorted short→long for confidence building.
// Adaptive reinsertion: struggled phrases come back sooner.
// ============================================================================

const emit = defineEmits(['close'])

const props = defineProps({
  courseCode: {
    type: String,
    required: true
  },
  beltColor: {
    type: String,
    default: '#d4a853'
  },
  upToSeed: {
    type: Number,
    default: null
  },
  targetLang: {
    type: String,
    default: 'eng'
  }
})

// Inject providers
const supabase = inject('supabase', null)

// ============================================================================
// PRONUNCIATION BANDS — human-meaningful feedback
// ============================================================================

const BANDS = [
  { key: 'crystal',    label: 'Crystal clear',     desc: 'A native speaker would understand instantly',     color: '#4ade80', icon: '✦' },
  { key: 'clear',      label: 'Clear enough',       desc: 'Understandable without needing context',          color: '#86efac', icon: '●' },
  { key: 'getting',    label: 'Getting there',      desc: 'Would be understood with a little context',       color: '#fbbf24', icon: '◐' },
  { key: 'practise',   label: 'Keep practising',    desc: 'A native speaker would need to concentrate to understand', color: '#fb923c', icon: '○' },
  { key: 'tryagain',   label: 'Try again',          desc: 'Would be hard to understand, even with context',  color: '#f87171', icon: '◌' },
]

// Sensitivity presets: each defines the score thresholds for band boundaries
// [crystal_min, clear_min, getting_min, practise_min] — below practise_min = tryagain
const SENSITIVITY_PRESETS = [
  { name: 'Encouraging',  thresholds: [60, 42, 25, 12] },
  { name: 'Moderate',     thresholds: [68, 50, 33, 18] },
  { name: 'Balanced',     thresholds: [75, 58, 40, 25] },
  { name: 'Demanding',    thresholds: [82, 68, 50, 35] },
  { name: 'Exacting',     thresholds: [90, 78, 60, 45] },
]

const sensitivityIndex = ref(0) // Default: Encouraging
const sensitivity = computed(() => SENSITIVITY_PRESETS[sensitivityIndex.value])

function scoreToBand(score) {
  const t = sensitivity.value.thresholds
  if (score >= t[0]) return BANDS[0] // crystal
  if (score >= t[1]) return BANDS[1] // clear
  if (score >= t[2]) return BANDS[2] // getting
  if (score >= t[3]) return BANDS[3] // practise
  return BANDS[4] // tryagain
}

// How far ahead to reinsert based on band
// Always progresses — never blocks. Struggled phrases come back later.
// Returns -1 (don't reinsert) or N (insert N phrases ahead).
function reinsertDistance(bandKey) {
  switch (bandKey) {
    case 'crystal': return -1  // nailed it
    case 'clear':   return -1  // good enough
    case 'getting': return 6   // come back in ~6 phrases
    case 'practise': return 3  // come back soon
    case 'tryagain': return 2  // come back very soon
    default: return 4
  }
}

// Track how many times each phrase has been attempted (by phrase ID)
// After 2 attempts, never reinsert again — don't punish the learner
const attemptCounts = new Map()

// ============================================================================
// State
// ============================================================================

const isLoading = ref(true)
const error = ref(null)

// Phrase data — the adaptive queue
const masterPhrases = ref([])  // All loaded phrases (source of truth)
const queue = ref([])           // Adaptive playback queue
const currentIndex = ref(-1)

// Pagination
const BATCH_SIZE = 100
const loadedCount = ref(0)
const totalCount = ref(0)
const hasMore = ref(true)
const isLoadingMore = ref(false)

// Pronunciation cycle states
const phase = ref('idle') // idle | playing | recording | analyzing | feedback
const currentResult = ref(null)
const currentBand = ref(null)

// Audio
let audioContext = null
let mediaStream = null
let recorder = null
let playbackAudio = null

// Cancellation
let cycleId = 0

// ============================================================================
// Computed
// ============================================================================

const currentPhrase = computed(() => {
  if (currentIndex.value < 0 || currentIndex.value >= queue.value.length) return null
  return queue.value[currentIndex.value]
})

const progressPercent = computed(() => {
  if (queue.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / queue.value.length) * 100)
})

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'playing': return 'Listen...'
    case 'recording': return 'Your turn'
    case 'analyzing': return 'Analyzing...'
    case 'feedback': return ''
    default: return ''
  }
})

const isActive = computed(() => phase.value !== 'idle')

// ============================================================================
// Data Loading — BUILD + USE phrases, sorted by target text length
// ============================================================================

const loadPhrases = async (offset = 0) => {
  if (!supabase?.value || !props.courseCode) {
    error.value = 'Database not configured'
    isLoading.value = false
    return
  }

  try {
    if (offset === 0) {
      isLoading.value = true
      error.value = null
    } else {
      isLoadingMore.value = true
    }

    // Count total available
    if (offset === 0) {
      let countQuery = supabase.value
        .from('course_practice_phrases')
        .select('*', { count: 'exact', head: true })
        .eq('course_code', props.courseCode)
        .in('phrase_role', ['build', 'use', 'eternal_eligible'])

      if (props.upToSeed) {
        countQuery = countQuery.lt('seed_number', props.upToSeed)
      }

      const { count, error: countError } = await countQuery
      if (countError) console.warn('[PronunciationOverlay] Count error:', countError.message)
      totalCount.value = count || 0
      console.log('[PronunciationOverlay] BUILD+USE phrases available:', totalCount.value)
    }

    // Fetch phrases
    let dataQuery = supabase.value
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, position, phrase_role, target1_audio_id, target2_audio_id')
      .eq('course_code', props.courseCode)
      .in('phrase_role', ['build', 'use', 'eternal_eligible'])

    if (props.upToSeed) {
      dataQuery = dataQuery.lt('seed_number', props.upToSeed)
    }

    const { data, error: fetchError } = await dataQuery
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1)

    if (fetchError) throw fetchError

    if (data && data.length > 0) {
      const newPhrases = data.map((p, i) => ({
        id: `${p.seed_number}-${p.lego_index}-${p.position || i}`,
        seedNumber: p.seed_number,
        legoIndex: p.lego_index,
        knownText: p.known_text,
        targetText: p.target_text,
        phraseRole: p.phrase_role,
        target1AudioId: p.target1_audio_id,
        target2AudioId: p.target2_audio_id,
        textLength: (p.target_text || '').length,
      }))

      if (offset === 0) {
        masterPhrases.value = newPhrases
      } else {
        masterPhrases.value = [...masterPhrases.value, ...newPhrases]
      }

      loadedCount.value = masterPhrases.value.length
      hasMore.value = data.length >= BATCH_SIZE && loadedCount.value < totalCount.value

      // Build initial queue: shuffled, but with shorter phrases front-loaded
      if (offset === 0) {
        buildQueue()
      }
    } else {
      hasMore.value = false
    }
  } catch (err) {
    console.error('[PronunciationOverlay] Load error:', err)
    error.value = 'Failed to load phrases'
  } finally {
    isLoading.value = false
    isLoadingMore.value = false
  }
}

const loadMoreIfNeeded = async () => {
  if (!hasMore.value || isLoadingMore.value) return
  const remaining = queue.value.length - currentIndex.value - 1
  if (remaining < 10) {
    await loadPhrases(loadedCount.value)
    // Append new phrases to end of queue
    const existing = new Set(queue.value.map(p => p.id))
    const fresh = masterPhrases.value.filter(p => !existing.has(p.id))
    queue.value = [...queue.value, ...fresh]
  }
}

/**
 * Build the adaptive queue from master phrases.
 * Sort by text length (short→long) with a light shuffle within length bands.
 */
function buildQueue() {
  const phrases = [...masterPhrases.value]

  // Group into length bands: short (<20), medium (20-50), long (50+)
  const short = phrases.filter(p => p.textLength < 20)
  const medium = phrases.filter(p => p.textLength >= 20 && p.textLength < 50)
  const long = phrases.filter(p => p.textLength >= 50)

  // Shuffle within each band
  shuffle(short)
  shuffle(medium)
  shuffle(long)

  // Concatenate: short first, then medium, then long
  queue.value = [...short, ...medium, ...long]
  currentIndex.value = -1
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

// ============================================================================
// Audio Infrastructure
// ============================================================================

const getAudioUrl = (audioId) => {
  if (!audioId) return null
  return `/api/audio/${audioId}?courseId=${encodeURIComponent(props.courseCode)}`
}

const initializeAudio = async () => {
  try {
    const AudioContextClass =
      window.AudioContext || (window).webkitAudioContext
    audioContext = new AudioContextClass()

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })

    recorder = new AudioRecorder(audioContext)
    playbackAudio = new Audio()
    return true
  } catch (err) {
    console.error('[PronunciationOverlay] Audio init failed:', err)
    error.value = 'Microphone access is required for pronunciation practice'
    return false
  }
}

const playAndDecode = async (audioUrl) => {
  const fetchPromise = fetch(audioUrl)
    .then(r => r.arrayBuffer())
    .then(buf => audioContext.decodeAudioData(buf))

  const playPromise = new Promise((resolve, reject) => {
    let settled = false
    const onEnded = () => { if (!settled) { settled = true; resolve() } }
    const onError = (e) => { if (!settled) { settled = true; reject(e) } }
    setTimeout(() => { if (!settled) { settled = true; resolve() } }, 15000)

    playbackAudio.removeEventListener('ended', playbackAudio._onEnded)
    playbackAudio.removeEventListener('error', playbackAudio._onError)
    playbackAudio._onEnded = onEnded
    playbackAudio._onError = onError
    playbackAudio.addEventListener('ended', onEnded)
    playbackAudio.addEventListener('error', onError)

    playbackAudio.src = audioUrl
    playbackAudio.load()
    playbackAudio.play().catch(onError)
  })

  const [audioBuffer] = await Promise.all([fetchPromise, playPromise])
  return audioBuffer
}

// ============================================================================
// Pronunciation Cycle: play → record → analyze → feedback → adapt
// ============================================================================

const startCycle = async (index) => {
  if (index < 0 || index >= queue.value.length) return

  const myCycleId = ++cycleId
  currentIndex.value = index
  currentResult.value = null
  currentBand.value = null
  await loadMoreIfNeeded()

  const phrase = queue.value[index]
  if (!phrase) return

  const audioId = Math.random() < 0.5
    ? (phrase.target1AudioId || phrase.target2AudioId)
    : (phrase.target2AudioId || phrase.target1AudioId)
  const audioUrl = getAudioUrl(audioId)

  if (!audioUrl) {
    console.warn('[PronunciationOverlay] No audio for phrase, skipping')
    advanceToNext(myCycleId)
    return
  }

  // PHASE 1: Play native audio
  phase.value = 'playing'
  if (myCycleId !== cycleId) return

  let audioBuffer
  try {
    audioBuffer = await playAndDecode(audioUrl)
  } catch (err) {
    console.error('[PronunciationOverlay] Playback failed:', err)
    advanceToNext(myCycleId)
    return
  }

  if (myCycleId !== cycleId) return
  await new Promise(resolve => setTimeout(resolve, 400))
  if (myCycleId !== cycleId) return

  // PHASE 2: Record learner
  phase.value = 'recording'

  let recordingPromise
  try {
    recordingPromise = recorder.start(mediaStream)
  } catch (err) {
    console.error('[PronunciationOverlay] Recording start failed:', err)
    advanceToNext(myCycleId)
    return
  }

  const nativeDuration = audioBuffer.duration * 1000
  const maxRecordMs = Math.min(10000, Math.max(3000, nativeDuration * 2.5))
  await new Promise(resolve => setTimeout(resolve, maxRecordMs))
  if (myCycleId !== cycleId) return

  // PHASE 3: Analyze
  phase.value = 'analyzing'
  recorder.stop()

  let learnerBuffer
  try {
    learnerBuffer = await recordingPromise
  } catch (err) {
    console.error('[PronunciationOverlay] Recording decode failed:', err)
    advanceToNext(myCycleId)
    return
  }

  if (myCycleId !== cycleId) return

  const phraseId = `${props.courseCode}-${audioId}`
  const nativeContour = getNativePitchContour(phraseId, audioBuffer)
  const learnerContour = extractPitchContour(learnerBuffer)
  const result = compareProsody(nativeContour, learnerContour, props.targetLang)

  const band = scoreToBand(result.score.overall)
  console.log(`[PronunciationOverlay] ${band.label} (${result.score.overall}%) — ${phrase.targetText}`)

  if (myCycleId !== cycleId) return

  // PHASE 4: Show feedback
  currentResult.value = result
  currentBand.value = band
  phase.value = 'feedback'

  // Adaptive reinsertion — always progress, never block
  const phraseKey = phrase.id || `${phrase.targetText}`
  const attempts = (attemptCounts.get(phraseKey) || 0) + 1
  attemptCounts.set(phraseKey, attempts)

  const dist = reinsertDistance(band.key)
  if (dist > 0 && attempts < 2) {
    // Reinsert this phrase further ahead for another go — but only once
    const insertAt = Math.min(currentIndex.value + dist + 1, queue.value.length)
    queue.value.splice(insertAt, 0, { ...phrase })
  }
  // dist === -1 or attempts >= 2: don't reinsert, move on

  // Brief pause to show feedback, then always advance
  await new Promise(resolve => setTimeout(resolve, 2500))
  if (myCycleId !== cycleId) return

  advanceToNext(myCycleId)
}

const advanceToNext = async (myCycleId) => {
  if (myCycleId !== cycleId) return

  const nextIndex = currentIndex.value + 1
  if (nextIndex >= queue.value.length) {
    if (hasMore.value) {
      await loadMoreIfNeeded()
      if (queue.value.length > nextIndex) {
        startCycle(nextIndex)
        return
      }
    }
    // Wrap — rebuild queue for another pass
    buildQueue()
    startCycle(0)
    return
  }

  startCycle(nextIndex)
}

const handleRetry = () => {
  if (currentIndex.value >= 0) {
    startCycle(currentIndex.value)
  }
}

const handleSkip = () => {
  const myCycleId = ++cycleId
  advanceToNext(myCycleId)
}

const togglePlayback = () => {
  if (isActive.value) {
    stopAll()
  } else {
    if (currentIndex.value < 0 || currentIndex.value >= queue.value.length) {
      startCycle(0)
    } else {
      startCycle(currentIndex.value)
    }
  }
}

const stopAll = () => {
  cycleId++
  phase.value = 'idle'
  currentResult.value = null
  currentBand.value = null
  if (playbackAudio) {
    playbackAudio.pause()
    playbackAudio.currentTime = 0
  }
  if (recorder?.isRecording()) {
    recorder.stop()
  }
}

const handleClose = () => {
  stopAll()
  emit('close')
}

// ============================================================================
// Lifecycle
// ============================================================================

onMounted(async () => {
  const audioOk = await initializeAudio()
  if (audioOk) {
    await loadPhrases()
  }
})

onUnmounted(() => {
  stopAll()
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop())
    mediaStream = null
  }
  if (audioContext) {
    audioContext.close()
    audioContext = null
  }
})
</script>

<template>
  <div class="pronunciation-overlay" :style="{ '--belt-color': beltColor }">
    <!-- Close button -->
    <button class="close-btn" @click.stop="handleClose">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"/>
      </svg>
    </button>

    <!-- Controls bar -->
    <div class="controls-bar" @click.stop>
      <!-- Sensitivity selector -->
      <div class="sensitivity-bar">
        <span class="sensitivity-label">How picky?</span>
        <div class="sensitivity-selector">
          <button
            v-for="(preset, i) in SENSITIVITY_PRESETS"
            :key="preset.name"
            class="sensitivity-btn"
            :class="{ active: sensitivityIndex === i }"
            @click="sensitivityIndex = i"
          >
            {{ preset.name }}
          </button>
        </div>
      </div>

      <!-- Transport -->
      <div class="transport-bar">
        <button class="transport-btn" @click="togglePlayback">
          <svg v-if="isActive" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor">
            <polygon points="7 3 20 12 7 21 7 3"/>
          </svg>
        </button>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
        </div>
        <span class="progress-text">{{ currentIndex + 1 }} / {{ queue.length }}</span>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading phrases...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-state" @click.stop>
      <p>{{ error }}</p>
      <button @click="loadPhrases()">Retry</button>
    </div>

    <!-- Main Content -->
    <div v-else class="pronunciation-stage">
      <!-- Current phrase display -->
      <div class="phrase-display">
        <div v-if="currentPhrase" class="phrase-role-badge" :class="'role--' + (currentPhrase.phraseRole || 'use')">
          {{ currentPhrase.phraseRole === 'build' ? 'Fragment' : 'Sentence' }}
        </div>
        <div class="phrase-target-text">{{ currentPhrase?.targetText || '' }}</div>
        <div v-if="currentPhrase?.knownText" class="phrase-known-text">{{ currentPhrase.knownText }}</div>
      </div>

      <!-- Phase indicator -->
      <div class="phase-indicator" :class="'phase--' + phase">
        <!-- Recording pulse -->
        <div v-if="phase === 'recording'" class="recording-pulse">
          <div class="pulse-ring"></div>
          <div class="pulse-ring delay-1"></div>
          <div class="pulse-dot"></div>
        </div>

        <!-- Analyzing spinner -->
        <div v-else-if="phase === 'analyzing'" class="analyzing-spinner"></div>

        <!-- Playing indicator -->
        <div v-else-if="phase === 'playing'" class="playing-indicator">
          <div class="sound-bar"></div>
          <div class="sound-bar delay-1"></div>
          <div class="sound-bar delay-2"></div>
        </div>

        <span v-if="phaseLabel" class="phase-text">{{ phaseLabel }}</span>
      </div>

      <!-- Band Feedback (replaces raw percentage) -->
      <Transition name="feedback-slide">
        <div v-if="phase === 'feedback' && currentBand" class="band-feedback">
          <div class="band-card" :style="{ '--band-color': currentBand.color }">
            <span class="band-icon">{{ currentBand.icon }}</span>
            <div class="band-text">
              <span class="band-label">{{ currentBand.label }}</span>
              <span class="band-desc">{{ currentBand.desc }}</span>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Prosody Feedback (pitch contour visualization) -->
      <Transition name="feedback-slide">
        <ProsodyFeedback
          v-if="phase === 'feedback' && currentResult"
          :result="currentResult"
        />
      </Transition>

      <!-- Action buttons (visible during feedback) -->
      <Transition name="feedback-slide">
        <div v-if="phase === 'feedback'" class="action-buttons">
          <button class="action-btn action-btn--retry" @click.stop="handleRetry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="1 4 1 10 7 10"/>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
            </svg>
            Retry
          </button>
          <button class="action-btn action-btn--next" @click.stop="handleSkip">
            Next
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      </Transition>

      <!-- Idle state hint -->
      <div v-if="phase === 'idle' && queue.length > 0" class="idle-hint">
        <div class="play-pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </div>
        <p>Tap play to start</p>
        <p class="phrase-count">{{ totalCount }} phrases available (short → long)</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pronunciation-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--bg-primary) 55%, transparent);
  backdrop-filter: blur(8px);
  font-family: var(--font-body);
  padding: env(safe-area-inset-top, 20px) 0 calc(env(safe-area-inset-bottom, 20px) + 100px) 0;
}

/* Close button */
.close-btn {
  position: absolute;
  top: calc(env(safe-area-inset-top, 20px) + 12px);
  right: 16px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 50%;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  z-index: 10;
}

.close-btn:hover { background: var(--pill-bg-hover); color: var(--text-primary); }
.close-btn svg { width: 20px; height: 20px; }

/* Controls bar — pushed down to clear the SSi logo */
.controls-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 3.5rem 1.5rem 0.5rem;
  cursor: default;
}

/* Sensitivity */
.sensitivity-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
}

.sensitivity-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
}

.sensitivity-selector {
  display: flex;
  gap: 2px;
}

.sensitivity-btn {
  padding: 4px 8px;
  background: transparent;
  border: 1px solid var(--border-medium);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 0.6875rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.sensitivity-btn:hover { background: var(--bg-elevated); color: var(--text-secondary); }
.sensitivity-btn.active { background: var(--bg-elevated); border-color: var(--text-secondary); color: var(--text-primary); }

/* Transport */
.transport-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.transport-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(145deg, var(--ssi-red-light, #d44545) 0%, var(--ssi-red, #b83232) 100%);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: 0 4px 12px rgba(194, 58, 58, 0.35);
  -webkit-tap-highlight-color: transparent;
}

.transport-btn:active { transform: scale(0.9); }
.transport-btn svg { width: 18px; height: 18px; }

.progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-medium);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--ssi-red, #b83232);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-muted);
  min-width: 48px;
  text-align: right;
}

/* Loading / Error */
.loading, .error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--border-medium);
  border-top-color: var(--text-muted);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.error-state button {
  padding: 0.5rem 1rem;
  background: var(--ssi-red, #b83232);
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: 600;
  cursor: pointer;
}

/* ═══════════════════════════════════════════════════
   PRONUNCIATION STAGE
   ═══════════════════════════════════════════════════ */

.pronunciation-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.5rem;
  gap: 1.25rem;
}

/* Phrase display */
.phrase-display {
  text-align: center;
  max-width: 400px;
}

.phrase-role-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.5rem;
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-muted);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.phrase-role-badge.role--build {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.2);
  color: #fbbf24;
}

.phrase-target-text {
  font-size: clamp(1.5rem, 4vmin, 2rem);
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  min-height: 2em;
  transition: opacity 0.3s ease;
}

.phrase-known-text {
  font-size: 0.9375rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
  font-style: italic;
}

/* Phase indicator */
.phase-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  min-height: 80px;
  justify-content: center;
}

.phase-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

/* Recording pulse animation */
.recording-pulse {
  position: relative;
  width: 48px;
  height: 48px;
}

.pulse-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  background: #ef4444;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.pulse-ring {
  position: absolute;
  inset: 0;
  border: 2px solid rgba(239, 68, 68, 0.4);
  border-radius: 50%;
  animation: pulse-expand 1.5s ease-out infinite;
}

.pulse-ring.delay-1 { animation-delay: 0.5s; }

@keyframes pulse-expand {
  0% { transform: scale(0.5); opacity: 1; }
  100% { transform: scale(1.3); opacity: 0; }
}

/* Analyzing spinner */
.analyzing-spinner {
  width: 32px;
  height: 32px;
  border: 2px solid var(--border-medium);
  border-top-color: var(--belt-color, var(--text-muted));
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Playing indicator (sound bars) */
.playing-indicator {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 32px;
}

.sound-bar {
  width: 4px;
  background: var(--belt-color, var(--text-muted));
  border-radius: 2px;
  animation: sound-bar-bounce 0.8s ease-in-out infinite;
}

.sound-bar:nth-child(1) { height: 12px; }
.sound-bar:nth-child(2) { height: 20px; animation-delay: 0.15s; }
.sound-bar:nth-child(3) { height: 16px; animation-delay: 0.3s; }

@keyframes sound-bar-bounce {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.6); }
}

/* ═══════════════════════════════════════════════════
   BAND FEEDBACK CARD
   ═══════════════════════════════════════════════════ */

.band-feedback {
  width: 100%;
  max-width: 360px;
}

.band-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 1.25rem;
  border-radius: 14px;
  background: color-mix(in srgb, var(--band-color) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--band-color) 25%, transparent);
}

.band-icon {
  font-size: 1.5rem;
  color: var(--band-color);
  flex-shrink: 0;
  width: 32px;
  text-align: center;
}

.band-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.band-label {
  font-size: 1rem;
  font-weight: 600;
  color: var(--band-color);
}

.band-desc {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  line-height: 1.3;
}

/* Action buttons */
.action-buttons {
  display: flex;
  gap: 0.75rem;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border-radius: 24px;
  border: 1px solid var(--border-medium);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn svg { width: 16px; height: 16px; }
.action-btn:hover { background: var(--pill-bg-hover); color: var(--text-primary); }

.action-btn--next {
  background: linear-gradient(145deg, var(--ssi-red-light, #d44545) 0%, var(--ssi-red, #b83232) 100%);
  border-color: transparent;
  color: white;
  box-shadow: 0 2px 8px rgba(194, 58, 58, 0.3);
}

.action-btn--next:hover { color: white; box-shadow: 0 4px 12px rgba(194, 58, 58, 0.4); }

/* Idle hint */
.idle-hint {
  text-align: center;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.idle-hint p { margin: 0; }

.play-pointer {
  opacity: 0.5;
  animation: bounce-up 1.5s ease-in-out infinite;
}

@keyframes bounce-up {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

.phrase-count {
  font-size: 0.75rem;
  margin-top: 0.5rem;
  opacity: 0.6;
}

/* Feedback slide transition */
.feedback-slide-enter-active { transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.feedback-slide-leave-active { transition: all 0.2s ease-in; }
.feedback-slide-enter-from { opacity: 0; transform: translateY(16px); }
.feedback-slide-leave-to { opacity: 0; transform: translateY(-8px); }

/* ═══════════════════════════════════════════════════
   MIST (LIGHT) THEME
   ═══════════════════════════════════════════════════ */

:root[data-theme="mist"] .phrase-role-badge {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.08);
  color: #6B6560;
}

:root[data-theme="mist"] .phrase-role-badge.role--build {
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.15);
  color: #b88a00;
}
</style>
