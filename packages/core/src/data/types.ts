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

export type PhraseType = 'component' | 'debut' | 'practice' | 'eternal';

export interface PracticePhrase {
  /** Unique identifier */
  id: string;
  /** Type of phrase in the learning sequence */
  phraseType: PhraseType;
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
