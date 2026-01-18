/**
 * Database types and conversion utilities
 *
 * Maps database rows (from Supabase) to core application types.
 * Table naming convention:
 * - course_* prefix for course-specific data (course_seeds, course_legos, course_practice_phrases)
 * - No prefix for global data (audio_samples, voices)
 */

import type {
  SeedPair,
  LegoPair,
  AudioRef,
  AudioLanguagePair,
  PracticePhrase,
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
// CYCLE VIEW TYPES (Self-contained learning units)
// These come from database views that JOIN content with audio
// ============================================

/**
 * LEGO Cycle - Self-contained LEGO learning item with audio
 * From `lego_cycles` view
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
  known_audio_uuid: string | null;
  known_duration_ms: number | null;
  target1_audio_uuid: string | null;
  target1_duration_ms: number | null;
  target2_audio_uuid: string | null;
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
  known_audio_uuid: string | null;
  known_duration_ms: number | null;
  target1_audio_uuid: string | null;
  target1_duration_ms: number | null;
  target2_audio_uuid: string | null;
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
  known_audio_uuid: string | null;
  known_duration_ms: number | null;
  target1_audio_uuid: string | null;
  target1_duration_ms: number | null;
  target2_audio_uuid: string | null;
  target2_duration_ms: number | null;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Computes phrase_type from position (runtime classification)
 *
 * Position mapping:
 * - 0: component (individual word parts of M-type LEGOs)
 * - 1: debut (the LEGO phrase itself - its debut appearance)
 * - 2-7: practice (first 6 practice sentences using the LEGO)
 * - 8+: eternal (long-term spaced repetition rotation)
 */
export function computePhraseType(position: number): 'component' | 'debut' | 'practice' | 'eternal' {
  if (position === 0) return 'component';
  if (position === 1) return 'debut';
  if (position >= 2 && position <= 7) return 'practice';
  return 'eternal';
}

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
  streak: number;
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

// ============================================
// CONVERSION FUNCTIONS
// ============================================

/**
 * Converts a SeedRow to a SeedPair
 *
 * Note: LEGOs must be fetched separately and added to the result.
 * Audio refs are resolved later via text-based lookup.
 */
export function convertSeedRowToSeedPair(row: SeedRow): Omit<SeedPair, 'legos'> {
  return {
    seed_id: row.seed_id,
    seed_pair: {
      known: row.known_text,
      target: row.target_text,
    },
    // Audio resolved later via resolveAudioForContent()
    audioRefs: undefined,
  };
}

/**
 * Converts a LegoRow to a LegoPair
 * Audio refs are resolved later via text-based lookup.
 */
export function convertLegoRowToLegoPair(row: LegoRow): LegoPair {
  return {
    id: row.lego_id,
    type: row.type,
    new: row.is_new,
    lego: {
      known: row.known_text,
      target: row.target_text,
    },
    components: row.components,  // Already in the row for M-type LEGOs
    // Placeholder audioRefs - resolved later via resolveAudioForContent()
    audioRefs: {
      known: createAudioRef(null),
      target: {
        voice1: createAudioRef(null),
        voice2: createAudioRef(null),
      },
    },
  };
}

/**
 * Converts a PracticePhraseRow to a PracticePhrase
 * Audio refs are resolved later via text-based lookup.
 */
export function convertPracticePhraseRowToPracticePhrase(row: PracticePhraseRow): PracticePhrase {
  // Build lego_id from seed_number and lego_index
  const legoId = `S${String(row.seed_number).padStart(4, '0')}L${String(row.lego_index).padStart(2, '0')}`;

  // Use explicit phrase_role if available, fallback to position-based computation
  const phraseType = row.phrase_role
    ? mapPhraseRoleToType(row.phrase_role)
    : computePhraseType(row.position);

  return {
    id: row.id,
    phraseType,
    phrase: {
      known: row.known_text,
      target: row.target_text,
    },
    // Placeholder audioRefs - resolved later via resolveAudioForContent()
    audioRefs: {
      known: createAudioRef(null),
      target: {
        voice1: createAudioRef(null),
        voice2: createAudioRef(null),
      },
    },
    wordCount: row.word_count,
    // Include connected LEGOs if available, otherwise just the primary LEGO
    containsLegos: row.connected_lego_ids?.length
      ? [legoId, ...row.connected_lego_ids]
      : [legoId],
  };
}

/**
 * Maps phrase_role to phrase_type for backwards compatibility
 */
export function mapPhraseRoleToType(role: 'component' | 'practice' | 'eternal_eligible'): 'component' | 'debut' | 'practice' | 'eternal' {
  switch (role) {
    case 'component': return 'component';
    case 'practice': return 'practice';
    case 'eternal_eligible': return 'eternal';
  }
}

/**
 * Builds a complete SeedPair with LEGOs
 */
export function buildSeedPairWithLegos(
  seedRow: SeedRow,
  legoRows: LegoRow[]
): SeedPair {
  const seed = convertSeedRowToSeedPair(seedRow);
  const legos = legoRows.map(convertLegoRowToLegoPair);

  return {
    ...seed,
    legos,
  };
}

/**
 * Groups LEGOs by their parent SEED (using seed_number)
 */
export function groupLegosBySeedNumber(legoRows: LegoRow[]): Map<number, LegoRow[]> {
  const grouped = new Map<number, LegoRow[]>();

  for (const lego of legoRows) {
    const existing = grouped.get(lego.seed_number) || [];
    existing.push(lego);
    grouped.set(lego.seed_number, existing);
  }

  // Sort LEGOs by index within each seed
  for (const legos of grouped.values()) {
    legos.sort((a, b) => a.lego_index - b.lego_index);
  }

  return grouped;
}

// ============================================
// CYCLE ROW CONVERSIONS
// These convert cycle view rows directly to core types
// with audio already resolved - no post-processing needed
// ============================================

/**
 * Converts a LegoCycleRow to a LegoPair
 * Audio is already resolved from the view - no extra lookups needed!
 */
export function convertLegoCycleToLegoPair(row: LegoCycleRow): LegoPair {
  return {
    id: row.lego_id,
    type: row.type,
    new: row.is_new,
    lego: {
      known: row.known_text,
      target: row.target_text,
    },
    components: row.components,
    audioRefs: {
      known: createAudioRef(row.known_audio_uuid, row.known_duration_ms ?? undefined),
      target: {
        voice1: createAudioRef(row.target1_audio_uuid, row.target1_duration_ms ?? undefined),
        voice2: createAudioRef(row.target2_audio_uuid, row.target2_duration_ms ?? undefined),
      },
    },
  };
}

/**
 * Converts a PracticeCycleRow to a PracticePhrase
 * Audio is already resolved from the view - no extra lookups needed!
 */
export function convertPracticeCycleToPracticePhrase(row: PracticeCycleRow): PracticePhrase {
  return {
    id: row.id,
    phraseType: row.phrase_type,  // Already computed in view
    phrase: {
      known: row.known_text,
      target: row.target_text,
    },
    audioRefs: {
      known: createAudioRef(row.known_audio_uuid, row.known_duration_ms ?? undefined),
      target: {
        voice1: createAudioRef(row.target1_audio_uuid, row.target1_duration_ms ?? undefined),
        voice2: createAudioRef(row.target2_audio_uuid, row.target2_duration_ms ?? undefined),
      },
    },
    wordCount: row.word_count,
    containsLegos: [row.lego_id],
  };
}

/**
 * Converts a SeedCycleRow to a partial SeedPair (without legos)
 * Audio is already resolved from the view - no extra lookups needed!
 */
export function convertSeedCycleToSeedPair(row: SeedCycleRow): Omit<SeedPair, 'legos'> {
  return {
    seed_id: row.seed_id,
    seed_pair: {
      known: row.known_text,
      target: row.target_text,
    },
    audioRefs: {
      known: createAudioRef(row.known_audio_uuid, row.known_duration_ms ?? undefined),
      target: {
        voice1: createAudioRef(row.target1_audio_uuid, row.target1_duration_ms ?? undefined),
        voice2: createAudioRef(row.target2_audio_uuid, row.target2_duration_ms ?? undefined),
      },
    },
  };
}

/**
 * Builds a complete SeedPair from cycle rows
 */
export function buildSeedPairFromCycles(
  seedRow: SeedCycleRow,
  legoRows: LegoCycleRow[]
): SeedPair {
  const seed = convertSeedCycleToSeedPair(seedRow);
  const legos = legoRows.map(convertLegoCycleToLegoPair);

  return {
    ...seed,
    legos,
  };
}

/**
 * Attaches audio metadata to AudioRefs from audio sample lookups
 *
 * Used when you have the full audio_samples data and want to enrich
 * the AudioRefs with duration information.
 */
export function enrichAudioRefs(
  audioRefs: AudioLanguagePair,
  audioSamples: Map<string, AudioSampleRow>
): AudioLanguagePair {
  const knownSample = audioSamples.get(audioRefs.known.id);
  const voice1Sample = audioSamples.get(audioRefs.target.voice1.id);
  const voice2Sample = audioSamples.get(audioRefs.target.voice2.id);

  return {
    known: {
      ...audioRefs.known,
      duration_ms: knownSample?.duration_ms || audioRefs.known.duration_ms,
    },
    target: {
      voice1: {
        ...audioRefs.target.voice1,
        duration_ms: voice1Sample?.duration_ms || audioRefs.target.voice1.duration_ms,
      },
      voice2: {
        ...audioRefs.target.voice2,
        duration_ms: voice2Sample?.duration_ms || audioRefs.target.voice2.duration_ms,
      },
    },
  };
}

// ============================================
// QUERY HELPERS
// ============================================

/**
 * Audio role mapping: application role → database role
 * The database uses 'source' for known language audio
 */
export type AppAudioRole = 'known' | 'target1' | 'target2';
export type DbAudioRole = 'source' | 'target1' | 'target2';

export function appRoleToDbRole(role: AppAudioRole): DbAudioRole {
  return role === 'known' ? 'source' : role;
}

/**
 * Audio sample lookup key generator
 *
 * Used to find audio by text + role when UUIDs aren't directly available.
 */
export function getAudioLookupKey(text: string, role: AppAudioRole): string {
  const normalized = text.toLowerCase().trim();
  const dbRole = appRoleToDbRole(role);
  return `${normalized}::${dbRole}`;
}

/**
 * Creates a Map for fast audio sample lookups
 */
export function createAudioSampleMap(samples: AudioSampleRow[]): Map<string, AudioSampleRow> {
  const map = new Map<string, AudioSampleRow>();

  for (const sample of samples) {
    // Index by UUID
    map.set(sample.uuid, sample);

    // Also index by text_normalized+role for lookups
    const key = `${sample.text_normalized}::${sample.role}`;
    map.set(key, sample);
  }

  return map;
}

/**
 * Resolves audio for a text+role pair from the audio map
 */
export function resolveAudioRef(
  text: string,
  role: AppAudioRole,
  audioMap: Map<string, AudioSampleRow>
): AudioRef {
  const key = getAudioLookupKey(text, role);
  const sample = audioMap.get(key);

  if (sample) {
    return {
      id: sample.uuid,
      url: getAudioUrl(sample.uuid),
      duration_ms: sample.duration_ms,
    };
  }

  // Fallback to silence if audio not found
  return createAudioRef(null);
}

/**
 * Resolves all audio refs for a LegoPair
 */
export function resolveLegoAudio(
  lego: LegoPair,
  audioMap: Map<string, AudioSampleRow>
): AudioLanguagePair {
  return {
    known: resolveAudioRef(lego.lego.known, 'known', audioMap),
    target: {
      voice1: resolveAudioRef(lego.lego.target, 'target1', audioMap),
      voice2: resolveAudioRef(lego.lego.target, 'target2', audioMap),
    },
  };
}

/**
 * Resolves all audio refs for a PracticePhrase
 */
export function resolvePhraseAudio(
  phrase: PracticePhrase,
  audioMap: Map<string, AudioSampleRow>
): AudioLanguagePair {
  return {
    known: resolveAudioRef(phrase.phrase.known, 'known', audioMap),
    target: {
      voice1: resolveAudioRef(phrase.phrase.target, 'target1', audioMap),
      voice2: resolveAudioRef(phrase.phrase.target, 'target2', audioMap),
    },
  };
}

/**
 * Type guard to check if a value is a SeedRow
 */
export function isSeedRow(value: unknown): value is SeedRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'seed_id' in value &&
    'course_code' in value &&
    'known_text' in value &&
    'target_text' in value
  );
}

/**
 * Type guard to check if a value is a LegoRow
 */
export function isLegoRow(value: unknown): value is LegoRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'lego_id' in value &&
    'seed_number' in value &&
    'type' in value &&
    'is_new' in value
  );
}
