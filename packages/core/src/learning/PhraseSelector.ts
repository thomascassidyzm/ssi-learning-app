/**
 * PhraseSelector - Intelligent phrase selection for ROUND-based learning
 *
 * Handles:
 * - Classifying phrases into pools (components, debut/build, eternal/use)
 * - Selecting BUILD phrases in cognitive order (shortest first)
 * - Selecting eternal phrases via random urn (variety without repetition)
 * - LEGO character validation (ensures phrases contain all LEGO characters)
 *
 * @module learning/PhraseSelector
 */

import type {
  PracticePhrase,
  ClassifiedBasket,
  LegoProgress,
} from '../data/types';

// ============================================
// ETERNAL SELECTION MODES
// ============================================

export type EternalSelectionMode =
  | 'random_urn'     // Shuffle all eternals, draw without replacement until empty
  | 'sequential'     // Go through in order (for testing/debugging)
  | 'max_distance';  // Maximize distance since last use (memory-based)

// ============================================
// PHRASE SELECTOR
// ============================================

export interface PhraseSelectorConfig {
  /** How to select eternal phrases (default: random_urn) */
  eternalSelectionMode: EternalSelectionMode;
  /** Minimum eternals before repeating urn (default: 3) */
  minEternalsBeforeRepeat: number;
}

const DEFAULT_CONFIG: PhraseSelectorConfig = {
  eternalSelectionMode: 'random_urn',
  minEternalsBeforeRepeat: 3,
};

/**
 * Gets the next debut phrase in sequence.
 * Debut phrases are practiced in order (shortest to longest).
 */
export function selectDebutPhrase(
  basket: ClassifiedBasket,
  progress: LegoProgress
): PracticePhrase | null {
  // First, return the LEGO debut itself
  if (progress.introduction_index === 0 && basket.debut) {
    return basket.debut;
  }

  // Then return debut phrases in order
  const debutIndex = progress.introduction_index - 1; // -1 because index 0 is the debut itself
  if (debutIndex < basket.debut_phrases.length) {
    return basket.debut_phrases[debutIndex];
  }

  // No more debut phrases
  return null;
}

/**
 * Initializes the eternal urn for a LEGO.
 * Shuffles all eternal phrase IDs for random-without-replacement selection.
 * Internal helper for selectFromUrn (no external consumers).
 */
function initializeEternalUrn(
  basket: ClassifiedBasket,
  _progress: LegoProgress
): string[] {
  // Get all eternal phrase IDs
  const phraseIds = basket.eternal_phrases.map(p => p.id);

  // Fisher-Yates shuffle
  const shuffled = [...phraseIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Selects an eternal phrase using the configured selection mode.
 * Updates the progress urn state.
 */
export function selectEternalPhrase(
  basket: ClassifiedBasket,
  progress: LegoProgress,
  config: PhraseSelectorConfig = DEFAULT_CONFIG
): { phrase: PracticePhrase | null; updatedUrn: string[] } {
  if (basket.eternal_phrases.length === 0) {
    return { phrase: null, updatedUrn: [] };
  }

  switch (config.eternalSelectionMode) {
    case 'random_urn':
      return selectFromUrn(basket, progress);

    case 'sequential':
      return selectSequential(basket, progress);

    case 'max_distance':
      return selectMaxDistance(basket, progress);

    default:
      return selectFromUrn(basket, progress);
  }
}

/**
 * Random urn selection: draw without replacement until empty, then reshuffle.
 */
function selectFromUrn(
  basket: ClassifiedBasket,
  progress: LegoProgress
): { phrase: PracticePhrase | null; updatedUrn: string[] } {
  let urn = progress.eternal_urn;

  // If urn is empty or not initialized, refill it
  if (!urn || urn.length === 0) {
    urn = initializeEternalUrn(basket, progress);
  }

  // Draw from the urn
  const phraseId = urn[0];
  const updatedUrn = urn.slice(1);

  // Find the phrase
  const phrase = basket.eternal_phrases.find(p => p.id === phraseId) || null;

  return { phrase, updatedUrn };
}

/**
 * Sequential selection: go through phrases in order (for testing).
 */
function selectSequential(
  basket: ClassifiedBasket,
  progress: LegoProgress
): { phrase: PracticePhrase | null; updatedUrn: string[] } {
  // Use urn as a counter (just store remaining IDs)
  let urn = progress.eternal_urn;

  if (!urn || urn.length === 0) {
    // Initialize with all IDs in order
    urn = basket.eternal_phrases.map(p => p.id);
  }

  const phraseId = urn[0];
  const updatedUrn = urn.slice(1);
  const phrase = basket.eternal_phrases.find(p => p.id === phraseId) || null;

  return { phrase, updatedUrn };
}

/**
 * Max distance selection: pick the phrase used longest ago.
 */
function selectMaxDistance(
  basket: ClassifiedBasket,
  progress: LegoProgress
): { phrase: PracticePhrase | null; updatedUrn: string[] } {
  const lastUsed = progress.last_eternal_phrase_id;

  // If never used or only one phrase, just pick first
  if (!lastUsed || basket.eternal_phrases.length <= 1) {
    const phrase = basket.eternal_phrases[0] || null;
    return { phrase, updatedUrn: progress.eternal_urn };
  }

  // Find the phrase that's furthest from last used in the list
  const lastIndex = basket.eternal_phrases.findIndex(p => p.id === lastUsed);

  // Pick the one that's halfway around the list (maximizes distance)
  const halfwayIndex = (lastIndex + Math.floor(basket.eternal_phrases.length / 2)) % basket.eternal_phrases.length;
  const phrase = basket.eternal_phrases[halfwayIndex];

  return { phrase, updatedUrn: progress.eternal_urn };
}

/**
 * Gets the count of debut phrases (not including the debut itself).
 */
export function getDebutPhraseCount(basket: ClassifiedBasket): number {
  return basket.debut_phrases.length;
}
