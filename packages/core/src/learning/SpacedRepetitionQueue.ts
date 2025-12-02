/**
 * SpacedRepetitionQueue - Fibonacci-based spaced repetition at LEGO level
 *
 * Key concepts:
 * - Fibonacci positions: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 (mastered)
 * - Skip number: items until next practice
 * - Operates per-thread (each thread has its own queue)
 */

import type { LegoProgress, LegoPair } from '../data/types';
import type { RepetitionConfig } from '../config/types';

export interface QueuedLego {
  lego: LegoPair;
  progress: LegoProgress;
  /** Priority score (lower = sooner) */
  priority: number;
}

export class SpacedRepetitionQueue {
  private config: RepetitionConfig;
  private queue: Map<string, QueuedLego> = new Map();
  private fibonacciSequence: number[];

  constructor(config: RepetitionConfig) {
    this.config = config;
    this.fibonacciSequence = config.fibonacci_sequence;
  }

  /**
   * Add a new LEGO to the queue (first introduction)
   */
  addNew(lego: LegoPair, threadId: number, courseId: string): LegoProgress {
    const progress: LegoProgress = {
      lego_id: lego.id,
      course_id: courseId,
      thread_id: threadId,
      fibonacci_position: 0, // Start at position 0
      skip_number: 0, // Practice immediately
      reps_completed: 0,
      is_retired: false,
      last_practiced_at: null,
    };

    this.queue.set(lego.id, {
      lego,
      progress,
      priority: this.calculatePriority(progress),
    });

    return progress;
  }

  /**
   * Load existing progress into the queue
   */
  loadProgress(lego: LegoPair, progress: LegoProgress): void {
    this.queue.set(lego.id, {
      lego,
      progress,
      priority: this.calculatePriority(progress),
    });
  }

  /**
   * Get the next LEGO to practice (lowest priority score)
   */
  getNext(): QueuedLego | null {
    let best: QueuedLego | null = null;
    let bestPriority = Infinity;

    for (const queued of this.queue.values()) {
      // Skip retired LEGOs
      if (queued.progress.is_retired) continue;

      // Skip LEGOs that still have skip numbers
      if (queued.progress.skip_number > 0) continue;

      if (queued.priority < bestPriority) {
        best = queued;
        bestPriority = queued.priority;
      }
    }

    return best;
  }

  /**
   * Get all LEGOs ready for practice (skip_number = 0)
   */
  getReady(): QueuedLego[] {
    return Array.from(this.queue.values())
      .filter(q => !q.progress.is_retired && q.progress.skip_number <= 0)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Record a practice attempt for a LEGO
   */
  recordPractice(
    legoId: string,
    wasSuccessful: boolean,
    wasSpike: boolean
  ): LegoProgress | null {
    const queued = this.queue.get(legoId);
    if (!queued) return null;

    const progress = queued.progress;

    // Update last practiced time
    progress.last_practiced_at = new Date();

    if (wasSpike) {
      // Spike: reset position (but not below 0)
      progress.fibonacci_position = Math.max(0, progress.fibonacci_position - 1);
    } else if (wasSuccessful) {
      // Success: increment reps and potentially advance position
      progress.reps_completed++;

      // After initial reps, advance in Fibonacci sequence
      if (progress.reps_completed >= this.config.initial_reps) {
        progress.fibonacci_position = Math.min(
          progress.fibonacci_position + 1,
          this.fibonacciSequence.length - 1
        );
      }

      // Check if retired (reached end of Fibonacci)
      if (progress.fibonacci_position >= this.fibonacciSequence.length - 1) {
        progress.is_retired = true;
      }
    }

    // Set skip number based on current Fibonacci position
    progress.skip_number = this.fibonacciSequence[progress.fibonacci_position] || 0;

    // Update priority
    queued.priority = this.calculatePriority(progress);

    return progress;
  }

  /**
   * Decrement skip numbers for all LEGOs (called after each practice)
   */
  decrementSkipNumbers(): void {
    for (const queued of this.queue.values()) {
      if (queued.progress.skip_number > 0) {
        queued.progress.skip_number--;
        queued.priority = this.calculatePriority(queued.progress);
      }
    }
  }

  /**
   * Get progress for a specific LEGO
   */
  getProgress(legoId: string): LegoProgress | null {
    return this.queue.get(legoId)?.progress || null;
  }

  /**
   * Get all progress (for persistence)
   */
  getAllProgress(): LegoProgress[] {
    return Array.from(this.queue.values()).map(q => q.progress);
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    total: number;
    active: number;
    retired: number;
    ready: number;
    avgPosition: number;
  } {
    const all = Array.from(this.queue.values());
    const active = all.filter(q => !q.progress.is_retired);
    const ready = all.filter(q => !q.progress.is_retired && q.progress.skip_number <= 0);

    const avgPosition = active.length > 0
      ? active.reduce((sum, q) => sum + q.progress.fibonacci_position, 0) / active.length
      : 0;

    return {
      total: all.length,
      active: active.length,
      retired: all.length - active.length,
      ready: ready.length,
      avgPosition,
    };
  }

  /**
   * Clear the queue
   */
  clear(): void {
    this.queue.clear();
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RepetitionConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.fibonacci_sequence) {
      this.fibonacciSequence = config.fibonacci_sequence;
    }

    // Recalculate all priorities
    for (const queued of this.queue.values()) {
      queued.priority = this.calculatePriority(queued.progress);
    }
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Calculate priority score for a LEGO
   * Lower score = higher priority (practice sooner)
   */
  private calculatePriority(progress: LegoProgress): number {
    // Retired LEGOs get max priority (never practice)
    if (progress.is_retired) return Infinity;

    // Base priority: skip number
    let priority = progress.skip_number;

    // Bonus for incomplete initial reps (practice more frequently)
    if (progress.reps_completed < this.config.initial_reps) {
      priority -= 10; // Higher priority
    }

    // Penalty for higher Fibonacci positions (more spaced out)
    priority += progress.fibonacci_position * 0.5;

    // Slight randomization to avoid predictable order
    priority += Math.random() * 0.1;

    return priority;
  }
}

/**
 * Factory function to create queue with default config
 */
export function createSpacedRepetitionQueue(
  config: RepetitionConfig
): SpacedRepetitionQueue {
  return new SpacedRepetitionQueue(config);
}
