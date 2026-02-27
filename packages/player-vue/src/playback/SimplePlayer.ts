// SimplePlayer.ts - Clean playback engine (~180 lines)

export interface Cycle {
  id: string
  known: { text: string; audioUrl: string }
  target: { text: string; voice1Url: string; voice2Url: string }
  pauseDuration?: number // ms — set by toSimpleRounds formula
  lingerMs?: number // ms — extra hold after voice2 (intro/debut: lets learner read tiles)
  legoId?: string // The LEGO this cycle is practising
  componentLegoIds?: string[]
  componentLegoTexts?: string[]
  /** M-LEGO component breakdown for visual display */
  components?: Array<{ known: string; target: string }>
}

export interface Round {
  roundNumber: number
  legoId: string
  seedId: string
  cycles: Cycle[]
}

// Phases: prompt → pause → voice1 → voice2
export type Phase = 'idle' | 'prompt' | 'pause' | 'voice1' | 'voice2'

export interface PlaybackState {
  roundIndex: number
  cycleIndex: number
  phase: Phase
  isPlaying: boolean
}

type EventName = 'state_changed' | 'phase_changed' | 'cycle_completed' | 'round_completed' | 'session_complete'
type EventCallback = (data?: unknown) => void

// Fallback: bootUpTime(2000) + scaleFactor(0.75) × estimatedTarget(6000) = 6500ms
const DEFAULT_PAUSE_DURATION = 6500

export class SimplePlayer {
  private rounds: Round[]
  private audio: HTMLAudioElement
  private state: PlaybackState
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private safetyTimer: ReturnType<typeof setTimeout> | null = null
  private lingerTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Map<EventName, Set<EventCallback>> = new Map()

  // Named handlers for cleanup in dispose()
  private onEndedHandler: () => void
  private onErrorHandler: (e: Event) => void

  constructor(rounds: Round[]) {
    this.rounds = rounds
    this.audio = new Audio()
    this.state = { roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false }

    this.onEndedHandler = () => this.onAudioEnded()
    this.onErrorHandler = (e: Event) => {
      console.error('Audio error:', e)
      if (this.state.phase !== 'pause' && this.state.phase !== 'idle') {
        this.onAudioEnded()
      }
    }

    this.audio.addEventListener('ended', this.onEndedHandler)
    this.audio.addEventListener('error', this.onErrorHandler)
  }

  // Event emitter
  on(event: EventName, callback: EventCallback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(callback)
  }

  off(event: EventName, callback: EventCallback): void {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: EventName, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }

  // Getters
  get currentRound(): Round | undefined {
    return this.rounds[this.state.roundIndex]
  }

  get currentCycle(): Cycle | undefined {
    return this.currentRound?.cycles[this.state.cycleIndex]
  }

  get currentState(): PlaybackState {
    return { ...this.state }
  }

  get progress(): { round: number; totalRounds: number; cycle: number; totalCycles: number } {
    const round = this.currentRound
    return {
      round: this.state.roundIndex + 1,
      totalRounds: this.rounds.length,
      cycle: this.state.cycleIndex + 1,
      totalCycles: round?.cycles.length ?? 0,
    }
  }

  get roundCount(): number {
    return this.rounds.length
  }

  // Dynamic round management (for priority loading)

  /**
   * Add rounds to the player. Rounds are inserted at the correct position
   * based on their roundNumber to maintain order.
   */
  addRounds(newRounds: Round[]): void {
    if (newRounds.length === 0) return

    // Build set of existing legoIds for fast duplicate detection
    const existingLegoIds = new Set(this.rounds.map(r => r.legoId))

    // Insert each round at the correct position based on legoId (which encodes seed + lego index)
    for (const round of newRounds) {
      // Skip if this exact LEGO already exists (by legoId, not roundNumber)
      if (existingLegoIds.has(round.legoId)) {
        continue
      }

      // Find insertion point (maintain legoId order - S0001L01 < S0001L02 < S0002L01)
      const insertIndex = this.rounds.findIndex(r => r.legoId > round.legoId)
      if (insertIndex === -1) {
        this.rounds.push(round)
      } else {
        this.rounds.splice(insertIndex, 0, round)
        if (insertIndex <= this.state.roundIndex) {
          this.state.roundIndex++
        }
      }
      existingLegoIds.add(round.legoId)
    }

    console.debug(`[SimplePlayer] Added ${newRounds.length} rounds, total now: ${this.rounds.length}`)
  }

  /**
   * Check if a round exists by its roundNumber
   */
  hasRound(roundNumber: number): boolean {
    return this.rounds.some(r => r.roundNumber === roundNumber)
  }

  /**
   * Get round by roundNumber (not index)
   */
  getRoundByNumber(roundNumber: number): Round | undefined {
    return this.rounds.find(r => r.roundNumber === roundNumber)
  }

  /**
   * Find the index of a round by its roundNumber
   */
  findRoundIndex(roundNumber: number): number {
    return this.rounds.findIndex(r => r.roundNumber === roundNumber)
  }

  // Controls
  play(): void {
    if (this.state.isPlaying) return
    const round = this.currentRound
    if (!round) {
      console.warn('[SimplePlayer] No rounds loaded, cannot play')
      return
    }
    if (!round.cycles || round.cycles.length === 0) {
      console.warn(`[SimplePlayer] Round ${round.roundNumber} has no cycles, skipping`)
      this.advanceRound()
      return
    }
    console.debug(`[SimplePlayer] Starting Round ${round.roundNumber} (${round.legoId}): ${round.cycles.length} cycles`)
    this.updateState({ isPlaying: true })
    this.startPhase('prompt')
  }

  pause(): void {
    if (!this.state.isPlaying) return
    this.audio.pause()
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.updateState({ isPlaying: false })
  }

  resume(): void {
    if (this.state.isPlaying) return
    this.updateState({ isPlaying: true })

    if (this.state.phase === 'pause') {
      this.startPausePhase()
    } else if (this.state.phase !== 'idle') {
      // Re-start current phase to ensure correct audio src
      this.startPhase(this.state.phase)
    }
  }

  stop(): void {
    this.audio.pause()
    this.audio.src = ''
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.updateState({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false })
  }

  // NOTE: No skipCycle() - a ROUND is the atomic learning unit
  // Users can skip entire rounds, but not individual cycles within a round

  skipRound(): void {
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.audio.pause()
    this.advanceRound()
  }

  jumpToRound(index: number): void {
    console.debug(`[SimplePlayer] jumpToRound(${index}) - rounds.length=${this.rounds.length}, isPlaying=${this.state.isPlaying}`)
    if (index < 0 || index >= this.rounds.length) {
      console.warn(`[SimplePlayer] jumpToRound(${index}) OUT OF BOUNDS - only ${this.rounds.length} rounds loaded`)
      return
    }
    this.clearPauseTimer()
    this.clearSafetyTimer()
    this.clearLingerTimer()
    this.audio.pause()
    this.audio.src = ''
    const wasPlaying = this.state.isPlaying
    // Must set isPlaying: false so play() doesn't early-return
    this.updateState({ roundIndex: index, cycleIndex: 0, phase: 'idle', isPlaying: false })
    console.debug(`[SimplePlayer] jumpToRound: wasPlaying=${wasPlaying}, calling play()`)
    if (wasPlaying) this.play()
  }

  // Private methods
  private startPhase(phase: Phase): void {
    this.updateState({ phase })

    // Log what's playing
    const cycle = this.currentCycle
    const round = this.currentRound
    if (phase === 'prompt' && cycle) {
      console.log(`  [${this.state.cycleIndex + 1}/${round?.cycles.length}] "${cycle.known.text}" → "${cycle.target.text}"`)
    }

    this.emit('phase_changed', { phase, cycle: this.currentCycle, round: this.currentRound })

    // Safety check: ensure we have the required data before playing
    const currentCycle = this.currentCycle

    switch (phase) {
      case 'prompt':
        if (currentCycle?.known?.audioUrl) {
          this.playAudio(currentCycle.known.audioUrl)
        } else {
          console.warn(`[SimplePlayer] No prompt audio for "${currentCycle?.known?.text}" → "${currentCycle?.target?.text}", skipping`)
          this.onAudioEnded()
        }
        break
      case 'pause':
        this.startPausePhase()
        break
      case 'voice1':
        if (currentCycle?.target?.voice1Url) {
          this.playAudio(currentCycle.target.voice1Url)
        } else {
          console.warn(`[SimplePlayer] No voice1 audio for "${currentCycle?.known?.text}" → "${currentCycle?.target?.text}", skipping`)
          this.onAudioEnded()
        }
        break
      case 'voice2':
        if (currentCycle?.target?.voice2Url) {
          this.playAudio(currentCycle.target.voice2Url)
        } else {
          console.warn(`[SimplePlayer] No voice2 audio for "${currentCycle?.known?.text}" → "${currentCycle?.target?.text}", skipping`)
          this.onAudioEnded()
        }
        break
    }
  }

  private playAudio(url: string): void {
    this.clearSafetyTimer()
    this.audio.src = url
    this.audio.play().catch((err) => {
      console.warn('[SimplePlayer] play() rejected:', err.message)
      this.onAudioEnded()
    })
    this.safetyTimer = setTimeout(() => {
      console.warn('[SimplePlayer] Safety timeout — audio ended event never fired, advancing')
      this.onAudioEnded()
    }, 10_000)
  }

  private startPausePhase(): void {
    const duration = this.currentCycle?.pauseDuration ?? DEFAULT_PAUSE_DURATION
    this.pauseTimer = setTimeout(() => {
      if (this.state.isPlaying) this.onAudioEnded()
    }, duration)
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer)
      this.pauseTimer = null
    }
  }

  private clearSafetyTimer(): void {
    if (this.safetyTimer) {
      clearTimeout(this.safetyTimer)
      this.safetyTimer = null
    }
  }

  private clearLingerTimer(): void {
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer)
      this.lingerTimer = null
    }
  }

  private onAudioEnded(): void {
    this.clearSafetyTimer()
    if (!this.state.isPlaying) return

    const nextPhase = this.getNextPhase()
    if (nextPhase) {
      this.startPhase(nextPhase)
    } else {
      // End of cycle — linger if requested (intro/debut tiles stay visible)
      const linger = this.currentCycle?.lingerMs
      if (linger && linger > 0) {
        this.lingerTimer = setTimeout(() => {
          this.lingerTimer = null
          if (this.state.isPlaying) this.advanceCycle()
        }, linger)
      } else {
        this.advanceCycle()
      }
    }
  }

  private getNextPhase(): Phase | null {
    // Simple transitions: prompt → pause → voice1 → voice2 → (next cycle)
    // Skip pause entirely for intro cycles (pauseDuration === 0) to avoid event-loop gap
    if (this.state.phase === 'prompt' && this.currentCycle?.pauseDuration === 0) {
      return 'voice1'
    }
    const transitions: Record<Phase, Phase | null> = {
      idle: null,
      prompt: 'pause',
      pause: 'voice1',
      voice1: 'voice2',
      voice2: null,  // End of cycle, advance to next
    }
    return transitions[this.state.phase]
  }

  private advanceCycle(): void {
    this.emit('cycle_completed', { cycle: this.currentCycle, round: this.currentRound })

    const round = this.currentRound
    if (!round || !round.cycles) {
      console.warn('[SimplePlayer] No round or cycles in advanceCycle, advancing to next round')
      this.advanceRound()
      return
    }
    if (this.state.cycleIndex < round.cycles.length - 1) {
      this.updateState({ cycleIndex: this.state.cycleIndex + 1 })
      this.startPhase('prompt')
    } else {
      this.advanceRound()
    }
  }

  private advanceRound(): void {
    this.emit('round_completed', { round: this.currentRound })

    if (this.state.roundIndex < this.rounds.length - 1) {
      this.updateState({ roundIndex: this.state.roundIndex + 1, cycleIndex: 0 })
      const round = this.currentRound
      if (round) {
        console.debug(`[SimplePlayer] Starting Round ${round.roundNumber} (${round.legoId}): ${round.cycles.length} cycles`)
      }
      this.startPhase('prompt')
    } else {
      console.log('[SimplePlayer] Session complete')
      this.updateState({ phase: 'idle', isPlaying: false })
      this.emit('session_complete')
    }
  }

  private updateState(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial }
    this.emit('state_changed', this.currentState)
  }

  dispose(): void {
    this.stop()
    this.audio.removeEventListener('ended', this.onEndedHandler)
    this.audio.removeEventListener('error', this.onErrorHandler)
    this.listeners.clear()
  }
}
