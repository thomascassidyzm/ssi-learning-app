/**
 * ThreadManager - Triple Helix with per-thread spaced repetition
 *
 * LEGOs dealt like cards: LEGO 1→A, LEGO 2→B, LEGO 3→C, LEGO 4→A...
 * Each thread maintains its own Fibonacci-based spaced repetition queue.
 */

import type { LegoPair, LegoProgress } from '@ssi/core'
import { createDefaultLegoProgress } from '@ssi/core'
import type {
  ThreadId,
  ThreadState,
  SerializedThreadState,
} from './types'

// Fibonacci sequence for spaced repetition
const FIBONACCI = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

export interface ThreadManager {
  /** Initialize threads with LEGOs (card-dealing distribution) */
  initialize(legos: LegoPair[], courseId: string): void

  /** Get the currently active thread */
  getActiveThread(): ThreadId

  /** Advance to next thread (A → B → C → A) */
  advanceThread(): void

  /** Get LEGOs ready for spaced rep from a specific thread */
  getSpacedRepItems(thread: ThreadId, count: number): LegoPair[]

  /** Get the next LEGO to introduce from active thread */
  getNextNewLego(): LegoPair | null

  /** Record a practice result for a LEGO */
  recordPractice(legoId: string, success: boolean): LegoProgress | null

  /** Get progress for a specific LEGO */
  getProgress(legoId: string): LegoProgress | null

  /** Get all progress for persistence */
  getAllProgress(): LegoProgress[]

  /** Serialize state for persistence */
  serialize(): SerializedThreadState

  /** Restore state from persistence */
  restore(state: SerializedThreadState, legos: LegoPair[], courseId: string): void

  /** Decrement skip numbers across all threads */
  decrementSkipNumbers(): void
}

/**
 * Create a new ThreadManager instance
 */
export function createThreadManager(): ThreadManager {
  const threads = new Map<ThreadId, ThreadState>()
  let activeThread: ThreadId = 'A'
  let courseId = ''

  // Initialize empty threads
  function initThreads(): void {
    for (const id of ['A', 'B', 'C'] as ThreadId[]) {
      threads.set(id, {
        legos: [],
        progress: new Map(),
        currentIndex: 0,
      })
    }
  }

  initThreads()

  /**
   * Card-deal LEGOs across threads: 1→A, 2→B, 3→C, 4→A...
   */
  function initialize(legos: LegoPair[], course: string): void {
    courseId = course
    initThreads()

    const threadOrder: ThreadId[] = ['A', 'B', 'C']
    for (let i = 0; i < legos.length; i++) {
      const threadId = threadOrder[i % 3]
      const thread = threads.get(threadId)!
      thread.legos.push(legos[i])

      // Create initial progress for each LEGO
      const threadNum = threadId === 'A' ? 1 : threadId === 'B' ? 2 : 3
      const progress = createDefaultLegoProgress(legos[i].id, courseId, threadNum)
      thread.progress.set(legos[i].id, progress)
    }
  }

  /**
   * Get the currently active thread
   */
  function getActiveThread(): ThreadId {
    return activeThread
  }

  /**
   * Advance to next thread (A → B → C → A)
   */
  function advanceThread(): void {
    const order: ThreadId[] = ['A', 'B', 'C']
    const currentIndex = order.indexOf(activeThread)
    activeThread = order[(currentIndex + 1) % 3]
  }

  /**
   * Get LEGOs ready for spaced rep from a specific thread
   * Returns LEGOs where skip_number has reached 0
   */
  function getSpacedRepItems(thread: ThreadId, count: number): LegoPair[] {
    const t = threads.get(thread)
    if (!t) return []

    const ready: LegoPair[] = []
    for (const lego of t.legos) {
      const progress = t.progress.get(lego.id)
      if (progress && progress.introduction_complete && progress.skip_number <= 0 && !progress.is_retired) {
        ready.push(lego)
        if (ready.length >= count) break
      }
    }
    return ready
  }

  /**
   * Get the next LEGO to introduce from the active thread
   */
  function getNextNewLego(): LegoPair | null {
    const thread = threads.get(activeThread)
    if (!thread) return null

    // Find next LEGO that hasn't been introduced
    while (thread.currentIndex < thread.legos.length) {
      const lego = thread.legos[thread.currentIndex]
      const progress = thread.progress.get(lego.id)

      if (progress && !progress.introduction_complete) {
        return lego
      }
      thread.currentIndex++
    }

    return null
  }

  /**
   * Record a practice result and update spaced rep
   */
  function recordPractice(legoId: string, success: boolean): LegoProgress | null {
    // Find the LEGO's thread
    for (const thread of threads.values()) {
      const progress = thread.progress.get(legoId)
      if (progress) {
        // Update reps completed
        progress.reps_completed++
        progress.last_practiced_at = new Date()

        if (success) {
          // Advance in Fibonacci sequence
          if (progress.fibonacci_position < FIBONACCI.length - 1) {
            progress.fibonacci_position++
          }
          progress.skip_number = FIBONACCI[progress.fibonacci_position]
        } else {
          // Reset on failure (but not all the way back)
          progress.fibonacci_position = Math.max(0, progress.fibonacci_position - 2)
          progress.skip_number = FIBONACCI[progress.fibonacci_position]
        }

        // Check for retirement (after enough reps at high positions)
        if (progress.fibonacci_position >= 6 && progress.reps_completed >= 10) {
          progress.is_retired = true
        }

        return { ...progress }
      }
    }
    return null
  }

  /**
   * Get progress for a specific LEGO
   */
  function getProgress(legoId: string): LegoProgress | null {
    for (const thread of threads.values()) {
      const progress = thread.progress.get(legoId)
      if (progress) return { ...progress }
    }
    return null
  }

  /**
   * Get all progress for persistence
   */
  function getAllProgress(): LegoProgress[] {
    const all: LegoProgress[] = []
    for (const thread of threads.values()) {
      for (const progress of thread.progress.values()) {
        all.push({ ...progress })
      }
    }
    return all
  }

  /**
   * Mark a LEGO's introduction as complete
   */
  function markIntroductionComplete(legoId: string): void {
    for (const thread of threads.values()) {
      const progress = thread.progress.get(legoId)
      if (progress) {
        progress.introduction_complete = true
        progress.introduction_played = true
        progress.skip_number = 1 // Ready for first spaced rep
        break
      }
    }
  }

  /**
   * Advance current index in active thread (after completing a LEGO's round)
   */
  function advanceCurrentIndex(): void {
    const thread = threads.get(activeThread)
    if (thread && thread.currentIndex < thread.legos.length) {
      thread.currentIndex++
    }
  }

  /**
   * Decrement skip numbers across all threads
   */
  function decrementSkipNumbers(): void {
    for (const thread of threads.values()) {
      for (const progress of thread.progress.values()) {
        if (progress.introduction_complete && progress.skip_number > 0) {
          progress.skip_number--
        }
      }
    }
  }

  /**
   * Serialize state for persistence
   */
  function serialize(): SerializedThreadState {
    const serialized: SerializedThreadState = {
      activeThread,
      threads: {},
    }

    for (const [id, thread] of threads) {
      serialized.threads[id] = {
        legoIds: thread.legos.map(l => l.id),
        currentIndex: thread.currentIndex,
        progress: Array.from(thread.progress.entries()).map(([legoId, prog]) => ({
          legoId,
          progress: { ...prog },
        })),
      }
    }

    return serialized
  }

  /**
   * Restore state from persistence
   */
  function restore(state: SerializedThreadState, legos: LegoPair[], course: string): void {
    courseId = course
    activeThread = state.activeThread

    // Create LEGO lookup
    const legoMap = new Map(legos.map(l => [l.id, l]))

    // Restore each thread
    for (const id of ['A', 'B', 'C'] as ThreadId[]) {
      const savedThread = state.threads[id]
      const thread: ThreadState = {
        legos: [],
        progress: new Map(),
        currentIndex: savedThread?.currentIndex ?? 0,
      }

      if (savedThread) {
        // Restore LEGOs in order
        for (const legoId of savedThread.legoIds) {
          const lego = legoMap.get(legoId)
          if (lego) thread.legos.push(lego)
        }

        // Restore progress
        for (const { legoId, progress } of savedThread.progress) {
          thread.progress.set(legoId, progress)
        }
      }

      threads.set(id, thread)
    }
  }

  return {
    initialize,
    getActiveThread,
    advanceThread,
    getSpacedRepItems,
    getNextNewLego,
    recordPractice,
    getProgress,
    getAllProgress,
    serialize,
    restore,
    decrementSkipNumbers,
  }
}

/**
 * Get thread ID from thread number (1, 2, 3)
 */
export function threadIdFromNumber(num: number): ThreadId {
  return num === 1 ? 'A' : num === 2 ? 'B' : 'C'
}

/**
 * Get thread number from thread ID
 */
export function threadNumberFromId(id: ThreadId): number {
  return id === 'A' ? 1 : id === 'B' ? 2 : 3
}
