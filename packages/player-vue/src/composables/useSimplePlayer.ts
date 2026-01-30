/**
 * useSimplePlayer - Vue composable for reactive SimplePlayer usage
 * Thin reactive wrapper around SimplePlayer with computed refs and cleanup.
 */
import { ref, computed, onUnmounted, type ComputedRef } from 'vue'
import {
  SimplePlayer,
  type PlaybackState,
  type Round,
  type Cycle,
  type Phase,
} from '../playback/SimplePlayer'

export interface UseSimplePlayerReturn {
  state: ComputedRef<PlaybackState>
  currentRound: ComputedRef<Round | null>
  currentCycle: ComputedRef<Cycle | null>
  phase: ComputedRef<Phase>
  isPlaying: ComputedRef<boolean>
  inIntroSequence: ComputedRef<boolean>
  roundIndex: ComputedRef<number>
  cycleIndex: ComputedRef<number>
  knownText: ComputedRef<string>
  targetText: ComputedRef<string>
  showTargetText: ComputedRef<boolean>
  progress: ComputedRef<{ round: number; total: number; percent: number }>
  initialize: (rounds: Round[]) => void
  play: () => void
  pause: () => void
  resume: () => void
  stop: () => void
  skipCycle: () => void
  skipRound: () => void
  jumpToRound: (index: number) => void
  onPhaseChanged: (callback: (phase: Phase) => void) => void
  onCycleCompleted: (callback: (cycle: Cycle) => void) => void
  onRoundCompleted: (callback: (round: Round) => void) => void
  onSessionComplete: (callback: () => void) => void
}

export function useSimplePlayer(): UseSimplePlayerReturn {
  // Internal state
  let player: SimplePlayer | null = null
  const internalState = ref<PlaybackState>({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false, inIntroSequence: false })
  const roundsRef = ref<Round[]>([])

  // Event callback storage
  const phaseCallbacks: Array<(phase: Phase) => void> = []
  const cycleCallbacks: Array<(cycle: Cycle) => void> = []
  const roundCallbacks: Array<(round: Round) => void> = []
  const sessionCallbacks: Array<() => void> = []

  // Initialize with rounds - creates new player instance
  function initialize(rounds: Round[]): void {
    // Clean up existing player
    if (player) {
      player.stop()
    }

    roundsRef.value = rounds
    player = new SimplePlayer(rounds)

    // Subscribe to state changes
    player.on('state_changed', (data) => {
      internalState.value = data as PlaybackState
    })

    // Forward events to registered callbacks
    player.on('phase_changed', (data: any) => {
      phaseCallbacks.forEach(cb => cb(data.phase))
    })
    player.on('cycle_completed', (data: any) => {
      cycleCallbacks.forEach(cb => cb(data.cycle))
    })
    player.on('round_completed', (data: any) => {
      roundCallbacks.forEach(cb => cb(data.round))
    })
    player.on('session_complete', () => {
      sessionCallbacks.forEach(cb => cb())
    })
  }

  // Computed refs for reactive state
  const state = computed(() => internalState.value)
  const phase = computed(() => internalState.value.phase)
  const isPlaying = computed(() => internalState.value.isPlaying)
  const inIntroSequence = computed(() => internalState.value.inIntroSequence)
  const roundIndex = computed(() => internalState.value.roundIndex)
  const cycleIndex = computed(() => internalState.value.cycleIndex)

  // Current round and cycle from rounds array
  const currentRound = computed<Round | null>(() => {
    return roundsRef.value[internalState.value.roundIndex] ?? null
  })

  const currentCycle = computed<Cycle | null>(() => {
    const round = currentRound.value
    if (!round) return null
    return round.cycles[internalState.value.cycleIndex] ?? null
  })

  // Derived state for UI
  const knownText = computed(() => currentCycle.value?.known.text ?? '')
  const targetText = computed(() => currentCycle.value?.target.text ?? '')
  const showTargetText = computed(() => internalState.value.phase === 'voice2')

  // Progress
  const progress = computed(() => {
    const total = roundsRef.value.length || 1
    const round = internalState.value.roundIndex + 1
    const percent = total > 0 ? Math.round((round / total) * 100) : 0
    return { round, total, percent }
  })

  // Methods (passthrough to player)
  const play = () => player?.play()
  const pause = () => player?.pause()
  const resume = () => player?.resume()
  const stop = () => player?.stop()
  const skipCycle = () => player?.skipCycle()
  const skipRound = () => player?.skipRound()
  const jumpToRound = (index: number) => player?.jumpToRound(index)

  // Event hooks
  const onPhaseChanged = (callback: (phase: Phase) => void) => { phaseCallbacks.push(callback) }
  const onCycleCompleted = (callback: (cycle: Cycle) => void) => { cycleCallbacks.push(callback) }
  const onRoundCompleted = (callback: (round: Round) => void) => { roundCallbacks.push(callback) }
  const onSessionComplete = (callback: () => void) => { sessionCallbacks.push(callback) }

  // Cleanup on unmount
  onUnmounted(() => {
    player?.stop()
    phaseCallbacks.length = 0
    cycleCallbacks.length = 0
    roundCallbacks.length = 0
    sessionCallbacks.length = 0
  })

  return {
    state,
    currentRound,
    currentCycle,
    phase,
    isPlaying,
    inIntroSequence,
    roundIndex,
    cycleIndex,
    knownText,
    targetText,
    showTargetText,
    progress,
    initialize,
    play,
    pause,
    resume,
    stop,
    skipCycle,
    skipRound,
    jumpToRound,
    onPhaseChanged,
    onCycleCompleted,
    onRoundCompleted,
    onSessionComplete,
  }
}

// Re-export types for convenience
export type { Round, Cycle, Phase, PlaybackState } from '../playback/SimplePlayer'
