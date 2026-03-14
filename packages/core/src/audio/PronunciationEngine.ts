/**
 * PronunciationEngine - Prosody-based pronunciation feedback
 *
 * Compares learner speech against native audio using pitch contour matching.
 * No speech-to-text needed — purely acoustic comparison.
 *
 * Pipeline:
 *   1. Extract pitch contour from native audio (offline, cached per phrase)
 *   2. Record learner via MediaRecorder + extract pitch in real-time
 *   3. Normalize both to semitones (eliminates male/female pitch differences)
 *   4. DTW alignment + scoring
 *
 * Dependencies: pitchy (McLeod Pitch Method, ~15KB)
 */

import { PitchDetector } from 'pitchy'

// ============================================
// TYPES
// ============================================

export interface PitchContour {
  /** Time offsets in seconds */
  times: number[]
  /** Fundamental frequencies in Hz (0 = unvoiced) */
  frequencies: number[]
  /** Clarity/confidence scores 0-1 */
  clarities: number[]
  /** Sample rate used for extraction */
  sampleRate: number
}

export interface ProsodyScore {
  /** Pitch contour similarity 0-100 */
  pitch: number
  /** Rhythm/timing similarity 0-100 */
  rhythm: number
  /** Duration ratio similarity 0-100 */
  timing: number
  /** Weighted overall score 0-100 */
  overall: number
}

export interface PronunciationResult {
  /** The computed scores */
  score: ProsodyScore
  /** Native pitch contour (semitone-normalized) */
  nativeContour: number[]
  /** Learner pitch contour (semitone-normalized) */
  learnerContour: number[]
  /** DTW alignment path (indices into native/learner) */
  alignmentPath: [number, number][]
  /** Learner audio duration in ms */
  learnerDurationMs: number
  /** Native audio duration in ms */
  nativeDurationMs: number
}

/** Per-language prosody weights */
export interface ProsodyWeights {
  pitch: number
  rhythm: number
  timing: number
}

// ============================================
// LANGUAGE WEIGHTS
// ============================================

const PROSODY_WEIGHTS: Record<string, ProsodyWeights> = {
  // Tonal — pitch is paramount
  cmn: { pitch: 0.7, rhythm: 0.15, timing: 0.15 },
  zho: { pitch: 0.7, rhythm: 0.15, timing: 0.15 },
  yue: { pitch: 0.7, rhythm: 0.15, timing: 0.15 },
  tha: { pitch: 0.6, rhythm: 0.2, timing: 0.2 },
  vie: { pitch: 0.6, rhythm: 0.2, timing: 0.2 },

  // Pitch-accent
  jpn: { pitch: 0.5, rhythm: 0.25, timing: 0.25 },
  kor: { pitch: 0.4, rhythm: 0.3, timing: 0.3 },

  // Stress-timed — rhythm matters most
  eng: { pitch: 0.3, rhythm: 0.45, timing: 0.25 },
  deu: { pitch: 0.3, rhythm: 0.45, timing: 0.25 },
  nld: { pitch: 0.3, rhythm: 0.45, timing: 0.25 },
  rus: { pitch: 0.3, rhythm: 0.45, timing: 0.25 },

  // Syllable-timed — even duration matters
  spa: { pitch: 0.3, rhythm: 0.3, timing: 0.4 },
  fra: { pitch: 0.3, rhythm: 0.3, timing: 0.4 },
  ita: { pitch: 0.3, rhythm: 0.3, timing: 0.4 },
  por: { pitch: 0.3, rhythm: 0.3, timing: 0.4 },

  // Mora-timed
  // jpn already covered above

  // Celtic
  cym: { pitch: 0.35, rhythm: 0.35, timing: 0.3 },
  gle: { pitch: 0.35, rhythm: 0.35, timing: 0.3 },
  gla: { pitch: 0.35, rhythm: 0.35, timing: 0.3 },

  // Semitic
  ara: { pitch: 0.3, rhythm: 0.35, timing: 0.35 },
  heb: { pitch: 0.3, rhythm: 0.35, timing: 0.35 },
}

const DEFAULT_WEIGHTS: ProsodyWeights = { pitch: 0.35, rhythm: 0.35, timing: 0.3 }

export function getWeightsForLanguage(langCode: string): ProsodyWeights {
  return PROSODY_WEIGHTS[langCode] || DEFAULT_WEIGHTS
}

// ============================================
// PITCH EXTRACTION
// ============================================

/** Frame rate for pitch analysis (frames per second) */
const ANALYSIS_FPS = 50
/** Minimum clarity to consider a frame "voiced" */
const MIN_CLARITY = 0.8

/**
 * Extract pitch contour from an AudioBuffer (offline analysis).
 * Runs pitchy's McLeod Pitch Method on overlapping frames.
 */
export function extractPitchContour(audioBuffer: AudioBuffer): PitchContour {
  // Mix to mono if stereo
  const channelData = audioBuffer.numberOfChannels > 1
    ? mixToMono(audioBuffer)
    : audioBuffer.getChannelData(0)

  const sampleRate = audioBuffer.sampleRate
  const frameSize = Math.round(sampleRate / ANALYSIS_FPS)
  // pitchy needs power-of-2 input size; use 2048 or 4096
  const inputSize = frameSize <= 2048 ? 2048 : 4096
  const detector = PitchDetector.forFloat32Array(inputSize)

  const times: number[] = []
  const frequencies: number[] = []
  const clarities: number[] = []

  for (let offset = 0; offset + inputSize <= channelData.length; offset += frameSize) {
    const frame = channelData.slice(offset, offset + inputSize)
    const [pitch, clarity] = detector.findPitch(frame, sampleRate)

    times.push(offset / sampleRate)
    frequencies.push(clarity >= MIN_CLARITY ? pitch : 0)
    clarities.push(clarity)
  }

  return { times, frequencies, clarities, sampleRate }
}

/**
 * Mix multi-channel AudioBuffer to mono Float32Array
 */
function mixToMono(buffer: AudioBuffer): Float32Array {
  const length = buffer.length
  const mono = new Float32Array(length)
  const numChannels = buffer.numberOfChannels

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i] / numChannels
    }
  }

  return mono
}

// ============================================
// SEMITONE NORMALIZATION
// ============================================

/**
 * Convert voiced F0 values to semitones relative to speaker's mean F0.
 * This eliminates differences between male/female voices.
 *
 * Formula: semitones = 12 * log2(f0 / mean_f0)
 *
 * Returns only voiced frames (unvoiced frames are dropped).
 */
export function toSemitones(contour: PitchContour): number[] {
  // Filter to voiced frames only
  const voiced = contour.frequencies.filter((f, i) => f > 0 && contour.clarities[i] >= MIN_CLARITY)

  if (voiced.length === 0) return []

  // Calculate geometric mean (more appropriate for frequencies)
  const logSum = voiced.reduce((sum, f) => sum + Math.log2(f), 0)
  const meanF0 = Math.pow(2, logSum / voiced.length)

  return voiced.map(f => 12 * Math.log2(f / meanF0))
}

// ============================================
// DTW (Dynamic Time Warping)
// ============================================

/**
 * Compute DTW distance and alignment path between two sequences.
 * Inline implementation — avoids a dependency for ~30 lines of code.
 */
export function dtw(seq1: number[], seq2: number[]): { distance: number; path: [number, number][] } {
  const n = seq1.length
  const m = seq2.length

  if (n === 0 || m === 0) return { distance: Infinity, path: [] }

  // Cost matrix
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity))
  cost[0][0] = 0

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = Math.abs(seq1[i - 1] - seq2[j - 1])
      cost[i][j] = d + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1])
    }
  }

  // Backtrack to find optimal path
  const path: [number, number][] = []
  let i = n, j = m
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1])
    const options = [
      { val: cost[i - 1][j - 1], di: -1, dj: -1 },
      { val: cost[i - 1][j], di: -1, dj: 0 },
      { val: cost[i][j - 1], di: 0, dj: -1 },
    ]
    const best = options.reduce((a, b) => a.val <= b.val ? a : b)
    i += best.di
    j += best.dj
  }

  path.reverse()

  // Normalize distance by path length
  const normalizedDistance = cost[n][m] / path.length

  return { distance: normalizedDistance, path }
}

// ============================================
// RHYTHM ANALYSIS
// ============================================

/**
 * Compute inter-onset intervals from a pitch contour.
 * An "onset" is a transition from unvoiced to voiced.
 */
function getInterOnsetIntervals(contour: PitchContour): number[] {
  const intervals: number[] = []
  let lastOnsetTime: number | null = null
  let wasVoiced = false

  for (let i = 0; i < contour.frequencies.length; i++) {
    const isVoiced = contour.frequencies[i] > 0 && contour.clarities[i] >= MIN_CLARITY
    if (isVoiced && !wasVoiced) {
      // Onset detected
      if (lastOnsetTime !== null) {
        intervals.push(contour.times[i] - lastOnsetTime)
      }
      lastOnsetTime = contour.times[i]
    }
    wasVoiced = isVoiced
  }

  return intervals
}

/**
 * Compute rhythm similarity between two IOI sequences.
 * Normalizes IOIs to ratios (each / mean) then correlates.
 */
function rhythmSimilarity(nativeIOI: number[], learnerIOI: number[]): number {
  if (nativeIOI.length < 2 || learnerIOI.length < 2) return 50 // neutral if not enough data

  // Normalize to ratios
  const normalize = (arr: number[]): number[] => {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length
    return mean > 0 ? arr.map(v => v / mean) : arr
  }

  const nNorm = normalize(nativeIOI)
  const lNorm = normalize(learnerIOI)

  // DTW on rhythm ratios
  const { distance } = dtw(nNorm, lNorm)

  // Convert distance to 0-100 score (lower distance = higher score)
  // Empirically, distance > 2.0 is very poor
  return Math.max(0, Math.min(100, 100 * (1 - distance / 2.0)))
}

// ============================================
// SCORING
// ============================================

/**
 * Compare native and learner pitch contours, returning a full PronunciationResult.
 */
export function compareProsody(
  nativeContour: PitchContour,
  learnerContour: PitchContour,
  langCode: string
): PronunciationResult {
  const weights = getWeightsForLanguage(langCode)

  // 1. Semitone normalization
  const nSemitones = toSemitones(nativeContour)
  const lSemitones = toSemitones(learnerContour)

  // 2. Pitch score via DTW
  let pitchScore = 50 // default if insufficient data
  let alignmentPath: [number, number][] = []

  if (nSemitones.length >= 3 && lSemitones.length >= 3) {
    const result = dtw(nSemitones, lSemitones)
    alignmentPath = result.path
    // Distance of 0 = perfect, > 5 semitones avg = very poor
    pitchScore = Math.max(0, Math.min(100, 100 * (1 - result.distance / 5)))
  }

  // 3. Rhythm score via IOI comparison
  const nIOI = getInterOnsetIntervals(nativeContour)
  const lIOI = getInterOnsetIntervals(learnerContour)
  const rhythmScore = rhythmSimilarity(nIOI, lIOI)

  // 4. Timing score via duration ratio
  const nDuration = nativeContour.times.length > 0
    ? nativeContour.times[nativeContour.times.length - 1]
    : 0
  const lDuration = learnerContour.times.length > 0
    ? learnerContour.times[learnerContour.times.length - 1]
    : 0

  let timingScore = 50
  if (nDuration > 0 && lDuration > 0) {
    const ratio = lDuration / nDuration
    // 1.0 = perfect, penalize quadratically for deviation
    timingScore = Math.max(0, Math.min(100, 100 * (1 - Math.pow(Math.abs(1 - ratio), 1.5))))
  }

  // 5. Weighted overall
  const overall = Math.round(
    weights.pitch * pitchScore +
    weights.rhythm * rhythmScore +
    weights.timing * timingScore
  )

  return {
    score: {
      pitch: Math.round(pitchScore),
      rhythm: Math.round(rhythmScore),
      timing: Math.round(timingScore),
      overall,
    },
    nativeContour: nSemitones,
    learnerContour: lSemitones,
    alignmentPath,
    learnerDurationMs: lDuration * 1000,
    nativeDurationMs: nDuration * 1000,
  }
}

// ============================================
// RECORDING (MediaRecorder integration)
// ============================================

/**
 * Record audio from a MediaStream using MediaRecorder.
 * Returns a promise that resolves to an AudioBuffer when stopped.
 */
export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private audioContext: AudioContext
  private resolveRecording: ((buffer: AudioBuffer) => void) | null = null
  private rejectRecording: ((error: Error) => void) | null = null

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext
  }

  /**
   * Start recording from the given MediaStream.
   * Returns a Promise<AudioBuffer> that resolves when stop() is called.
   */
  start(stream: MediaStream): Promise<AudioBuffer> {
    this.chunks = []

    // Prefer webm/opus, fall back to whatever's available
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '' // let browser choose

    this.mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }

    this.mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' })
        const arrayBuffer = await blob.arrayBuffer()
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer)
        this.resolveRecording?.(audioBuffer)
      } catch (error) {
        this.rejectRecording?.(error instanceof Error ? error : new Error(String(error)))
      }
    }

    this.mediaRecorder.onerror = (event) => {
      this.rejectRecording?.(new Error(`MediaRecorder error: ${event}`))
    }

    this.mediaRecorder.start(100) // collect in 100ms chunks

    return new Promise<AudioBuffer>((resolve, reject) => {
      this.resolveRecording = resolve
      this.rejectRecording = reject
    })
  }

  /**
   * Stop recording. The Promise from start() will resolve.
   */
  stop(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop()
    }
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording'
  }
}

// ============================================
// NATIVE AUDIO PITCH CACHE
// ============================================

/** Cache of extracted pitch contours for native audio, keyed by phrase ID */
const nativePitchCache = new Map<string, PitchContour>()

/**
 * Get or compute the pitch contour for a native audio buffer.
 * Results are cached by phraseId since native audio is immutable.
 */
export function getNativePitchContour(phraseId: string, audioBuffer: AudioBuffer): PitchContour {
  const cached = nativePitchCache.get(phraseId)
  if (cached) return cached

  const contour = extractPitchContour(audioBuffer)
  nativePitchCache.set(phraseId, contour)
  return contour
}

/**
 * Clear the native pitch cache (e.g., on course change)
 */
export function clearNativePitchCache(): void {
  nativePitchCache.clear()
}
