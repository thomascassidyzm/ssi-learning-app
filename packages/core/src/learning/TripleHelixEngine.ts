/**
 * TripleHelixEngine - Orchestrates 3 parallel learning threads
 *
 * Key concepts:
 * - SEEDs are distributed via card-dealing across threads
 * - Each thread has its own SpacedRepetitionQueue for LEGOs
 * - Rotation between threads provides natural inter-thread spacing
 * - ROUND-based introduction for new LEGOs (via RoundEngine)
 */

import type {
  SeedPair,
  LegoPair,
  LearningItem,
  HelixState,
  SeedProgress,
  LegoProgress,
  LearningMode,
  PracticePhrase,
  ClassifiedBasket,
  RoundState,
} from '../data/types';
import { createDefaultLegoProgress } from '../data/types';
import type { HelixConfig, RepetitionConfig } from '../config/types';
import { SpacedRepetitionQueue } from './SpacedRepetitionQueue';
import {
  getNextRoundItem,
  createRoundState,
  needsRound,
  type RoundEngineConfig,
} from './RoundEngine';
import { selectEternalPhrase } from './PhraseSelector';

interface ThreadState {
  /** Queue for this thread's LEGOs */
  queue: SpacedRepetitionQueue;
  /** SEEDs assigned to this thread */
  seeds: SeedPair[];
  /** Current SEED being worked on */
  currentSeedIndex: number;
  /** Current LEGO index within the SEED */
  currentLegoIndex: number;
  /** SEEDs that have been fully introduced */
  introducedSeeds: Set<string>;
}

export class TripleHelixEngine {
  private helixConfig: HelixConfig;
  private threads: Map<number, ThreadState> = new Map();
  private activeThread: number = 1;
  private courseId: string;
  private allSeeds: SeedPair[] = [];

  // ROUND-based learning state
  private baskets: Map<string, ClassifiedBasket> = new Map();
  private roundStates: Map<string, RoundState> = new Map();
  private legoProgressMap: Map<string, LegoProgress> = new Map();
  private roundConfig: RoundEngineConfig = {
    spacedRepInterleaveCount: 3,
    consolidationCount: 2,
    skipComponents: false,
    phraseSelector: {
      eternalSelectionMode: 'random_urn',
      minEternalsBeforeRepeat: 3,
    },
  };

  // Currently active round (if any)
  private activeRoundLegoId: string | null = null;

  constructor(
    helixConfig: HelixConfig,
    repetitionConfig: RepetitionConfig,
    courseId: string
  ) {
    this.helixConfig = helixConfig;
    this.courseId = courseId;

    // Initialize threads
    for (let i = 1; i <= helixConfig.thread_count; i++) {
      this.threads.set(i, {
        queue: new SpacedRepetitionQueue(repetitionConfig),
        seeds: [],
        currentSeedIndex: 0,
        currentLegoIndex: 0,
        introducedSeeds: new Set(),
      });
    }
  }

  /**
   * Register a ClassifiedBasket for a LEGO (for ROUND-based phrase selection)
   */
  registerBasket(legoId: string, basket: ClassifiedBasket): void {
    this.baskets.set(legoId, basket);
  }

  /**
   * Register multiple baskets at once
   */
  registerBaskets(baskets: ClassifiedBasket[]): void {
    for (const basket of baskets) {
      this.baskets.set(basket.lego_id, basket);
    }
  }

  /**
   * Get the currently active round (if any)
   */
  getActiveRound(): { legoId: string; roundState: RoundState } | null {
    if (this.activeRoundLegoId) {
      const roundState = this.roundStates.get(this.activeRoundLegoId);
      if (roundState) {
        return { legoId: this.activeRoundLegoId, roundState };
      }
    }
    return null;
  }

  /**
   * Load seeds and distribute them across threads (card-dealing)
   */
  loadSeeds(seeds: SeedPair[]): void {
    this.allSeeds = seeds;

    // Card-deal distribution: seed 1 → thread A, seed 2 → thread B, seed 3 → thread C, repeat
    const threadCount = this.helixConfig.thread_count;
    const seedCount = Math.min(seeds.length, this.helixConfig.initial_seed_count);

    for (let i = 0; i < seedCount; i++) {
      const threadId = (i % threadCount) + 1;
      const thread = this.threads.get(threadId);
      if (thread) {
        thread.seeds.push(seeds[i]);
      }
    }
  }

  /**
   * Load existing state (from persistence)
   */
  loadState(
    helixState: HelixState,
    seedProgress: SeedProgress[],
    legoProgress: LegoProgress[]
  ): void {
    this.activeThread = helixState.active_thread;

    // Load seed progress
    for (const sp of seedProgress) {
      const thread = this.threads.get(sp.thread_id);
      if (thread && sp.is_introduced) {
        thread.introducedSeeds.add(sp.seed_id);
      }
    }

    // Load LEGO progress
    for (const lp of legoProgress) {
      const thread = this.threads.get(lp.thread_id);
      if (thread) {
        // Find the LEGO in the seeds
        const lego = this.findLego(lp.lego_id);
        if (lego) {
          thread.queue.loadProgress(lego, lp);
        }
      }
    }

    // Restore thread positions from helixState
    for (const [threadId, state] of Object.entries(helixState.threads)) {
      const thread = this.threads.get(parseInt(threadId));
      if (thread && state.currentSeedId) {
        const seedIndex = thread.seeds.findIndex(s => s.seed_id === state.currentSeedId);
        if (seedIndex >= 0) {
          thread.currentSeedIndex = seedIndex;
          thread.currentLegoIndex = state.currentLegoIndex;
        }
      }
    }
  }

  /**
   * Get the next learning item to practice
   *
   * Enhanced with ROUND-based learning:
   * - If there's an active Round, continue it
   * - If Round needs spaced rep, get it from another thread
   * - Otherwise, normal thread rotation
   */
  getNextItem(): LearningItem | null {
    // If there's an active Round, continue it
    if (this.activeRoundLegoId) {
      const result = this.continueActiveRound();
      if (result) return result;
    }

    // Try current thread first
    let item = this.getItemFromThread(this.activeThread);

    // If nothing ready in current thread, try rotation
    if (!item) {
      for (let i = 1; i <= this.helixConfig.thread_count; i++) {
        const threadId = ((this.activeThread + i - 1) % this.helixConfig.thread_count) + 1;
        item = this.getItemFromThread(threadId);
        if (item) {
          this.activeThread = threadId;
          break;
        }
      }
    }

    return item;
  }

  /**
   * Continue the active Round, handling all phases including spaced rep
   */
  private continueActiveRound(): LearningItem | null {
    const legoId = this.activeRoundLegoId;
    if (!legoId) return null;

    const basket = this.baskets.get(legoId);
    const roundState = this.roundStates.get(legoId);
    const progress = this.legoProgressMap.get(legoId);

    if (!basket || !roundState || !progress) {
      // Missing data, abandon round
      this.activeRoundLegoId = null;
      return null;
    }

    // Find the LEGO and SEED
    const lego = this.findLego(legoId);
    const seed = this.findSeedForLego(legoId);

    if (!lego || !seed) {
      this.activeRoundLegoId = null;
      return null;
    }

    // Get next item from RoundEngine
    const result = getNextRoundItem(
      lego,
      seed,
      basket,
      progress,
      roundState,
      this.roundConfig
    );

    // Update state
    this.legoProgressMap.set(legoId, result.updatedProgress);
    this.roundStates.set(legoId, result.updatedRoundState);

    // Check if Round is complete
    if (result.roundComplete) {
      this.activeRoundLegoId = null;
      // Update the queue with the completed progress
      const thread = this.findThreadForLego(legoId);
      if (thread) {
        thread.queue.updateProgress(legoId, result.updatedProgress);
      }
      return null; // Get next item normally
    }

    // If Round needs spaced rep item, get from another thread
    if (result.needsSpacedRepItem) {
      const spacedRepItem = this.getSpacedRepItemForRound(progress.thread_id);
      if (spacedRepItem) {
        return spacedRepItem;
      }
      // No spaced rep available, continue Round
      return this.continueActiveRound();
    }

    return result.item;
  }

  /**
   * Get a spaced rep item from a thread OTHER than the active Round's thread
   */
  private getSpacedRepItemForRound(excludeThreadId: number): LearningItem | null {
    for (const [threadId, thread] of this.threads) {
      if (threadId === excludeThreadId) continue;

      const readyLego = thread.queue.getNext();
      if (readyLego) {
        const seed = this.findSeedForLego(readyLego.lego.id);
        if (seed) {
          return this.createLearningItemWithBasket(
            readyLego.lego,
            seed,
            threadId,
            'review'
          );
        }
      }
    }
    return null;
  }

  /**
   * Record practice result for a LEGO
   */
  recordPractice(
    legoId: string,
    threadId: number,
    wasSuccessful: boolean,
    wasSpike: boolean
  ): LegoProgress | null {
    const thread = this.threads.get(threadId);
    if (!thread) return null;

    // Record in the queue
    const progress = thread.queue.recordPractice(legoId, wasSuccessful, wasSpike);

    // Decrement skip numbers in this thread
    thread.queue.decrementSkipNumbers();

    // Rotate to next thread after practice
    this.rotateThread();

    return progress;
  }

  /**
   * Mark a SEED as fully introduced
   */
  markSeedIntroduced(seedId: string, threadId: number): void {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.introducedSeeds.add(seedId);
    }
  }

  /**
   * Get current helix state (for persistence)
   */
  getHelixState(): HelixState {
    const threads: HelixState['threads'] = {};

    for (const [threadId, thread] of this.threads) {
      const currentSeed = thread.seeds[thread.currentSeedIndex];
      threads[threadId] = {
        seedOrder: thread.seeds.map(s => s.seed_id),
        currentSeedId: currentSeed?.seed_id || null,
        currentLegoIndex: thread.currentLegoIndex,
      };
    }

    return {
      active_thread: this.activeThread,
      threads,
      injected_content: {},
    };
  }

  /**
   * Get all LEGO progress (for persistence)
   */
  getAllLegoProgress(): LegoProgress[] {
    const progress: LegoProgress[] = [];
    for (const thread of this.threads.values()) {
      progress.push(...thread.queue.getAllProgress());
    }
    return progress;
  }

  /**
   * Get all SEED progress (for persistence)
   */
  getAllSeedProgress(): SeedProgress[] {
    const progress: SeedProgress[] = [];

    for (const [threadId, thread] of this.threads) {
      for (const seed of thread.seeds) {
        progress.push({
          seed_id: seed.seed_id,
          course_id: this.courseId,
          thread_id: threadId,
          is_introduced: thread.introducedSeeds.has(seed.seed_id),
          introduced_at: thread.introducedSeeds.has(seed.seed_id) ? new Date() : null,
        });
      }
    }

    return progress;
  }

  /**
   * Get statistics across all threads
   */
  getStats(): {
    threads: Array<{ threadId: number; stats: ReturnType<SpacedRepetitionQueue['getStats']> }>;
    activeThread: number;
    totalSeeds: number;
    introducedSeeds: number;
  } {
    const threadStats = [];
    let totalIntroduced = 0;
    let totalSeeds = 0;

    for (const [threadId, thread] of this.threads) {
      threadStats.push({
        threadId,
        stats: thread.queue.getStats(),
      });
      totalSeeds += thread.seeds.length;
      totalIntroduced += thread.introducedSeeds.size;
    }

    return {
      threads: threadStats,
      activeThread: this.activeThread,
      totalSeeds,
      introducedSeeds: totalIntroduced,
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  private getItemFromThread(threadId: number): LearningItem | null {
    const thread = this.threads.get(threadId);
    if (!thread) return null;

    // First check if there's a LEGO ready for review
    const readyLego = thread.queue.getNext();
    if (readyLego) {
      // Check if this LEGO needs a Round (introduction not complete)
      const progress = this.legoProgressMap.get(readyLego.lego.id);
      if (progress && needsRound(progress)) {
        // Start/continue a Round for this LEGO
        return this.startRoundForLego(readyLego.lego.id, threadId);
      }

      // Normal review - use basket for phrase variety if available
      const seed = this.findSeedForLego(readyLego.lego.id);
      if (seed) {
        return this.createLearningItemWithBasket(
          readyLego.lego,
          seed,
          threadId,
          'review'
        );
      }
    }

    // Otherwise, introduce new content
    return this.getNextNewItem(thread, threadId);
  }

  private getNextNewItem(thread: ThreadState, threadId: number): LearningItem | null {
    // Get current seed
    if (thread.currentSeedIndex >= thread.seeds.length) {
      return null; // No more seeds in this thread
    }

    const seed = thread.seeds[thread.currentSeedIndex];
    const legos = seed.legos.filter(l => l.new); // Only new LEGOs

    // Get current LEGO
    if (thread.currentLegoIndex >= legos.length) {
      // Mark seed as introduced and move to next
      this.markSeedIntroduced(seed.seed_id, threadId);
      thread.currentSeedIndex++;
      thread.currentLegoIndex = 0;
      return this.getNextNewItem(thread, threadId);
    }

    const lego = legos[thread.currentLegoIndex];

    // Add to queue if not already there
    if (!thread.queue.getProgress(lego.id)) {
      thread.queue.addNew(lego, threadId, this.courseId);
    }

    // Create initial progress if needed
    if (!this.legoProgressMap.has(lego.id)) {
      this.legoProgressMap.set(
        lego.id,
        createDefaultLegoProgress(lego.id, this.courseId, threadId)
      );
    }

    // Advance to next LEGO for next call
    thread.currentLegoIndex++;

    // Start a Round for this new LEGO (if basket is available)
    const basket = this.baskets.get(lego.id);
    if (basket) {
      return this.startRoundForLego(lego.id, threadId);
    }

    // Fallback: simple introduction without Round structure
    return this.createLearningItem(lego, seed, threadId, 'introduction');
  }

  /**
   * Start a Round for a LEGO (or continue an existing one)
   */
  private startRoundForLego(legoId: string, _threadId: number): LearningItem | null {
    // Get or create round state
    if (!this.roundStates.has(legoId)) {
      this.roundStates.set(legoId, createRoundState(legoId, this.roundConfig));
    }

    // Set as active round
    this.activeRoundLegoId = legoId;

    // Continue the round
    return this.continueActiveRound();
  }

  /**
   * Create a learning item using basket for phrase variety
   */
  private createLearningItemWithBasket(
    lego: LegoPair,
    seed: SeedPair,
    threadId: number,
    mode: LearningMode
  ): LearningItem {
    const basket = this.baskets.get(lego.id);
    const progress = this.legoProgressMap.get(lego.id);

    // If we have a basket and progress, select an eternal phrase with variety
    if (basket && progress && basket.eternal_phrases.length > 0) {
      const { phrase, updatedUrn } = selectEternalPhrase(
        basket,
        progress,
        this.roundConfig.phraseSelector
      );

      if (phrase) {
        // Update progress with new urn state
        this.legoProgressMap.set(lego.id, {
          ...progress,
          eternal_urn: updatedUrn,
          last_eternal_phrase_id: phrase.id,
        });

        return {
          lego,
          phrase,
          seed,
          thread_id: threadId,
          mode,
        };
      }
    }

    // Fallback to simple phrase
    return this.createLearningItem(lego, seed, threadId, mode);
  }

  private createLearningItem(
    lego: LegoPair,
    seed: SeedPair,
    threadId: number,
    mode: LearningMode
  ): LearningItem {
    // For now, create a simple practice phrase from the LEGO itself
    // In production, this would select from the LEGO's practice phrases
    const phrase: PracticePhrase = {
      id: `${lego.id}_phrase`,
      phraseType: mode === 'introduction' ? 'debut' : 'eternal',
      phrase: lego.lego,
      audioRefs: lego.audioRefs,
      wordCount: lego.lego.target.split(/\s+/).length,
      containsLegos: [lego.id],
    };

    return {
      lego,
      phrase,
      seed,
      thread_id: threadId,
      mode,
    };
  }

  private rotateThread(): void {
    this.activeThread = (this.activeThread % this.helixConfig.thread_count) + 1;
  }

  private findLego(legoId: string): LegoPair | null {
    for (const seed of this.allSeeds) {
      const lego = seed.legos.find(l => l.id === legoId);
      if (lego) return lego;
    }
    return null;
  }

  private findSeedForLego(legoId: string): SeedPair | null {
    for (const seed of this.allSeeds) {
      if (seed.legos.some(l => l.id === legoId)) {
        return seed;
      }
    }
    return null;
  }

  private findThreadForLego(legoId: string): ThreadState | null {
    for (const thread of this.threads.values()) {
      if (thread.queue.getProgress(legoId)) {
        return thread;
      }
    }
    return null;
  }
}

/**
 * Factory function
 */
export function createTripleHelixEngine(
  helixConfig: HelixConfig,
  repetitionConfig: RepetitionConfig,
  courseId: string
): TripleHelixEngine {
  return new TripleHelixEngine(helixConfig, repetitionConfig, courseId);
}
