/**
 * Core data types for SSi Language Learning
 */

// ============================================
// AUDIO REFERENCES
// ============================================

export interface AudioRef {
  /** Unique identifier for the audio file */
  id: string;
  /** URL or path to the audio file */
  url: string;
  /** Duration in milliseconds (if known) */
  duration_ms?: number;
}

// ============================================
// LANGUAGE PAIRS
// ============================================

export interface LanguagePair {
  /** Known language text (language learner already speaks) */
  known: string;
  /** Target language text (language being learned) */
  target: string;
}

export interface AudioLanguagePair {
  /** Known language audio */
  known: AudioRef;
  /** Target language audio - two voices for variety */
  target: {
    voice1: AudioRef;
    voice2: AudioRef;
  };
}

// ============================================
// LEGO PAIRS
// ============================================

export type LegoType = 'A' | 'M';  // Atomic or Molecular

export interface LegoPair {
  /** Unique identifier (e.g., "S0003L01") */
  id: string;
  /** Type: A = Atomic (cannot split), M = Molecular (can split) */
  type: LegoType;
  /** Whether this LEGO is new to the learner in this SEED context */
  new: boolean;
  /** The LEGO text pair */
  lego: LanguagePair;
  /** Components for M-type LEGOs (breakdown parts) */
  components?: LanguagePair[];
  /** Audio references */
  audioRefs: AudioLanguagePair;
}

// ============================================
// SEED PAIRS
// ============================================

export interface SeedPair {
  /** Unique identifier (e.g., "S0003") */
  seed_id: string;
  /** The full sentence pair */
  seed_pair: LanguagePair;
  /** LEGOs that build up to this SEED */
  legos: LegoPair[];
  /** Audio for the full SEED */
  audioRefs?: AudioLanguagePair;
}

// ============================================
// PRACTICE PHRASES
// ============================================

/** Legacy phrase type classification */
export type PhraseType = 'component' | 'debut' | 'practice' | 'eternal';

/**
 * Phrase role determines how phrases are used in the ROUND structure:
 * - 'component': Internal building blocks (NOT played to learners)
 * - 'build': Practice phrases for BUILD phase (drilling the new LEGO)
 * - 'use': Practice phrases for REVIEW (older LEGOs) and CONSOLIDATE
 */
export type PhraseRole = 'component' | 'build' | 'use';

export interface PracticePhrase {
  /** Unique identifier */
  id: string;
  /** Type of phrase in the learning sequence (legacy) */
  phraseType: PhraseType;
  /** Role of phrase in ROUND structure (new - takes precedence if present) */
  phraseRole?: PhraseRole;
  /** The phrase text pair */
  phrase: LanguagePair;
  /** Audio references */
  audioRefs: AudioLanguagePair;
  /** Word count (for sorting) */
  wordCount: number;
  /** IDs of LEGOs reinforced in this phrase */
  containsLegos: string[];
}

// ============================================
// COURSE MANIFEST
// ============================================

export interface CourseManifest {
  /** Course identifier */
  course_id: string;
  /** Course title */
  title: string;
  /** Known language code (e.g., "en", "ar", "cy") */
  known_language: string;
  /** Target language code (e.g., "es", "zh", "ga") */
  target_language: string;
  /** Version for cache invalidation */
  version: string;
  /** All SEEDs in the course */
  seeds: SeedPair[];
  /** Total audio file count */
  audio_count: number;
  /** Estimated total duration in hours */
  estimated_hours: number;
}

// ============================================
// LEARNER PROGRESS
// ============================================

export interface LegoProgress {
  /** LEGO identifier */
  lego_id: string;
  /** Course identifier */
  course_id: string;
  /** Thread this LEGO is in (1, 2, or 3) */
  thread_id: number;
  /** Position in Fibonacci sequence */
  fibonacci_position: number;
  /** Items until next practice */
  skip_number: number;
  /** How many of initial reps completed */
  reps_completed: number;
  /** Whether this LEGO is retired (mastered) */
  is_retired: boolean;
  /** When last practiced */
  last_practiced_at: Date | null;

  // ROUND tracking
  /** Whether introduction audio has been played */
  introduction_played: boolean;
  /** Current position in introduction sequence (phases 2-4) */
  introduction_index: number;
  /** Whether the full ROUND is complete (ready for spaced rep) */
  introduction_complete: boolean;

  // Eternal selection state (for spaced rep variety)
  /** Remaining phrase IDs in the urn (for random_urn selection) */
  eternal_urn: string[];
  /** Last eternal phrase ID used (for max_distance mode) */
  last_eternal_phrase_id: string | null;
}

export interface SeedProgress {
  /** SEED identifier */
  seed_id: string;
  /** Course identifier */
  course_id: string;
  /** Thread this SEED is in (1, 2, or 3) */
  thread_id: number;
  /** Whether all LEGOs have been introduced */
  is_introduced: boolean;
  /** When introduced */
  introduced_at: Date | null;
}

export interface HelixState {
  /** Active thread (1, 2, or 3) */
  active_thread: number;
  /** State for each thread */
  threads: {
    [threadId: number]: {
      seedOrder: string[];
      currentSeedId: string | null;
      currentLegoIndex: number;
    };
  };
  /** Injected content by subject */
  injected_content: Record<string, string[]>;
}

// ============================================
// LEARNING ITEMS (what the player receives)
// ============================================

export interface LearningItem {
  /** The LEGO being practiced */
  lego: LegoPair;
  /** The specific phrase for this practice */
  phrase: PracticePhrase;
  /** Parent SEED (for context) */
  seed: SeedPair;
  /** Thread this came from */
  thread_id: number;
  /** Current mode */
  mode: LearningMode;
}

export type LearningMode =
  | 'introduction'  // First time seeing this LEGO
  | 'practice'      // Regular practice with mixed phrases
  | 'review'        // Spaced repetition review
  | 'breakdown'     // Component breakdown for M-types
  | 'buildup';      // Building back up after breakdown

// ============================================
// CLASSIFIED BASKET (for ROUND phrase selection)
// ============================================

/**
 * A basket of phrases organized by cognitive load (syllable count).
 * Used by PhraseSelector for intelligent phrase ordering.
 */
export interface ClassifiedBasket {
  /** LEGO ID this basket is for */
  lego_id: string;
  /** Components (for M-type LEGOs only) - individual parts */
  components: PracticePhrase[];
  /** The LEGO debut phrase (the LEGO itself in minimal context) */
  debut: PracticePhrase | null;
  /** Debut phrases sorted by syllable count (easiest first) */
  debut_phrases: PracticePhrase[];
  /** Eternal phrases for ongoing spaced rep (varied contexts) */
  eternal_phrases: PracticePhrase[];
  /** Introduction audio ref ("The Spanish for X is...") */
  introduction_audio: AudioRef | null;
}

/**
 * Current state of a ROUND in progress.
 * A ROUND is the complete introduction sequence for one LEGO.
 *
 * ROUND structure: INTRO → LEGO → BUILD (×7) → REVIEW (×12 max) → CONSOLIDATE (×2)
 *
 * NOTE: Components phase exists for backwards compatibility but is ALWAYS SKIPPED.
 * Components are internal building blocks for content creation, not for learner delivery.
 */
export type RoundPhase =
  | 'intro_audio'      // INTRO: Play "The Spanish for X is..."
  | 'components'       // SKIPPED: Components are NOT played to learners
  | 'debut_lego'       // LEGO: Practice the LEGO phrase itself
  | 'debut_phrases'    // BUILD: Up to 7 practice phrases (from build + use roles)
  | 'spaced_rep'       // REVIEW: Spaced rep review using USE phrases from older LEGOs
  | 'consolidation';   // CONSOLIDATE: 2 phrases to wrap up the ROUND

export interface RoundState {
  /** LEGO being introduced */
  lego_id: string;
  /** Current phase in the ROUND */
  current_phase: RoundPhase;
  /** Position within current phase (for multi-item phases) */
  phase_index: number;
  /** How many spaced rep items to interleave */
  spaced_rep_target: number;
  /** How many spaced rep items completed */
  spaced_rep_completed: number;
  /** How many consolidation eternals remaining (usually 1-2) */
  consolidation_remaining: number;
}

/**
 * Default LegoProgress for a new LEGO
 */
export function createDefaultLegoProgress(legoId: string, courseId: string, threadId: number): LegoProgress {
  return {
    lego_id: legoId,
    course_id: courseId,
    thread_id: threadId,
    fibonacci_position: 0,
    skip_number: 1,
    reps_completed: 0,
    is_retired: false,
    last_practiced_at: null,
    // ROUND tracking
    introduction_played: false,
    introduction_index: 0,
    introduction_complete: false,
    // Eternal selection
    eternal_urn: [],
    last_eternal_phrase_id: null,
  };
}
