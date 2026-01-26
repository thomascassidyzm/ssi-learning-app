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

  /**
   * Initialize empty session ready for incremental round loading
   * Used for fast startup - session can start playing as rounds are added
   */
  initializeEmpty(courseId: string, resume?: ResumePoint): void

  start(getAudioSource: GetAudioSourceFn): void
  pause(): void
  resume(): void
  stop(): void

  // Incremental round loading
  /**
   * Add a single round to the session
   * @param round - The round template to add
   */
  addRound(round: RoundTemplate): void

  /**
   * Add multiple rounds to the session
   * @param rounds - Array of round templates to add
   */
  addRounds(rounds: RoundTemplate[]): void

  /**
   * Check if a round at the given index exists
   * @param roundIndex - 0-based round index
   */
  hasRound(roundIndex: number): boolean

  /**
   * Get the current number of loaded rounds
   */
  getRoundCount(): number

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
  readonly rounds: Ref<RoundTemplate[]>  // Expose rounds for external access

  // Completed content (for BrainView and Listening components)
  readonly completedRounds: ComputedRef<RoundTemplate[]>
  readonly completedLegoIds: ComputedRef<Set<string>>

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
   * Completed rounds (all rounds before current)
   * Used by BrainView and Listening to know which content is available
   */
  const completedRounds = computed<RoundTemplate[]>(() => {
    return rounds.value.slice(0, currentRoundIndex.value)
  })

  /**
   * Set of LEGO IDs from completed rounds
   * Used by BrainView to show only completed nodes
   * Used by Listening to filter available phrases
   */
  const completedLegoIds = computed<Set<string>>(() => {
    const ids = new Set<string>()
    for (let i = 0; i < currentRoundIndex.value; i++) {
      const round = rounds.value[i]
      if (round?.legoId) {
        ids.add(round.legoId)
      }
    }
    return ids
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
        // Event handler errors are non-critical
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
   * Initialize empty session ready for incremental round loading
   * Used for fast startup - session can start playing as rounds are added
   */
  function initializeEmpty(course: string, resume?: ResumePoint): void {
    state.value = 'loading'
    courseId = course
    seeds = []
    baskets = new Map()

    // Clear existing rounds
    rounds.value = []
    currentRoundIndex.value = resume?.roundNumber ?? 0
    currentItemIndex.value = 0
    state.value = 'idle'

    console.log('[SessionController] Initialized empty session for', course)
  }

  /**
   * Add a single round to the session
   */
  function addRound(round: RoundTemplate): void {
    // Apply config to set playable flags
    const configuredRound = applyConfig(round, config.value)
    rounds.value = [...rounds.value, configuredRound]
    emit('round:loaded', { roundNumber: round.roundNumber })

    // If we were waiting for this round, resume playback
    if (isPlaybackActive && state.value === 'playing' && !currentRound.value) {
      const newCurrentRound = rounds.value[currentRoundIndex.value]
      if (newCurrentRound) {
        console.log('[SessionController] Round', round.roundNumber, 'loaded, resuming playback')
        playCurrentItem()
      }
    }
  }

  /**
   * Add multiple rounds to the session
   */
  function addRounds(newRounds: RoundTemplate[]): void {
    // Apply config to each round
    const configuredRounds = newRounds.map(round => applyConfig(round, config.value))
    rounds.value = [...rounds.value, ...configuredRounds]
    for (const round of newRounds) {
      emit('round:loaded', { roundNumber: round.roundNumber })
    }
  }

  /**
   * Check if a round at the given index exists
   */
  function hasRound(roundIndex: number): boolean {
    return roundIndex >= 0 && roundIndex < rounds.value.length
  }

  /**
   * Get the current number of loaded rounds
   */
  function getRoundCount(): number {
    return rounds.value.length
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
      // Check if we're waiting for a round to load (lazy loading scenario)
      if (currentRoundIndex.value < rounds.value.length) {
        // Round should exist but doesn't - this is unexpected
        completeSession()
        return
      }
      // Round not yet loaded - emit loading event and wait
      // The PriorityRoundLoader will add rounds as they load
      emit('round:loading', { roundNumber: currentRoundIndex.value + 1 })
      console.log('[SessionController] Waiting for round', currentRoundIndex.value + 1, 'to load')
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
        // Audio errors are non-critical - continue to next item
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
    initializeEmpty,
    start,
    pause,
    resume: resumePlayback,
    stop,

    // Incremental round loading
    addRound,
    addRounds,
    hasRound,
    getRoundCount,

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
    rounds: readonly(rounds) as Ref<RoundTemplate[]>,

    // Completed content (for BrainView and Listening)
    completedRounds,
    completedLegoIds,

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
