import { ref, onUnmounted } from 'vue'
import type { Cycle } from '../types/Cycle'

export type CyclePhase = 'PROMPT' | 'PAUSE' | 'VOICE_1' | 'VOICE_2' | 'IDLE'

export interface CyclePlaybackState {
  phase: CyclePhase
  isPlaying: boolean
  error: string | null
}

export type GetAudioBlobFn = (audioId: string) => Promise<Blob | null>

/**
 * Composable for playing a single Cycle through its 4 phases.
 *
 * Usage:
 * const { state, playCycle, stop } = useCyclePlayback()
 * await playCycle(cycle, getAudioBlob)
 */
export function useCyclePlayback() {
  const state = ref<CyclePlaybackState>({
    phase: 'IDLE',
    isPlaying: false,
    error: null
  })

  let audio: HTMLAudioElement | null = null
  let currentTimeout: ReturnType<typeof setTimeout> | null = null
  let audioEndedHandler: (() => void) | null = null
  let playbackAborted = false

  /**
   * Creates and reuses a single Audio element for all playback.
   * This is critical for mobile compatibility - creating new Audio elements
   * requires re-establishing the user gesture unlock on iOS.
   */
  function getAudioElement(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio()
    }
    return audio
  }

  /**
   * Plays an audio blob and returns when it completes.
   */
  function playAudio(blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      if (playbackAborted) {
        reject(new Error('Playback aborted'))
        return
      }

      const audioEl = getAudioElement()
      const blobUrl = URL.createObjectURL(blob)

      // Clean up previous handler
      if (audioEndedHandler) {
        audioEl.removeEventListener('ended', audioEndedHandler)
      }

      // Set up completion handler
      audioEndedHandler = () => {
        URL.revokeObjectURL(blobUrl)
        if (!playbackAborted) {
          resolve()
        }
      }

      audioEl.addEventListener('ended', audioEndedHandler, { once: true })

      // Handle errors
      const errorHandler = (e: ErrorEvent) => {
        URL.revokeObjectURL(blobUrl)
        reject(new Error(`Audio playback error: ${e.message}`))
      }
      audioEl.addEventListener('error', errorHandler, { once: true })

      // Start playback
      audioEl.src = blobUrl
      audioEl.load()
      audioEl.play().catch(reject)
    })
  }

  /**
   * Waits for a duration with the ability to abort.
   */
  function wait(durationMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (playbackAborted) {
        reject(new Error('Playback aborted'))
        return
      }

      currentTimeout = setTimeout(() => {
        currentTimeout = null
        if (!playbackAborted) {
          resolve()
        }
      }, durationMs)
    })
  }

  /**
   * Plays a complete Cycle through all 4 phases.
   * Returns a promise that resolves when the cycle completes.
   */
  async function playCycle(
    cycle: Cycle,
    getAudioBlob: GetAudioBlobFn
  ): Promise<void> {
    playbackAborted = false
    state.value.isPlaying = true
    state.value.error = null

    try {
      // Phase 1: PROMPT - Play known language audio
      state.value.phase = 'PROMPT'
      const knownBlob = await getAudioBlob(cycle.known.audioId)
      if (!knownBlob) {
        throw new Error(`Known audio not found: ${cycle.known.audioId}`)
      }
      await playAudio(knownBlob)

      // Phase 2: PAUSE - Silent gap for learner to attempt response
      state.value.phase = 'PAUSE'
      await wait(cycle.pauseDurationMs)

      // Phase 3: VOICE_1 - Play target language audio (voice 1)
      state.value.phase = 'VOICE_1'
      const target1Blob = await getAudioBlob(cycle.target.voice1AudioId)
      if (!target1Blob) {
        throw new Error(`Target voice 1 audio not found: ${cycle.target.voice1AudioId}`)
      }
      await playAudio(target1Blob)

      // Phase 4: VOICE_2 - Play target language audio (voice 2)
      state.value.phase = 'VOICE_2'
      const target2Blob = await getAudioBlob(cycle.target.voice2AudioId)
      if (!target2Blob) {
        throw new Error(`Target voice 2 audio not found: ${cycle.target.voice2AudioId}`)
      }
      await playAudio(target2Blob)

      // Cycle complete
      state.value.phase = 'IDLE'
      state.value.isPlaying = false
    } catch (err) {
      if (!playbackAborted) {
        state.value.error = err instanceof Error ? err.message : 'Unknown playback error'
        state.value.phase = 'IDLE'
        state.value.isPlaying = false
        throw err
      }
    }
  }

  /**
   * Stops current playback immediately.
   */
  function stop(): void {
    playbackAborted = true

    if (audio) {
      audio.pause()
      audio.currentTime = 0
    }

    if (currentTimeout) {
      clearTimeout(currentTimeout)
      currentTimeout = null
    }

    if (audioEndedHandler && audio) {
      audio.removeEventListener('ended', audioEndedHandler)
      audioEndedHandler = null
    }

    state.value.phase = 'IDLE'
    state.value.isPlaying = false
  }

  // Cleanup on unmount
  onUnmounted(() => {
    stop()
    if (audio) {
      audio.src = ''
      audio = null
    }
  })

  return {
    state,
    playCycle,
    stop
  }
}
