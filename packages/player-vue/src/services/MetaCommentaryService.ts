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
 * Gating (2026-05-26): a variable-interval reward — "uncertain dopamine".
 * Fires roughly every ~10 minutes of ACTIVE learning, with ±30% jitter so the
 * learner can't predict it, and only ever BETWEEN TWO SPEAKING ROUNDS (the
 * caller passes `canFire` for that — see handleRoundBoundary). Consistency
 * isn't the goal; surprise is, so people keep finding them interesting.
 *
 * "Active learning time" is measured in CYCLES PLAYED (~11s each), not
 * wall-clock — a learner who pauses for 20 min shouldn't get an encouragement
 * the instant they resume. The previous fixed round-cadence had no jitter; the
 * one before THAT was cycle-counting crippled by a hardcoded "doing well"
 * performance multiplier (fired roughly never). This is the plain interval
 * with none of that baggage.
 *
 * Skip semantics: when commentary IS returned for a round, the instruction
 * index advances and global state saves immediately. If the learner stops
 * during playback, the instruction is still considered consumed — matches
 * Tom's intent that "you CAN skip them and they don't come back".
 */

import type { AudioRef } from '@ssi/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CourseDataProvider } from '../providers/CourseDataProvider'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
 * Cadence config — tune here without code spelunking.
 *   ~11s per cycle ⇒ ~5.5 cycles/min (validated, see CLAUDE.md timing).
 *   Base interval ~10 min of active play ≈ 55 cycles, jittered ±30%
 *   ⇒ each gap lands somewhere in ~7–13 min. The jitter is deliberate:
 *   an unpredictable reward keeps the encouragements feeling fresh.
 */
const CYCLES_PER_MINUTE = 5.5
const BASE_INTERVAL_MINUTES = 10
const BASE_INTERVAL_CYCLES = Math.round(BASE_INTERVAL_MINUTES * CYCLES_PER_MINUTE)
const INTERVAL_JITTER = 0.3

export class MetaCommentaryService {
  private provider: CourseDataProvider
  private courseId: string
  private learnerId: string
  private globalState: GlobalCommentaryState
  private instructions: Array<AudioRef & { text: string; position: number }> = []
  private encouragements: Array<AudioRef & { text: string }> = []
  private welcomeAudio: AudioRef | null = null
  private initialized = false
  /** Supabase client for cross-device persistence of instruction progress.
   *  Null for guests / when not provided ⇒ localStorage-only (per-device). */
  private supabase: SupabaseClient | null

  // Variable-interval reward state (session-scoped — a fresh session starts
  // the clock over, which is fine: encouragements aren't progress).
  private cyclesSinceLastFire = 0
  private nextFireAtCycles = 0 // 0 → rolled lazily on first round

  // Encouragement rotation (session-scoped): a shuffled cursor through the
  // pool so each is heard once per lap before any repeat, and the cursor
  // advances on every pick — so a selected-then-skipped encouragement moves on
  // instead of being re-drawn at the next boundary (the old pure-random pick
  // had no progress, so the same few kept coming back).
  private encouragementOrder: number[] = []
  private encouragementCursor = 0

  // Dev cheat (?forceEncouragements=1): fire on EVERY eligible (speaking)
  // boundary, bypassing the ~10-min interval, so the interjection display can
  // be tested without a long wait. Instructions still come first (in order),
  // then encouragements. Off in normal play.
  forceFire = false

  // Dev cheat (?fc=enc): jump straight to encouragements, skipping the ~30
  // ordered instructions — SESSION-ONLY, never persisted (no globalState
  // write), so the learner's real instruction progress is untouched. For
  // eyeballing the rotating encouragement icons without grinding through every
  // instruction first.
  forceEncouragementsOnly = false

  constructor(provider: CourseDataProvider, learnerId: string, supabase: SupabaseClient | null = null) {
    this.provider = provider
    this.courseId = provider.getCourseId()
    this.learnerId = learnerId
    this.supabase = supabase
    this.globalState = this.getDefaultGlobalState()
  }

  /** Cross-device sync is possible only for a signed-in learner (a real
   *  learners.id UUID) with a client — guests stay on localStorage. */
  private get canSync(): boolean {
    return !!this.supabase && UUID_RE.test(this.learnerId)
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

    // Load saved state (per-user, persists across courses). localStorage is the
    // fast/offline cache; the server is the source of truth across devices.
    this.loadGlobalState()
    await this.syncFromServer()

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

  /** Roll the next interval: BASE ± INTERVAL_JITTER, in cycles. */
  private rollIntervalCycles(): number {
    const factor = 1 + (Math.random() * 2 - 1) * INTERVAL_JITTER
    return Math.max(1, Math.round(BASE_INTERVAL_CYCLES * factor))
  }

  /**
   * Called after every round completes. Accumulates active play time (the
   * round's cycle count) and fires commentary once ~the rolled interval has
   * elapsed — but ONLY when `canFire` is true (the caller sets this when the
   * boundary sits between two speaking rounds, so an encouragement never butts
   * up against a listening section). When it can't fire yet, the accumulated
   * time is kept, so the next clean boundary picks it up.
   *
   * @param _roundNumber  kept for caller/telemetry symmetry; timing no longer
   *                      keys off round number.
   * @param cyclesInRound number of cycles in the round that just completed.
   * @param canFire       true iff this boundary is a legal place to drop one.
   */
  onRoundComplete(_roundNumber: number, cyclesInRound = 0, canFire = true): MetaCommentaryAudio | null {
    if (this.nextFireAtCycles === 0) this.nextFireAtCycles = this.rollIntervalCycles()
    this.cyclesSinceLastFire += Math.max(0, cyclesInRound)

    if (!canFire) return null
    if (!this.forceFire && this.cyclesSinceLastFire < this.nextFireAtCycles) return null

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

    // Reset the clock and re-roll so the next gap is independently uncertain.
    this.cyclesSinceLastFire = 0
    this.nextFireAtCycles = this.rollIntervalCycles()
    return commentary
  }

  /**
   * Pick the next commentary to play.
   *  - Instructions phase (per-learner global): next item in the fixed
   *    sequence. Always advances on play; skipping doesn't re-queue.
   *  - Encouragements phase: a shuffled cursor walks the whole pool before any
   *    repeat (reshuffled each lap), and advances on every pick — so skipping
   *    one moves on rather than re-drawing the same few.
   */
  private getNextCommentary(): MetaCommentaryAudio | null {
    // ?fc=enc cheat: skip the instruction list entirely (session-only, no
    // persistence) so the encouragement icons can be tested immediately.
    if (!this.forceEncouragementsOnly &&
        !this.globalState.instructionsComplete && this.globalState.instructionIndex < this.instructions.length) {
      const instruction = this.instructions[this.globalState.instructionIndex]
      return { ...instruction, type: 'instruction' }
    }

    if (this.encouragements.length === 0) return null
    const encouragement = this.encouragements[this.nextEncouragementIndex()]
    return { ...encouragement, type: 'encouragement' }
  }

  /** Next encouragement index via a shuffled cursor — walk the whole pool
   *  before repeating, reshuffling each lap. Advances every call so a skipped
   *  encouragement isn't re-drawn at the next boundary. */
  private nextEncouragementIndex(): number {
    if (this.encouragementOrder.length !== this.encouragements.length ||
        this.encouragementCursor >= this.encouragementOrder.length) {
      this.encouragementOrder = this.shuffledIndices(this.encouragements.length)
      this.encouragementCursor = 0
    }
    return this.encouragementOrder[this.encouragementCursor++]
  }

  /** Fisher–Yates shuffle of [0..n). Avoids butting the previous lap's last
   *  index against the new lap's first, so two laps never repeat the same
   *  encouragement back-to-back. */
  private shuffledIndices(n: number): number[] {
    const a = Array.from({ length: n }, (_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    const prevLast = this.encouragementOrder.length
      ? this.encouragementOrder[this.encouragementOrder.length - 1]
      : -1
    if (n > 1 && a[0] === prevLast) { [a[0], a[1]] = [a[1], a[0]] }
    return a
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
    // Mirror to the server (fire-and-forget; localStorage already holds it).
    if (this.canSync) void this.saveToServer()
  }

  /**
   * Read the learner's instruction progress from the server and merge it with
   * the local cache by FURTHEST progress (the index is monotonic — you only
   * advance). So a fresh device adopts the server's progress, while progress
   * made offline (local ahead) is pushed up. Best-effort: any failure leaves
   * the localStorage value in place.
   */
  private async syncFromServer(): Promise<void> {
    if (!this.canSync || !this.supabase) return
    try {
      const { data, error } = await this.supabase
        .from('learner_meta_commentary_state')
        .select('instruction_index, instructions_complete')
        .eq('learner_id', this.learnerId)
        .maybeSingle()
      if (error) {
        console.warn('[MetaCommentaryService] server load failed:', error.message)
        return
      }
      const local = this.globalState
      const serverIndex = data?.instruction_index ?? 0
      const serverComplete = !!data?.instructions_complete
      const merged: GlobalCommentaryState = {
        instructionIndex: Math.max(local.instructionIndex, serverIndex),
        instructionsComplete: local.instructionsComplete || serverComplete,
      }
      this.globalState = merged
      // Cache the merge locally.
      try { localStorage.setItem(this.getGlobalStorageKey(), JSON.stringify(merged)) } catch { /* ignore */ }
      // Push the merge up if the server row is missing or behind.
      const serverBehind = !data || serverIndex !== merged.instructionIndex || serverComplete !== merged.instructionsComplete
      if (serverBehind) await this.saveToServer()
    } catch (err) {
      console.warn('[MetaCommentaryService] syncFromServer error:', err)
    }
  }

  private async saveToServer(): Promise<void> {
    if (!this.canSync || !this.supabase) return
    try {
      const { error } = await this.supabase
        .from('learner_meta_commentary_state')
        .upsert({
          learner_id: this.learnerId,
          instructions_complete: this.globalState.instructionsComplete,
          instruction_index: this.globalState.instructionIndex,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'learner_id' })
      if (error) console.warn('[MetaCommentaryService] server save failed:', error.message)
    } catch (err) {
      console.warn('[MetaCommentaryService] saveToServer error:', err)
    }
  }
}

/**
 * Factory function
 */
export function createMetaCommentaryService(
  provider: CourseDataProvider,
  learnerId: string,
  supabase: SupabaseClient | null = null,
): MetaCommentaryService {
  return new MetaCommentaryService(provider, learnerId, supabase)
}
