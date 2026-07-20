/**
 * Database types and conversion utilities
 *
 * Maps database rows (from Supabase) to core application types.
 * Table naming convention:
 * - course_* prefix for course-specific data (course_seeds, course_legos, course_practice_phrases)
 * - No prefix for global data (audio_samples, voices)
 */

import type {
  AudioRef,
} from './types';

// ============================================
// DATABASE ROW TYPES (from Dashboard)
// ============================================

/**
 * Seed row from `course_seeds` table
 * Note: Audio is resolved by text lookup, not stored UUIDs
 */
export interface SeedRow {
  id: string;  // UUID primary key
  seed_id: string;  // Generated: 'S0001', 'S0002', etc.
  course_code: string;
  seed_number: number;  // Position in learning sequence
  known_text: string;
  target_text: string;
  status: 'draft' | 'released' | 'deprecated';
  release_batch?: number;
  version: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * LEGO row from `course_legos` table
 * Note: Audio is resolved by text lookup, not stored UUIDs
 */
export interface LegoRow {
  id: string;  // UUID primary key
  lego_id: string;  // Generated: 'S0001L01', 'S0001L02', etc.
  course_code: string;
  seed_number: number;
  lego_index: number;
  known_text: string;
  target_text: string;
  type: 'A' | 'M';
  is_new: boolean;
  components?: Array<{ known: string; target: string }>;  // For M-type LEGOs
  status: 'draft' | 'released' | 'deprecated';
  release_batch?: number;
  version: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Audio sample row from `audio_samples` table
 * Note: Audio is GLOBAL (no course_code) - same audio shared across courses
 */
export interface AudioSampleRow {
  uuid: string;
  voice_id: string;
  text: string;
  text_normalized: string;
  lang: string;  // 'eng', 'spa', etc.
  role: 'source' | 'target1' | 'target2';  // 'source' = known language
  cadence: 'natural' | 'slow';
  s3_bucket?: string;
  s3_key: string;
  duration_ms?: number;
  file_size_bytes?: number;
  checksum_md5?: string;
  source?: 'tts' | 'human';
  tts_engine?: string;
  tts_voice_variant?: string;
  tts_text?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Practice phrase row from `course_practice_phrases` table
 * Note: phrase_type is computed at runtime from position, not stored
 * Audio is resolved by text lookup, not stored UUIDs
 */
export interface PracticePhraseRow {
  id: string;  // UUID primary key
  course_code: string;
  seed_number: number;
  lego_index: number;
  position: number;  // Legacy ordering field, now secondary to phrase_role
  known_text: string;
  target_text: string;
  word_count: number;
  lego_count: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  register?: 'casual' | 'formal';

  // Explicit role (replaces position-based categorization)
  phrase_role: 'component' | 'practice' | 'eternal_eligible';

  // Coverage metadata (for selection variety)
  connected_lego_ids: string[];  // Other LEGOs in this phrase
  lego_position?: 'start' | 'middle' | 'end';  // Where primary LEGO appears

  // Cognitive load proxy
  target_syllable_count?: number;

  metadata?: Record<string, unknown>;
  status: 'draft' | 'released' | 'deprecated';
  release_batch?: number;
  version: number;
  created_at?: string;
  updated_at?: string;
}

// ============================================
// CYCLE ROW TYPES (Self-contained learning units)
// Audio IDs stored directly on rows - no views/joins needed
// ============================================

/**
 * LEGO Cycle - Self-contained LEGO learning item with audio
 * From `course_legos` table (audio IDs stored directly)
 */
export interface LegoCycleRow {
  // Identity
  id: string;
  lego_id: string;
  course_code: string;
  seed_number: number;
  lego_index: number;

  // LEGO metadata
  type: 'A' | 'M';
  is_new: boolean;
  components?: Array<{ known: string; target: string }>;
  status: 'draft' | 'released' | 'deprecated';
  version: number;

  // Text pair
  known_text: string;
  target_text: string;

  // Audio refs (pre-joined from audio_samples)
  known_audio_id: string | null;
  known_duration_ms: number | null;
  target1_audio_id: string | null;
  target1_duration_ms: number | null;
  target2_audio_id: string | null;
  target2_duration_ms: number | null;
}

/**
 * Practice Cycle - Self-contained practice phrase item with audio
 * From `practice_cycles` view
 */
export interface PracticeCycleRow {
  // Identity
  id: string;
  course_code: string;
  seed_number: number;
  lego_index: number;
  position: number;
  lego_id: string;  // Computed in view

  // Phrase role (explicit from table, not computed)
  phrase_role: 'component' | 'practice' | 'eternal_eligible';

  // Phrase type (computed in view for backwards compatibility)
  phrase_type: 'component' | 'debut' | 'practice' | 'eternal';

  // Coverage metadata (for selection variety)
  connected_lego_ids: string[];  // Other LEGOs in this phrase
  lego_position?: 'start' | 'middle' | 'end';  // Where primary LEGO appears

  // Practice metadata
  word_count: number;
  lego_count: number;
  target_syllable_count?: number;  // Cognitive load proxy
  difficulty?: 'easy' | 'medium' | 'hard';
  register?: 'casual' | 'formal';
  status: 'draft' | 'released' | 'deprecated';
  version: number;

  // Text pair
  known_text: string;
  target_text: string;

  // Audio refs (pre-joined from audio_samples)
  known_audio_id: string | null;
  known_duration_ms: number | null;
  target1_audio_id: string | null;
  target1_duration_ms: number | null;
  target2_audio_id: string | null;
  target2_duration_ms: number | null;
}

/**
 * Seed Cycle - Self-contained seed item with audio
 * From `seed_cycles` view
 */
export interface SeedCycleRow {
  // Identity
  id: string;
  seed_id: string;
  course_code: string;
  seed_number: number;

  // Seed metadata
  status: 'draft' | 'released' | 'deprecated';
  version: number;

  // Text pair
  known_text: string;
  target_text: string;

  // Audio refs (pre-joined from audio_samples)
  known_audio_id: string | null;
  known_duration_ms: number | null;
  target1_audio_id: string | null;
  target1_duration_ms: number | null;
  target2_audio_id: string | null;
  target2_duration_ms: number | null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

// Import visibility and pricing types from pricing module (canonical location)
import type { CourseVisibility, CoursePricingTier } from '../pricing/types';

// Re-export for convenience
export type { CourseVisibility, CoursePricingTier };

/**
 * Course row from `courses` table (matches dashboard schema - SSoT)
 * Used for course catalog and selection UI
 */
export interface CourseRow {
  course_code: string;           // e.g., 'ita_for_eng'
  known_lang: string;            // 3-letter code: 'eng', 'spa', 'deu'
  target_lang: string;           // 3-letter code: 'ita', 'fra', 'spa'
  display_name: string;          // e.g., 'Italian for English speakers'
  known_voice: string | null;
  target_voice_1: string | null;
  target_voice_2: string | null;
  presentation_voice: string | null;
  status: 'draft' | 'active' | 'archived';
  created_at?: string;
  updated_at?: string;

  // Visibility and pricing (added 2026-01-31)
  visibility?: CourseVisibility;  // 'public' | 'hidden' | 'beta'
  pricing_tier?: CoursePricingTier; // 'free' | 'premium' | 'community'
  is_community?: boolean;        // Community-created course (always free)
  released_at?: string | null;   // When course went public
  featured_order?: number | null; // Display order in course selector
}

/**
 * Enrolled course with progress data
 * Combines CourseRow with learner enrollment data
 */
export interface EnrolledCourseRow extends CourseRow {
  enrolled_at: string;
  last_practiced_at: string | null;
  completed_seeds: number;
  progress: number;  // 0-100
  is_currently_active: boolean;
}

/**
 * Course catalog organized by known language
 */
export interface CourseCatalog {
  knownLanguages: Array<{ code: string; name: string; flag: string }>;
  coursesByKnown: Record<string, CourseRow[]>;
}

/**
 * Language metadata mapping (3-letter codes to display info)
 * Used by UI to show flags and full names
 */
export const LANGUAGE_META: Record<string, { name: string; flag: string }> = {
  eng: { name: 'English', flag: '🇬🇧' },
  spa: { name: 'Spanish', flag: '🇪🇸' },
  ita: { name: 'Italian', flag: '🇮🇹' },
  fra: { name: 'French', flag: '🇫🇷' },
  deu: { name: 'German', flag: '🇩🇪' },
  por: { name: 'Portuguese', flag: '🇵🇹' },
  cym: { name: 'Welsh', flag: '🏴󠁧󠁢󠁷󠁬󠁳󠁿' },
  jpn: { name: 'Japanese', flag: '🇯🇵' },
  zho: { name: 'Chinese', flag: '🇨🇳' },
  kor: { name: 'Korean', flag: '🇰🇷' },
  ara: { name: 'Arabic', flag: '🇸🇦' },
  nld: { name: 'Dutch', flag: '🇳🇱' },
  rus: { name: 'Russian', flag: '🇷🇺' },
  pol: { name: 'Polish', flag: '🇵🇱' },
  swe: { name: 'Swedish', flag: '🇸🇪' },
  nor: { name: 'Norwegian', flag: '🇳🇴' },
  dan: { name: 'Danish', flag: '🇩🇰' },
  fin: { name: 'Finnish', flag: '🇫🇮' },
  tur: { name: 'Turkish', flag: '🇹🇷' },
  hin: { name: 'Hindi', flag: '🇮🇳' },
};

/**
 * Get language metadata by code
 */
export function getLanguageMeta(code: string): { name: string; flag: string } {
  return LANGUAGE_META[code] || { name: code.toUpperCase(), flag: '🌐' };
}

// ============================================
// AUDIO URL CONSTRUCTION
// ============================================

/**
 * S3 bucket base URL for audio files
 */
export const AUDIO_BASE_URL = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered';

/**
 * Constructs S3 URL from audio UUID
 *
 * @param uuid - Audio sample UUID
 * @returns Full S3 URL
 *
 * @example
 * ```typescript
 * const url = getAudioUrl('abc-123-def-456');
 * // => 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered/abc-123-def-456.mp3'
 * ```
 */
export function getAudioUrl(uuid: string): string {
  return `${AUDIO_BASE_URL}/${uuid}.mp3`;
}

/**
 * Creates an AudioRef from a UUID and optional duration
 */
export function createAudioRef(uuid: string | null, duration_ms?: number): AudioRef {
  if (!uuid) {
    // Fallback for missing audio
    return {
      id: 'silence',
      url: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
      duration_ms: duration_ms || 1000,
    };
  }

  return {
    id: uuid,
    url: getAudioUrl(uuid),
    duration_ms,
  };
}
