/**
 * SessionController - Single orchestrator for learning sessions
 *
 * Replaces the complex handleCycleEvent logic with a clean state machine.
 * Single index for position (not double indexing).
 *
 * State machine: idle → loading → playing → paused → complete
 */

import { ref, readonly, computed, type Ref, type ComputedRef } from 'vue'
import type { LegoPair, SeedPair, ClassifiedBasket } from '@ssi/core'
import type {
  SessionState,
  SessionEventType,
  SessionEventData,
  SessionEventHandler,
  SessionProgress,
  RoundTemplate,
  RoundItem,
  ResumePoint,
  GetAudioSourceFn,
  CycleEventData,
  ScriptItem,
  Round,
} from './types'
import { getPlayableItems, applyConfig } from './types'
import { createCyclePlayer, type CyclePlayer } from './CyclePlayer'
import { createThreadManager, type ThreadManager } from './ThreadManager'
import { buildRounds } from './RoundBuilder'
import { createPlaybackConfig, type PlaybackConfig, DEFAULT_PLAYBACK_CONFIG } from './PlaybackConfig'
import { scriptItemToCycle } from '../utils/scriptItemToCycle'

export interface SessionController {
  // Lifecycle
  initialize(
    legos: LegoPair[],
    seeds: SeedPair[],
    baskets: Map<string, ClassifiedBasket>,
    courseId: string,
    resume?: ResumePoint
  ): Promise<void>

  start(getAudioSource: GetAudioSourceFn): void
  pause(): void
  resume(): void
  stop(): void

  // Navigation
  skipCycle(): void
  skipRound(): void
  jumpToRound(roundNumber: number): void

  // Configuration
  setConfig(config: Partial<PlaybackConfig>): void

  // State (reactive)
  readonly state: Ref<SessionState>
  readonly currentRound: ComputedRef<RoundTemplate | null>
  readonly currentItemIndex: Ref<number>  // SINGLE index
  readonly progress: ComputedRef<SessionProgress>
  readonly config: Ref<PlaybackConfig>

  // Events
  on(handler: SessionEventHandler): void
  off(handler: SessionEventHandler): void

  // Access to sub-components
  readonly cyclePlayer: CyclePlayer
  readonly threadManager: ThreadManager

  // Cleanup
  dispose(): void
}

export function createSessionController(): SessionController {
  // Core state
  const state = ref<SessionState>('idle')
  const currentItemIndex = ref(0)
  const config = ref<PlaybackConfig>(createPlaybackConfig())

  // Data
  const rounds = ref<RoundTemplate[]>([])
  const currentRoundIndex = ref(0)
  let courseId = ''
  let seeds: SeedPair[] = []
  let baskets: Map<string, ClassifiedBasket> = new Map()
  let getAudioSource: GetAudioSourceFn | null = null

  // Sub-components
  const cyclePlayer = createCyclePlayer()
  const threadManager = createThreadManager()

  // Event handlers
  const handlers = new Set<SessionEventHandler>()

  // Playback control
  let isPlaybackActive = false

  /**
   * Computed: current round
   */
  const currentRound = computed<RoundTemplate | null>(() => {
    if (currentRoundIndex.value >= rounds.value.length) return null
    return rounds.value[currentRoundIndex.value]
  })

  /**
   * Computed: session progress
   */
  const progress = computed<SessionProgress>(() => {
    const round = currentRound.value
    const playableItems = round ? getPlayableItems(round) : []

    return {
      roundNumber: currentRoundIndex.value + 1,
      itemIndex: currentItemIndex.value,
      totalItemsInRound: playableItems.length,
      roundsCompleted: currentRoundIndex.value,
      totalRounds: rounds.value.length,
      legosMastered: 0, // TODO: track from threadManager
    }
  })

  /**
   * Emit session event
   */
  function emit(type: SessionEventType, data?: Partial<SessionEventData>): void {
    const event: SessionEventData = {
      type,
      timestamp: Date.now(),
      round: currentRound.value ?? undefined,
      itemIndex: currentItemIndex.value,
      progress: progress.value,
      ...data,
    }

    for (const handler of handlers) {
      try {
        handler(event)
      } catch (e) {
        console.error('[SessionController] Event handler error:', e)
      }
    }
  }

  /**
   * Initialize session with course data
   */
  async function initialize(
    legos: LegoPair[],
    seedData: SeedPair[],
    basketData: Map<string, ClassifiedBasket>,
    course: string,
    resume?: ResumePoint
  ): Promise<void> {
    state.value = 'loading'
    courseId = course
    seeds = seedData
    baskets = basketData

    // Initialize thread manager
    if (resume?.threadState) {
      threadManager.restore(resume.threadState, legos, courseId)
      currentRoundIndex.value = resume.roundNumber
    } else {
      threadManager.initialize(legos, courseId)
      currentRoundIndex.value = 0
    }

    // Build rounds for each LEGO
    buildAllRounds(legos)

    currentItemIndex.value = 0
    state.value = 'idle'
  }

  /**
   * Build round templates for all LEGOs
   * Converts Round output from RoundBuilder to RoundTemplate with Cycles
   */
  function buildAllRounds(legos: LegoPair[]): void {
    // Build audio URL (SessionController doesn't have direct URL access - items have URLs)
    const buildAudioUrl = (audioId: string): string => {
      // URL will be resolved at playback time via getAudioSource
      // Return a placeholder that can be matched by audio ID
      return `/api/audio/${audioId}`
    }

    // Build rounds using RoundBuilder
    const builtRounds = buildRounds(legos, seeds, baskets, config.value, buildAudioUrl)

    // Convert Round[] to RoundTemplate[] by adding Cycle to each item
    rounds.value = builtRounds.map((round): RoundTemplate => ({
      roundNumber: round.roundNumber,
      legoId: round.legoId,
      legoIndex: round.legoIndex,
      seedId: round.seedId,
      spacedRepReviews: round.spacedRepReviews,
      items: round.items.map((item): RoundItem => ({
        ...item,
        // Convert ScriptItem to Cycle for playback (null for intro items)
        cycle: item.type !== 'intro' ? scriptItemToCycle(item) : null,
        // All items playable by default (config can toggle)
        playable: true,
      })),
    }))

    // Apply config to set playable flags correctly
    rounds.value = rounds.value.map(round => applyConfig(round, config.value))
  }

  /**
   * Find the seed that contains a LEGO
   */
  function findSeedForLego(legoId: string): SeedPair | null {
    for (const seed of seeds) {
      if (seed.legos.some(l => l.id === legoId)) {
        return seed
      }
    }
    return seeds[0] ?? null
  }

  /**
   * Start playback
   */
  function start(audioSource: GetAudioSourceFn): void {
    if (state.value !== 'idle' && state.value !== 'paused') return

    getAudioSource = audioSource
    state.value = 'playing'
    isPlaybackActive = true

    emit('session:started')
    playCurrentItem()
  }

  /**
   * Play the current item
   */
  async function playCurrentItem(): Promise<void> {
    if (!isPlaybackActive || state.value !== 'playing') return

    const round = currentRound.value
    if (!round) {
      completeSession()
      return
    }

    const playableItems = getPlayableItems(round)
    if (currentItemIndex.value >= playableItems.length) {
      completeRound()
      return
    }

    const item = playableItems[currentItemIndex.value]
    emit('item:started', { item })

    // Handle intro (audio-only, no 4-phase cycle)
    if (item.type === 'intro' && !item.cycle) {
      // TODO: Play intro audio
      await handleItemComplete(item)
      return
    }

    // Play the cycle
    if (item.cycle && getAudioSource) {
      try {
        await cyclePlayer.playCycle(item.cycle, getAudioSource, config.value)
        await handleItemComplete(item)
      } catch (err) {
        console.error('[SessionController] Cycle playback error:', err)
        // Continue to next item on error
        await handleItemComplete(item)
      }
    }
  }

  /**
   * Handle item completion
   */
  async function handleItemComplete(item: RoundItem): Promise<void> {
    if (!isPlaybackActive || state.value !== 'playing') return

    emit('item:completed', { item })

    // Record practice for spaced rep
    if (item.cycle && item.type !== 'intro') {
      threadManager.recordPractice(item.cycle.legoId, true)
    }

    // Advance to next item
    currentItemIndex.value++

    const round = currentRound.value
    if (!round) {
      completeSession()
      return
    }

    const playableItems = getPlayableItems(round)
    if (currentItemIndex.value >= playableItems.length) {
      completeRound()
    } else {
      playCurrentItem()
    }
  }

  /**
   * Complete current round and move to next
   */
  function completeRound(): void {
    emit('round:completed')

    // Decrement skip numbers for spaced rep
    threadManager.decrementSkipNumbers()

    // Move to next round
    currentRoundIndex.value++
    currentItemIndex.value = 0

    if (currentRoundIndex.value >= rounds.value.length) {
      completeSession()
      return
    }

    emit('round:started')
    playCurrentItem()
  }

  /**
   * Complete the session
   */
  function completeSession(): void {
    state.value = 'complete'
    isPlaybackActive = false
    emit('session:complete')
  }

  /**
   * Pause playback
   */
  function pause(): void {
    if (state.value !== 'playing') return

    cyclePlayer.stop()
    state.value = 'paused'
    isPlaybackActive = false
    emit('session:paused')
  }

  /**
   * Resume playback
   */
  function resumePlayback(): void {
    if (state.value !== 'paused') return
    if (!getAudioSource) return

    state.value = 'playing'
    isPlaybackActive = true
    emit('session:resumed')
    playCurrentItem()
  }

  /**
   * Stop playback completely
   */
  function stop(): void {
    cyclePlayer.stop()
    state.value = 'idle'
    isPlaybackActive = false
  }

  /**
   * Skip current cycle
   */
  function skipCycle(): void {
    if (state.value !== 'playing') return

    cyclePlayer.stop()

    const round = currentRound.value
    if (!round) return

    const playableItems = getPlayableItems(round)
    currentItemIndex.value++

    if (currentItemIndex.value >= playableItems.length) {
      completeRound()
    } else {
      playCurrentItem()
    }
  }

  /**
   * Skip current round
   */
  function skipRound(): void {
    if (state.value !== 'playing' && state.value !== 'paused') return

    cyclePlayer.stop()
    completeRound()
  }

  /**
   * Jump to a specific round
   */
  function jumpToRound(roundNumber: number): void {
    if (roundNumber < 0 || roundNumber >= rounds.value.length) return

    cyclePlayer.stop()
    currentRoundIndex.value = roundNumber
    currentItemIndex.value = 0

    if (state.value === 'playing') {
      emit('round:started')
      playCurrentItem()
    }
  }

  /**
   * Update configuration
   */
  function setConfig(newConfig: Partial<PlaybackConfig>): void {
    config.value = createPlaybackConfig({ ...config.value, ...newConfig })

    // Reapply config to all rounds (flips playable flags)
    rounds.value = rounds.value.map(round => applyConfig(round, config.value))
  }

  /**
   * Subscribe to session events
   */
  function on(handler: SessionEventHandler): void {
    handlers.add(handler)
  }

  /**
   * Unsubscribe from session events
   */
  function off(handler: SessionEventHandler): void {
    handlers.delete(handler)
  }

  /**
   * Wire up cycle player events
   */
  cyclePlayer.on((event: CycleEventData) => {
    // Forward cycle events as needed
    // UI can subscribe directly to cyclePlayer for fine-grained updates
  })

  /**
   * Cleanup
   */
  function dispose(): void {
    stop()
    handlers.clear()
    cyclePlayer.dispose()
  }

  return {
    // Lifecycle
    initialize,
    start,
    pause,
    resume: resumePlayback,
    stop,

    // Navigation
    skipCycle,
    skipRound,
    jumpToRound,

    // Configuration
    setConfig,

    // State (reactive)
    state: readonly(state) as Ref<SessionState>,
    currentRound,
    currentItemIndex: readonly(currentItemIndex) as Ref<number>,
    progress,
    config: readonly(config) as Ref<PlaybackConfig>,

    // Events
    on,
    off,

    // Sub-components
    cyclePlayer,
    threadManager,

    // Cleanup
    dispose,
  }
}

/**
 * Vue composable wrapper
 */
export function useSessionController(): SessionController {
  return createSessionController()
}
