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
import { useAudioSessionKeepalive } from './useAudioSessionKeepalive'
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
  /**
   * Optional: collect the audio ids needed by a round. Used together with
   * {@link prefetchAudio} to pre-warm the IndexedDB cache before
   * concatenation runs. Returning a complete list is best-effort —
   * concatenation falls through to direct fetches for anything missing.
   *
   * When this is omitted (or returns an empty list), prepare() skips the
   * pre-warm step and uses the legacy serial-fetch path inside
   * concatenateRound. Behavior is unchanged from before this composable
   * grew chunked prefetch.
   */
  getRoundAudioIds?: (roundIndex: number) => string[]
  /**
   * Optional: pre-warm the IndexedDB cache for a set of audio ids. Should
   * resolve when the given ids are durably in cache (driving mode
   * activates the moment this promise settles). Errors are absorbed
   * by driving-mode — concatenation will still fall through to network
   * fetches for any uncached id.
   *
   * Two-phase pattern (caller's choice, but the design driving this
   * contract): phase 1 awaits the priority ids in parallel (fast,
   * unblocks activation); phase 2 fires a fire-and-forget background
   * chunk-fill bounded by `maxBytes` (slow, fills the long tail behind
   * the learner). The Promise resolves at the end of phase 1, so each
   * round's audio is "the first chunk that lets it start" and the 50 MB
   * headroom continues accumulating in the background.
   *
   * The wiring in LearningPlayer.vue routes this through
   * audioCache.persistent.ensure (phase 1) + BundleDownloader.start
   * (phase 2). Driving-mode itself stays agnostic — anything that
   * fulfils this Promise will work.
   */
  prefetchAudio?: (
    audioIds: string[],
    opts?: { maxBytes?: number },
  ) => Promise<void>
  /**
   * Size cap (bytes) for each chunked cache fill. Tom's spec: ~50 MB.
   * Large enough that one chunk covers several rounds of audio and the
   * long-tail backstop kicks in; small enough that the chunk lands in
   * a handful of seconds on a typical mobile connection, so activation
   * isn't gated on the full course download.
   *
   * Defaults to 50 MB. Set to 0 to disable the size cap (prefetch fills
   * until queue exhausted — falls back to BundleDownloader's old behavior).
   */
  chunkBytes?: number
}

interface DrivingModeReturn {
  // State (reactive)
  state: ComputedRef<DrivingModeState>
  currentRoundIndex: ComputedRef<number>
  currentSegment: ComputedRef<AudioSegment | null>
  preparationProgress: ComputedRef<number>
  isActive: ComputedRef<boolean>
  isPrepared: ComputedRef<boolean>

  // Aliases for convenience
  currentRound: ComputedRef<number>
  prepProgress: ComputedRef<number>

  // Actions
  prepare: (startFromRound: number) => Promise<void>
  enter: (startFromRound?: number) => Promise<void>
  exit: () => DrivingModePosition | null
  skipToNextRound: () => Promise<void>
  skipToPreviousRound: () => Promise<void>
  togglePlayPause: () => void
}

// ============================================================================
// Constants
// ============================================================================

/** Position update interval (ms) for animation frame updates */
const POSITION_UPDATE_INTERVAL = 250

/** Seconds of no progress before we consider audio stalled */
const STALL_DETECTION_TIMEOUT_SECS = 5

/** Delay (ms) before retrying a failed play() call */
const PLAY_RETRY_DELAY_MS = 1000

/** Maximum number of play() retries before giving up */
const PLAY_MAX_RETRIES = 2

/**
 * Default size cap for chunked cache fill. ~50 MB matches Tom's spec
 * for driving-mode activation: enough to cover the current round plus
 * a few rounds of headroom, small enough to land in seconds on mobile.
 */
const DEFAULT_CHUNK_BYTES = 50 * 1024 * 1024

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

  // Concatenated audio storage
  let currentRoundAudio: ConcatenatedAudio | null = null
  let nextRoundAudio: ConcatenatedAudio | null = null

  // State tracking
  let isLoadingNext = false
  let positionUpdateFrame: number | null = null
  let lastPositionUpdateTime = 0

  // Pre-built audio (from prepare() — survives modal cancel)
  let preparedRoundAudio: ConcatenatedAudio | null = null
  let preparedForRound = -1
  let isPrepareInProgress = false

  // Preload generation counter — incremented on skip to abort stale preloads
  let preloadGeneration = 0

  // Stall detection
  let lastKnownCurrentTime = -1
  let stallCheckTimer: ReturnType<typeof setInterval> | null = null

  // Wake Lock (prevents screen sleep on Android)
  let wakeLock: WakeLockSentinel | null = null

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

  const isPrepared = computed<boolean>(() =>
    preparedRoundAudio !== null
  )

  // iOS audio-session keepalive — runs the silent loop for the whole
  // driving session. Replaces the old per-transition bridge that only
  // fired in the last 2s of each round. Continuous coverage means the
  // brief gap between concatenated round blobs (mainAudio.src swap +
  // load() + play()) can't drop the session.
  useAudioSessionKeepalive(isActive)

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
   * Handle timeupdate events to track segment position
   */
  function handleTimeUpdate(): void {
    if (!mainAudio || !currentRoundAudio) return

    const currentTime = mainAudio.currentTime

    // Update current segment based on time
    const foundSegment = findSegmentAtTime(currentRoundAudio.segments, currentTime)
    if (foundSegment && foundSegment !== segment.value) {
      segment.value = foundSegment
      emitPositionUpdate()
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
  // Wake Lock (Android screen sleep prevention)
  // ----------------------------------------

  async function acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return
    try {
      wakeLock = await navigator.wakeLock.request('screen')
      wakeLock.addEventListener('release', () => { wakeLock = null })
      // Re-acquire if tab becomes visible again (Android releases on tab switch)
      const handleVisibility = async () => {
        if (document.visibilityState === 'visible' && internalState.value === 'playing' && !wakeLock) {
          try { wakeLock = await navigator.wakeLock.request('screen') } catch { /* ignore */ }
        }
      }
      document.addEventListener('visibilitychange', handleVisibility)
      cleanupFns.push(() => document.removeEventListener('visibilitychange', handleVisibility))
    } catch {
      // Wake Lock not available or denied — continue without it
    }
  }

  function releaseWakeLock(): void {
    if (wakeLock) {
      wakeLock.release().catch(() => {})
      wakeLock = null
    }
  }

  // ----------------------------------------
  // Round Loading & Transitions
  // ----------------------------------------

  /**
   * Pre-warm the audio cache for a round before concatenation runs. This
   * is the "first chunk lets it start" half of the chunked-download
   * design: instead of letting concatenateRound do 60+ serial fetches
   * on a cold cache, we feed the round's audio ids to the caller's
   * chunked prefetch (BundleDownloader.start with maxBytes=chunkBytes).
   *
   * Behavior:
   *   - If the caller didn't supply `prefetchAudio` + `getRoundAudioIds`,
   *     this is a no-op and concatenateRound stays on the legacy path.
   *   - The prefetch typically downloads MORE than this round's audio
   *     (the chunk cap absorbs extra ids opportunistically), so by the
   *     time we move to the next round its audio is already local.
   *   - Errors from prefetch are absorbed — concatenateRound's
   *     `getAudioSource` will fall through to the proxy URL for any
   *     uncached id, just like before.
   */
  async function prefetchForRound(index: number): Promise<void> {
    if (!options.prefetchAudio || !options.getRoundAudioIds) return

    const ids = options.getRoundAudioIds(index)
    if (!ids || ids.length === 0) return

    // chunkBytes default 50 MB; 0 disables the cap (caller decides).
    const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES
    const maxBytes = chunkBytes > 0 ? chunkBytes : undefined

    try {
      await options.prefetchAudio(ids, { maxBytes })
    } catch (err) {
      // Don't fail the round on a prefetch failure — concatenateRound
      // has its own fallback path (proxy URL via getAudioSource).
      console.warn(`[useDrivingMode] Cache prefetch failed for round ${index}, falling back to direct fetch:`, err)
    }
  }

  /**
   * Concatenate a round's audio into a single blob. Pre-warms the cache
   * first via {@link prefetchForRound} when the caller wired it up —
   * concatenation then reads locally instead of paying 60+ serial
   * network fetches.
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

    // Step 1: pre-warm the audio cache for this round (no-op if the
    // caller didn't wire up prefetchAudio). Driving-mode activates as
    // soon as this chunk lands AND concatenation runs.
    await prefetchForRound(index)

    // Step 2: concatenate. By now the audio cache is warm for most ids
    // in the round; concatenateRound's fetches resolve from blob: URLs
    // instead of going to the network.
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

    const generation = preloadGeneration

    isLoadingNext = true
    if (internalState.value === 'playing') {
      internalState.value = 'loading-next'
    }

    try {
      const result = await loadRound(nextIndex)

      // If a skip happened while we were loading, discard the stale result
      if (generation !== preloadGeneration) {
        if (result) releaseConcatenatedAudio(result)
        return
      }

      nextRoundAudio = result
    } catch (err) {
      console.error('[useDrivingMode] Failed to preload next round:', err)
    } finally {
      // Only update loading state if this preload is still current
      if (generation === preloadGeneration) {
        isLoadingNext = false
        if (internalState.value === 'loading-next') {
          internalState.value = 'playing'
        }
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

    await playWithRetry()

    // Start preloading next round
    preloadNextRound()
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
  // Stall Detection
  // ----------------------------------------

  /**
   * Start watching for audio stalls (currentTime stops advancing while playing)
   */
  function startStallDetection(): void {
    if (stallCheckTimer !== null) return

    lastKnownCurrentTime = -1

    stallCheckTimer = setInterval(() => {
      if (!mainAudio || mainAudio.paused || internalState.value === 'inactive') {
        lastKnownCurrentTime = -1
        return
      }

      const current = mainAudio.currentTime
      if (lastKnownCurrentTime >= 0 && current === lastKnownCurrentTime) {
        // Audio hasn't advanced — attempt recovery
        console.warn('[useDrivingMode] Stall detected, attempting recovery')
        recoverFromStall()
      }
      lastKnownCurrentTime = current
    }, STALL_DETECTION_TIMEOUT_SECS * 1000)
  }

  /**
   * Stop stall detection
   */
  function stopStallDetection(): void {
    if (stallCheckTimer !== null) {
      clearInterval(stallCheckTimer)
      stallCheckTimer = null
    }
  }

  /**
   * Attempt to recover from a stalled audio element
   */
  async function recoverFromStall(): Promise<void> {
    if (!mainAudio) return

    // Try re-seeking first
    try {
      const pos = mainAudio.currentTime
      mainAudio.currentTime = pos + 0.1
      await mainAudio.play()
      console.info('[useDrivingMode] Recovered from stall via re-seek')
      return
    } catch {
      // Re-seek failed, transition to next round
    }

    console.warn('[useDrivingMode] Re-seek failed, transitioning to next round')
    await handleMainAudioEnded()
  }

  // ----------------------------------------
  // Play with Retry
  // ----------------------------------------

  /**
   * Attempt to play mainAudio with retry on failure (e.g. iOS interruption)
   */
  async function playWithRetry(retries = PLAY_MAX_RETRIES): Promise<void> {
    if (!mainAudio) return

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await mainAudio.play()
        return
      } catch (err) {
        console.warn(`[useDrivingMode] play() failed (attempt ${attempt + 1}/${retries + 1}):`, err)
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, PLAY_RETRY_DELAY_MS))
        } else {
          console.error('[useDrivingMode] play() failed after all retries, transitioning')
          // Surface error but don't crash — try next round
          await handleMainAudioEnded()
        }
      }
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
   * Pre-build audio for a round without starting playback.
   * Survives modal cancel — enter() will use the pre-built audio if valid.
   */
  async function prepare(startFromRound: number): Promise<void> {
    // Already prepared for this round
    if (preparedRoundAudio && preparedForRound === startFromRound) return
    // Already preparing or already active
    if (isPrepareInProgress) return
    if (internalState.value !== 'inactive') return

    // Release old prepared audio if for a different round
    if (preparedRoundAudio) {
      releaseConcatenatedAudio(preparedRoundAudio)
      preparedRoundAudio = null
    }

    preparedForRound = startFromRound
    prepProgress.value = 0
    isPrepareInProgress = true

    // Create audio context if needed
    if (!audioContext) {
      audioContext = createAudioContext()
    }

    try {
      preparedRoundAudio = await loadRound(startFromRound, (progress) => {
        prepProgress.value = progress
      })
      if (preparedRoundAudio) {
        prepProgress.value = 1
      }
    } catch (err) {
      console.error('[useDrivingMode] Failed to prepare round:', err)
      preparedRoundAudio = null
      preparedForRound = -1
    } finally {
      isPrepareInProgress = false
    }
  }

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
      // Create audio infrastructure (reuse AudioContext from prepare() if available)
      if (!audioContext) {
        audioContext = createAudioContext()
      }
      mainAudio = createMainAudio()

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

      // Use pre-built audio from prepare() if available for this round
      if (preparedRoundAudio && preparedForRound === startFromRound) {
        currentRoundAudio = preparedRoundAudio
        preparedRoundAudio = null
        preparedForRound = -1
        prepProgress.value = 1
      } else {
        // Build from scratch
        currentRoundAudio = await loadRound(startFromRound, (progress) => {
          prepProgress.value = progress
        })
      }

      if (!currentRoundAudio) {
        throw new Error('Failed to prepare first round audio')
      }

      // Setup Media Session and Wake Lock
      setupMediaSession()
      await acquireWakeLock()

      // Initialize segment
      segment.value = currentRoundAudio.segments[0] || null

      // Start playback
      mainAudio.src = currentRoundAudio.blobUrl
      mainAudio.load()

      await playWithRetry()

      internalState.value = 'playing'
      prepProgress.value = 1

      // Start position tracking and stall detection
      startPositionTracking()
      startStallDetection()

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

    // Abort any in-flight preload
    preloadGeneration++

    // Discard stale preloaded audio if it's for the wrong round
    if (nextRoundAudio) {
      releaseConcatenatedAudio(nextRoundAudio)
      nextRoundAudio = null
    }
    isLoadingNext = false

    await transitionToNextRound()
  }

  /**
   * Skip to the previous round
   */
  async function skipToPreviousRound(): Promise<void> {
    if (internalState.value === 'inactive' || !mainAudio) return

    // Abort any in-flight preload
    preloadGeneration++
    isLoadingNext = false

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

    await playWithRetry()
    preloadNextRound()
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
    // Stop position tracking and stall detection
    stopPositionTracking()
    stopStallDetection()

    // Stop and cleanup audio elements
    if (mainAudio) {
      mainAudio.pause()
      mainAudio.src = ''
      mainAudio = null
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

    // Release prepared audio too
    if (preparedRoundAudio) {
      releaseConcatenatedAudio(preparedRoundAudio)
      preparedRoundAudio = null
      preparedForRound = -1
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

    // Release Wake Lock and clear Media Session
    releaseWakeLock()
    clearMediaSession()

    // Reset state
    internalState.value = 'inactive'
    segment.value = null
    prepProgress.value = 0
    isLoadingNext = false
    preloadGeneration = 0
    lastKnownCurrentTime = -1
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
    isPrepared,

    // Aliases for convenience
    currentRound: currentRoundIndex,
    prepProgress: preparationProgress,

    // Actions
    prepare,
    enter,
    exit,
    skipToNextRound,
    skipToPreviousRound,
    togglePlayPause
  }
}
