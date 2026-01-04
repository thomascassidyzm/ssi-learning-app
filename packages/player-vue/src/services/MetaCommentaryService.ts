/**
 * MetaCommentaryService - Manages welcome, instructions, and encouragements
 *
 * Timing Logic (v13.1):
 * - Welcome: Once at course start, can be skipped
 * - Instructions: Played in sequence, between rounds, every 5-10 mins
 * - Encouragements: Random pool after instructions complete, between rounds
 *
 * Key Principles:
 * - NEVER interrupt a round - atomic unit of learning
 * - Instructions are meta-cognitive, in fixed sequence for all courses
 * - Encouragements are motivational, randomly selected
 * - Adaptation: if learner doing well, less frequent commentary
 *
 * Timing Math (CYCLE-based, not round-based):
 * - A CYCLE is consistent: ~11 seconds (prompt + pause + voice1 + voice2)
 * - A ROUND varies wildly (3-15+ cycles depending on LEGO type)
 * - 5 minutes = ~27 cycles, 10 minutes = ~55 cycles
 * - Base interval: 27-55 cycles between commentary (randomized)
 * - Commentary only plays at ROUND boundaries (between rounds, not mid-round)
 */

import type { AudioRef } from '@ssi/core'
import type { CourseDataProvider } from '../providers/CourseDataProvider'

export interface MetaCommentaryAudio extends AudioRef {
  text: string
  type: 'welcome' | 'instruction' | 'encouragement'
  position?: number // For instructions: position in sequence
}

/**
 * Global state - shared across ALL courses for this user
 * Instructions are meta-cognitive about learning, not course-specific
 */
export interface GlobalCommentaryState {
  instructionsComplete: boolean // Once true, never play instructions again
  instructionIndex: number // How far through instructions (if not complete)
  encouragementUrn: string[] // IDs not yet played this cycle (URN = pick without replacement)
  encouragementUrnCycle: number // How many times we've emptied the urn
}

/**
 * Session state - tracks timing within current session
 */
export interface SessionCommentaryState {
  lastCommentaryCycle: number // Cycle count when last commentary played
  totalCyclesCompleted: number // Cycles this session
  totalRoundsCompleted: number // Rounds this session
  sessionStartTime: number
}

export interface PerformanceMetrics {
  averageResponseTime: number // ms - how fast learner responds
  correctStreak: number // consecutive correct responses
  strugglingItems: number // items with repeated errors
}

// Storage key prefixes
const GLOBAL_STORAGE_KEY = 'ssi_commentary_global_' // Per-user, across all courses
const SESSION_STORAGE_KEY = 'ssi_commentary_session_' // Per-session timing

// Timing constants (CYCLE-based, not round-based)
// A cycle is ~11 seconds (consistent), a round varies wildly
const MIN_CYCLES_BETWEEN_COMMENTARY = 27 // ~5 minutes (27 * 11s = 297s)
const MAX_CYCLES_BETWEEN_COMMENTARY = 55 // ~10 minutes (55 * 11s = 605s)
const PERFORMANCE_MULTIPLIER_GOOD = 1.5 // If doing well, 50% longer intervals

export class MetaCommentaryService {
  private provider: CourseDataProvider
  private courseId: string
  private learnerId: string
  private globalState: GlobalCommentaryState
  private sessionState: SessionCommentaryState
  private instructions: Array<AudioRef & { text: string; position: number }> = []
  private encouragements: Array<AudioRef & { text: string }> = []
  private welcomeAudio: AudioRef | null = null
  private nextCommentaryCycle: number = 0 // Cycle count threshold for next commentary
  private initialized = false

  constructor(provider: CourseDataProvider, learnerId: string) {
    this.provider = provider
    this.courseId = provider.getCourseId()
    this.learnerId = learnerId
    this.globalState = this.getDefaultGlobalState()
    this.sessionState = this.getDefaultSessionState()
  }

  private getDefaultGlobalState(): GlobalCommentaryState {
    return {
      instructionsComplete: false,
      instructionIndex: 0,
      encouragementUrn: [], // Will be populated with all encouragement IDs
      encouragementUrnCycle: 0,
    }
  }

  private getDefaultSessionState(): SessionCommentaryState {
    return {
      lastCommentaryCycle: 0,
      totalCyclesCompleted: 0,
      totalRoundsCompleted: 0,
      sessionStartTime: Date.now(),
    }
  }

  /**
   * Initialize the service - load state and prefetch audio lists
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Load saved state (global is per-user, session is fresh each time)
    this.loadGlobalState()

    // Prefetch all meta-commentary audio
    const [instructions, encouragements, welcome] = await Promise.all([
      this.provider.getInstructions(),
      this.provider.getEncouragements(),
      this.provider.getWelcomeAudio(),
    ])

    this.instructions = instructions
    this.encouragements = encouragements
    this.welcomeAudio = welcome

    // Initialize encouragement URN if empty (first time or new encouragements added)
    if (this.globalState.encouragementUrn.length === 0 && encouragements.length > 0) {
      this.refillEncouragementUrn()
    }

    // Calculate when next commentary should play (based on cycles)
    this.calculateNextCommentaryCycle()

    this.initialized = true

    console.log('[MetaCommentaryService] Initialized:', {
      instructions: instructions.length,
      encouragements: encouragements.length,
      hasWelcome: !!welcome,
      globalState: this.globalState,
      nextCommentaryCycle: this.nextCommentaryCycle,
    })
  }

  /**
   * Refill the encouragement URN with all available encouragement IDs
   * Called when URN is empty (start of new cycle)
   */
  private refillEncouragementUrn(): void {
    this.globalState.encouragementUrn = this.encouragements.map(e => e.id)
    // Shuffle the urn for random order
    this.shuffleArray(this.globalState.encouragementUrn)
    this.globalState.encouragementUrnCycle++
    console.log('[MetaCommentaryService] Refilled encouragement URN, cycle:', this.globalState.encouragementUrnCycle)
  }

  /**
   * Fisher-Yates shuffle
   */
  private shuffleArray(array: string[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[array[i], array[j]] = [array[j], array[i]]
    }
  }

  /**
   * Check if welcome audio is available
   * Note: Whether welcome has been played is tracked per-course by CourseDataProvider
   * This just checks if welcome audio exists
   */
  shouldPlayWelcome(): boolean {
    return this.welcomeAudio !== null
  }

  /**
   * Get welcome audio if available
   */
  getWelcomeAudio(): MetaCommentaryAudio | null {
    if (!this.welcomeAudio) return null

    return {
      ...this.welcomeAudio,
      text: 'Welcome to the course',
      type: 'welcome',
    }
  }

  /**
   * Mark welcome as played (or skipped)
   * Note: Welcome is typically per-course and tracked by CourseDataProvider
   * This method is here for completeness but may not be needed
   */
  markWelcomePlayed(): void {
    // Welcome state is per-course, handled by CourseDataProvider
    // No need to track in global user state
  }

  /**
   * Called after each cycle completes (for tracking)
   * Call this on every cycle to accumulate the count
   */
  onCycleComplete(): void {
    this.sessionState.totalCyclesCompleted++
    // Don't save on every cycle - too frequent. Save on round complete.
  }

  /**
   * Called after each round completes
   * Returns commentary audio if it's time to play one, null otherwise
   *
   * Commentary only plays at round boundaries (never mid-round),
   * but timing is based on cycle count (consistent ~11s units)
   *
   * @param roundNumber - The round that just completed
   * @param cyclesInRound - How many cycles were in this round
   * @param performance - Optional performance metrics for adaptation
   */
  onRoundComplete(
    roundNumber: number,
    cyclesInRound: number = 0,
    performance?: PerformanceMetrics
  ): MetaCommentaryAudio | null {
    // Update cycle count if provided (alternative to calling onCycleComplete for each)
    if (cyclesInRound > 0) {
      this.sessionState.totalCyclesCompleted += cyclesInRound
    }
    this.sessionState.totalRoundsCompleted = roundNumber

    // Check if it's time for commentary (based on CYCLES, not rounds)
    if (this.sessionState.totalCyclesCompleted < this.nextCommentaryCycle) {
      return null
    }

    // Get the next commentary (instruction or encouragement)
    const commentary = this.getNextCommentary()

    if (commentary) {
      // Update session timing state
      this.sessionState.lastCommentaryCycle = this.sessionState.totalCyclesCompleted

      // Update global state based on what was played
      if (commentary.type === 'instruction') {
        this.globalState.instructionIndex++
        // Check if all instructions are now complete
        if (this.globalState.instructionIndex >= this.instructions.length) {
          this.globalState.instructionsComplete = true
          console.log('[MetaCommentaryService] 🎓 All instructions complete! Switching to encouragements.')
        }
      }
      // Note: encouragement URN is already updated in getNextCommentary()

      // Save global state (persists across sessions/courses)
      this.saveGlobalState()

      // Calculate next commentary time, adjusted for performance
      this.calculateNextCommentaryCycle(performance)
    }

    return commentary
  }

  /**
   * Get the next commentary audio
   * - If instructions not complete: next instruction in sequence
   * - If instructions complete: URN-based random encouragement (no repeats until all played)
   *
   * Global state tracks this ACROSS ALL COURSES for the user
   */
  private getNextCommentary(): MetaCommentaryAudio | null {
    // Instructions not yet complete? Play next instruction in sequence
    if (!this.globalState.instructionsComplete && this.globalState.instructionIndex < this.instructions.length) {
      const instruction = this.instructions[this.globalState.instructionIndex]
      return {
        ...instruction,
        type: 'instruction',
      }
    }

    // Instructions complete - use URN-based encouragement selection
    if (this.encouragements.length === 0) {
      return null
    }

    // If URN is empty, refill it (start new cycle)
    if (this.globalState.encouragementUrn.length === 0) {
      this.refillEncouragementUrn()
    }

    // Pop from the URN (draw without replacement)
    const encouragementId = this.globalState.encouragementUrn.pop()!

    // Find the encouragement by ID
    const encouragement = this.encouragements.find(e => e.id === encouragementId)
    if (!encouragement) {
      console.warn('[MetaCommentaryService] Encouragement not found:', encouragementId)
      return null
    }

    console.log('[MetaCommentaryService] Playing encouragement from URN, remaining:', this.globalState.encouragementUrn.length)

    return {
      ...encouragement,
      type: 'encouragement',
    }
  }

  /**
   * Calculate when the next commentary should play (based on CYCLES)
   * Adapts based on performance - if doing well, less frequent
   */
  private calculateNextCommentaryCycle(performance?: PerformanceMetrics): void {
    // Base interval: random between MIN and MAX cycles (~5-10 minutes)
    let interval =
      MIN_CYCLES_BETWEEN_COMMENTARY +
      Math.floor(Math.random() * (MAX_CYCLES_BETWEEN_COMMENTARY - MIN_CYCLES_BETWEEN_COMMENTARY))

    // Adaptation: if doing well, increase interval
    if (performance) {
      const isDoingWell = this.assessPerformance(performance)
      if (isDoingWell) {
        interval = Math.floor(interval * PERFORMANCE_MULTIPLIER_GOOD)
        console.log('[MetaCommentaryService] Good performance - increasing interval to', interval, 'cycles')
      }
    }

    this.nextCommentaryCycle = this.sessionState.totalCyclesCompleted + interval

    console.log('[MetaCommentaryService] Next commentary at cycle', this.nextCommentaryCycle,
      `(~${Math.round(interval * 11 / 60)} mins from now)`)
  }

  /**
   * Assess if learner is doing well based on performance metrics
   * Returns true if commentary frequency should be reduced
   */
  private assessPerformance(metrics: PerformanceMetrics): boolean {
    // "Doing well" criteria:
    // - Response time under 2 seconds average (prompt → response)
    // - Correct streak of 10+ items
    // - No struggling items in current session
    const fastResponses = metrics.averageResponseTime < 2000
    const onAStreak = metrics.correctStreak >= 10
    const notStruggling = metrics.strugglingItems === 0

    // Need at least 2 of 3 indicators to be "doing well"
    const score = (fastResponses ? 1 : 0) + (onAStreak ? 1 : 0) + (notStruggling ? 1 : 0)
    return score >= 2
  }

  /**
   * Get current state (for debugging/display)
   */
  getState(): { global: Readonly<GlobalCommentaryState>; session: Readonly<SessionCommentaryState> } {
    return {
      global: { ...this.globalState },
      session: { ...this.sessionState },
    }
  }

  /**
   * Get progress through instructions (global, across all courses)
   */
  getInstructionProgress(): { current: number; total: number; complete: boolean } {
    return {
      current: this.globalState.instructionIndex,
      total: this.instructions.length,
      complete: this.globalState.instructionsComplete,
    }
  }

  /**
   * Force play next commentary (for testing/debugging)
   */
  forceNextCommentary(): MetaCommentaryAudio | null {
    this.nextCommentaryCycle = 0
    return this.onRoundComplete(this.sessionState.totalRoundsCompleted, 0)
  }

  /**
   * Reset session state (for new session)
   */
  resetSession(): void {
    this.sessionState = this.getDefaultSessionState()
    this.calculateNextCommentaryCycle()
  }

  /**
   * Reset ALL state including global (for testing or true fresh start)
   * WARNING: This resets instruction progress across all courses!
   */
  resetAll(): void {
    this.globalState = this.getDefaultGlobalState()
    this.sessionState = this.getDefaultSessionState()
    this.refillEncouragementUrn()
    this.calculateNextCommentaryCycle()
    this.saveGlobalState()
  }

  // --- Persistence ---

  /**
   * Global state key - per USER, not per course
   * This means instruction progress carries across all courses
   */
  private getGlobalStorageKey(): string {
    return `${GLOBAL_STORAGE_KEY}${this.learnerId}`
  }

  private loadGlobalState(): void {
    try {
      const key = this.getGlobalStorageKey()
      const saved = localStorage.getItem(key)
      if (saved) {
        const parsed = JSON.parse(saved)
        this.globalState = { ...this.getDefaultGlobalState(), ...parsed }
        console.log('[MetaCommentaryService] Loaded global state:', this.globalState)
      }
    } catch (err) {
      console.warn('[MetaCommentaryService] Failed to load global state:', err)
    }
  }

  private saveGlobalState(): void {
    try {
      const key = this.getGlobalStorageKey()
      localStorage.setItem(key, JSON.stringify(this.globalState))
    } catch (err) {
      console.warn('[MetaCommentaryService] Failed to save global state:', err)
    }
  }
}

/**
 * Factory function
 */
export function createMetaCommentaryService(
  provider: CourseDataProvider,
  learnerId: string
): MetaCommentaryService {
  return new MetaCommentaryService(provider, learnerId)
}
