import { ref, onUnmounted } from 'vue'
import type { Cycle } from '../types/Cycle'

export type CyclePhase = 'PROMPT' | 'PAUSE' | 'VOICE_1' | 'VOICE_2' | 'IDLE'

export interface CyclePlaybackState {
  phase: CyclePhase
  isPlaying: boolean
  error: string | null
}

/**
 * Audio source - either a cached blob or a URL for direct playback
 */
export type AudioSource = { type: 'blob'; blob: Blob } | { type: 'url'; url: string }

/**
 * Function to resolve an audio ID to either a cached blob or a URL
 * Returns blob if cached (for offline), otherwise URL for direct playback
 */
export type GetAudioSourceFn = (audioId: string) => Promise<AudioSource | null>

/**
 * Composable for playing a single Cycle through its 4 phases.
 *
 * Usage:
 * const { state, playCycle, stop } = useCyclePlayback()
 * await playCycle(cycle, getAudioSource)
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
  let currentBlobUrl: string | null = null

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
   * Clean up any blob URL from previous playback
   */
  function cleanupBlobUrl(): void {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }
  }

  /**
   * Plays audio from either a blob or URL and returns when it completes.
   */
  function playAudio(source: AudioSource): Promise<void> {
    return new Promise((resolve, reject) => {
      if (playbackAborted) {
        reject(new Error('Playback aborted'))
        return
      }

      const audioEl = getAudioElement()

      // Clean up previous blob URL if any
      cleanupBlobUrl()

      // Get the URL to play
      let srcUrl: string
      if (source.type === 'blob') {
        srcUrl = URL.createObjectURL(source.blob)
        currentBlobUrl = srcUrl  // Track for cleanup
      } else {
        srcUrl = source.url
      }

      // Clean up previous handler
      if (audioEndedHandler) {
        audioEl.removeEventListener('ended', audioEndedHandler)
      }

      // Set up completion handler
      audioEndedHandler = () => {
        cleanupBlobUrl()
        if (!playbackAborted) {
          resolve()
        }
      }

      audioEl.addEventListener('ended', audioEndedHandler, { once: true })

      // Handle errors
      const errorHandler = () => {
        cleanupBlobUrl()
        // Get error details from audio element
        const audioError = audioEl.error
        let errorMessage = 'Audio playback error'
        if (audioError) {
          const errorCodes: Record<number, string> = {
            1: 'ABORTED',
            2: 'NETWORK',
            3: 'DECODE',
            4: 'SRC_NOT_SUPPORTED'
          }
          const codeName = errorCodes[audioError.code] || 'UNKNOWN'
          errorMessage = `Audio playback error: ${codeName} (code ${audioError.code})`
          if (audioError.message) {
            errorMessage += ` - ${audioError.message}`
          }
        }
        // Audio errors are handled gracefully - cycle continues
        reject(new Error(errorMessage))
      }
      audioEl.addEventListener('error', errorHandler, { once: true })

      // Start playback
      audioEl.src = srcUrl
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
    getAudioSource: GetAudioSourceFn
  ): Promise<void> {
    playbackAborted = false
    state.value.isPlaying = true
    state.value.error = null

    try {
      // Phase 1: PROMPT - Play known language audio
      state.value.phase = 'PROMPT'
      const knownSource = await getAudioSource(cycle.known.audioId)
      if (!knownSource) {
        throw new Error(`Known audio not found: ${cycle.known.audioId}`)
      }
      await playAudio(knownSource)

      // Phase 2: PAUSE - Silent gap for learner to attempt response
      state.value.phase = 'PAUSE'
      await wait(cycle.pauseDurationMs)

      // Phase 3: VOICE_1 - Play target language audio (voice 1)
      state.value.phase = 'VOICE_1'
      const target1Source = await getAudioSource(cycle.target.voice1AudioId)
      if (!target1Source) {
        throw new Error(`Target voice 1 audio not found: ${cycle.target.voice1AudioId}`)
      }
      await playAudio(target1Source)

      // Phase 4: VOICE_2 - Play target language audio (voice 2)
      state.value.phase = 'VOICE_2'
      const target2Source = await getAudioSource(cycle.target.voice2AudioId)
      if (!target2Source) {
        throw new Error(`Target voice 2 audio not found: ${cycle.target.voice2AudioId}`)
      }
      await playAudio(target2Source)

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
