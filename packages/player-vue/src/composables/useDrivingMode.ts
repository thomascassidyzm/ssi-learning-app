/**
 * useDrivingMode - Orchestrate background audio playback for hands-free learning
 *
 * This composable enables "Driving Mode" where entire rounds are concatenated
 * into single audio blobs for seamless background playback on iOS Safari.
 *
 * Key features:
 * - Concatenates rounds into single audio blobs using audioConcatenator
 * - Uses "silent audio placeholder" trick to maintain iOS audio session between rounds
 * - Chain-loads next round while current plays for seamless transitions
 * - Media Session API for lock screen and car bluetooth controls
 * - Tracks position via segments for resume to normal mode
 *
 * iOS Background Audio Strategy:
 * 1. Concatenate entire round into single WAV blob (no gaps = no session drops)
 * 2. While playing, preload next round in background
 * 3. Near end of current round, start silent audio to keep session alive
 * 4. Swap to next round's blob, stop silent audio
 * 5. Repeat until session complete
 */

import { ref, computed, onUnmounted, type Ref, type ComputedRef } from 'vue'
import {
  concatenateRound,
  releaseConcatenatedAudio,
  findSegmentAtTime,
  type ConcatenatedAudio,
  type AudioSegment
} from '../utils/audioConcatenator'
import { getSilentAudioUrl } from '../utils/silentAudio'
import type { Cycle } from '../types/Cycle'
import type { GetAudioSourceFn } from '../playback/types'

// ============================================================================
// Types
// ============================================================================

export type DrivingModeState =
  | 'inactive'
  | 'preparing'      // Concatenating first round
  | 'playing'
  | 'paused'
  | 'loading-next'   // Playing but also loading next round

export interface DrivingModePosition {
  roundIndex: number
  cycleIndex: number
  phase: AudioSegment['phase']
}

export interface DrivingModeOptions {
  /** Get cycles for a specific round index (0-based) */
  getCyclesForRound: (roundIndex: number) => Cycle[]
  /** Get total number of rounds in the session */
  getTotalRounds: () => number
  /** Function to resolve audio IDs to sources */
  getAudioSource: GetAudioSourceFn
  /** Called when position changes (for UI updates) */
  onPositionUpdate?: (position: DrivingModePosition) => void
  /** Called when round changes */
  onRoundChange?: (roundIndex: number) => void
  /** Called when all rounds are complete */
  onSessionComplete?: () => void
}

interface DrivingModeReturn {
  // State (reactive)
  state: ComputedRef<DrivingModeState>
  currentRoundIndex: ComputedRef<number>
  currentSegment: ComputedRef<AudioSegment | null>
  preparationProgress: ComputedRef<number>
  isActive: ComputedRef<boolean>

  // Aliases for convenience
  currentRound: ComputedRef<number>
  prepProgress: ComputedRef<number>

  // Actions
  enter: (startFromRound?: number) => Promise<void>
  exit: () => DrivingModePosition | null
  skipToNextRound: () => Promise<void>
  skipToPreviousRound: () => Promise<void>
  togglePlayPause: () => void
}

// ============================================================================
// Constants
// ============================================================================

/** Time remaining (seconds) when we start silent audio to bridge gap */
const SILENT_AUDIO_BRIDGE_THRESHOLD = 1.0

/** Position update interval (ms) for animation frame updates */
const POSITION_UPDATE_INTERVAL = 250

// ============================================================================
// Composable Implementation
// ============================================================================

export function useDrivingMode(options: DrivingModeOptions): DrivingModeReturn {
  // ----------------------------------------
  // Internal State
  // ----------------------------------------

  const internalState = ref<DrivingModeState>('inactive')
  const roundIndex = ref(0)
  const segment = ref<AudioSegment | null>(null)
  const prepProgress = ref(0)

  // Audio elements
  let audioContext: AudioContext | null = null
  let mainAudio: HTMLAudioElement | null = null
  let silentAudio: HTMLAudioElement | null = null

  // Concatenated audio storage
  let currentRoundAudio: ConcatenatedAudio | null = null
  let nextRoundAudio: ConcatenatedAudio | null = null

  // State tracking
  let isLoadingNext = false
  let isSilentPlaying = false
  let positionUpdateFrame: number | null = null
  let lastPositionUpdateTime = 0

  // Event listener cleanup
  const cleanupFns: Array<() => void> = []

  // ----------------------------------------
  // Computed State (Public)
  // ----------------------------------------

  const state = computed<DrivingModeState>(() => internalState.value)

  const currentRoundIndex = computed<number>(() => roundIndex.value)

  const currentSegment = computed<AudioSegment | null>(() => segment.value)

  const preparationProgress = computed<number>(() => prepProgress.value)

  const isActive = computed<boolean>(() =>
    internalState.value !== 'inactive'
  )

  // ----------------------------------------
  // Audio Element Management
  // ----------------------------------------

  /**
   * Create and configure the main audio element for round playback
   */
  function createMainAudio(): HTMLAudioElement {
    const audio = new Audio()
    audio.preload = 'auto'

    // iOS-specific attributes for background playback
    audio.setAttribute('playsinline', 'true')
    audio.setAttribute('webkit-playsinline', 'true')

    return audio
  }

  /**
   * Create and configure the silent audio element for session keep-alive
   */
  function createSilentAudio(): HTMLAudioElement {
    const audio = new Audio()
    audio.src = getSilentAudioUrl()
    audio.loop = true
    audio.volume = 0 // Completely silent but keeps audio session alive
    audio.preload = 'auto'

    // iOS-specific attributes
    audio.setAttribute('playsinline', 'true')
    audio.setAttribute('webkit-playsinline', 'true')

    return audio
  }

  /**
   * Create AudioContext for decoding
   */
  function createAudioContext(): AudioContext {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
    return new AudioContextClass()
  }

  // ----------------------------------------
  // Event Handlers
  // ----------------------------------------

  /**
   * Handle timeupdate events to track position and trigger silent audio bridge
   */
  function handleTimeUpdate(): void {
    if (!mainAudio || !currentRoundAudio) return

    const currentTime = mainAudio.currentTime
    const duration = mainAudio.duration
    const timeRemaining = duration - currentTime

    // Update current segment based on time
    const foundSegment = findSegmentAtTime(currentRoundAudio.segments, currentTime)
    if (foundSegment && foundSegment !== segment.value) {
      segment.value = foundSegment
      emitPositionUpdate()
    }

    // Start silent audio bridge near end of round
    if (timeRemaining < SILENT_AUDIO_BRIDGE_THRESHOLD && !isSilentPlaying && nextRoundAudio) {
      startSilentBridge()
    }
  }

  /**
   * Handle main audio ended event - transition to next round
   */
  async function handleMainAudioEnded(): Promise<void> {
    if (internalState.value === 'inactive') return

    const totalRounds = options.getTotalRounds()
    const nextIndex = roundIndex.value + 1

    // Check if session is complete
    if (nextIndex >= totalRounds) {
      // Save progress for the final round
      options.onRoundChange?.(roundIndex.value)
      options.onSessionComplete?.()
      await exitDrivingMode()
      return
    }

    // Transition to next round
    await transitionToNextRound()
  }

  /**
   * Handle play/pause state changes
   */
  function handlePlayStateChange(): void {
    if (!mainAudio) return

    if (mainAudio.paused && internalState.value === 'playing') {
      internalState.value = 'paused'
    } else if (!mainAudio.paused && internalState.value === 'paused') {
      internalState.value = isLoadingNext ? 'loading-next' : 'playing'
    }
  }

  // ----------------------------------------
  // Silent Audio Bridge
  // ----------------------------------------

  /**
   * Start silent audio to maintain iOS audio session during transition
   */
  function startSilentBridge(): void {
    if (!silentAudio || isSilentPlaying) return

    silentAudio.play().catch((err) => {
      console.warn('[useDrivingMode] Silent audio play failed:', err)
    })
    isSilentPlaying = true
  }

  /**
   * Stop silent audio after transition
   */
  function stopSilentBridge(): void {
    if (!silentAudio || !isSilentPlaying) return

    silentAudio.pause()
    silentAudio.currentTime = 0
    isSilentPlaying = false
  }

  // ----------------------------------------
  // Round Loading & Transitions
  // ----------------------------------------

  /**
   * Concatenate a round's audio into a single blob
   */
  async function loadRound(
    index: number,
    onProgress?: (progress: number) => void
  ): Promise<ConcatenatedAudio | null> {
    if (!audioContext) return null

    const cycles = options.getCyclesForRound(index)
    if (!cycles || cycles.length === 0) {
      console.warn(`[useDrivingMode] No cycles for round ${index}`)
      return null
    }

    try {
      const concatenated = await concatenateRound(
        cycles,
        options.getAudioSource,
        audioContext,
        onProgress
      )
      return concatenated
    } catch (err) {
      console.error(`[useDrivingMode] Failed to load round ${index}:`, err)
      return null
    }
  }

  /**
   * Start preloading the next round in background
   */
  async function preloadNextRound(): Promise<void> {
    const totalRounds = options.getTotalRounds()
    const nextIndex = roundIndex.value + 1

    if (nextIndex >= totalRounds) {
      // No more rounds to preload
      return
    }

    if (isLoadingNext || nextRoundAudio) {
      // Already loading or loaded
      return
    }

    isLoadingNext = true
    if (internalState.value === 'playing') {
      internalState.value = 'loading-next'
    }

    try {
      nextRoundAudio = await loadRound(nextIndex)
    } catch (err) {
      console.error('[useDrivingMode] Failed to preload next round:', err)
    } finally {
      isLoadingNext = false
      if (internalState.value === 'loading-next') {
        internalState.value = 'playing'
      }
    }
  }

  /**
   * Transition from current round to next round
   */
  async function transitionToNextRound(): Promise<void> {
    if (!mainAudio) return

    // Release current round audio
    if (currentRoundAudio) {
      releaseConcatenatedAudio(currentRoundAudio)
    }

    // Move next round to current
    currentRoundAudio = nextRoundAudio
    nextRoundAudio = null

    // Wait for next round if not ready
    if (!currentRoundAudio) {
      const nextIndex = roundIndex.value + 1
      currentRoundAudio = await loadRound(nextIndex)
    }

    if (!currentRoundAudio) {
      console.error('[useDrivingMode] Failed to load next round')
      await exitDrivingMode()
      return
    }

    // Update round index
    roundIndex.value += 1
    segment.value = currentRoundAudio.segments[0] || null

    // Emit round change callback
    options.onRoundChange?.(roundIndex.value)

    // Set new audio source and play
    mainAudio.src = currentRoundAudio.blobUrl
    mainAudio.load()

    try {
      await mainAudio.play()
      stopSilentBridge()

      // Start preloading next round
      preloadNextRound()
    } catch (err) {
      console.error('[useDrivingMode] Failed to play next round:', err)
    }
  }

  // ----------------------------------------
  // Position Tracking
  // ----------------------------------------

  /**
   * Emit position update to callback
   */
  function emitPositionUpdate(): void {
    if (!options.onPositionUpdate || !segment.value) return

    const position: DrivingModePosition = {
      roundIndex: roundIndex.value,
      cycleIndex: segment.value.cycleIndex,
      phase: segment.value.phase
    }

    options.onPositionUpdate(position)
  }

  /**
   * Start position tracking via animation frame
   */
  function startPositionTracking(): void {
    if (positionUpdateFrame !== null) return

    function update(): void {
      const now = performance.now()

      // Throttle updates
      if (now - lastPositionUpdateTime >= POSITION_UPDATE_INTERVAL) {
        handleTimeUpdate()
        lastPositionUpdateTime = now
      }

      if (internalState.value !== 'inactive') {
        positionUpdateFrame = requestAnimationFrame(update)
      }
    }

    positionUpdateFrame = requestAnimationFrame(update)
  }

  /**
   * Stop position tracking
   */
  function stopPositionTracking(): void {
    if (positionUpdateFrame !== null) {
      cancelAnimationFrame(positionUpdateFrame)
      positionUpdateFrame = null
    }
  }

  // ----------------------------------------
  // Media Session API
  // ----------------------------------------

  /**
   * Setup Media Session for lock screen and bluetooth controls
   */
  function setupMediaSession(): void {
    if (!('mediaSession' in navigator)) return

    const totalRounds = options.getTotalRounds()

    // Set metadata
    updateMediaSessionMetadata()

    // Setup action handlers
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => {
        mainAudio?.play()
      }],
      ['pause', () => {
        mainAudio?.pause()
      }],
      ['nexttrack', () => {
        skipToNextRound()
      }],
      ['previoustrack', () => {
        skipToPreviousRound()
      }],
      ['seekforward', (details) => {
        if (mainAudio) {
          const skipTime = details?.seekOffset ?? 10
          mainAudio.currentTime = Math.min(
            mainAudio.currentTime + skipTime,
            mainAudio.duration
          )
        }
      }],
      ['seekbackward', (details) => {
        if (mainAudio) {
          const skipTime = details?.seekOffset ?? 10
          mainAudio.currentTime = Math.max(mainAudio.currentTime - skipTime, 0)
        }
      }],
      ['seekto', (details) => {
        if (mainAudio && details?.seekTime !== undefined) {
          mainAudio.currentTime = details.seekTime
        }
      }]
    ]

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
        cleanupFns.push(() => {
          try {
            navigator.mediaSession.setActionHandler(action, null)
          } catch {
            // Ignore cleanup errors
          }
        })
      } catch (err) {
        // Not all actions are supported on all platforms
        console.debug(`[useDrivingMode] Media session action '${action}' not supported`)
      }
    }
  }

  /**
   * Update Media Session metadata for current round
   */
  function updateMediaSessionMetadata(): void {
    if (!('mediaSession' in navigator)) return

    const totalRounds = options.getTotalRounds()

    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Round ${roundIndex.value + 1} of ${totalRounds}`,
      artist: 'SSi Learning',
      album: 'Driving Mode'
    })

    // Update position state if audio is available
    if (mainAudio && currentRoundAudio && !isNaN(mainAudio.duration)) {
      navigator.mediaSession.setPositionState({
        duration: mainAudio.duration,
        playbackRate: mainAudio.playbackRate,
        position: mainAudio.currentTime
      })
    }
  }

  /**
   * Clear Media Session
   */
  function clearMediaSession(): void {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  }

  // ----------------------------------------
  // Public Actions
  // ----------------------------------------

  /**
   * Enter driving mode starting from a specific round
   */
  async function enter(startFromRound = 0): Promise<void> {
    if (internalState.value !== 'inactive') {
      console.warn('[useDrivingMode] Already active, exiting first')
      cleanup()
    }

    internalState.value = 'preparing'
    roundIndex.value = startFromRound
    prepProgress.value = 0

    try {
      // Create audio infrastructure
      audioContext = createAudioContext()
      mainAudio = createMainAudio()
      silentAudio = createSilentAudio()

      // Setup event listeners
      const timeUpdateHandler = () => handleTimeUpdate()
      const endedHandler = () => handleMainAudioEnded()
      const playHandler = () => handlePlayStateChange()
      const pauseHandler = () => handlePlayStateChange()

      mainAudio.addEventListener('timeupdate', timeUpdateHandler)
      mainAudio.addEventListener('ended', endedHandler)
      mainAudio.addEventListener('play', playHandler)
      mainAudio.addEventListener('pause', pauseHandler)

      cleanupFns.push(
        () => mainAudio?.removeEventListener('timeupdate', timeUpdateHandler),
        () => mainAudio?.removeEventListener('ended', endedHandler),
        () => mainAudio?.removeEventListener('play', playHandler),
        () => mainAudio?.removeEventListener('pause', pauseHandler)
      )

      // Concatenate first round
      currentRoundAudio = await loadRound(startFromRound, (progress) => {
        prepProgress.value = progress
      })

      if (!currentRoundAudio) {
        throw new Error('Failed to prepare first round audio')
      }

      // Setup Media Session
      setupMediaSession()

      // Initialize segment
      segment.value = currentRoundAudio.segments[0] || null

      // Start playback
      mainAudio.src = currentRoundAudio.blobUrl
      mainAudio.load()

      await mainAudio.play()

      internalState.value = 'playing'
      prepProgress.value = 1

      // Start position tracking
      startPositionTracking()

      // Start preloading next round
      preloadNextRound()

      // Emit initial position
      emitPositionUpdate()
      options.onRoundChange?.(roundIndex.value)

    } catch (err) {
      console.error('[useDrivingMode] Failed to enter driving mode:', err)
      cleanup()
      throw err
    }
  }

  /**
   * Exit driving mode and return current position for resuming normal mode
   */
  function exit(): DrivingModePosition | null {
    if (internalState.value === 'inactive') {
      return null
    }

    // Capture current position before cleanup
    const position: DrivingModePosition | null = segment.value
      ? {
          roundIndex: roundIndex.value,
          cycleIndex: segment.value.cycleIndex,
          phase: segment.value.phase
        }
      : null

    cleanup()

    return position
  }

  /**
   * Skip to the next round
   */
  async function skipToNextRound(): Promise<void> {
    if (internalState.value === 'inactive') return

    const totalRounds = options.getTotalRounds()
    if (roundIndex.value >= totalRounds - 1) {
      // Already on last round
      return
    }

    await transitionToNextRound()
  }

  /**
   * Skip to the previous round
   */
  async function skipToPreviousRound(): Promise<void> {
    if (internalState.value === 'inactive' || !mainAudio) return

    // If more than 3 seconds in, restart current round
    if (mainAudio.currentTime > 3) {
      mainAudio.currentTime = 0
      segment.value = currentRoundAudio?.segments[0] || null
      emitPositionUpdate()
      return
    }

    // Go to previous round if not on first
    if (roundIndex.value <= 0) {
      mainAudio.currentTime = 0
      return
    }

    // Release current audio
    if (currentRoundAudio) {
      releaseConcatenatedAudio(currentRoundAudio)
    }

    // Load previous round
    const prevIndex = roundIndex.value - 1
    currentRoundAudio = await loadRound(prevIndex)

    if (!currentRoundAudio) {
      console.error('[useDrivingMode] Failed to load previous round')
      return
    }

    // Clear next round audio since we're going back
    if (nextRoundAudio) {
      releaseConcatenatedAudio(nextRoundAudio)
      nextRoundAudio = null
    }

    // Update state
    roundIndex.value = prevIndex
    segment.value = currentRoundAudio.segments[0] || null

    // Emit callbacks
    options.onRoundChange?.(roundIndex.value)
    updateMediaSessionMetadata()

    // Play
    mainAudio.src = currentRoundAudio.blobUrl
    mainAudio.load()

    try {
      await mainAudio.play()
      stopSilentBridge()
      preloadNextRound()
    } catch (err) {
      console.error('[useDrivingMode] Failed to play previous round:', err)
    }
  }

  /**
   * Toggle between playing and paused states
   */
  function togglePlayPause(): void {
    if (!mainAudio || internalState.value === 'inactive') return

    if (mainAudio.paused) {
      mainAudio.play().then(() => {
        internalState.value = isLoadingNext ? 'loading-next' : 'playing'
        if ('mediaSession' in navigator) {
          navigator.mediaSession.playbackState = 'playing'
        }
      }).catch((err) => {
        console.error('[useDrivingMode] Failed to resume playback:', err)
      })
    } else {
      mainAudio.pause()
      internalState.value = 'paused'
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    }
  }

  // ----------------------------------------
  // Cleanup
  // ----------------------------------------

  /**
   * Full cleanup when exiting driving mode
   */
  function cleanup(): void {
    // Stop position tracking
    stopPositionTracking()

    // Stop and cleanup audio elements
    if (mainAudio) {
      mainAudio.pause()
      mainAudio.src = ''
      mainAudio = null
    }

    if (silentAudio) {
      silentAudio.pause()
      silentAudio.src = ''
      silentAudio = null
    }

    // Close audio context
    if (audioContext) {
      audioContext.close().catch(() => {
        // Ignore close errors
      })
      audioContext = null
    }

    // Release concatenated audio blobs
    if (currentRoundAudio) {
      releaseConcatenatedAudio(currentRoundAudio)
      currentRoundAudio = null
    }

    if (nextRoundAudio) {
      releaseConcatenatedAudio(nextRoundAudio)
      nextRoundAudio = null
    }

    // Run all cleanup functions (event listeners, media session)
    for (const fn of cleanupFns) {
      try {
        fn()
      } catch {
        // Ignore cleanup errors
      }
    }
    cleanupFns.length = 0

    // Clear Media Session
    clearMediaSession()

    // Reset state
    internalState.value = 'inactive'
    segment.value = null
    prepProgress.value = 0
    isLoadingNext = false
    isSilentPlaying = false
  }

  /**
   * Exit driving mode completely (used internally)
   */
  async function exitDrivingMode(): Promise<void> {
    cleanup()
  }

  // ----------------------------------------
  // Lifecycle
  // ----------------------------------------

  onUnmounted(() => {
    cleanup()
  })

  // ----------------------------------------
  // Return Public Interface
  // ----------------------------------------

  return {
    // State (reactive)
    state,
    currentRoundIndex,
    currentSegment,
    preparationProgress,
    isActive,

    // Aliases for convenience
    currentRound: currentRoundIndex,
    prepProgress: preparationProgress,

    // Actions
    enter,
    exit,
    skipToNextRound,
    skipToPreviousRound,
    togglePlayPause
  }
}
