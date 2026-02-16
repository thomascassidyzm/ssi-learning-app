/**
 * CyclePlayer - Event-driven 4-phase cycle playback
 *
 * Core principle: Events fire synchronously. UI subscribes and reacts.
 * No polling, no timeouts for text transitions.
 *
 * Phases: PROMPT → PAUSE → VOICE_1 → VOICE_2 → complete
 */

import { ref, readonly, type Ref } from 'vue'
import type { Cycle } from '../types/Cycle'
import type {
  CyclePhase,
  CycleEventType,
  CycleEventData,
  CycleEventHandler,
  AudioSource,
  GetAudioSourceFn,
} from './types'
import { calculatePauseDuration, type PlaybackConfig, DEFAULT_PLAYBACK_CONFIG } from './PlaybackConfig'

export interface CyclePlayerState {
  phase: CyclePhase
  isPlaying: boolean
  currentCycle: Cycle | null
  error: string | null
}

export interface CyclePlayer {
  /** Reactive state for UI binding */
  readonly state: Ref<CyclePlayerState>

  /** Play a cycle through all 4 phases */
  playCycle(cycle: Cycle, getAudioSource: GetAudioSourceFn, config?: PlaybackConfig): Promise<void>

  /** Stop current playback immediately */
  stop(): void

  /** Subscribe to cycle events */
  on(handler: CycleEventHandler): void

  /** Unsubscribe from cycle events */
  off(handler: CycleEventHandler): void

  /** Cleanup resources (call on unmount) */
  dispose(): void
}

/**
 * Create a new CyclePlayer instance
 */
export function createCyclePlayer(): CyclePlayer {
  // Internal state
  const state = ref<CyclePlayerState>({
    phase: 'idle',
    isPlaying: false,
    currentCycle: null,
    error: null,
  })

  // Event handlers
  const handlers = new Set<CycleEventHandler>()

  // Audio element (single, reused for mobile compatibility)
  let audio: HTMLAudioElement | null = null
  let currentTimeout: ReturnType<typeof setTimeout> | null = null
  let audioEndedHandler: (() => void) | null = null
  let aborted = false
  let currentBlobUrl: string | null = null
  let safetyTimer: ReturnType<typeof setTimeout> | null = null
  let stallCheck: ReturnType<typeof setInterval> | null = null

  /**
   * Get or create the single audio element
   */
  function getAudioElement(): HTMLAudioElement {
    if (!audio) {
      audio = new Audio()
    }
    return audio
  }

  /**
   * Clean up blob URL to prevent memory leaks
   */
  function cleanupBlobUrl(): void {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl)
      currentBlobUrl = null
    }
  }

  /**
   * Emit an event to all handlers
   */
  function emit(type: CycleEventType, cycle: Cycle, phase: CyclePhase, error?: string): void {
    const event: CycleEventData = {
      type,
      cycle,
      phase,
      timestamp: Date.now(),
      error,
    }
    // Fire synchronously to all handlers
    for (const handler of handlers) {
      try {
        handler(event)
      } catch (e) {
        // Event handler errors are non-critical
      }
    }
  }

  /**
   * Clean up stall detection and safety timers
   */
  function clearWatchdogs(): void {
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null }
    if (stallCheck) { clearInterval(stallCheck); stallCheck = null }
  }

  /**
   * Play audio from a source and return when complete.
   * Includes stall detection (3s no progress) and absolute safety timeout (15s).
   */
  function playAudio(source: AudioSource): Promise<void> {
    return new Promise((resolve, reject) => {
      if (aborted) {
        reject(new Error('Playback aborted'))
        return
      }

      const audioEl = getAudioElement()
      cleanupBlobUrl()
      clearWatchdogs()

      // Get URL to play
      let srcUrl: string
      if (source.type === 'blob') {
        srcUrl = URL.createObjectURL(source.blob)
        currentBlobUrl = srcUrl
      } else {
        srcUrl = source.url
      }

      // Clean up previous handler
      if (audioEndedHandler) {
        audioEl.removeEventListener('ended', audioEndedHandler)
      }

      let settled = false

      function settleResolve(): void {
        if (settled) return
        settled = true
        clearWatchdogs()
        cleanupBlobUrl()
        if (!aborted) resolve()
      }

      function settleReject(err: Error): void {
        if (settled) return
        settled = true
        clearWatchdogs()
        cleanupBlobUrl()
        reject(err)
      }

      // Set up completion handler
      audioEndedHandler = () => settleResolve()
      audioEl.addEventListener('ended', audioEndedHandler, { once: true })

      // Handle errors
      const errorHandler = () => {
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
        settleReject(new Error(errorMessage))
      }
      audioEl.addEventListener('error', errorHandler, { once: true })

      // Stall detection: if currentTime stops advancing for 3s, skip forward
      let lastTime = -1
      stallCheck = setInterval(() => {
        if (settled || aborted) { clearWatchdogs(); return }
        const ct = audioEl.currentTime
        if (ct > 0 && ct === lastTime && !audioEl.paused) {
          console.warn('[CyclePlayer] Audio stalled, skipping forward')
          audioEl.removeEventListener('ended', audioEndedHandler!)
          audioEl.removeEventListener('error', errorHandler)
          settleResolve()
        }
        lastTime = ct
      }, 1500)

      // Absolute safety: no single audio clip should take more than 15s
      safetyTimer = setTimeout(() => {
        if (!settled && !aborted) {
          console.warn('[CyclePlayer] Safety timeout, skipping forward')
          audioEl.removeEventListener('ended', audioEndedHandler!)
          audioEl.removeEventListener('error', errorHandler)
          settleResolve()
        }
      }, 15000)

      // Start playback
      audioEl.src = srcUrl
      audioEl.load()
      audioEl.play().catch(settleReject)
    })
  }

  /**
   * Wait for a duration with abort support
   */
  function wait(durationMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (aborted) {
        reject(new Error('Playback aborted'))
        return
      }

      currentTimeout = setTimeout(() => {
        currentTimeout = null
        if (!aborted) {
          resolve()
        }
      }, durationMs)
    })
  }

  /**
   * Play a complete cycle through all 4 phases
   */
  async function playCycle(
    cycle: Cycle,
    getAudioSource: GetAudioSourceFn,
    config: PlaybackConfig = DEFAULT_PLAYBACK_CONFIG
  ): Promise<void> {
    aborted = false
    state.value = {
      phase: 'idle',
      isPlaying: true,
      currentCycle: cycle,
      error: null,
    }

    try {
      // Phase 1: PROMPT - Play known language audio
      state.value.phase = 'prompt'
      emit('phase:prompt', cycle, 'prompt')

      const knownSource = await getAudioSource(cycle.known.audioId)
      if (!knownSource) {
        throw new Error(`Known audio not found: ${cycle.known.audioId}`)
      }
      await playAudio(knownSource)

      if (aborted) return

      // Phase 2: PAUSE - Silent gap for learner response
      state.value.phase = 'pause'
      emit('phase:pause', cycle, 'pause')

      const pauseDuration = calculatePauseDuration(cycle.pauseDurationMs, config)
      await wait(pauseDuration)

      if (aborted) return

      // Phase 3: VOICE_1 - Target audio, voice 1 (no text yet)
      state.value.phase = 'voice1'
      emit('phase:voice1', cycle, 'voice1')

      const target1Source = await getAudioSource(cycle.target.voice1AudioId)
      if (!target1Source) {
        throw new Error(`Target voice 1 audio not found: ${cycle.target.voice1AudioId}`)
      }
      await playAudio(target1Source)

      if (aborted) return

      // Phase 4: VOICE_2 - Target audio, voice 2 (text appears!)
      state.value.phase = 'voice2'
      emit('phase:voice2', cycle, 'voice2')

      const target2Source = await getAudioSource(cycle.target.voice2AudioId)
      if (!target2Source) {
        throw new Error(`Target voice 2 audio not found: ${cycle.target.voice2AudioId}`)
      }
      await playAudio(target2Source)

      if (aborted) return

      // Cycle complete
      state.value.phase = 'idle'
      state.value.isPlaying = false
      emit('cycle:complete', cycle, 'idle')

    } catch (err) {
      if (!aborted) {
        const message = err instanceof Error ? err.message : 'Unknown playback error'
        state.value.error = message
        state.value.phase = 'idle'
        state.value.isPlaying = false
        emit('cycle:error', cycle, 'idle', message)
        throw err
      }
    }
  }

  /**
   * Stop current playback immediately
   */
  function stop(): void {
    aborted = true

    clearWatchdogs()

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

    cleanupBlobUrl()

    state.value.phase = 'idle'
    state.value.isPlaying = false
  }

  /**
   * Subscribe to cycle events
   */
  function on(handler: CycleEventHandler): void {
    handlers.add(handler)
  }

  /**
   * Unsubscribe from cycle events
   */
  function off(handler: CycleEventHandler): void {
    handlers.delete(handler)
  }

  /**
   * Cleanup resources
   */
  function dispose(): void {
    stop()
    handlers.clear()
    if (audio) {
      audio.src = ''
      audio = null
    }
  }

  return {
    state: readonly(state) as Ref<CyclePlayerState>,
    playCycle,
    stop,
    on,
    off,
    dispose,
  }
}

/**
 * Vue composable wrapper for CyclePlayer
 */
export function useCyclePlayer(): CyclePlayer {
  const player = createCyclePlayer()

  // Auto-dispose on component unmount would be handled by the caller
  // via onUnmounted(() => player.dispose())

  return player
}
