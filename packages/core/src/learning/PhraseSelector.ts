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
  LegoPair,
  AudioRef,
} from '../data/types';

// ============================================
// LEGO CHARACTER VALIDATION
// ============================================

/**
 * Validates that a phrase contains ALL characters from the LEGO target.
 *
 * This ensures practice phrases actually reinforce the LEGO being learned.
 * For CJK languages (Chinese, Japanese, Korean), this checks that every
 * character in the LEGO appears in the phrase. For alphabetic languages,
 * this is less critical but still enforced.
 *
 * @param phraseTarget - The target text of the practice phrase
 * @param legoTarget - The target text of the LEGO
 * @returns true if phrase contains all LEGO characters
 *
 * @example
 * // Japanese: LEGO "日本語" in phrase "日本語を勉強します" = true
 * phraseContainsLegoChars("日本語を勉強します", "日本語") // true
 *
 * // Japanese: LEGO "食べる" NOT fully in phrase "食事" = false
 * phraseContainsLegoChars("食事", "食べる") // false (missing べ, る)
 */
export function phraseContainsLegoChars(
  phraseTarget: string,
  legoTarget: string
): boolean {
  if (!phraseTarget || !legoTarget) return false;

  // Remove whitespace and punctuation from LEGO target to get meaningful chars
  // Using Unicode property escapes for comprehensive punctuation handling
  const legoChars = new Set(legoTarget.replace(/[\s\p{P}]/gu, '').split(''));

  // Check that every LEGO character appears in the phrase
  for (const char of legoChars) {
    if (!phraseTarget.includes(char)) {
      return false;
    }
  }

  return true;
}

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
 * Creates a ClassifiedBasket from raw phrase data.
 *
 * Classification uses `phraseRole` when available (new database column),
 * falling back to `phraseType` for backwards compatibility.
 *
 * ROUND structure mapping:
 * - Components: NOT played to learners (internal only)
 * - BUILD (debut_phrases): 'build' role phrases + 'use' role phrases (up to 7)
 * - CONSOLIDATE (eternal_phrases): 'use' role phrases
 *
 * All practice phrases are validated to contain ALL characters from the LEGO target.
 */
export function classifyBasket(
  legoId: string,
  lego: LegoPair,
  phrases: PracticePhrase[],
  introductionAudio: AudioRef | null = null
): ClassifiedBasket {
  const components: PracticePhrase[] = [];
  let debut: PracticePhrase | null = null;
  const buildPhrases: PracticePhrase[] = [];  // BUILD phase (from 'build' role)
  const usePhrases: PracticePhrase[] = [];    // REVIEW/CONSOLIDATE (from 'use' role)

  const legoTarget = lego?.lego?.target || '';

  for (const phrase of phrases) {
    // Use phraseRole if available (new), otherwise fall back to phraseType (legacy)
    const role = phrase.phraseRole || mapPhraseTypeToRole(phrase.phraseType);

    switch (role) {
      case 'component':
        // Components are NOT played to learners, but we still collect them
        // for backwards compatibility and potential future use
        components.push(phrase);
        break;

      case 'build':
        // BUILD phrases: validate they contain all LEGO characters
        if (phraseContainsLegoChars(phrase.phrase.target, legoTarget)) {
          buildPhrases.push(phrase);
        }
        break;

      case 'use':
        // USE phrases: validate they contain all LEGO characters
        if (phraseContainsLegoChars(phrase.phrase.target, legoTarget)) {
          usePhrases.push(phrase);
        }
        break;
    }

    // Also check for debut phrase (the LEGO itself)
    if (phrase.phraseType === 'debut' && !debut) {
      debut = phrase;
    }
  }

  // BUILD phase draws from BOTH build AND use role phrases (up to 7 total)
  // This gives maximum flexibility when one pool is limited
  const debutPhrases = [...buildPhrases, ...usePhrases];

  // Sort by target text character length (cognitive load proxy)
  // Character count works better than word count across all languages
  debutPhrases.sort((a, b) => a.phrase.target.length - b.phrase.target.length);

  // CONSOLIDATE uses the same pool (eternal_phrases)
  // Can reuse BUILD phrases because REVIEW phase provides separation
  const eternalPhrases = [...buildPhrases, ...usePhrases];
  eternalPhrases.sort((a, b) => a.phrase.target.length - b.phrase.target.length);

  // If no explicit debut phrase, create one from the LEGO itself
  if (!debut && lego) {
    debut = {
      id: `${legoId}_debut`,
      phraseType: 'debut',
      phrase: lego.lego,
      audioRefs: lego.audioRefs,
      wordCount: lego.lego.target.split(/\s+/).length,
      containsLegos: [legoId],
    };
  }

  return {
    lego_id: legoId,
    components,
    debut,
    debut_phrases: debutPhrases,
    eternal_phrases: eternalPhrases,
    introduction_audio: introductionAudio,
  };
}

/**
 * Maps legacy phraseType to new phraseRole for backwards compatibility.
 */
function mapPhraseTypeToRole(phraseType: PracticePhrase['phraseType']): 'component' | 'build' | 'use' {
  switch (phraseType) {
    case 'component':
      return 'component';
    case 'debut':
      // Debut phrases (not the LEGO debut itself) are BUILD phrases
      return 'build';
    case 'practice':
    case 'eternal':
      // Practice and eternal are USE phrases
      return 'use';
    default:
      return 'use';
  }
}

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
 * Gets the next component for M-type LEGO breakdown.
 * Returns null when all components have been practiced.
 */
export function selectComponent(
  basket: ClassifiedBasket,
  componentIndex: number
): PracticePhrase | null {
  if (componentIndex < basket.components.length) {
    return basket.components[componentIndex];
  }
  return null;
}

/**
 * Initializes the eternal urn for a LEGO.
 * Shuffles all eternal phrase IDs for random-without-replacement selection.
 */
export function initializeEternalUrn(
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

/**
 * Gets the count of eternal phrases.
 */
export function getEternalPhraseCount(basket: ClassifiedBasket): number {
  return basket.eternal_phrases.length;
}

/**
 * Gets the count of components (for M-type LEGOs).
 */
export function getComponentCount(basket: ClassifiedBasket): number {
  return basket.components.length;
}

/**
 * Checks if the basket has enough variety for good spaced rep.
 * At least 3 eternal phrases recommended for variety.
 */
export function hasAdequateVariety(
  basket: ClassifiedBasket,
  minEternals: number = 3
): boolean {
  return basket.eternal_phrases.length >= minEternals;
}
