/**
 * RoundEngine - Orchestrates the ROUND-based introduction sequence for a LEGO
 *
 * A ROUND is the complete learning progression for one LEGO:
 * 1. INTRO - Introduction Audio ("The Spanish for X is...")
 * 2. LEGO - The LEGO phrase itself (debut)
 * 3. BUILD - Up to 7 practice phrases (builds confidence with the new LEGO)
 * 4. REVIEW - Interleaved spaced rep (USE phrases from older LEGOs)
 * 5. CONSOLIDATE - 2 phrases before next Round
 *
 * NOTE: Components are NOT played to learners - they are internal building blocks
 * used for content creation, not delivery.
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
  selectEternalPhrase,
  getDebutPhraseCount,
  type PhraseSelectorConfig,
} from './PhraseSelector';

// ============================================
// ROUND ENGINE CONSTANTS
// ============================================

/** Maximum BUILD phrases per ROUND (up to 7, drawing from build and use roles) */
const MAX_BUILD_PHRASES = 7;

/** Maximum REVIEW (spaced rep) items per ROUND */
const MAX_SPACED_REP_PHRASES = 12;

/** Number of CONSOLIDATE phrases at end of ROUND */
const CONSOLIDATE_COUNT = 2;

// ============================================
// ROUND ENGINE CONFIGURATION
// ============================================

export interface RoundEngineConfig {
  /** How many spaced rep items to interleave during a ROUND (default: 12 max) */
  spacedRepInterleaveCount: number;
  /** How many consolidation phrases at end of ROUND (default: 2) */
  consolidationCount: number;
  /** Maximum BUILD phrases per ROUND (default: 7) */
  maxBuildPhrases: number;
  /** Phrase selector config */
  phraseSelector: PhraseSelectorConfig;
}

const DEFAULT_CONFIG: RoundEngineConfig = {
  spacedRepInterleaveCount: MAX_SPACED_REP_PHRASES,
  consolidationCount: CONSOLIDATE_COUNT,
  maxBuildPhrases: MAX_BUILD_PHRASES,
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
      return handleDebutPhrases(lego, seed, basket, progress, roundState, threadId, config);

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
 * Phase 2: Components - ALWAYS SKIPPED
 *
 * Components are internal building blocks used for content creation, NOT delivery.
 * They are never played to the learner. This phase immediately advances to debut_lego.
 */
function handleComponents(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  _threadId: number,
  config: RoundEngineConfig
): RoundResult {
  // Components are NOT played to learners - always skip to debut_lego
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
 * Phase 4: BUILD Phrases
 * Practice phrases that reinforce the new LEGO (up to 7 phrases).
 * Draws from both 'build' and 'use' role phrases for the current LEGO.
 */
function handleDebutPhrases(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  threadId: number,
  config: RoundEngineConfig = DEFAULT_CONFIG
): RoundResult {
  // Check if we've hit the max BUILD phrases cap
  // introduction_index starts at 1 after debut_lego phase, so BUILD count = index - 1
  const buildPhraseCount = progress.introduction_index - 1;
  if (buildPhraseCount >= config.maxBuildPhrases) {
    // Already at max BUILD phrases, advance to REVIEW (spaced_rep)
    return getNextRoundItem(
      lego,
      seed,
      basket,
      progress,
      advancePhase(roundState, basket, lego),
      config
    );
  }

  // Select next BUILD phrase (progress.introduction_index tracks position)
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

  // All BUILD phrases done (or less than 7 available), advance to REVIEW
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
 * Phase 5: REVIEW (Spaced Repetition)
 *
 * Reviews older LEGOs using USE-role phrases only.
 * The actual review items come from TripleHelix (Fibonacci-based scheduling).
 * Max 12 REVIEW items per ROUND.
 */
function handleSpacedRep(
  lego: LegoPair,
  seed: SeedPair,
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  _threadId: number
): RoundResult {
  // Check if we need more REVIEW items
  if (roundState.spaced_rep_completed < roundState.spaced_rep_target) {
    // Signal that TripleHelix should provide a REVIEW item (USE phrases from older LEGOs)
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

  // REVIEW complete, advance to CONSOLIDATE
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
 * Phase 6: CONSOLIDATE
 *
 * Wraps up the ROUND with 2 practice phrases before moving to the next LEGO.
 * Can reuse BUILD phrases since REVIEW phase provides separation.
 * Uses eternal_phrases pool which includes phrases from both build and use roles.
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
 *
 * Phase order: INTRO → LEGO → BUILD → REVIEW → CONSOLIDATE
 *
 * NOTE: Components phase is always skipped - components are internal building
 * blocks for content creation, not for learner delivery.
 */
function advancePhase(
  roundState: RoundState,
  _basket: ClassifiedBasket,
  _lego: LegoPair
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

  // ALWAYS skip components - they are NOT played to learners
  // Components are internal building blocks for content creation only
  if (nextPhase === 'components') {
    nextPhase = 'debut_lego';
  }

  // Note: spaced_rep is always entered - TripleHelix decides if there are
  // older LEGOs to review. If none, it returns 0 items.

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
 *
 * Counts: INTRO (1) + LEGO (1) + BUILD (up to 7) + REVIEW (up to 12) + CONSOLIDATE (2)
 * Components are NOT counted - they're skipped.
 */
export function getRemainingRoundItems(
  basket: ClassifiedBasket,
  progress: LegoProgress,
  roundState: RoundState,
  config: RoundEngineConfig = DEFAULT_CONFIG
): number {
  let remaining = 0;

  // Calculate actual BUILD phrase count (capped at maxBuildPhrases)
  const availableBuildPhrases = Math.min(
    getDebutPhraseCount(basket),
    config.maxBuildPhrases
  );

  // Count based on current phase
  switch (roundState.current_phase) {
    case 'intro_audio':
      if (!progress.introduction_played) remaining += 1;
      // Fall through to count remaining phases (NO components)
      remaining += 1; // debut_lego (LEGO)
      remaining += availableBuildPhrases; // BUILD (capped)
      remaining += config.spacedRepInterleaveCount; // REVIEW
      remaining += config.consolidationCount; // CONSOLIDATE
      break;

    case 'components':
      // Components are always skipped, so this falls through to debut_lego
      remaining += 1; // debut_lego (LEGO)
      remaining += availableBuildPhrases; // BUILD
      remaining += config.spacedRepInterleaveCount; // REVIEW
      remaining += config.consolidationCount; // CONSOLIDATE
      break;

    case 'debut_lego':
      remaining += 1; // LEGO itself
      remaining += availableBuildPhrases; // BUILD
      remaining += config.spacedRepInterleaveCount; // REVIEW
      remaining += config.consolidationCount; // CONSOLIDATE
      break;

    case 'debut_phrases': {
      // BUILD phrases remaining (capped)
      const buildCompleted = progress.introduction_index - 1;
      remaining += Math.max(0, availableBuildPhrases - buildCompleted);
      remaining += config.spacedRepInterleaveCount; // REVIEW
      remaining += config.consolidationCount; // CONSOLIDATE
      break;
    }

    case 'spaced_rep':
      // REVIEW items remaining
      remaining += roundState.spaced_rep_target - roundState.spaced_rep_completed;
      remaining += config.consolidationCount; // CONSOLIDATE
      break;

    case 'consolidation':
      // CONSOLIDATE items remaining
      remaining += roundState.consolidation_remaining;
      break;
  }

  return remaining;
}
