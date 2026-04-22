/**
 * usePronunciationMode - Vue composable for pronunciation feedback mode
 *
 * Coordinates:
 *   1. Recording learner speech via MediaRecorder
 *   2. Extracting pitch contours from native + learner audio
 *   3. Comparing prosody via DTW
 *   4. Exposing results for ProsodyFeedback.vue visualization
 *
 * Reuses the existing VoiceActivityDetector's MediaStream (mic already granted).
 */

import { ref, computed, type Ref } from 'vue'
import {
  extractPitchContour,
  compareProsody,
  AudioRecorder,
  getNativePitchContour,
  clearNativePitchCache,
  type PitchContour,
  type PronunciationResult,
} from '@ssi/core/audio'

// ============================================
// STATE
// ============================================

/** Whether pronunciation mode is active */
const isActive = ref(false)

/** Current pronunciation result (null until comparison complete) */
const currentResult: Ref<PronunciationResult | null> = ref(null)

/** Whether we're currently recording the learner */
const isRecording = ref(false)

/** Whether we're analyzing (between recording end and result ready) */
const isAnalyzing = ref(false)

/** Whether feedback is ready to display */
const feedbackReady = computed(() => currentResult.value !== null)

/** The AudioRecorder instance */
let recorder: AudioRecorder | null = null

/** The AudioContext shared with VAD */
let audioContext: AudioContext | null = null

/** The MediaStream from VAD's mic */
let mediaStream: MediaStream | null = null

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize pronunciation mode with the existing audio infrastructure.
 * Call this once when the mic is first granted (VAD init succeeds).
 */
function initialize(ctx: AudioContext, stream: MediaStream): void {
  audioContext = ctx
  mediaStream = stream
  recorder = new AudioRecorder(ctx)
}

/**
 * Check if pronunciation mode is ready to use
 */
function isInitialized(): boolean {
  return audioContext !== null && mediaStream !== null && recorder !== null
}

// ============================================
// RECORDING FLOW
// ============================================

/** Promise that resolves with the learner's AudioBuffer when recording stops */
let recordingPromise: Promise<AudioBuffer> | null = null

/**
 * Start recording the learner's pronunciation attempt.
 * Call this when the PAUSE phase begins (or when learner taps "record").
 */
function startRecording(): boolean {
  if (!isInitialized() || !mediaStream || !recorder) {
    console.warn('[PronunciationMode] Not initialized')
    return false
  }

  if (isRecording.value) {
    console.warn('[PronunciationMode] Already recording')
    return false
  }

  currentResult.value = null
  isRecording.value = true
  isAnalyzing.value = false

  recordingPromise = recorder.start(mediaStream)
  return true
}

/**
 * Stop recording and compare against native audio.
 *
 * @param nativeAudioBuffer The native phrase audio as an AudioBuffer
 * @param phraseId Unique phrase identifier (for caching native pitch)
 * @param langCode ISO 639-3 language code (for per-language weights)
 */
async function stopRecordingAndCompare(
  nativeAudioBuffer: AudioBuffer,
  phraseId: string,
  langCode: string,
): Promise<PronunciationResult | null> {
  if (!recorder || !isRecording.value || !recordingPromise) {
    console.warn('[PronunciationMode] Not recording')
    return null
  }

  // Stop the recorder (triggers ondataavailable → onstop → resolve)
  recorder.stop()
  isRecording.value = false
  isAnalyzing.value = true

  try {
    // Wait for the recorded audio
    const learnerBuffer = await recordingPromise

    // Extract pitch contours
    const nativeContour = getNativePitchContour(phraseId, nativeAudioBuffer)
    const learnerContour = extractPitchContour(learnerBuffer)

    // Compare prosody
    const result = compareProsody(nativeContour, learnerContour, langCode)

    currentResult.value = result
    isAnalyzing.value = false

    console.log(`[PronunciationMode] Score: ${result.score.overall}% (duration: ${result.score.duration}, peakCount: ${result.score.peakCount}, envelope: ${result.score.envelope})`)

    return result
  } catch (error) {
    console.error('[PronunciationMode] Analysis failed:', error)
    isAnalyzing.value = false
    return null
  }
}

// ============================================
// MODE LIFECYCLE
// ============================================

function enter(): void {
  isActive.value = true
  currentResult.value = null
  isRecording.value = false
  isAnalyzing.value = false
}

function exit(): void {
  // Stop any in-progress recording
  if (isRecording.value && recorder) {
    recorder.stop()
  }
  isActive.value = false
  currentResult.value = null
  isRecording.value = false
  isAnalyzing.value = false
}

function clearResult(): void {
  currentResult.value = null
}

// ============================================
// COMPOSABLE
// ============================================

export function usePronunciationMode() {
  return {
    // State
    isActive: computed(() => isActive.value),
    isRecording: computed(() => isRecording.value),
    isAnalyzing: computed(() => isAnalyzing.value),
    feedbackReady,
    currentResult: computed(() => currentResult.value),

    // Methods
    initialize,
    isInitialized,
    enter,
    exit,
    startRecording,
    stopRecordingAndCompare,
    clearResult,
    clearNativePitchCache,
  }
}

export default usePronunciationMode
