/**
 * Audio Concatenation Utility for Driving Mode
 *
 * Concatenates multiple audio files for a round into a single WAV blob,
 * enabling background playback on iOS Safari. This is essential for the
 * Driving Mode feature where audio must continue playing when the screen
 * is locked or the browser is backgrounded.
 *
 * The concatenation process:
 * 1. For each cycle: known audio -> 4s pause -> voice1 -> voice2
 * 2. 200ms gaps between audio files
 * 3. Track segment boundaries for position mapping during playback
 * 4. Encode to 16-bit WAV for maximum compatibility
 */

import type { Cycle } from '../types/Cycle'
import type { GetAudioSourceFn, AudioSource } from '../playback/types'

// ============================================================================
// Exported Types
// ============================================================================

export interface AudioSegment {
  id: string           // Cycle ID or audio ID
  phase: 'known' | 'pause' | 'voice1' | 'voice2'
  startTime: number    // Seconds into concatenated file
  endTime: number
  cycleIndex: number   // Which cycle this belongs to
}

export interface ConcatenatedAudio {
  blob: Blob
  blobUrl: string
  segments: AudioSegment[]
  totalDuration: number
}

// ============================================================================
// Constants
// ============================================================================

const SAMPLE_RATE = 44100
const NUM_CHANNELS = 2  // Stereo for better compatibility
const BITS_PER_SAMPLE = 16
const PAUSE_DURATION = 4.0      // 4 seconds of silence for PAUSE phase
const GAP_DURATION = 0.2        // 200ms gaps between audio files

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Write an ASCII string to a DataView at the specified offset.
 */
function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

/**
 * Fetch audio data from a source and return as ArrayBuffer.
 */
async function fetchAudioData(source: AudioSource): Promise<ArrayBuffer | null> {
  try {
    if (source.type === 'blob') {
      return await source.blob.arrayBuffer()
    } else if (source.type === 'url') {
      const response = await fetch(source.url)
      if (!response.ok) {
        console.warn(`Failed to fetch audio from URL: ${source.url}`)
        return null
      }
      return await response.arrayBuffer()
    }
    return null
  } catch (error) {
    console.warn('Error fetching audio data:', error)
    return null
  }
}

/**
 * Decode audio data to an AudioBuffer using the provided AudioContext.
 */
async function decodeAudio(
  audioContext: AudioContext,
  data: ArrayBuffer
): Promise<AudioBuffer | null> {
  try {
    // Create a copy of the data since decodeAudioData may detach the buffer
    const dataCopy = data.slice(0)
    return await audioContext.decodeAudioData(dataCopy)
  } catch (error) {
    console.warn('Error decoding audio data:', error)
    return null
  }
}

/**
 * Create an AudioBuffer filled with silence.
 */
function createSilence(
  audioContext: AudioContext,
  durationSeconds: number
): AudioBuffer {
  const numSamples = Math.ceil(durationSeconds * SAMPLE_RATE)
  const buffer = audioContext.createBuffer(NUM_CHANNELS, numSamples, SAMPLE_RATE)
  // AudioBuffer is zero-initialized by default, so it's already silent
  return buffer
}

/**
 * Resample an AudioBuffer to the target sample rate if necessary.
 * Also converts to stereo if the source is mono.
 */
function normalizeBuffer(
  audioContext: AudioContext,
  buffer: AudioBuffer
): AudioBuffer {
  const needsResample = buffer.sampleRate !== SAMPLE_RATE
  const needsStereoConversion = buffer.numberOfChannels === 1

  if (!needsResample && !needsStereoConversion && buffer.numberOfChannels === NUM_CHANNELS) {
    return buffer
  }

  // Calculate the new length based on sample rate conversion
  const ratio = SAMPLE_RATE / buffer.sampleRate
  const newLength = Math.ceil(buffer.length * ratio)

  // Create a new buffer at the target sample rate
  const newBuffer = audioContext.createBuffer(NUM_CHANNELS, newLength, SAMPLE_RATE)

  for (let channel = 0; channel < NUM_CHANNELS; channel++) {
    const sourceChannel = buffer.numberOfChannels === 1 ? 0 : Math.min(channel, buffer.numberOfChannels - 1)
    const sourceData = buffer.getChannelData(sourceChannel)
    const destData = newBuffer.getChannelData(channel)

    if (needsResample) {
      // Linear interpolation for resampling
      for (let i = 0; i < newLength; i++) {
        const srcIndex = i / ratio
        const srcIndexFloor = Math.floor(srcIndex)
        const srcIndexCeil = Math.min(srcIndexFloor + 1, sourceData.length - 1)
        const fraction = srcIndex - srcIndexFloor

        destData[i] = sourceData[srcIndexFloor] * (1 - fraction) + sourceData[srcIndexCeil] * fraction
      }
    } else {
      // Just copy the data
      destData.set(sourceData.subarray(0, Math.min(sourceData.length, destData.length)))
    }
  }

  return newBuffer
}

/**
 * Concatenate multiple AudioBuffers into a single buffer.
 */
function concatenateBuffers(
  audioContext: AudioContext,
  buffers: AudioBuffer[]
): AudioBuffer {
  if (buffers.length === 0) {
    return createSilence(audioContext, 0.1)
  }

  if (buffers.length === 1) {
    return buffers[0]
  }

  // Calculate total length
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0)

  // Create the output buffer
  const outputBuffer = audioContext.createBuffer(NUM_CHANNELS, totalLength, SAMPLE_RATE)

  // Copy each buffer's data
  let offset = 0
  for (const buffer of buffers) {
    for (let channel = 0; channel < NUM_CHANNELS; channel++) {
      const sourceChannel = Math.min(channel, buffer.numberOfChannels - 1)
      const sourceData = buffer.getChannelData(sourceChannel)
      const destData = outputBuffer.getChannelData(channel)
      destData.set(sourceData, offset)
    }
    offset += buffer.length
  }

  return outputBuffer
}

/**
 * Encode an AudioBuffer to a 16-bit WAV blob.
 */
function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const bitsPerSample = BITS_PER_SAMPLE
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const numSamples = buffer.length
  const dataSize = numSamples * blockAlign
  const headerSize = 44

  // Create WAV file in memory
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(arrayBuffer)

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)  // File size - 8 bytes
  writeString(view, 8, 'WAVE')

  // fmt sub-chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)            // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true)             // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true)   // NumChannels
  view.setUint32(24, sampleRate, true)    // SampleRate
  view.setUint32(28, byteRate, true)      // ByteRate
  view.setUint16(32, blockAlign, true)    // BlockAlign
  view.setUint16(34, bitsPerSample, true) // BitsPerSample

  // data sub-chunk
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)      // Subchunk2Size

  // Write interleaved audio data
  const channelData: Float32Array[] = []
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch))
  }

  let byteOffset = headerSize
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      // Convert float [-1, 1] to 16-bit integer [-32768, 32767]
      const sample = Math.max(-1, Math.min(1, channelData[ch][i]))
      const intSample = sample < 0 ? sample * 32768 : sample * 32767
      view.setInt16(byteOffset, intSample, true)
      byteOffset += 2
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Concatenate all audio files for a round into a single WAV blob.
 *
 * For each cycle, the order is:
 * 1. Known audio (cycle.known.audioId)
 * 2. 4 seconds of silence (PAUSE phase)
 * 3. Voice1 audio (cycle.target.voice1AudioId)
 * 4. Voice2 audio (cycle.target.voice2AudioId)
 *
 * 200ms gaps are added between each audio segment.
 *
 * @param cycles - Array of Cycle objects containing audio IDs
 * @param getAudioSource - Function to fetch audio source by ID
 * @param audioContext - Web Audio API context for decoding
 * @param onProgress - Optional callback for progress updates (0-1)
 * @returns Promise resolving to concatenated audio with segment mapping
 */
export async function concatenateRound(
  cycles: Cycle[],
  getAudioSource: GetAudioSourceFn,
  audioContext: AudioContext,
  onProgress?: (progress: number) => void
): Promise<ConcatenatedAudio> {
  const segments: AudioSegment[] = []
  const allBuffers: AudioBuffer[] = []

  let currentTime = 0
  const totalSteps = cycles.length * 4  // 4 phases per cycle (known, pause, voice1, voice2)
  let completedSteps = 0

  const reportProgress = () => {
    if (onProgress) {
      onProgress(completedSteps / totalSteps)
    }
  }

  // Create reusable gap buffer
  const gapBuffer = createSilence(audioContext, GAP_DURATION)

  for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex++) {
    const cycle = cycles[cycleIndex]

    // Phase 1: Known audio
    const knownAudioId = cycle.known.audioId
    if (knownAudioId) {
      const knownSource = await getAudioSource(knownAudioId)
      if (knownSource) {
        const audioData = await fetchAudioData(knownSource)
        if (audioData) {
          const decoded = await decodeAudio(audioContext, audioData)
          if (decoded) {
            const normalized = normalizeBuffer(audioContext, decoded)
            const duration = normalized.length / SAMPLE_RATE

            segments.push({
              id: knownAudioId,
              phase: 'known',
              startTime: currentTime,
              endTime: currentTime + duration,
              cycleIndex
            })

            allBuffers.push(normalized)
            currentTime += duration

            // Add gap after known audio
            allBuffers.push(gapBuffer)
            currentTime += GAP_DURATION
          }
        }
      }
    }
    completedSteps++
    reportProgress()

    // Phase 2: PAUSE (use cycle's pause duration or default to 4 seconds)
    const pauseDurationSec = (cycle.pauseDurationMs || 4000) / 1000
    const pauseBuffer = createSilence(audioContext, pauseDurationSec)
    segments.push({
      id: `cycle-${cycleIndex}-pause`,
      phase: 'pause',
      startTime: currentTime,
      endTime: currentTime + pauseDurationSec,
      cycleIndex
    })
    allBuffers.push(pauseBuffer)
    currentTime += pauseDurationSec

    // Add gap after pause
    allBuffers.push(gapBuffer)
    currentTime += GAP_DURATION

    completedSteps++
    reportProgress()

    // Phase 3: Voice1 audio
    const voice1AudioId = cycle.target.voice1AudioId
    if (voice1AudioId) {
      const voice1Source = await getAudioSource(voice1AudioId)
      if (voice1Source) {
        const audioData = await fetchAudioData(voice1Source)
        if (audioData) {
          const decoded = await decodeAudio(audioContext, audioData)
          if (decoded) {
            const normalized = normalizeBuffer(audioContext, decoded)
            const duration = normalized.length / SAMPLE_RATE

            segments.push({
              id: voice1AudioId,
              phase: 'voice1',
              startTime: currentTime,
              endTime: currentTime + duration,
              cycleIndex
            })

            allBuffers.push(normalized)
            currentTime += duration

            // Add gap after voice1
            allBuffers.push(gapBuffer)
            currentTime += GAP_DURATION
          }
        }
      }
    }
    completedSteps++
    reportProgress()

    // Phase 4: Voice2 audio
    const voice2AudioId = cycle.target.voice2AudioId
    if (voice2AudioId) {
      const voice2Source = await getAudioSource(voice2AudioId)
      if (voice2Source) {
        const audioData = await fetchAudioData(voice2Source)
        if (audioData) {
          const decoded = await decodeAudio(audioContext, audioData)
          if (decoded) {
            const normalized = normalizeBuffer(audioContext, decoded)
            const duration = normalized.length / SAMPLE_RATE

            segments.push({
              id: voice2AudioId,
              phase: 'voice2',
              startTime: currentTime,
              endTime: currentTime + duration,
              cycleIndex
            })

            allBuffers.push(normalized)
            currentTime += duration

            // Add gap after voice2 (except for last cycle)
            if (cycleIndex < cycles.length - 1) {
              allBuffers.push(gapBuffer)
              currentTime += GAP_DURATION
            }
          }
        }
      }
    }
    completedSteps++
    reportProgress()
  }

  // Handle edge case: no audio was found
  if (allBuffers.length === 0) {
    console.warn('No audio files were successfully loaded for concatenation')
    // Create a minimal silent buffer
    allBuffers.push(createSilence(audioContext, 0.1))
    currentTime = 0.1
  }

  // Concatenate all buffers
  const concatenatedBuffer = concatenateBuffers(audioContext, allBuffers)

  // Encode to WAV
  const blob = encodeWav(concatenatedBuffer)
  const blobUrl = URL.createObjectURL(blob)

  // Final progress update
  if (onProgress) {
    onProgress(1)
  }

  return {
    blob,
    blobUrl,
    segments,
    totalDuration: currentTime
  }
}

/**
 * Release resources associated with a ConcatenatedAudio object.
 * Should be called when the audio is no longer needed to prevent memory leaks.
 */
export function releaseConcatenatedAudio(audio: ConcatenatedAudio): void {
  if (audio.blobUrl) {
    URL.revokeObjectURL(audio.blobUrl)
  }
}

/**
 * Find the segment containing a given playback time.
 * Useful for determining current phase and cycle during playback.
 */
export function findSegmentAtTime(
  segments: AudioSegment[],
  timeSeconds: number
): AudioSegment | null {
  for (const segment of segments) {
    if (timeSeconds >= segment.startTime && timeSeconds < segment.endTime) {
      return segment
    }
  }
  return null
}

/**
 * Find all segments for a specific cycle index.
 */
export function getSegmentsForCycle(
  segments: AudioSegment[],
  cycleIndex: number
): AudioSegment[] {
  return segments.filter(s => s.cycleIndex === cycleIndex)
}
