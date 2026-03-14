/**
 * PronunciationEngine - Prosody-based pronunciation feedback
 *
 * Compares learner speech against native audio using envelope matching.
 * No speech-to-text, no frame-level pitch DTW.
 *
 * Three signals (what a human listener actually notices):
 *   1. Duration — is the utterance roughly the right length?
 *   2. Peak count — does it have the right number of "bumps" (≈ syllables)?
 *   3. Envelope shape — does the stress pattern roughly match?
 *
 * Critical first step: trim silence from learner recording.
 * MediaRecorder captures mic-click, room noise, and dead air that
 * would otherwise destroy any comparison.
 */

// ============================================
// TYPES
// ============================================

export interface PitchContour {
  /** Time offsets in seconds */
  times: number[]
  /** Fundamental frequencies in Hz (0 = unvoiced) — kept for visualization */
  frequencies: number[]
  /** Clarity/confidence scores 0-1 */
  clarities: number[]
  /** Sample rate used for extraction */
  sampleRate: number
  /** RMS energy envelope (one value per frame) */
  energy: number[]
}

export interface ProsodyScore {
  /** Duration match 0-100 */
  duration: number
  /** Peak count (syllable) match 0-100 */
  peakCount: number
  /** Envelope shape similarity 0-100 */
  envelope: number
  /** Weighted overall score 0-100 */
  overall: number
}

export interface PronunciationResult {
  score: ProsodyScore
  /** Native energy envelope (trimmed, normalized) */
  nativeContour: number[]
  /** Learner energy envelope (trimmed, normalized) */
  learnerContour: number[]
  /** Not used in new engine, kept for interface compat */
  alignmentPath: [number, number][]
  learnerDurationMs: number
  nativeDurationMs: number
}

/** Per-language prosody weights */
export interface ProsodyWeights {
  duration: number
  peakCount: number
  envelope: number
}

// ============================================
// LANGUAGE WEIGHTS
// ============================================

const PROSODY_WEIGHTS: Record<string, ProsodyWeights> = {
  // Tonal — envelope shape matters most (tone = energy contour)
  cmn: { duration: 0.2, peakCount: 0.3, envelope: 0.5 },
  zho: { duration: 0.2, peakCount: 0.3, envelope: 0.5 },
  yue: { duration: 0.2, peakCount: 0.3, envelope: 0.5 },
  tha: { duration: 0.25, peakCount: 0.3, envelope: 0.45 },
  vie: { duration: 0.25, peakCount: 0.3, envelope: 0.45 },

  // Pitch-accent
  jpn: { duration: 0.25, peakCount: 0.35, envelope: 0.4 },
  kor: { duration: 0.25, peakCount: 0.35, envelope: 0.4 },

  // Stress-timed — peak count and envelope both matter
  eng: { duration: 0.25, peakCount: 0.35, envelope: 0.4 },
  deu: { duration: 0.25, peakCount: 0.35, envelope: 0.4 },
  nld: { duration: 0.25, peakCount: 0.35, envelope: 0.4 },
  rus: { duration: 0.25, peakCount: 0.35, envelope: 0.4 },

  // Syllable-timed — duration and peak count matter most
  spa: { duration: 0.3, peakCount: 0.4, envelope: 0.3 },
  fra: { duration: 0.3, peakCount: 0.4, envelope: 0.3 },
  ita: { duration: 0.3, peakCount: 0.4, envelope: 0.3 },
  por: { duration: 0.3, peakCount: 0.4, envelope: 0.3 },

  // Celtic
  cym: { duration: 0.3, peakCount: 0.35, envelope: 0.35 },
  gle: { duration: 0.3, peakCount: 0.35, envelope: 0.35 },
  gla: { duration: 0.3, peakCount: 0.35, envelope: 0.35 },

  // Semitic
  ara: { duration: 0.3, peakCount: 0.35, envelope: 0.35 },
  heb: { duration: 0.3, peakCount: 0.35, envelope: 0.35 },
}

const DEFAULT_WEIGHTS: ProsodyWeights = { duration: 0.25, peakCount: 0.35, envelope: 0.4 }

export function getWeightsForLanguage(langCode: string): ProsodyWeights {
  return PROSODY_WEIGHTS[langCode] || DEFAULT_WEIGHTS
}

// ============================================
// ENERGY EXTRACTION
// ============================================

/** Frame rate for energy analysis */
const ANALYSIS_FPS = 50

/**
 * Extract energy envelope from an AudioBuffer.
 * Also extracts pitch for visualization (kept from v1).
 */
export function extractPitchContour(audioBuffer: AudioBuffer): PitchContour {
  const channelData = audioBuffer.numberOfChannels > 1
    ? mixToMono(audioBuffer)
    : audioBuffer.getChannelData(0)

  const sampleRate = audioBuffer.sampleRate
  const frameSize = Math.round(sampleRate / ANALYSIS_FPS)

  const times: number[] = []
  const frequencies: number[] = [] // kept for viz, not used in scoring
  const clarities: number[] = []
  const energy: number[] = []

  for (let offset = 0; offset + frameSize <= channelData.length; offset += frameSize) {
    // RMS energy for this frame
    let sumSq = 0
    for (let i = offset; i < offset + frameSize; i++) {
      sumSq += channelData[i] * channelData[i]
    }
    const rms = Math.sqrt(sumSq / frameSize)

    times.push(offset / sampleRate)
    frequencies.push(0) // placeholder — pitch not used in scoring
    clarities.push(rms > 0.01 ? 0.95 : 0.1) // voiced if energy above noise floor
    energy.push(rms)
  }

  return { times, frequencies, clarities, sampleRate, energy }
}

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
// SILENCE TRIMMING
// ============================================

/**
 * Trim leading and trailing silence from an energy envelope.
 * Uses a threshold relative to the signal's own energy.
 * Returns the trimmed slice indices [start, end).
 */
export function trimSilence(energy: number[]): [number, number] {
  if (energy.length === 0) return [0, 0]

  // Threshold = 25% of peak energy — high enough to cut through background noise
  // In a noisy room, the "silence" floor is much higher than in a studio
  const peak = Math.max(...energy)
  const threshold = Math.max(peak * 0.25, 0.008)

  let start = 0
  while (start < energy.length && energy[start] < threshold) start++

  let end = energy.length
  while (end > start && energy[end - 1] < threshold) end--

  // If somehow everything is below threshold, return the whole thing
  if (start >= end) return [0, energy.length]

  return [start, end]
}

// ============================================
// PEAK DETECTION (≈ syllable counting)
// ============================================

/**
 * Count energy peaks in a contour. Each peak ≈ one syllable nucleus.
 * Uses a smoothed envelope to avoid counting noise as peaks.
 */
export function countEnergyPeaks(energy: number[]): number {
  if (energy.length < 3) return energy.length > 0 ? 1 : 0

  // Smooth with a 7-frame moving average — wider window to suppress noise bumps
  const smoothed = smooth(energy, 7)

  // Find local maxima that are clearly above the noise floor
  // Use 70th percentile as threshold (more noise-resistant than mean)
  const sorted = [...smoothed].sort((a, b) => a - b)
  const p70 = sorted[Math.floor(sorted.length * 0.7)] || 0
  const threshold = Math.max(p70 * 0.6, sorted[Math.floor(sorted.length * 0.3)] || 0)

  let peaks = 0
  for (let i = 1; i < smoothed.length - 1; i++) {
    if (smoothed[i] > smoothed[i - 1] &&
        smoothed[i] > smoothed[i + 1] &&
        smoothed[i] > threshold) {
      peaks++
      // Skip ahead — minimum ~100ms between syllable nuclei
      i += 4
    }
  }

  return Math.max(1, peaks)
}

function smooth(arr: number[], windowSize: number): number[] {
  const half = Math.floor(windowSize / 2)
  return arr.map((_, i) => {
    let sum = 0, count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j]
      count++
    }
    return sum / count
  })
}

// ============================================
// ENVELOPE SHAPE COMPARISON
// ============================================

/**
 * Downsample an energy envelope to N bins and normalize to sum=1.
 * This gives a "shape" that's independent of absolute loudness or duration.
 */
export function normalizeEnvelope(energy: number[], bins: number = 20): number[] {
  if (energy.length === 0) return new Array(bins).fill(1 / bins)

  // If fewer samples than bins, reduce bin count to match
  const actualBins = Math.min(bins, energy.length)
  const binSize = energy.length / actualBins
  const result: number[] = []

  for (let b = 0; b < actualBins; b++) {
    const start = Math.floor(b * binSize)
    const end = Math.max(start + 1, Math.floor((b + 1) * binSize))
    let sum = 0
    for (let i = start; i < Math.min(end, energy.length); i++) {
      sum += energy[i]
    }
    result.push(sum / (end - start))
  }

  // Pad to target bin count if we reduced
  while (result.length < bins) {
    result.push(result[result.length - 1] || 0)
  }

  // Normalize to sum = 1
  const total = result.reduce((a, b) => a + b, 0)
  if (total > 0) {
    for (let i = 0; i < result.length; i++) result[i] /= total
  }

  return result
}

/**
 * Compare two normalized envelopes using cosine similarity.
 * Returns 0-100 (100 = identical shape).
 */
export function envelopeSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 50

  let dotProduct = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 50

  // Cosine similarity is -1 to 1; speech envelopes are always positive so 0 to 1
  const cosSim = dotProduct / denom

  // Map to 0-100 — linear, not squared. Background noise flattens contrast
  // so even "good" attempts get lower cosine similarity than in a studio.
  // cosSim of 0.7+ should feel like a decent match
  return Math.max(0, Math.min(100, cosSim * 100))
}

// ============================================
// SCORING
// ============================================

/**
 * Compare native and learner audio, returning a prosody-based score.
 *
 * Step 1: Trim silence (fixes MediaRecorder start/end noise)
 * Step 2: Duration score (right length?)
 * Step 3: Peak count score (right number of syllables?)
 * Step 4: Envelope shape score (similar stress pattern?)
 */
export function compareProsody(
  nativeContour: PitchContour,
  learnerContour: PitchContour,
  langCode: string
): PronunciationResult {
  const weights = getWeightsForLanguage(langCode)

  // 1. Trim silence from both
  const [nStart, nEnd] = trimSilence(nativeContour.energy)
  const [lStart, lEnd] = trimSilence(learnerContour.energy)

  const nEnergy = nativeContour.energy.slice(nStart, nEnd)
  const lEnergy = learnerContour.energy.slice(lStart, lEnd)

  // Trimmed durations in seconds
  const nDuration = nEnergy.length / ANALYSIS_FPS
  const lDuration = lEnergy.length / ANALYSIS_FPS

  // 2. Duration score — very generous, noisy trimming shifts boundaries
  //    ±40% is still 80+, ±60% is ~60, only 2x+ difference tanks it
  let durationScore = 50
  if (nDuration > 0 && lDuration > 0) {
    const ratio = lDuration / nDuration
    const deviation = Math.abs(1 - ratio)
    durationScore = Math.max(0, Math.min(100, 100 * Math.exp(-1.5 * deviation * deviation)))
  }

  // 3. Peak count score — forgiving because background noise creates phantom peaks
  const nPeaks = countEnergyPeaks(nEnergy)
  const lPeaks = countEnergyPeaks(lEnergy)

  let peakCountScore: number
  if (nPeaks === lPeaks) {
    peakCountScore = 100
  } else {
    const diff = Math.abs(nPeaks - lPeaks)
    // Off by 1: still ~85. Off by 2: ~70. Off by 3+: gradual falloff
    peakCountScore = Math.max(0, Math.min(100, 100 * Math.exp(-0.3 * diff * diff)))
  }

  // 4. Envelope shape — does the stress pattern match?
  const nNorm = normalizeEnvelope(nEnergy)
  const lNorm = normalizeEnvelope(lEnergy)
  const envelopeScore = envelopeSimilarity(nNorm, lNorm)

  // 5. Weighted overall
  const overall = Math.round(
    weights.duration * durationScore +
    weights.peakCount * peakCountScore +
    weights.envelope * envelopeScore
  )

  return {
    score: {
      duration: Math.round(durationScore),
      peakCount: Math.round(peakCountScore),
      envelope: Math.round(envelopeScore),
      overall,
    },
    nativeContour: nNorm,
    learnerContour: lNorm,
    alignmentPath: [],
    learnerDurationMs: lDuration * 1000,
    nativeDurationMs: nDuration * 1000,
  }
}

// ============================================
// DTW (kept for potential future use / backwards compat)
// ============================================

export function dtw(seq1: number[], seq2: number[]): { distance: number; path: [number, number][] } {
  const n = seq1.length
  const m = seq2.length
  if (n === 0 || m === 0) return { distance: Infinity, path: [] }

  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity))
  cost[0][0] = 0

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = Math.abs(seq1[i - 1] - seq2[j - 1])
      cost[i][j] = d + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1])
    }
  }

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

  return { distance: cost[n][m] / path.length, path }
}

// ============================================
// SEMITONE NORMALIZATION (kept for viz / backwards compat)
// ============================================

const MIN_CLARITY = 0.8

export function toSemitones(contour: PitchContour): number[] {
  const voiced = contour.frequencies.filter((f, i) => f > 0 && contour.clarities[i] >= MIN_CLARITY)
  if (voiced.length === 0) return []
  const logSum = voiced.reduce((sum, f) => sum + Math.log2(f), 0)
  const meanF0 = Math.pow(2, logSum / voiced.length)
  return voiced.map(f => 12 * Math.log2(f / meanF0))
}

// ============================================
// RECORDING
// ============================================

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private audioContext: AudioContext
  private resolveRecording: ((buffer: AudioBuffer) => void) | null = null
  private rejectRecording: ((error: Error) => void) | null = null

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext
  }

  start(stream: MediaStream): Promise<AudioBuffer> {
    this.chunks = []

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : ''

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

    this.mediaRecorder.start(100)

    return new Promise<AudioBuffer>((resolve, reject) => {
      this.resolveRecording = resolve
      this.rejectRecording = reject
    })
  }

  stop(): void {
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop()
    }
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === 'recording'
  }
}

// ============================================
// NATIVE AUDIO CACHE
// ============================================

const nativePitchCache = new Map<string, PitchContour>()

export function getNativePitchContour(phraseId: string, audioBuffer: AudioBuffer): PitchContour {
  const cached = nativePitchCache.get(phraseId)
  if (cached) return cached
  const contour = extractPitchContour(audioBuffer)
  nativePitchCache.set(phraseId, contour)
  return contour
}

export function clearNativePitchCache(): void {
  nativePitchCache.clear()
}
