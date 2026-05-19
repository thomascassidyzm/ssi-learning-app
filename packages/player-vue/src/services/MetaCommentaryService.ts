/**
 * MetaCommentaryService - Manages welcome, instructions, and encouragements
 *
 * Round-based cadence (2026-05-19):
 *   • Welcome  — once at course start (handled separately by the player)
 *   • Instructions — ordered, played one per commentary slot, never repeat once
 *                    advanced. PER-LEARNER (not per-course), so a learner who
 *                    finishes the instruction sequence on Spanish doesn't hear
 *                    them again starting French.
 *   • Encouragements — random pull from the pool, repeats fine. Kick in after
 *                    instructions are complete.
 *
 * Gating: every Nth round (default N=2 → every other round). Simple,
 * predictable, and easy to tune. Replaces the previous cycle-counting
 * approach (27–55 cycles + a "doing well" multiplier whose performance
 * inputs were hardcoded, making commentary fire roughly never).
 *
 * Skip semantics: when commentary IS returned for a round, the instruction
 * index advances and global state saves immediately. If the learner stops
 * during playback, the instruction is still considered consumed — matches
 * Tom's intent that "you CAN skip them and they don't come back".
 */

import type { AudioRef } from '@ssi/core'
import type { CourseDataProvider } from '../providers/CourseDataProvider'

export interface MetaCommentaryAudio extends AudioRef {
  text: string
  type: 'welcome' | 'instruction' | 'encouragement'
  position?: number // For instructions: position in sequence
}

/** Per-learner state, persists across courses (instruction progress is global). */
export interface GlobalCommentaryState {
  instructionsComplete: boolean // Once true, never play instructions again
  instructionIndex: number      // How far through instructions (if not complete)
}

// Storage key — per-user, across all courses.
// Old keys may still contain unused fields (encouragementUrn, etc.) from
// the previous URN-based design; we ignore them via spread default below.
const GLOBAL_STORAGE_KEY = 'ssi_commentary_global_'

/**
 * Cadence — early rounds are short (individual-LEGO intros, ~3 cycles
 * each), so a fixed "every other round" would fire too often at the
 * start. The early-rounds list spaces commentary out by cycle count
 * (~20 cycles ≈ 5-10 mins) while round count is still ramping up:
 *
 *   Round 5   – first full SEED has just played out
 *   Round 10  – ~20 more cycles of practice
 *   Round 14  – another ~20 cycles
 *   Round 18  – another ~20 cycles
 *   Round 20, 22, 24, …  – steady state, every 2 rounds (rounds are
 *                          longer now, so each pair ≈ 20 cycles)
 *
 * Tunable at the top so the cadence can be re-balanced without code
 * spelunking. Keep `EARLY` in ascending order.
 */
const EARLY_COMMENTARY_ROUNDS = [5, 10, 14, 18] as const
const STEADY_STATE_FROM_ROUND = 20
const STEADY_STATE_INTERVAL = 2

function shouldFireAtRound(round: number): boolean {
  if (round <= 0) return false
  if ((EARLY_COMMENTARY_ROUNDS as readonly number[]).includes(round)) return true
  if (round < STEADY_STATE_FROM_ROUND) return false
  return (round - STEADY_STATE_FROM_ROUND) % STEADY_STATE_INTERVAL === 0
}

export class MetaCommentaryService {
  private provider: CourseDataProvider
  private courseId: string
  private learnerId: string
  private globalState: GlobalCommentaryState
  private instructions: Array<AudioRef & { text: string; position: number }> = []
  private encouragements: Array<AudioRef & { text: string }> = []
  private welcomeAudio: AudioRef | null = null
  private initialized = false

  constructor(provider: CourseDataProvider, learnerId: string) {
    this.provider = provider
    this.courseId = provider.getCourseId()
    this.learnerId = learnerId
    this.globalState = this.getDefaultGlobalState()
  }

  private getDefaultGlobalState(): GlobalCommentaryState {
    return {
      instructionsComplete: false,
      instructionIndex: 0,
    }
  }

  /**
   * Initialize the service - load state and prefetch audio lists
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Load saved state (per-user, persists across courses).
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

    this.initialized = true

    console.debug(`[MetaCommentary] ${instructions.length} instructions, ${encouragements.length} encouragements${welcome ? ', welcome' : ''}, learner at index ${this.globalState.instructionIndex}/${instructions.length}`)
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
   * Called after each round completes. Returns commentary if the round-count
   * cadence says it's time, otherwise null. No cycle accounting, no
   * performance heuristics — just the simple rule.
   */
  onRoundComplete(roundNumber: number): MetaCommentaryAudio | null {
    if (!shouldFireAtRound(roundNumber)) return null

    const commentary = this.getNextCommentary()
    if (!commentary) return null

    if (commentary.type === 'instruction') {
      this.globalState.instructionIndex++
      if (this.globalState.instructionIndex >= this.instructions.length) {
        this.globalState.instructionsComplete = true
        console.debug('[MetaCommentary] Instructions complete, switching to encouragements')
      }
      this.saveGlobalState()
    }

    return commentary
  }

  /**
   * Pick the next commentary to play.
   *  - Instructions phase (per-learner global): next item in the fixed
   *    sequence. Always advances on play; skipping doesn't re-queue.
   *  - Encouragements phase: random pick with replacement. The pool is
   *    small enough that repetition feels fine and the URN bookkeeping
   *    the previous design used was pure ceremony.
   */
  private getNextCommentary(): MetaCommentaryAudio | null {
    if (!this.globalState.instructionsComplete && this.globalState.instructionIndex < this.instructions.length) {
      const instruction = this.instructions[this.globalState.instructionIndex]
      return { ...instruction, type: 'instruction' }
    }

    if (this.encouragements.length === 0) return null
    const idx = Math.floor(Math.random() * this.encouragements.length)
    const encouragement = this.encouragements[idx]
    return { ...encouragement, type: 'encouragement' }
  }

  /** Caller compatibility — invoked by the player after playback finishes. */
  finishCommentaryPlayback(): void {
    // State already advanced in onRoundComplete (intentional, so skipping
    // mid-playback doesn't replay the same instruction next round). Nothing
    // else to do here.
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

  /** Debug hook — force the next commentary regardless of cadence. */
  forceNextCommentary(): MetaCommentaryAudio | null {
    const commentary = this.getNextCommentary()
    if (commentary?.type === 'instruction') {
      this.globalState.instructionIndex++
      if (this.globalState.instructionIndex >= this.instructions.length) {
        this.globalState.instructionsComplete = true
      }
      this.saveGlobalState()
    }
    return commentary
  }

  /**
   * Reset ALL state including global (for testing or true fresh start)
   * WARNING: This resets instruction progress across all courses!
   */
  resetAll(): void {
    this.globalState = this.getDefaultGlobalState()
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
        // Spread default first so any old/extra fields (encouragementUrn,
        // encouragementUrnCycle from the previous design) are dropped on
        // first save.
        this.globalState = { ...this.getDefaultGlobalState(), ...parsed }
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
