/**
 * Database types and conversion utilities
 *
 * Maps database rows (from Supabase) to core application types.
 * These types match the dashboard schema tables: seeds, legos, audio_samples.
 */

import type {
  SeedPair,
  LegoPair,
  AudioRef,
  AudioLanguagePair,
  PracticePhrase,
  PhraseType,
} from './types';

// ============================================
// DATABASE ROW TYPES (from Dashboard)
// ============================================

/**
 * Seed row from `seeds` table
 */
export interface SeedRow {
  seed_id: string;
  course_code: string;
  position: number;
  known_text: string;
  target_text: string;
  known_audio_uuid: string | null;
  target_audio_uuid: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * LEGO row from `legos` table
 */
export interface LegoRow {
  lego_id: string;
  seed_id: string;
  lego_index: number;
  known_text: string;
  target_text: string;
  type: 'A' | 'M';
  is_new: boolean;
  known_audio_uuid: string | null;
  target_audio_uuid: string | null;
  target_audio_uuid_alt: string | null;  // Second voice
  component_of_lego_id: string | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Audio sample row from `audio_samples` table
 */
export interface AudioSampleRow {
  uuid: string;
  s3_key: string;
  duration_ms: number;
  text: string;
  text_normalized: string;
  role: 'known' | 'target1' | 'target2';
  voice_id: string | null;
  course_code: string;
  created_at?: string;
}

/**
 * Practice phrase row from `lego_practice_phrases` table
 */
export interface PracticePhraseRow {
  phrase_id: string;
  lego_id: string;
  seed_id: string;
  known_text: string;
  target_text: string;
  phrase_type: 'component' | 'debut' | 'practice' | 'eternal';
  sort_order: number;
  word_count: number;
  known_audio_uuid: string | null;
  target_audio_uuid: string | null;
  target_audio_uuid_alt: string | null;
  created_at?: string;
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
 */
export function convertSeedRowToSeedPair(row: SeedRow): Omit<SeedPair, 'legos'> {
  return {
    seed_id: row.seed_id,
    seed_pair: {
      known: row.known_text,
      target: row.target_text,
    },
    audioRefs: row.known_audio_uuid && row.target_audio_uuid ? {
      known: createAudioRef(row.known_audio_uuid),
      target: {
        voice1: createAudioRef(row.target_audio_uuid),
        voice2: createAudioRef(row.target_audio_uuid), // Use same audio if no alt
      },
    } : undefined,
  };
}

/**
 * Converts a LegoRow to a LegoPair
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
    components: undefined, // Components must be queried separately
    audioRefs: {
      known: createAudioRef(row.known_audio_uuid),
      target: {
        voice1: createAudioRef(row.target_audio_uuid),
        voice2: createAudioRef(row.target_audio_uuid_alt || row.target_audio_uuid),
      },
    },
  };
}

/**
 * Converts a PracticePhraseRow to a PracticePhrase
 */
export function convertPracticePhraseRowToPracticePhrase(row: PracticePhraseRow): PracticePhrase {
  return {
    id: row.phrase_id,
    phraseType: row.phrase_type as PhraseType,
    phrase: {
      known: row.known_text,
      target: row.target_text,
    },
    audioRefs: {
      known: createAudioRef(row.known_audio_uuid),
      target: {
        voice1: createAudioRef(row.target_audio_uuid),
        voice2: createAudioRef(row.target_audio_uuid_alt || row.target_audio_uuid),
      },
    },
    wordCount: row.word_count,
    containsLegos: [row.lego_id], // Single LEGO reference
  };
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
 * Groups LEGOs by their parent SEED
 */
export function groupLegosBySeed(legoRows: LegoRow[]): Map<string, LegoRow[]> {
  const grouped = new Map<string, LegoRow[]>();

  for (const lego of legoRows) {
    const existing = grouped.get(lego.seed_id) || [];
    existing.push(lego);
    grouped.set(lego.seed_id, existing);
  }

  // Sort LEGOs by index within each seed
  for (const legos of grouped.values()) {
    legos.sort((a, b) => a.lego_index - b.lego_index);
  }

  return grouped;
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
 * Audio sample lookup key generator
 *
 * Used to find audio by text + role when UUIDs aren't directly available.
 */
export function getAudioLookupKey(text: string, role: 'known' | 'target1' | 'target2'): string {
  const normalized = text.toLowerCase().trim();
  return `${normalized}::${role}`;
}

/**
 * Creates a Map for fast audio sample lookups
 */
export function createAudioSampleMap(samples: AudioSampleRow[]): Map<string, AudioSampleRow> {
  const map = new Map<string, AudioSampleRow>();

  for (const sample of samples) {
    // Index by UUID
    map.set(sample.uuid, sample);

    // Also index by text+role for lookups
    const key = getAudioLookupKey(sample.text, sample.role);
    map.set(key, sample);
  }

  return map;
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
    'seed_id' in value &&
    'type' in value &&
    'is_new' in value
  );
}
