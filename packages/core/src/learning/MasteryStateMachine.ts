/**
 * MasteryStateMachine - Four-state mastery progression per LEGO
 *
 * Based on APML spec: adaptation-engine.apml
 *
 * Core principles:
 * - Four states: acquisition → consolidating → confident → mastered
 * - Each state has a typical_skip value (items until next practice)
 * - Advance on consecutive smooth responses (no discontinuity)
 * - Fast-track on consecutive fast responses
 * - Regress on severe discontinuities
 *
 * State transitions are gradient-based, not absolute.
 * We track consecutive smooth/fast responses per LEGO.
 */

import type {
  MasteryState,
  LegoMasteryState,
  MasteryConfig,
  MasteryTransition,
  DiscontinuitySeverity,
} from './types';

/**
 * Typical skip values per mastery state
 * (items to skip before practicing this LEGO again)
 */
const TYPICAL_SKIP: Record<MasteryState, number> = {
  acquisition: 1,
  consolidating: 3,
  confident: 8,
  mastered: 21,
} as const;

/**
 * Default configuration
 */
const DEFAULT_CONFIG: MasteryConfig = {
  advancement_threshold: 3,   // Consecutive smooth to advance
  fast_track_threshold: 5,    // Consecutive fast to skip a state
} as const;

/**
 * MasteryStateMachine
 *
 * Tracks mastery state per LEGO and manages state transitions
 * based on performance patterns (smooth/fast responses and discontinuities).
 */
export class MasteryStateMachine {
  private config: MasteryConfig;
  private states: Map<string, LegoMasteryState> = new Map();

  constructor(config: Partial<MasteryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Get mastery state for a LEGO
   * Creates new state if doesn't exist
   */
  getState(legoId: string): LegoMasteryState {
    let state = this.states.get(legoId);

    if (!state) {
      // Create new state starting in acquisition
      state = this.createInitialState(legoId);
      this.states.set(legoId, state);
    }

    return state;
  }

  /**
   * Record a smooth response (no discontinuity detected)
   *
   * @param legoId - LEGO identifier
   * @param wasFast - Whether response was faster than learner's pattern
   * @returns Transition if state changed, null otherwise
   */
  recordSmooth(legoId: string, wasFast: boolean): MasteryTransition | null {
    const state = this.getState(legoId);

    // Increment consecutive counters
    state.consecutive_smooth++;
    if (wasFast) {
      state.consecutive_fast++;
    } else {
      // Reset fast counter if not fast (must be consecutive)
      state.consecutive_fast = 0;
    }

    state.updated_at = new Date();

    // Check for state transitions
    const transition = this.checkAndApplyTransition(state);

    return transition;
  }

  /**
   * Record a discontinuity (pattern break detected)
   *
   * @param legoId - LEGO identifier
   * @param severity - 'mild' | 'moderate' | 'severe'
   * @returns Transition if state changed, null otherwise
   */
  recordDiscontinuity(
    legoId: string,
    severity: DiscontinuitySeverity
  ): MasteryTransition | null {
    const state = this.getState(legoId);
    const previousState = state.current_state;

    // Update discontinuity tracking
    state.discontinuity_count++;
    state.last_discontinuity_at = new Date();
    state.updated_at = new Date();

    // Apply severity-based response
    let transition: MasteryTransition | null = null;

    switch (severity) {
      case 'mild':
        // No state change, no counter reset
        break;

      case 'moderate':
        // Hold position: reset consecutive counters
        state.consecutive_smooth = 0;
        state.consecutive_fast = 0;
        transition = {
          from_state: previousState,
          to_state: state.current_state,
          reason: 'hold',
          timestamp: state.updated_at,
        };
        break;

      case 'severe':
        // Regress one state (but not below acquisition)
        const newState = this.regressState(state.current_state);
        if (newState !== state.current_state) {
          state.current_state = newState;
          transition = {
            from_state: previousState,
            to_state: newState,
            reason: 'regression',
            timestamp: state.updated_at,
          };
        }
        // Reset counters
        state.consecutive_smooth = 0;
        state.consecutive_fast = 0;
        break;
    }

    return transition;
  }

  /**
   * Get the typical skip value for a LEGO based on its current mastery state
   *
   * @param legoId - LEGO identifier
   * @returns Number of items to skip before practicing again
   */
  getTypicalSkip(legoId: string): number {
    const state = this.getState(legoId);
    return TYPICAL_SKIP[state.current_state];
  }

  /**
   * Get all mastery states (for persistence)
   */
  getAllStates(): LegoMasteryState[] {
    return Array.from(this.states.values());
  }

  /**
   * Load existing states (from persistence)
   */
  loadStates(states: LegoMasteryState[]): void {
    this.states.clear();
    for (const state of states) {
      // Convert date strings to Date objects if needed
      const loadedState: LegoMasteryState = {
        ...state,
        last_discontinuity_at: state.last_discontinuity_at
          ? new Date(state.last_discontinuity_at)
          : null,
        created_at: new Date(state.created_at),
        updated_at: new Date(state.updated_at),
      };
      this.states.set(state.lego_id, loadedState);
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<MasteryConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): MasteryConfig {
    return { ...this.config };
  }

  /**
   * Clear all states
   */
  clear(): void {
    this.states.clear();
  }

  /**
   * Reset state for a specific LEGO
   */
  resetState(legoId: string): void {
    this.states.delete(legoId);
  }

  /**
   * Get all LEGOs in a specific mastery state
   */
  getLegosByState(state: MasteryState): string[] {
    const result: string[] = [];
    this.states.forEach((legoState, legoId) => {
      if (legoState.current_state === state) {
        result.push(legoId);
      }
    });
    return result;
  }

  /**
   * Get statistics across all LEGOs
   */
  getStats(): {
    total: number;
    by_state: Record<MasteryState, number>;
    avg_consecutive_smooth: number;
    avg_discontinuity_count: number;
  } {
    const all = Array.from(this.states.values());
    const byState: Record<MasteryState, number> = {
      acquisition: 0,
      consolidating: 0,
      confident: 0,
      mastered: 0,
    };

    let totalSmooth = 0;
    let totalDiscontinuities = 0;

    for (const state of all) {
      byState[state.current_state]++;
      totalSmooth += state.consecutive_smooth;
      totalDiscontinuities += state.discontinuity_count;
    }

    return {
      total: all.length,
      by_state: byState,
      avg_consecutive_smooth: all.length > 0 ? totalSmooth / all.length : 0,
      avg_discontinuity_count: all.length > 0 ? totalDiscontinuities / all.length : 0,
    };
  }

  // ============================================
  // PRIVATE METHODS
  // ============================================

  /**
   * Create initial state for a new LEGO
   */
  private createInitialState(legoId: string): LegoMasteryState {
    const now = new Date();
    return {
      lego_id: legoId,
      current_state: 'acquisition',
      consecutive_smooth: 0,
      consecutive_fast: 0,
      discontinuity_count: 0,
      last_discontinuity_at: null,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Check if state should transition and apply if needed
   */
  private checkAndApplyTransition(state: LegoMasteryState): MasteryTransition | null {
    const previousState = state.current_state;

    // Check for fast-track (skip a state)
    if (state.consecutive_fast >= this.config.fast_track_threshold) {
      const newState = this.advanceState(state.current_state, 2); // Skip one
      if (newState !== state.current_state) {
        state.current_state = newState;
        state.consecutive_smooth = 0;
        state.consecutive_fast = 0;
        return {
          from_state: previousState,
          to_state: newState,
          reason: 'fast_track',
          timestamp: state.updated_at,
        };
      }
    }

    // Check for normal advancement
    if (state.consecutive_smooth >= this.config.advancement_threshold) {
      const newState = this.advanceState(state.current_state, 1);
      if (newState !== state.current_state) {
        state.current_state = newState;
        state.consecutive_smooth = 0;
        state.consecutive_fast = 0;
        return {
          from_state: previousState,
          to_state: newState,
          reason: 'advancement',
          timestamp: state.updated_at,
        };
      }
    }

    return null;
  }

  /**
   * Advance mastery state by N steps
   */
  private advanceState(current: MasteryState, steps: number = 1): MasteryState {
    const stateOrder: MasteryState[] = [
      'acquisition',
      'consolidating',
      'confident',
      'mastered',
    ];

    const currentIndex = stateOrder.indexOf(current);
    const newIndex = Math.min(currentIndex + steps, stateOrder.length - 1);

    return stateOrder[newIndex];
  }

  /**
   * Regress mastery state by one step
   */
  private regressState(current: MasteryState): MasteryState {
    const stateOrder: MasteryState[] = [
      'acquisition',
      'consolidating',
      'confident',
      'mastered',
    ];

    const currentIndex = stateOrder.indexOf(current);
    const newIndex = Math.max(currentIndex - 1, 0);

    return stateOrder[newIndex];
  }
}

/**
 * Factory function to create MasteryStateMachine with default config
 */
export function createMasteryStateMachine(
  config: Partial<MasteryConfig> = {}
): MasteryStateMachine {
  return new MasteryStateMachine(config);
}
