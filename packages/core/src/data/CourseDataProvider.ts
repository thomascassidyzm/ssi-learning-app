/**
 * CourseDataProvider - Queries course data from Supabase
 *
 * Provides methods to fetch SEEDs, LEGOs, practice phrases, and audio samples
 * from the dashboard database. Converts database rows to core application types.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedPair, LegoPair, PracticePhrase } from './types';
import type {
  SeedRow,
  LegoRow,
  AudioSampleRow,
  PracticePhraseRow,
} from './database-types';
import {
  buildSeedPairWithLegos,
  groupLegosBySeed,
  convertLegoRowToLegoPair,
  convertPracticePhraseRowToPracticePhrase,
  createAudioSampleMap,
  enrichAudioRefs,
} from './database-types';

export interface CourseDataProviderConfig {
  /** Supabase client instance */
  supabase: SupabaseClient;
  /** Course code to query (e.g., 'spa_for_eng_v2') */
  courseCode: string;
  /** Enable debug logging */
  debug?: boolean;
}

export interface SessionContentOptions {
  /** Starting seed position (inclusive) */
  startPosition: number;
  /** Ending seed position (inclusive) */
  endPosition: number;
  /** Whether to include practice phrases (default: true) */
  includePractices?: boolean;
  /** Whether to include audio metadata (default: true) */
  includeAudio?: boolean;
}

export interface SessionContent {
  /** SEEDs with their LEGOs */
  seeds: SeedPair[];
  /** Practice phrases for all LEGOs in session */
  practices: Map<string, PracticePhrase[]>;
  /** Total number of LEGOs in session */
  totalLegos: number;
  /** Estimated session duration in seconds (based on audio) */
  estimatedDurationSeconds: number;
}

/**
 * CourseDataProvider - Main data access layer for course content
 *
 * @example
 * ```typescript
 * const provider = new CourseDataProvider({
 *   supabase: createClient(),
 *   courseCode: 'spa_for_eng_v2',
 *   debug: true
 * });
 *
 * // Get seeds 1-30 with all LEGOs and practices
 * const content = await provider.getSessionContent({
 *   startPosition: 1,
 *   endPosition: 30
 * });
 *
 * // Query specific LEGOs
 * const legos = await provider.getLegosBySeedId('S0001');
 *
 * // Get practices for a LEGO
 * const practices = await provider.getPracticesForLego('S0001L01');
 * ```
 */
export class CourseDataProvider {
  private supabase: SupabaseClient;
  private courseCode: string;
  private debug: boolean;

  constructor(config: CourseDataProviderConfig) {
    this.supabase = config.supabase;
    this.courseCode = config.courseCode;
    this.debug = config.debug ?? false;
  }

  // ============================================
  // SEED QUERIES
  // ============================================

  /**
   * Fetches seeds by position range
   */
  async getSeedsByPositionRange(startPosition: number, endPosition: number): Promise<SeedRow[]> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching seeds ${startPosition}-${endPosition} for ${this.courseCode}`);
    }

    const { data, error } = await this.supabase
      .from('seeds')
      .select('*')
      .eq('course_code', this.courseCode)
      .gte('position', startPosition)
      .lte('position', endPosition)
      .order('position', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch seeds: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} seeds`);
    }

    return (data as SeedRow[]) || [];
  }

  /**
   * Fetches a single seed by ID
   */
  async getSeedById(seedId: string): Promise<SeedRow | null> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching seed ${seedId}`);
    }

    const { data, error } = await this.supabase
      .from('seeds')
      .select('*')
      .eq('seed_id', seedId)
      .eq('course_code', this.courseCode)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // Not found
        return null;
      }
      throw new Error(`Failed to fetch seed: ${error.message}`);
    }

    return data as SeedRow;
  }

  // ============================================
  // LEGO QUERIES
  // ============================================

  /**
   * Fetches all LEGOs for given seed IDs
   */
  async getLegosForSeeds(seedIds: string[]): Promise<LegoRow[]> {
    if (seedIds.length === 0) {
      return [];
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching LEGOs for ${seedIds.length} seeds`);
    }

    const { data, error } = await this.supabase
      .from('legos')
      .select('*')
      .in('seed_id', seedIds)
      .order('seed_id', { ascending: true })
      .order('lego_index', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch LEGOs: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} LEGOs`);
    }

    return (data as LegoRow[]) || [];
  }

  /**
   * Fetches LEGOs for a specific seed
   */
  async getLegosBySeedId(seedId: string): Promise<LegoRow[]> {
    return this.getLegosForSeeds([seedId]);
  }

  /**
   * Fetches a single LEGO by ID
   */
  async getLegoById(legoId: string): Promise<LegoRow | null> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching LEGO ${legoId}`);
    }

    const { data, error } = await this.supabase
      .from('legos')
      .select('*')
      .eq('lego_id', legoId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to fetch LEGO: ${error.message}`);
    }

    return data as LegoRow;
  }

  // ============================================
  // PRACTICE PHRASE QUERIES
  // ============================================

  /**
   * Fetches practice phrases for given LEGO IDs
   */
  async getPracticesForLegos(legoIds: string[]): Promise<PracticePhraseRow[]> {
    if (legoIds.length === 0) {
      return [];
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching practices for ${legoIds.length} LEGOs`);
    }

    const { data, error } = await this.supabase
      .from('lego_practice_phrases')
      .select('*')
      .in('lego_id', legoIds)
      .order('lego_id', { ascending: true })
      .order('sort_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch practices: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} practice phrases`);
    }

    return (data as PracticePhraseRow[]) || [];
  }

  /**
   * Fetches practice phrases for a specific LEGO
   */
  async getPracticesForLego(legoId: string): Promise<PracticePhraseRow[]> {
    return this.getPracticesForLegos([legoId]);
  }

  // ============================================
  // AUDIO QUERIES
  // ============================================

  /**
   * Fetches audio samples by UUIDs
   */
  async getAudioSamplesByUuids(uuids: string[]): Promise<AudioSampleRow[]> {
    if (uuids.length === 0) {
      return [];
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching ${uuids.length} audio samples`);
    }

    const { data, error } = await this.supabase
      .from('audio_samples')
      .select('*')
      .in('uuid', uuids);

    if (error) {
      throw new Error(`Failed to fetch audio samples: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} audio samples`);
    }

    return (data as AudioSampleRow[]) || [];
  }

  /**
   * Fetches audio samples for a course
   *
   * Use this to get all audio metadata at once for duration info.
   */
  async getAudioSamplesForCourse(): Promise<AudioSampleRow[]> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching all audio for ${this.courseCode}`);
    }

    const { data, error } = await this.supabase
      .from('audio_samples')
      .select('*')
      .eq('course_code', this.courseCode);

    if (error) {
      throw new Error(`Failed to fetch audio samples: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} audio samples`);
    }

    return (data as AudioSampleRow[]) || [];
  }

  // ============================================
  // HIGH-LEVEL QUERIES
  // ============================================

  /**
   * Gets all content needed for a learning session
   *
   * This is the main method used by the learning app to load a session.
   * It fetches seeds, LEGOs, practices, and optionally audio metadata.
   *
   * @example
   * ```typescript
   * // Load seeds 1-30 (first session)
   * const content = await provider.getSessionContent({
   *   startPosition: 1,
   *   endPosition: 30
   * });
   *
   * console.log(`Loaded ${content.totalLegos} LEGOs`);
   * console.log(`Estimated duration: ${content.estimatedDurationSeconds}s`);
   *
   * // Use in learning engine
   * for (const seed of content.seeds) {
   *   for (const lego of seed.legos) {
   *     const practices = content.practices.get(lego.id) || [];
   *     // ... use in TripleHelixEngine
   *   }
   * }
   * ```
   */
  async getSessionContent(options: SessionContentOptions): Promise<SessionContent> {
    const {
      startPosition,
      endPosition,
      includePractices = true,
      includeAudio = true,
    } = options;

    if (this.debug) {
      console.log(`[CourseDataProvider] Loading session content (seeds ${startPosition}-${endPosition})`);
    }

    // 1. Fetch seeds
    const seedRows = await this.getSeedsByPositionRange(startPosition, endPosition);

    if (seedRows.length === 0) {
      throw new Error(`No seeds found for positions ${startPosition}-${endPosition}`);
    }

    // 2. Fetch LEGOs for all seeds
    const seedIds = seedRows.map((s) => s.seed_id);
    const legoRows = await this.getLegosForSeeds(seedIds);
    const legosBySeeds = groupLegosBySeed(legoRows);

    // 3. Build SeedPairs with LEGOs
    const seeds: SeedPair[] = seedRows.map((seedRow) => {
      const legosForSeed = legosBySeeds.get(seedRow.seed_id) || [];
      return buildSeedPairWithLegos(seedRow, legosForSeed);
    });

    // 4. Fetch practice phrases if requested
    const practices = new Map<string, PracticePhrase[]>();
    if (includePractices) {
      const legoIds = legoRows.map((l) => l.lego_id);
      const practiceRows = await this.getPracticesForLegos(legoIds);

      // Group by LEGO
      for (const practiceRow of practiceRows) {
        const existing = practices.get(practiceRow.lego_id) || [];
        existing.push(convertPracticePhraseRowToPracticePhrase(practiceRow));
        practices.set(practiceRow.lego_id, existing);
      }
    }

    // 5. Enrich with audio metadata if requested
    let estimatedDurationSeconds = 0;
    if (includeAudio) {
      // Collect all audio UUIDs
      const audioUuids = new Set<string>();

      for (const seedRow of seedRows) {
        if (seedRow.known_audio_uuid) audioUuids.add(seedRow.known_audio_uuid);
        if (seedRow.target_audio_uuid) audioUuids.add(seedRow.target_audio_uuid);
      }

      for (const legoRow of legoRows) {
        if (legoRow.known_audio_uuid) audioUuids.add(legoRow.known_audio_uuid);
        if (legoRow.target_audio_uuid) audioUuids.add(legoRow.target_audio_uuid);
        if (legoRow.target_audio_uuid_alt) audioUuids.add(legoRow.target_audio_uuid_alt);
      }

      // Fetch audio samples
      const audioSamples = await this.getAudioSamplesByUuids(Array.from(audioUuids));
      const audioMap = createAudioSampleMap(audioSamples);

      // Enrich seeds and LEGOs with duration info
      for (const seed of seeds) {
        if (seed.audioRefs) {
          seed.audioRefs = enrichAudioRefs(seed.audioRefs, audioMap);
        }

        for (const lego of seed.legos) {
          lego.audioRefs = enrichAudioRefs(lego.audioRefs, audioMap);

          // Estimate duration: known + pause (2x target) + target1 + gap (1s) + target2
          const knownDur = lego.audioRefs.known.duration_ms || 2000;
          const targetDur = lego.audioRefs.target.voice1.duration_ms || 2000;
          const cycleDuration = knownDur + (targetDur * 2) + targetDur + 1000 + targetDur;
          estimatedDurationSeconds += cycleDuration / 1000;
        }
      }

      // Enrich practice phrases
      for (const practicePhraseList of practices.values()) {
        for (const practice of practicePhraseList) {
          practice.audioRefs = enrichAudioRefs(practice.audioRefs, audioMap);
        }
      }
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Session loaded: ${seeds.length} seeds, ${legoRows.length} LEGOs`);
      console.log(`[CourseDataProvider] Estimated duration: ${estimatedDurationSeconds}s (${Math.round(estimatedDurationSeconds / 60)} min)`);
    }

    return {
      seeds,
      practices,
      totalLegos: legoRows.length,
      estimatedDurationSeconds,
    };
  }

  /**
   * Builds a complete SeedPair with all LEGOs and components
   */
  async getSeedPairWithLegos(seedId: string): Promise<SeedPair | null> {
    const seedRow = await this.getSeedById(seedId);
    if (!seedRow) {
      return null;
    }

    const legoRows = await this.getLegosBySeedId(seedId);
    return buildSeedPairWithLegos(seedRow, legoRows);
  }

  /**
   * Builds a complete LegoPair with practice phrases
   */
  async getLegoPairWithPractices(
    legoId: string
  ): Promise<{ lego: LegoPair; practices: PracticePhrase[] } | null> {
    const legoRow = await this.getLegoById(legoId);
    if (!legoRow) {
      return null;
    }

    const practiceRows = await this.getPracticesForLego(legoId);
    const practices = practiceRows.map(convertPracticePhraseRowToPracticePhrase);

    return {
      lego: convertLegoRowToLegoPair(legoRow),
      practices,
    };
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Gets the total number of seeds in the course
   */
  async getTotalSeeds(): Promise<number> {
    const { count, error } = await this.supabase
      .from('seeds')
      .select('*', { count: 'exact', head: true })
      .eq('course_code', this.courseCode);

    if (error) {
      throw new Error(`Failed to count seeds: ${error.message}`);
    }

    return count || 0;
  }

  /**
   * Gets course code
   */
  getCourseCode(): string {
    return this.courseCode;
  }

  /**
   * Enables/disables debug logging
   */
  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }
}

/**
 * Factory function to create a CourseDataProvider
 */
export function createCourseDataProvider(
  supabase: SupabaseClient,
  courseCode: string,
  debug = false
): CourseDataProvider {
  return new CourseDataProvider({ supabase, courseCode, debug });
}
