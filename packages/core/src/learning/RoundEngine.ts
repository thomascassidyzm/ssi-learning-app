/**
 * RoundEngine - Orchestrates the ROUND-based introduction sequence for a LEGO
 *
 * A ROUND is the complete learning progression for one LEGO:
 * 1. Introduction Audio ("The Spanish for X is...")
 * 2. Components (M-type only - break down into parts)
 * 3. LEGO Debut (the LEGO phrase itself)
 * 4. Debut Phrases (shortest phrases first, build confidence)
 * 5. Interleaved Spaced Rep (review older LEGOs)
 * 6. Consolidation (1-2 eternals before next Round)
 *
 * The ROUND is orthogonal to CYCLE:
 * - CYCLE = HOW (delivery: PROMPT → PAUSE → VOICE_1 → VOICE_2)
 * - ROUND = WHAT (content: which phrases in which order)
 *
 * @module learning/RoundEngine
 */

import type {
  LearningItem,
  LegoPair,
  SeedPair,
  PracticePhrase,
  ClassifiedBasket,
  LegoProgress,
  RoundState,
  RoundPhase,
} from '../data/types';

import {
  selectDebutPhrase,
  selectComponent,
  selectEternalPhrase,
  getComponentCount,
  getDebutPhraseCount,
  type PhraseSelectorConfig,
} from './PhraseSelector';

// ============================================
// ROUND ENGINE CONFIGURATION
// ============================================

export interface RoundEngineConfig {
  /** How many spaced rep items to interleave during a ROUND (default: 3) */
  spacedRepInterleaveCount: number;
  /** How many consolidation eternals at end of ROUND (default: 2) */
  consolidationCount: number;
  /** Skip components for M-type LEGOs (default: false) */
  skipComponents: boolean;
  /** Phrase selector config */
  phraseSelector: PhraseSelectorConfig;
}

const DEFAULT_CONFIG: RoundEngineConfig = {
  spacedRepInterleaveCount: 3,
  consolidationCount: 2,
  skipComponents: false,
  phraseSelector: {
    eternalSelectionMode: 'random_urn',
    minEternalsBeforeRepeat: 3,
  },
};

// ============================================
// ROUND RESULT
// ============================================

export interface RoundResult {
  /** The learning item to practice (null if Round is complete) */
  item: LearningItem | null;
  /** Updated LEGO progress */
  updatedProgress: LegoProgress;
  /** Updated Round state */
  updatedRoundState: RoundState;
  /** Whether the Round is complete */
  roundComplete: boolean;
  /** Whether we need a spaced rep item from TripleHelix */
  needsSpacedRepItem: boolean;
  /** Whether this is introduction audio (special handling needed) */
  isIntroductionAudio: boolean;
}

// ============================================
// ROUND ENGINE
// ============================================

/**
 * Creates initial RoundState for a new LEGO.
 */
export function createRoundState(legoId: string, config: RoundEngineConfig = DEFAULT_CONFIG): RoundState {
  return {
    lego_id: legoId,
    current_phase: 'intro_audio',
    phase_index: 0,
    spaced_rep_target: config.spacedRepInterleaveCount,
    spaced_rep_completed: 0,
    consolidation_remaining: config.consolidationCount,
  };
}

/**
 * Gets the next item in the ROUND sequence.
 *
 * @param lego - The LEGO being introduced
 * @param seed - Parent SEED for context
 * @param basket - Classified phrase basket
 * @param progress - Current learner progress for this LEGO
 * @param roundState - Current state of the Round
 * @param config - Engine configuration
 */
export function getNextRoundItem(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  config: RoundEngineConfig = DEFAULT_CONFIG
): RoundResult {
  const threadId = progress.thread_id;

  switch (roundState.current_phase) {
    case 'intro_audio':
      return handleIntroAudio(lego, seed, basket, progress, roundState, threadId);

    case 'components':
      return handleComponents(lego, seed, basket, progress, roundState, threadId, config);

    case 'debut_lego':
      return handleDebutLego(lego, seed, basket, progress, roundState, threadId);

    case 'debut_phrases':
      return handleDebutPhrases(lego, seed, basket, progress, roundState, threadId);

    case 'spaced_rep':
      return handleSpacedRep(lego, seed, basket, progress, roundState, threadId);

    case 'consolidation':
      return handleConsolidation(lego, seed, basket, progress, roundState, threadId, config);

    default:
      // Round complete
      return createCompleteResult(progress, roundState);
  }
}

/**
 * Phase 1: Introduction Audio
 * Plays "The Spanish for X is..."
 */
function handleIntroAudio(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  threadId: number
): RoundResult {
  // If we have introduction audio, mark it for special handling
  if (basket.introduction_audio && !progress.introduction_played) {
    // Create a special "introduction audio" item
    // The player will handle this differently (just play audio, no cycle)
    const introPhrase: PracticePhrase = {
      id: `${lego.id}_intro`,
      phraseType: 'debut', // Technically it's an intro, but this works
      phrase: lego.lego,
      audioRefs: lego.audioRefs, // We'll use introduction_audio separately
      wordCount: 0,
      containsLegos: [lego.id],
    };

    return {
      item: {
        lego,
        phrase: introPhrase,
        seed,
        thread_id: threadId,
        mode: 'introduction',
      },
      updatedProgress: {
        ...progress,
        introduction_played: true,
      },
      updatedRoundState: advancePhase(roundState, basket, lego),
      roundComplete: false,
      needsSpacedRepItem: false,
      isIntroductionAudio: true,
    };
  }

  // No introduction audio or already played, advance to next phase
  return getNextRoundItem(
    lego,
    seed,
    basket,
    { ...progress, introduction_played: true },
    advancePhase(roundState, basket, lego),
    DEFAULT_CONFIG
  );
}

/**
 * Phase 2: Components (M-type only)
 * Practice individual parts before the whole
 */
function handleComponents(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  threadId: number,
  config: RoundEngineConfig
): RoundResult {
  // Skip if not M-type or config says skip
  if (lego.type !== 'M' || config.skipComponents || basket.components.length === 0) {
    return getNextRoundItem(
      lego,
      seed,
      basket,
      progress,
      advancePhase(roundState, basket, lego),
      config
    );
  }

  const component = selectComponent(basket, roundState.phase_index);

  if (component) {
    return {
      item: {
        lego,
        phrase: component,
        seed,
        thread_id: threadId,
        mode: 'breakdown',
      },
      updatedProgress: progress,
      updatedRoundState: {
        ...roundState,
        phase_index: roundState.phase_index + 1,
      },
      roundComplete: false,
      needsSpacedRepItem: false,
      isIntroductionAudio: false,
    };
  }

  // All components done, advance to next phase
  return getNextRoundItem(
    lego,
    seed,
    basket,
    progress,
    advancePhase(roundState, basket, lego),
    config
  );
}

/**
 * Phase 3: LEGO Debut
 * Practice the LEGO phrase itself
 */
function handleDebutLego(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  threadId: number
): RoundResult {
  if (basket.debut) {
    return {
      item: {
        lego,
        phrase: basket.debut,
        seed,
        thread_id: threadId,
        mode: 'introduction',
      },
      updatedProgress: {
        ...progress,
        introduction_index: 1, // Move past debut
      },
      updatedRoundState: advancePhase(roundState, basket, lego),
      roundComplete: false,
      needsSpacedRepItem: false,
      isIntroductionAudio: false,
    };
  }

  // No debut phrase (shouldn't happen), advance
  return getNextRoundItem(
    lego,
    seed,
    basket,
    progress,
    advancePhase(roundState, basket, lego),
    DEFAULT_CONFIG
  );
}

/**
 * Phase 4: Debut Phrases
 * Practice short phrases (builds confidence)
 */
function handleDebutPhrases(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  threadId: number
): RoundResult {
  // Select next debut phrase (progress.introduction_index tracks position)
  const phrase = selectDebutPhrase(basket, progress);

  if (phrase) {
    return {
      item: {
        lego,
        phrase,
        seed,
        thread_id: threadId,
        mode: 'introduction',
      },
      updatedProgress: {
        ...progress,
        introduction_index: progress.introduction_index + 1,
      },
      updatedRoundState: roundState,
      roundComplete: false,
      needsSpacedRepItem: false,
      isIntroductionAudio: false,
    };
  }

  // All debut phrases done, advance to spaced rep
  return getNextRoundItem(
    lego,
    seed,
    basket,
    progress,
    advancePhase(roundState, basket, lego),
    DEFAULT_CONFIG
  );
}

/**
 * Phase 5: Interleaved Spaced Rep
 * Review older LEGOs (the actual review items come from TripleHelix)
 */
function handleSpacedRep(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  _threadId: number
): RoundResult {
  // Check if we need more spaced rep items
  if (roundState.spaced_rep_completed < roundState.spaced_rep_target) {
    // Signal that TripleHelix should provide a spaced rep item
    return {
      item: null, // TripleHelix will provide the item
      updatedProgress: progress,
      updatedRoundState: {
        ...roundState,
        spaced_rep_completed: roundState.spaced_rep_completed + 1,
      },
      roundComplete: false,
      needsSpacedRepItem: true,
      isIntroductionAudio: false,
    };
  }

  // Spaced rep complete, advance to consolidation
  return getNextRoundItem(
    lego,
    seed,
    basket,
    progress,
    advancePhase(roundState, basket, lego),
    DEFAULT_CONFIG
  );
}

/**
 * Phase 6: Consolidation
 * Practice eternal phrases before moving to next Round
 */
function handleConsolidation(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  threadId: number,
  config: RoundEngineConfig
): RoundResult {
  if (roundState.consolidation_remaining > 0 && basket.eternal_phrases.length > 0) {
    // Select an eternal phrase
    const { phrase, updatedUrn } = selectEternalPhrase(basket, progress, config.phraseSelector);

    if (phrase) {
      return {
        item: {
          lego,
          phrase,
          seed,
          thread_id: threadId,
          mode: 'practice',
        },
        updatedProgress: {
          ...progress,
          eternal_urn: updatedUrn,
          last_eternal_phrase_id: phrase.id,
        },
        updatedRoundState: {
          ...roundState,
          consolidation_remaining: roundState.consolidation_remaining - 1,
        },
        roundComplete: false,
        needsSpacedRepItem: false,
        isIntroductionAudio: false,
      };
    }
  }

  // Consolidation complete, Round is done!
  return createCompleteResult(progress, roundState);
}

/**
 * Creates the result for a completed Round.
 */
function createCompleteResult(progress: LegoProgress, roundState: RoundState): RoundResult {
  return {
    item: null,
    updatedProgress: {
      ...progress,
      introduction_complete: true,
    },
    updatedRoundState: roundState,
    roundComplete: true,
    needsSpacedRepItem: false,
    isIntroductionAudio: false,
  };
}

/**
 * Advances to the next phase in the Round.
 */
function advancePhase(
  roundState: RoundState,
  basket: ClassifiedBasket,
  lego: LegoPair
): RoundState {
  const phaseOrder: RoundPhase[] = [
    'intro_audio',
    'components',
    'debut_lego',
    'debut_phrases',
    'spaced_rep',
    'consolidation',
  ];

  const currentIndex = phaseOrder.indexOf(roundState.current_phase);
  let nextPhase = phaseOrder[currentIndex + 1];

  // Skip components if not M-type
  if (nextPhase === 'components' && (lego.type !== 'M' || basket.components.length === 0)) {
    nextPhase = 'debut_lego';
  }

  // Skip spaced_rep if there are no older LEGOs to review (handled by TripleHelix)
  // We'll still signal needsSpacedRepItem and let TripleHelix decide

  return {
    ...roundState,
    current_phase: nextPhase || 'consolidation',
    phase_index: 0, // Reset for new phase
  };
}

/**
 * Checks if a LEGO needs a Round (introduction not complete).
 */
export function needsRound(progress: LegoProgress): boolean {
  return !progress.introduction_complete;
}

/**
 * Calculates how many items remain in the current Round.
 */
export function getRemainingRoundItems(
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  config: RoundEngineConfig = DEFAULT_CONFIG
): number {
  let remaining = 0;

  // Count based on current phase
  switch (roundState.current_phase) {
    case 'intro_audio':
      if (!progress.introduction_played) remaining += 1;
      // Fall through to count remaining phases
      remaining += getComponentCount(basket);
      remaining += 1; // debut_lego
      remaining += getDebutPhraseCount(basket);
      remaining += config.spacedRepInterleaveCount;
      remaining += config.consolidationCount;
      break;

    case 'components':
      remaining += basket.components.length - roundState.phase_index;
      remaining += 1; // debut_lego
      remaining += getDebutPhraseCount(basket);
      remaining += config.spacedRepInterleaveCount;
      remaining += config.consolidationCount;
      break;

    case 'debut_lego':
      remaining += 1;
      remaining += getDebutPhraseCount(basket);
      remaining += config.spacedRepInterleaveCount;
      remaining += config.consolidationCount;
      break;

    case 'debut_phrases':
      remaining += basket.debut_phrases.length - (progress.introduction_index - 1);
      remaining += config.spacedRepInterleaveCount;
      remaining += config.consolidationCount;
      break;

    case 'spaced_rep':
      remaining += roundState.spaced_rep_target - roundState.spaced_rep_completed;
      remaining += config.consolidationCount;
      break;

    case 'consolidation':
      remaining += roundState.consolidation_remaining;
      break;
  }

  return remaining;
}
