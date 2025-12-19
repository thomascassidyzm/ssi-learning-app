/**
 * CourseDataProvider - Queries course data from Supabase
 *
 * Uses cycle views (lego_cycles, practice_cycles, seed_cycles) that
 * pre-join content with audio for single-query session loading.
 *
 * Each "cycle" is a self-contained learning unit ready to play:
 * - Text pair (known + target)
 * - Audio refs (known, target1, target2)
 * - Metadata (type, status, etc.)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SeedPair, LegoPair, PracticePhrase } from './types';
import type {
  LegoCycleRow,
  PracticeCycleRow,
  SeedCycleRow,
} from './database-types';
import {
  convertLegoCycleToLegoPair,
  convertPracticeCycleToPracticePhrase,
  buildSeedPairFromCycles,
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
 * Uses pre-joined cycle views for efficient single-query loading.
 * Each query returns complete learning units with audio already resolved.
 *
 * @example
 * ```typescript
 * const provider = new CourseDataProvider({
 *   supabase: createClient(),
 *   courseCode: 'spa_for_eng_v2',
 *   debug: true
 * });
 *
 * // Get seeds 1-30 with all LEGOs and practices (single efficient query each)
 * const content = await provider.getSessionContent({
 *   startPosition: 1,
 *   endPosition: 30
 * });
 *
 * // Each LEGO is ready to play - audio already resolved!
 * for (const seed of content.seeds) {
 *   for (const lego of seed.legos) {
 *     console.log(lego.audioRefs.known.url);  // Ready to play
 *   }
 * }
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
  // CYCLE VIEW QUERIES (Recommended)
  // Single query returns complete learning units
  // ============================================

  /**
   * Fetches LEGO cycles by seed number range
   * Returns complete learning units with audio pre-resolved
   */
  async getLegoCycles(startSeed: number, endSeed: number): Promise<LegoCycleRow[]> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching lego_cycles for seeds ${startSeed}-${endSeed}`);
    }

    const { data, error } = await this.supabase
      .from('lego_cycles')
      .select('*')
      .eq('course_code', this.courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch lego cycles: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} lego cycles`);
    }

    return (data as LegoCycleRow[]) || [];
  }

  /**
   * Fetches practice cycles by seed number range
   * Returns complete practice items with audio pre-resolved
   */
  async getPracticeCycles(startSeed: number, endSeed: number): Promise<PracticeCycleRow[]> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching practice_cycles for seeds ${startSeed}-${endSeed}`);
    }

    const { data, error } = await this.supabase
      .from('practice_cycles')
      .select('*')
      .eq('course_code', this.courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .order('position', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch practice cycles: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} practice cycles`);
    }

    return (data as PracticeCycleRow[]) || [];
  }

  /**
   * Fetches seed cycles by position range
   * Returns complete seed items with audio pre-resolved
   */
  async getSeedCycles(startSeed: number, endSeed: number): Promise<SeedCycleRow[]> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching seed_cycles for seeds ${startSeed}-${endSeed}`);
    }

    const { data, error } = await this.supabase
      .from('seed_cycles')
      .select('*')
      .eq('course_code', this.courseCode)
      .gte('seed_number', startSeed)
      .lte('seed_number', endSeed)
      .order('seed_number', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch seed cycles: ${error.message}`);
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Found ${data?.length || 0} seed cycles`);
    }

    return (data as SeedCycleRow[]) || [];
  }

  /**
   * Fetches a single LEGO cycle by ID
   * Returns complete learning unit with audio pre-resolved
   */
  async getLegoCycleById(legoId: string): Promise<LegoCycleRow | null> {
    if (this.debug) {
      console.log(`[CourseDataProvider] Fetching lego_cycle ${legoId}`);
    }

    const { data, error } = await this.supabase
      .from('lego_cycles')
      .select('*')
      .eq('lego_id', legoId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error(`Failed to fetch lego cycle: ${error.message}`);
    }

    return data as LegoCycleRow;
  }

  // ============================================
  // HIGH-LEVEL SESSION QUERIES
  // ============================================

  /**
   * Gets all content needed for a learning session
   *
   * Uses cycle views for efficient single-query loading.
   * Audio is pre-resolved - no post-processing needed!
   *
   * @example
   * ```typescript
   * const content = await provider.getSessionContent({
   *   startPosition: 1,
   *   endPosition: 30
   * });
   *
   * // Everything is ready to use
   * console.log(`Loaded ${content.totalLegos} LEGOs`);
   * console.log(`Duration: ${content.estimatedDurationSeconds}s`);
   * ```
   */
  async getSessionContent(options: SessionContentOptions): Promise<SessionContent> {
    const {
      startPosition,
      endPosition,
      includePractices = true,
    } = options;

    if (this.debug) {
      console.log(`[CourseDataProvider] Loading session (seeds ${startPosition}-${endPosition})`);
    }

    // 1. Fetch seed cycles and lego cycles in parallel
    const [seedCycles, legoCycles] = await Promise.all([
      this.getSeedCycles(startPosition, endPosition),
      this.getLegoCycles(startPosition, endPosition),
    ]);

    if (seedCycles.length === 0) {
      throw new Error(`No seeds found for positions ${startPosition}-${endPosition}`);
    }

    // 2. Group lego cycles by seed_number
    const legosBySeedNumber = new Map<number, LegoCycleRow[]>();
    for (const lego of legoCycles) {
      const existing = legosBySeedNumber.get(lego.seed_number) || [];
      existing.push(lego);
      legosBySeedNumber.set(lego.seed_number, existing);
    }

    // 3. Build SeedPairs with LEGOs (audio already resolved!)
    const seeds: SeedPair[] = seedCycles.map((seedCycle) => {
      const legosForSeed = legosBySeedNumber.get(seedCycle.seed_number) || [];
      return buildSeedPairFromCycles(seedCycle, legosForSeed);
    });

    // 4. Fetch practice cycles if requested
    const practices = new Map<string, PracticePhrase[]>();
    if (includePractices) {
      const practiceCycles = await this.getPracticeCycles(startPosition, endPosition);

      // Group by LEGO ID
      for (const practiceCycle of practiceCycles) {
        const existing = practices.get(practiceCycle.lego_id) || [];
        existing.push(convertPracticeCycleToPracticePhrase(practiceCycle));
        practices.set(practiceCycle.lego_id, existing);
      }

      if (this.debug) {
        console.log(`[CourseDataProvider] Loaded ${practiceCycles.length} practice cycles`);
      }
    }

    // 5. Calculate estimated duration from audio
    let estimatedDurationSeconds = 0;
    for (const seed of seeds) {
      for (const lego of seed.legos) {
        // Cycle: known + pause (2x target) + target1 + gap (1s) + target2
        const knownDur = lego.audioRefs?.known.duration_ms || 2000;
        const targetDur = lego.audioRefs?.target.voice1.duration_ms || 2000;
        const cycleDuration = knownDur + (targetDur * 2) + targetDur + 1000 + targetDur;
        estimatedDurationSeconds += cycleDuration / 1000;
      }
    }

    if (this.debug) {
      console.log(`[CourseDataProvider] Session loaded: ${seeds.length} seeds, ${legoCycles.length} LEGOs`);
      console.log(`[CourseDataProvider] Duration: ${estimatedDurationSeconds}s (${Math.round(estimatedDurationSeconds / 60)} min)`);
    }

    return {
      seeds,
      practices,
      totalLegos: legoCycles.length,
      estimatedDurationSeconds,
    };
  }

  /**
   * Gets a single LEGO with its practice phrases
   * Returns complete learning unit ready to play
   */
  async getLegoPairWithPractices(
    legoId: string
  ): Promise<{ lego: LegoPair; practices: PracticePhrase[] } | null> {
    const legoCycle = await this.getLegoCycleById(legoId);
    if (!legoCycle) {
      return null;
    }

    // Fetch practice cycles for this LEGO
    const { data: practiceCycles, error } = await this.supabase
      .from('practice_cycles')
      .select('*')
      .eq('lego_id', legoId)
      .order('position', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch practice cycles: ${error.message}`);
    }

    const practices = (practiceCycles || []).map(convertPracticeCycleToPracticePhrase);

    return {
      lego: convertLegoCycleToLegoPair(legoCycle),
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
      .from('seed_cycles')
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
