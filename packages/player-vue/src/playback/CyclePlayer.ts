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

/**
 * Thrown when the circuit breaker opens after too many consecutive cycle
 * failures. The session layer catches this specifically to pause playback
 * and hand off to the offline degradation ladder, rather than silently
 * continuing (which would stall forever if audio is fundamentally broken).
 */
export class CircuitOpenError extends Error {
  readonly failures: number
  readonly lastError: string
  constructor(failures: number, lastError: string) {
    super(`Audio playback circuit opened after ${failures} consecutive failures: ${lastError}`)
    this.name = 'CircuitOpenError'
    this.failures = failures
    this.lastError = lastError
  }
}

/**
 * Thrown when the browser rejects audio playback because it needs a fresh
 * user gesture. This is the iOS Safari / Chrome autoplay-policy scenario —
 * most commonly triggered when the tab has been backgrounded for a while
 * and the audio element lost its unlock, or on first playback attempt
 * before the user has interacted with the page.
 *
 * The session layer catches this specifically and pauses immediately so
 * the UI can prompt "Tap to resume", rather than burning three cycles
 * through the circuit breaker.
 */
export class AudioGestureRequiredError extends Error {
  readonly originalError: unknown
  constructor(originalError: unknown) {
    const msg = originalError instanceof Error ? originalError.message : 'User gesture required'
    super(`Audio playback requires a fresh user gesture: ${msg}`)
    this.name = 'AudioGestureRequiredError'
    this.originalError = originalError
  }
}

function isGestureRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybe = err as { name?: string; message?: string }
  // NotAllowedError is what Safari/Chrome throw when autoplay policy
  // blocks a play() call. InvalidStateError can surface on iOS after
  // long backgrounding. Message sniffing is a last-ditch fallback for
  // older WebKit that sometimes reports a plain Error.
  if (maybe.name === 'NotAllowedError') return true
  if (maybe.name === 'InvalidStateError') return true
  const msg = (maybe.message || '').toLowerCase()
  return msg.includes('user didn') || msg.includes('user gesture') || msg.includes('not allowed')
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

  /**
   * Reset the consecutive-failure counter that drives the circuit breaker.
   * Call after the session layer has handled a circuit-open condition
   * (e.g. offline fallback succeeded, user manually retried).
   */
  resetCircuit(): void

  /** Current consecutive-failure count (for telemetry / UI) */
  readonly consecutiveFailures: Ref<number>

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

  // Circuit breaker state: counts consecutive cycle failures. Reset on any
  // successful cycle. When it reaches the configured threshold, playCycle
  // throws CircuitOpenError so the session layer can pause / degrade
  // instead of silently continuing to hammer a broken audio source.
  const consecutiveFailures = ref(0)

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

      // Create the blob URL locally so the try/finally path below can always
      // revoke it even if setup throws before the Promise settle hooks are
      // wired up. We also mirror it onto `currentBlobUrl` so stop() and the
      // normal settle hooks still clean it up on the happy path.
      let localBlobUrl: string | null = null
      let srcUrl: string
      try {
        if (source.type === 'blob') {
          srcUrl = URL.createObjectURL(source.blob)
          localBlobUrl = srcUrl
          currentBlobUrl = srcUrl
        } else {
          srcUrl = source.url
        }
      } catch (err) {
        // URL.createObjectURL is essentially never going to throw, but if it
        // does we must not leave a dangling URL.
        if (localBlobUrl) URL.revokeObjectURL(localBlobUrl)
        currentBlobUrl = null
        reject(err instanceof Error ? err : new Error('Failed to create audio URL'))
        return
      }

      // Clean up previous handler
      if (audioEndedHandler) {
        audioEl.removeEventListener('ended', audioEndedHandler)
        audioEndedHandler = null
      }

      let settled = false

      function cleanupListeners(): void {
        if (audioEndedHandler) {
          audioEl.removeEventListener('ended', audioEndedHandler)
          audioEndedHandler = null
        }
        audioEl.removeEventListener('error', errorHandler)
      }

      function revokeLocalBlobUrl(): void {
        // Always revoke the blob URL we created for this playback, even if
        // the global currentBlobUrl was already cleared by stop() or a later
        // playAudio call. This is the belt for the try/finally suspenders.
        if (localBlobUrl) {
          URL.revokeObjectURL(localBlobUrl)
          if (currentBlobUrl === localBlobUrl) currentBlobUrl = null
          localBlobUrl = null
        }
      }

      function settleResolve(): void {
        if (settled) return
        settled = true
        clearWatchdogs()
        cleanupListeners()
        revokeLocalBlobUrl()
        if (!aborted) resolve()
      }

      function settleReject(err: Error): void {
        if (settled) return
        settled = true
        clearWatchdogs()
        cleanupListeners()
        revokeLocalBlobUrl()
        reject(err)
      }

      // Handle errors — declared here so the listener below can reference it.
      function errorHandler(): void {
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

      // Everything from here on is wrapped so any synchronous throw during
      // setup routes through settleReject, which revokes the blob URL.
      try {
        // Set up completion handler
        audioEndedHandler = () => settleResolve()
        audioEl.addEventListener('ended', audioEndedHandler, { once: true })
        audioEl.addEventListener('error', errorHandler, { once: true })

        // Stall detection: require TWO consecutive checks with no progress (3s total).
        // iOS Safari throttles setInterval in backgrounded tabs, so after a
        // long hidden period the callback fires in a burst. Track wall-clock
        // time between checks — if too much time passed, the browser was
        // asleep, not the audio, so reset the stall counter rather than
        // falsely skipping a cycle on tab-return.
        let lastTime = -1
        let stallCount = 0
        let lastCheckAt = Date.now()
        stallCheck = setInterval(() => {
          if (settled || aborted) { clearWatchdogs(); return }
          const now = Date.now()
          const elapsed = now - lastCheckAt
          lastCheckAt = now
          // If the interval was throttled (tab hidden / device sleep),
          // elapsed >> 1500ms. Reset counters and re-seed lastTime.
          if (elapsed > 3000) {
            stallCount = 0
            lastTime = audioEl.currentTime
            return
          }
          const ct = audioEl.currentTime
          if (ct > 0 && ct === lastTime && !audioEl.paused && !audioEl.ended) {
            stallCount++
            if (stallCount >= 2) {
              console.warn('[CyclePlayer] Audio stalled for 3s, skipping')
              audioEl.pause()
              settleResolve()
            }
          } else {
            stallCount = 0
          }
          lastTime = ct
        }, 1500)

        // Absolute safety: no single audio clip should take more than 15s
        safetyTimer = setTimeout(() => {
          if (!settled && !aborted) {
            console.warn('[CyclePlayer] Safety timeout (15s), skipping')
            audioEl.pause()
            settleResolve()
          }
        }, 15000)

        // Start playback. play() rejections from the autoplay policy
        // (NotAllowedError etc.) are re-thrown as AudioGestureRequiredError
        // so the session layer can pause on the *first* failure and prompt
        // for a tap, rather than waiting for the circuit breaker to trip.
        audioEl.src = srcUrl
        audioEl.load()
        audioEl.play().catch((err) => {
          if (isGestureRequiredError(err)) {
            settleReject(new AudioGestureRequiredError(err))
          } else {
            settleReject(err instanceof Error ? err : new Error('Audio play failed'))
          }
        })
      } catch (err) {
        settleReject(err instanceof Error ? err : new Error('Audio setup failed'))
      }
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

      // Cycle complete — reset the circuit breaker on any successful cycle
      consecutiveFailures.value = 0
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

        // Gesture-required errors are not "failures" in the circuit-breaker
        // sense — they're a clear signal from the browser that we need a
        // user tap, not that audio is broken. Surface them immediately so
        // the session layer can prompt for a tap. Don't burn through the
        // circuit-breaker budget on them.
        if (err instanceof AudioGestureRequiredError) {
          throw err
        }

        consecutiveFailures.value++
        if (consecutiveFailures.value >= config.maxConsecutiveFailures) {
          throw new CircuitOpenError(consecutiveFailures.value, message)
        }
        throw err
      }
    }
  }

  /**
   * Reset the circuit-breaker failure counter
   */
  function resetCircuit(): void {
    consecutiveFailures.value = 0
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
    consecutiveFailures: readonly(consecutiveFailures) as Ref<number>,
    playCycle,
    stop,
    on,
    off,
    resetCircuit,
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
