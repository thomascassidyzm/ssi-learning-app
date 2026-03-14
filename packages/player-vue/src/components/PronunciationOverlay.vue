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
// Same content source as ListeningOverlay (USE phrases up to currentSeed - 1)
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
  /**
   * Current playing seed number.
   * Filters phrases to only completed seeds (strictly less than this seed).
   */
  upToSeed: {
    type: Number,
    default: null
  },
  /**
   * Target language code (ISO 639-3) for per-language prosody weights
   */
  targetLang: {
    type: String,
    default: 'eng'
  }
})

// Inject providers
const supabase = inject('supabase', null)

// ============================================================================
// State
// ============================================================================

const isLoading = ref(true)
const error = ref(null)
const mode = ref('shuffled')

// Phrase data
const allPhrases = ref([])
const currentIndex = ref(-1)

// Pagination
const BATCH_SIZE = 50
const PRELOAD_THRESHOLD = 10
const loadedCount = ref(0)
const totalCount = ref(0)
const hasMore = ref(true)
const isLoadingMore = ref(false)

// Pronunciation cycle states
const phase = ref('idle') // idle | playing | recording | analyzing | feedback
const currentResult = ref(null)

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
  if (currentIndex.value < 0 || currentIndex.value >= allPhrases.value.length) return null
  return allPhrases.value[currentIndex.value]
})

const progressPercent = computed(() => {
  if (allPhrases.value.length === 0) return 0
  return Math.round(((currentIndex.value + 1) / allPhrases.value.length) * 100)
})

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'playing': return 'Listen...'
    case 'recording': return 'Your turn'
    case 'analyzing': return 'Analyzing...'
    case 'feedback': return ''
    default: return 'Tap to start'
  }
})

const isActive = computed(() => phase.value !== 'idle')

// ============================================================================
// Data Loading (same pattern as ListeningOverlay)
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

    if (offset === 0) {
      let countQuery = supabase.value
        .from('course_practice_phrases')
        .select('*', { count: 'exact', head: true })
        .eq('course_code', props.courseCode)
        .in('phrase_role', ['use', 'eternal_eligible'])

      if (props.upToSeed) {
        countQuery = countQuery.lt('seed_number', props.upToSeed)
      }

      const { count, error: countError } = await countQuery
      if (countError) console.warn('[PronunciationOverlay] Count error:', countError.message)
      totalCount.value = count || 0
      console.log('[PronunciationOverlay] USE phrases available:', totalCount.value)
    }

    let dataQuery = supabase.value
      .from('course_practice_phrases')
      .select('seed_number, lego_index, known_text, target_text, position, target1_audio_id, target2_audio_id')
      .eq('course_code', props.courseCode)
      .in('phrase_role', ['use', 'eternal_eligible'])

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
        target1AudioId: p.target1_audio_id,
        target2AudioId: p.target2_audio_id,
      }))

      if (offset === 0) {
        allPhrases.value = newPhrases
      } else {
        allPhrases.value = [...allPhrases.value, ...newPhrases]
      }

      loadedCount.value = allPhrases.value.length
      hasMore.value = data.length >= BATCH_SIZE && loadedCount.value < totalCount.value

      if (mode.value === 'shuffled' && offset === 0) {
        shufflePhrases()
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
  const remaining = allPhrases.value.length - currentIndex.value - 1
  if (remaining < PRELOAD_THRESHOLD) {
    await loadPhrases(loadedCount.value)
  }
}

const shufflePhrases = () => {
  const arr = [...allPhrases.value]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  allPhrases.value = arr
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
    // Create AudioContext for pitch analysis
    const AudioContextClass =
      window.AudioContext || (window).webkitAudioContext
    audioContext = new AudioContextClass()

    // Request microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    })

    recorder = new AudioRecorder(audioContext)

    // Reusable playback element
    playbackAudio = new Audio()

    return true
  } catch (err) {
    console.error('[PronunciationOverlay] Audio init failed:', err)
    error.value = 'Microphone access is required for pronunciation practice'
    return false
  }
}

/**
 * Play an audio URL and return the decoded AudioBuffer for pitch analysis.
 * Uses the /api/audio proxy and decodes the response for analysis.
 */
const playAndDecode = async (audioUrl) => {
  // Fetch the audio data for decoding
  const fetchPromise = fetch(audioUrl)
    .then(r => r.arrayBuffer())
    .then(buf => audioContext.decodeAudioData(buf))

  // Simultaneously play through Audio element for the learner to hear
  const playPromise = new Promise((resolve, reject) => {
    let settled = false
    const onEnded = () => { if (!settled) { settled = true; resolve() } }
    const onError = (e) => { if (!settled) { settled = true; reject(e) } }
    const safetyTimer = setTimeout(() => { if (!settled) { settled = true; resolve() } }, 15000)

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

  // Wait for both: playback to finish AND audio buffer to be decoded
  const [audioBuffer] = await Promise.all([fetchPromise, playPromise])
  return audioBuffer
}

// ============================================================================
// Pronunciation Cycle: play → record → analyze → feedback
// ============================================================================

const startCycle = async (index) => {
  if (index < 0 || index >= allPhrases.value.length) return

  const myCycleId = ++cycleId
  currentIndex.value = index
  currentResult.value = null
  await loadMoreIfNeeded()

  const phrase = allPhrases.value[index]
  if (!phrase) return

  // Pick a voice
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

  // Brief pause before recording
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

  // Auto-stop after max duration (native duration * 2.5, min 3s, max 10s)
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

  // Extract pitch contours and compare
  const phraseId = `${props.courseCode}-${audioId}`
  const nativeContour = getNativePitchContour(phraseId, audioBuffer)
  const learnerContour = extractPitchContour(learnerBuffer)
  const result = compareProsody(nativeContour, learnerContour, props.targetLang)

  console.log(`[PronunciationOverlay] Score: ${result.score.overall}% (pitch:${result.score.pitch} rhythm:${result.score.rhythm} timing:${result.score.timing})`)

  if (myCycleId !== cycleId) return

  // PHASE 4: Show feedback
  currentResult.value = result
  phase.value = 'feedback'

  // Auto-advance after 3 seconds (or user taps)
  await new Promise(resolve => setTimeout(resolve, 3000))
  if (myCycleId !== cycleId) return

  advanceToNext(myCycleId)
}

const advanceToNext = async (myCycleId) => {
  if (myCycleId !== cycleId) return

  const nextIndex = currentIndex.value + 1
  if (nextIndex >= allPhrases.value.length) {
    if (hasMore.value) {
      await loadMoreIfNeeded()
      if (allPhrases.value.length > nextIndex) {
        startCycle(nextIndex)
        return
      }
    }
    // Wrap around
    if (mode.value === 'shuffled') shufflePhrases()
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
  cycleId++
  advanceToNext(cycleId)
}

const togglePlayback = () => {
  if (isActive.value) {
    stopAll()
  } else {
    if (currentIndex.value < 0) {
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

const setMode = (newMode) => {
  if (newMode === mode.value) return
  const wasActive = isActive.value
  stopAll()
  mode.value = newMode

  if (newMode === 'shuffled') {
    shufflePhrases()
  } else {
    allPhrases.value.sort((a, b) => {
      if (a.seedNumber !== b.seedNumber) return a.seedNumber - b.seedNumber
      if (a.legoIndex !== b.legoIndex) return a.legoIndex - b.legoIndex
      return 0
    })
  }

  currentIndex.value = 0
  if (wasActive) startCycle(0)
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
      <!-- Mode Toggle -->
      <div class="mode-toggle">
        <button class="mode-btn" :class="{ active: mode === 'ordered' }" @click="setMode('ordered')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
            <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
          </svg>
          Ordered
        </button>
        <button class="mode-btn" :class="{ active: mode === 'shuffled' }" @click="setMode('shuffled')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
            <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/>
          </svg>
          Shuffled
        </button>
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
        <span class="progress-text">{{ progressPercent }}%</span>
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

      <!-- Prosody Feedback -->
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
      <div v-if="phase === 'idle' && allPhrases.length > 0" class="idle-hint">
        <p>Tap play to start pronunciation practice</p>
        <p class="phrase-count">{{ totalCount }} phrases available</p>
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

.close-btn:hover {
  background: var(--pill-bg-hover);
  color: var(--text-primary);
}

.close-btn svg { width: 20px; height: 20px; }

/* Controls bar */
.controls-bar {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.5rem 0.5rem;
  cursor: default;
}

/* Mode Toggle */
.mode-toggle {
  display: flex;
  justify-content: center;
  gap: 0.5rem;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--bg-elevated);
  border: 1px solid var(--border-medium);
  border-radius: 20px;
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-btn:hover { background: var(--pill-bg-hover); color: var(--text-secondary); }
.mode-btn.active { border-color: var(--text-secondary); color: var(--text-primary); }
.mode-btn svg { width: 16px; height: 16px; }

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
  min-width: 36px;
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
  gap: 1.5rem;
}

/* Phrase display */
.phrase-display {
  text-align: center;
  max-width: 400px;
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

.pulse-ring.delay-1 {
  animation-delay: 0.5s;
}

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

.action-btn:hover {
  background: var(--pill-bg-hover);
  color: var(--text-primary);
}

.action-btn--next {
  background: linear-gradient(145deg, var(--ssi-red-light, #d44545) 0%, var(--ssi-red, #b83232) 100%);
  border-color: transparent;
  color: white;
  box-shadow: 0 2px 8px rgba(194, 58, 58, 0.3);
}

.action-btn--next:hover {
  color: white;
  box-shadow: 0 4px 12px rgba(194, 58, 58, 0.4);
}

/* Idle hint */
.idle-hint {
  text-align: center;
  color: var(--text-muted);
}

.idle-hint p { margin: 0; }

.phrase-count {
  font-size: 0.75rem;
  margin-top: 0.5rem;
  opacity: 0.6;
}

/* Feedback slide transition */
.feedback-slide-enter-active {
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.feedback-slide-leave-active {
  transition: all 0.2s ease-in;
}

.feedback-slide-enter-from {
  opacity: 0;
  transform: translateY(16px);
}

.feedback-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
