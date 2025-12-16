/**
 * WeightedSelector - Probabilistic LEGO selection based on multiple factors
 *
 * Implements weighted selection algorithm from Adaptation Engine spec (v1.0.0)
 * Inspired by Lake Waterfall research - prioritizes stale and struggling items
 *
 * Weight calculation:
 *   weight = base_weight * staleness_factor * struggle_factor * recency_factor
 *
 * where:
 *   - staleness_factor: increases with days since practice
 *   - struggle_factor: increases with discontinuity count
 *   - recency_factor: slight penalty for very recent practice (prevent hammering)
 *
 * Selection uses weighted random (not deterministic highest weight) to maintain
 * variety while still prioritizing items that need attention.
 */

import type { WeightedSelectionConfig } from '../config/types';

// ============================================
// TYPES
// ============================================

/**
 * Data needed to calculate weight for a LEGO
 */
export interface LegoSelectionData {
  /** When this LEGO was last practiced (null if never) */
  last_practice_at: Date | null;
  /** Count of discontinuities detected for this LEGO */
  discontinuity_count: number;
}

/**
 * A candidate LEGO for selection
 */
export interface LegoCandidate {
  /** LEGO identifier */
  lego_id: string;
  /** Selection data for this LEGO */
  data: LegoSelectionData;
  /** Calculated weight (set during selection) */
  weight?: number;
  /** Probability (normalized weight, 0-1) */
  probability?: number;
}

/**
 * Result of weight calculation
 */
export interface WeightCalculation {
  /** LEGO ID */
  lego_id: string;
  /** Final calculated weight */
  weight: number;
  /** Component factors that went into calculation */
  factors: {
    base_weight: number;
    staleness_factor: number;
    struggle_factor: number;
    recency_factor: number;
  };
  /** Diagnostics */
  diagnostics: {
    days_since_practice: number;
    minutes_since_practice: number;
  };
}

// ============================================
// WEIGHTED SELECTOR
// ============================================

export class WeightedSelector {
  private config: WeightedSelectionConfig;
  private legoData: Map<string, LegoSelectionData>;

  constructor(config: WeightedSelectionConfig) {
    this.config = config;
    this.legoData = new Map();
  }

  /**
   * Calculate weight for a single LEGO
   *
   * Formula: base_weight * staleness_factor * struggle_factor * recency_factor
   *
   * @param legoId - LEGO identifier
   * @param data - Selection data for this LEGO
   * @returns Calculated weight (higher = more likely to be selected)
   */
  calculateWeight(legoId: string, data: LegoSelectionData): WeightCalculation {
    const now = new Date();

    // Base weight - starting point for all LEGOs
    const base_weight = 1.0;

    // Calculate time deltas
    const millisSincePractice = data.last_practice_at
      ? now.getTime() - data.last_practice_at.getTime()
      : Number.MAX_SAFE_INTEGER; // Never practiced = very stale

    const daysSincePractice = millisSincePractice / (1000 * 60 * 60 * 24);
    const minutesSincePractice = millisSincePractice / (1000 * 60);

    // Staleness factor - increases with time since practice
    // Formula: 1 + (days_since_practice * staleness_rate)
    // Never practiced items get massive staleness boost
    const staleness_factor = data.last_practice_at
      ? 1 + daysSincePractice * this.config.staleness_rate
      : 1 + 365 * this.config.staleness_rate; // Cap at 1 year equivalent

    // Struggle factor - increases with discontinuity count
    // Formula: 1 + (discontinuity_count * struggle_multiplier)
    const struggle_factor =
      1 + data.discontinuity_count * this.config.struggle_multiplier;

    // Recency factor - penalty for very recent practice
    // Prevents "hammering" the same LEGO repeatedly
    // Just practiced (0 min): factor = 0.5 (penalized)
    // Practiced recency_window (30 min) ago: factor = 1.0 (no penalty)
    // Never practiced: factor = 1.0 (no penalty)
    let recency_factor = 1.0;
    if (data.last_practice_at) {
      const timeFraction = Math.min(1, minutesSincePractice / this.config.recency_window);
      recency_factor = 0.5 + 0.5 * timeFraction;
    }

    // Final weight calculation
    const weight =
      base_weight * staleness_factor * struggle_factor * recency_factor;

    return {
      lego_id: legoId,
      weight,
      factors: {
        base_weight,
        staleness_factor,
        struggle_factor,
        recency_factor,
      },
      diagnostics: {
        days_since_practice: daysSincePractice,
        minutes_since_practice: minutesSincePractice,
      },
    };
  }

  /**
   * Select a LEGO from candidates using weighted random selection
   *
   * Algorithm:
   * 1. Calculate weight for each candidate
   * 2. Normalize weights to probabilities (sum = 1.0)
   * 3. Random selection weighted by probabilities
   *
   * @param candidates - Array of eligible LEGOs
   * @returns Selected candidate with weight and probability metadata
   * @throws Error if candidates array is empty
   */
  selectFromCandidates(candidates: LegoCandidate[]): LegoCandidate {
    if (candidates.length === 0) {
      throw new Error('Cannot select from empty candidates array');
    }

    // Special case: single candidate
    if (candidates.length === 1) {
      const selected = candidates[0];
      const calc = this.calculateWeight(selected.lego_id, selected.data);
      selected.weight = calc.weight;
      selected.probability = 1.0;
      return selected;
    }

    // Step 1: Calculate weights for all candidates
    const calculations = candidates.map((candidate) =>
      this.calculateWeight(candidate.lego_id, candidate.data)
    );

    // Step 2: Sum total weight
    const totalWeight = calculations.reduce((sum, calc) => sum + calc.weight, 0);

    // Prevent division by zero (should never happen with our formulas, but safety first)
    if (totalWeight === 0) {
      // Fall back to uniform random selection
      const randomIndex = Math.floor(Math.random() * candidates.length);
      const selected = candidates[randomIndex];
      selected.weight = 0;
      selected.probability = 1 / candidates.length;
      return selected;
    }

    // Step 3: Normalize to probabilities and attach to candidates
    candidates.forEach((candidate, i) => {
      candidate.weight = calculations[i].weight;
      candidate.probability = calculations[i].weight / totalWeight;
    });

    // Step 4: Weighted random selection
    // Generate random number [0, 1)
    const random = Math.random();
    let cumulativeProbability = 0;

    for (const candidate of candidates) {
      cumulativeProbability += candidate.probability!;
      if (random < cumulativeProbability) {
        return candidate;
      }
    }

    // Fallback to last candidate (should only happen due to floating point rounding)
    return candidates[candidates.length - 1];
  }

  /**
   * Update data after a LEGO is practiced
   *
   * @param legoId - LEGO that was just practiced
   */
  updateAfterPractice(legoId: string): void {
    const data = this.legoData.get(legoId) || {
      last_practice_at: null,
      discontinuity_count: 0,
    };

    data.last_practice_at = new Date();

    this.legoData.set(legoId, data);
  }

  /**
   * Record a discontinuity for a LEGO
   *
   * Called when AdaptationEngine detects a pattern break (spike, hesitation, etc.)
   *
   * @param legoId - LEGO that had a discontinuity
   */
  recordDiscontinuity(legoId: string): void {
    const data = this.legoData.get(legoId) || {
      last_practice_at: null,
      discontinuity_count: 0,
    };

    data.discontinuity_count++;

    this.legoData.set(legoId, data);
  }

  /**
   * Get selection data for a LEGO
   *
   * @param legoId - LEGO identifier
   * @returns Selection data (or defaults if not tracked)
   */
  getLegoData(legoId: string): LegoSelectionData {
    return (
      this.legoData.get(legoId) || {
        last_practice_at: null,
        discontinuity_count: 0,
      }
    );
  }

  /**
   * Set selection data for a LEGO (useful for initialization from persistence)
   *
   * @param legoId - LEGO identifier
   * @param data - Selection data to set
   */
  setLegoData(legoId: string, data: LegoSelectionData): void {
    this.legoData.set(legoId, data);
  }

  /**
   * Get all tracked LEGO data (for persistence)
   */
  getAllLegoData(): Map<string, LegoSelectionData> {
    return new Map(this.legoData);
  }

  /**
   * Clear all LEGO data (useful for testing or session reset)
   */
  clearAllData(): void {
    this.legoData.clear();
  }

  /**
   * Reset data for a specific LEGO
   */
  resetLego(legoId: string): void {
    this.legoData.delete(legoId);
  }

  /**
   * Initialize a new LEGO with default data
   */
  initializeLego(legoId: string): void {
    if (!this.legoData.has(legoId)) {
      this.legoData.set(legoId, {
        last_practice_at: null,
        discontinuity_count: 0,
      });
    }
  }

  /**
   * Update configuration
   *
   * @param config - Partial config to merge with existing
   */
  updateConfig(config: Partial<WeightedSelectionConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): WeightedSelectionConfig {
    return { ...this.config };
  }

  /**
   * Decay discontinuity counts over time
   *
   * Optional method to gradually reduce discontinuity_count for LEGOs
   * that haven't been practiced in a while (prevents permanent penalty).
   *
   * Suggested usage: call periodically (e.g., once per session start)
   *
   * @param daysSinceLastPractice - Threshold in days
   * @param decayAmount - How much to reduce discontinuity_count (default: 1)
   */
  decayDiscontinuityCounts(
    daysSinceLastPractice: number = 7,
    decayAmount: number = 1
  ): void {
    const now = new Date();
    const thresholdMillis = daysSinceLastPractice * 24 * 60 * 60 * 1000;

    this.legoData.forEach((data, legoId) => {
      if (data.last_practice_at) {
        const millisSince = now.getTime() - data.last_practice_at.getTime();
        if (
          millisSince > thresholdMillis &&
          data.discontinuity_count > 0
        ) {
          data.discontinuity_count = Math.max(
            0,
            data.discontinuity_count - decayAmount
          );
          this.legoData.set(legoId, data);
        }
      }
    });
  }
}

// ============================================
// FACTORY FUNCTION
// ============================================

/**
 * Create a WeightedSelector with default configuration
 */
export function createWeightedSelector(
  config?: Partial<WeightedSelectionConfig>
): WeightedSelector {
  const defaultConfig: WeightedSelectionConfig = {
    staleness_rate: 0.1,
    struggle_multiplier: 0.5,
    recency_window: 30,
  };

  return new WeightedSelector({ ...defaultConfig, ...config });
}
