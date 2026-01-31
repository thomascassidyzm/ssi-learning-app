// SimplePlayer.ts - Clean playback engine (~180 lines)

export interface Cycle {
  id: string
  known: { text: string; audioUrl: string }
  target: { text: string; voice1Url: string; voice2Url: string }
  pauseDuration?: number // ms, default 4000
}

export interface Round {
  roundNumber: number
  legoId: string
  seedId: string
  introAudioUrl?: string  // "The Spanish for X is..." - voice1/voice2 come from cycles[0]
  cycles: Cycle[]
}

// Phases: intro plays presentation then voice1/voice2, regular cycles play prompt → pause → voice1 → voice2
export type Phase = 'idle' | 'intro' | 'prompt' | 'pause' | 'voice1' | 'voice2'

export interface PlaybackState {
  roundIndex: number
  cycleIndex: number
  phase: Phase
  isPlaying: boolean
  inIntroSequence: boolean  // True when playing intro's voice1/voice2 (before prompt)
}

type EventName = 'state_changed' | 'phase_changed' | 'cycle_completed' | 'round_completed' | 'session_complete'
type EventCallback = (data?: unknown) => void

const DEFAULT_PAUSE_DURATION = 4000

export class SimplePlayer {
  private rounds: Round[]
  private audio: HTMLAudioElement
  private state: PlaybackState
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Map<EventName, Set<EventCallback>> = new Map()

  constructor(rounds: Round[]) {
    this.rounds = rounds
    this.audio = new Audio()
    this.state = { roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false, inIntroSequence: false }

    this.audio.addEventListener('ended', () => this.onAudioEnded())
    this.audio.addEventListener('error', (e) => {
      console.error('Audio error:', e)
      this.onAudioEnded() // Continue despite errors
    })
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

    // Insert each round at the correct position based on roundNumber
    for (const round of newRounds) {
      // Find insertion point (maintain ascending roundNumber order)
      const insertIndex = this.rounds.findIndex(r => r.roundNumber > round.roundNumber)
      if (insertIndex === -1) {
        // Append to end
        this.rounds.push(round)
      } else {
        // Check if round already exists at this position
        if (this.rounds[insertIndex - 1]?.roundNumber === round.roundNumber) {
          continue // Skip duplicate
        }
        this.rounds.splice(insertIndex, 0, round)
      }
    }

    console.log(`[SimplePlayer] Added ${newRounds.length} rounds, total now: ${this.rounds.length}`)
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
    console.log(`[SimplePlayer] Starting Round ${round.roundNumber} (${round.legoId}): ${round.cycles.length} cycles`)
    this.updateState({ isPlaying: true })
    this.startPhase(this.shouldPlayIntro() ? 'intro' : 'prompt')
  }

  pause(): void {
    if (!this.state.isPlaying) return
    this.audio.pause()
    this.clearPauseTimer()
    this.updateState({ isPlaying: false })
  }

  resume(): void {
    if (this.state.isPlaying) return
    this.updateState({ isPlaying: true })

    if (this.state.phase === 'pause') {
      this.startPausePhase()
    } else if (this.state.phase !== 'idle') {
      this.audio.play().catch(console.error)
    }
  }

  stop(): void {
    this.audio.pause()
    this.audio.src = ''
    this.clearPauseTimer()
    this.updateState({ roundIndex: 0, cycleIndex: 0, phase: 'idle', isPlaying: false, inIntroSequence: false })
  }

  skipCycle(): void {
    this.clearPauseTimer()
    this.audio.pause()
    this.advanceCycle()
  }

  skipRound(): void {
    this.clearPauseTimer()
    this.audio.pause()
    this.advanceRound()
  }

  jumpToRound(index: number): void {
    console.log(`[SimplePlayer] jumpToRound(${index}) - rounds.length=${this.rounds.length}, isPlaying=${this.state.isPlaying}`)
    if (index < 0 || index >= this.rounds.length) {
      console.warn(`[SimplePlayer] jumpToRound(${index}) OUT OF BOUNDS - only ${this.rounds.length} rounds loaded`)
      return
    }
    this.clearPauseTimer()
    this.audio.pause()
    const wasPlaying = this.state.isPlaying
    // Must set isPlaying: false so play() doesn't early-return
    this.updateState({ roundIndex: index, cycleIndex: 0, phase: 'idle', isPlaying: false, inIntroSequence: false })
    console.log(`[SimplePlayer] jumpToRound: wasPlaying=${wasPlaying}, calling play()`)
    if (wasPlaying) this.play()
  }

  // Private methods
  private shouldPlayIntro(): boolean {
    // Play intro only at start of round, if presentation audio exists
    // voice1/voice2 for intro come from cycles[0] (the LEGO debut)
    return this.state.cycleIndex === 0 && !!this.currentRound?.introAudioUrl
  }

  private startPhase(phase: Phase): void {
    // Track intro sequence state
    if (phase === 'intro') {
      this.updateState({ phase, inIntroSequence: true })
    } else if (phase === 'prompt') {
      // Exiting intro sequence when we hit prompt
      this.updateState({ phase, inIntroSequence: false })
    } else {
      this.updateState({ phase })
    }

    // Log what's playing
    const cycle = this.currentCycle
    const round = this.currentRound
    if (phase === 'intro' && round) {
      console.log(`%c[Round ${round.roundNumber}] ${round.legoId} - ${round.cycles.length} cycles`, 'color: #4CAF50; font-weight: bold')
    }
    if (phase === 'prompt' && cycle) {
      console.log(`  [${this.state.cycleIndex + 1}/${round?.cycles.length}] "${cycle.known.text}" → "${cycle.target.text}"`)
    }

    this.emit('phase_changed', { phase, cycle: this.currentCycle, round: this.currentRound })

    // Safety check: ensure we have the required data before playing
    const currentRound = this.currentRound
    const currentCycle = this.currentCycle

    switch (phase) {
      case 'intro':
        // Presentation audio: "The Spanish for X is..."
        if (currentRound?.introAudioUrl) {
          this.playAudio(currentRound.introAudioUrl)
        } else {
          console.warn('[SimplePlayer] No intro audio URL, skipping to next phase')
          this.onAudioEnded()
        }
        break
      case 'prompt':
        if (currentCycle?.known?.audioUrl) {
          this.playAudio(currentCycle.known.audioUrl)
        } else {
          console.warn('[SimplePlayer] No prompt audio URL, skipping to next phase')
          this.onAudioEnded()
        }
        break
      case 'pause':
        this.startPausePhase()
        break
      case 'voice1':
        // Always use cycle's voice URLs (same audio for intro and debut)
        if (currentCycle?.target?.voice1Url) {
          this.playAudio(currentCycle.target.voice1Url)
        } else {
          console.warn('[SimplePlayer] No voice1 audio URL, skipping to next phase')
          this.onAudioEnded()
        }
        break
      case 'voice2':
        // Always use cycle's voice URLs (same audio for intro and debut)
        if (currentCycle?.target?.voice2Url) {
          this.playAudio(currentCycle.target.voice2Url)
        } else {
          console.warn('[SimplePlayer] No voice2 audio URL, skipping to next phase')
          this.onAudioEnded()
        }
        break
    }
  }

  private playAudio(url: string): void {
    this.audio.src = url
    this.audio.play().catch(console.error)
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

  private onAudioEnded(): void {
    if (!this.state.isPlaying) return

    const nextPhase = this.getNextPhase()
    if (nextPhase) {
      this.startPhase(nextPhase)
    } else {
      this.advanceCycle()
    }
  }

  private getNextPhase(): Phase | null {
    // Intro sequence: intro → voice1 → voice2 → prompt (then regular cycle continues)
    // Regular cycle: prompt → pause → voice1 → voice2 → (next cycle)
    if (this.state.phase === 'intro') {
      return 'voice1'
    }
    if (this.state.phase === 'voice2' && this.state.inIntroSequence) {
      // After intro's voice2, go to prompt for the debut practice
      return 'prompt'
    }

    const transitions: Record<Phase, Phase | null> = {
      idle: null,
      intro: 'voice1',  // Handled above but included for completeness
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
      this.updateState({ roundIndex: this.state.roundIndex + 1, cycleIndex: 0, inIntroSequence: false })
      const round = this.currentRound
      if (round) {
        console.log(`[SimplePlayer] Starting Round ${round.roundNumber} (${round.legoId}): ${round.cycles.length} cycles`)
      }
      this.startPhase(this.shouldPlayIntro() ? 'intro' : 'prompt')
    } else {
      console.log('[SimplePlayer] Session complete')
      this.updateState({ phase: 'idle', isPlaying: false, inIntroSequence: false })
      this.emit('session_complete')
    }
  }

  private updateState(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial }
    this.emit('state_changed', this.currentState)
  }
}
