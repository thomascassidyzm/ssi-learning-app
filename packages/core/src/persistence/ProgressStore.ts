/**
 * ProgressStore - Manages learner progress persistence
 *
 * Provides abstraction over Supabase for:
 * - Learner records and preferences
 * - Course enrollments
 * - LEGO and SEED progress
 *
 * Designed for offline-first with sync queue integration
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HelixState, LegoProgress, SeedProgress } from '../data/types';
import type {
  IProgressStore,
  LearnerRecord,
  LearnerPreferences,
  CourseEnrollmentRecord,
  LegoProgressRecord,
  SeedProgressRecord,
  LearnerBaselineRecord,
} from './types';
import type { LearnerBaseline } from '../learning/types';

export interface ProgressStoreConfig {
  /** Supabase client instance */
  client: SupabaseClient;
  /** Schema to use (default: 'public') */
  schema?: string;
}

export class ProgressStore implements IProgressStore {
  private client: SupabaseClient;
  private schema: string;

  constructor(config: ProgressStoreConfig) {
    this.client = config.client;
    this.schema = config.schema ?? 'public';
  }

  // ============================================
  // LEARNER MANAGEMENT
  // ============================================

  async getLearner(learnerId: string): Promise<LearnerRecord | null> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('learners')
      .select('*')
      .eq('id', learnerId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Failed to get learner: ${error.message}`);
    }

    return this.mapToLearnerRecord(data);
  }

  async updateLearnerPreferences(
    learnerId: string,
    prefs: Partial<LearnerPreferences>
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('learners')
      .update({
        preferences: prefs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', learnerId);

    if (error) {
      throw new Error(`Failed to update preferences: ${error.message}`);
    }
  }

  // ============================================
  // COURSE ENROLLMENT
  // ============================================

  async getEnrollment(
    learnerId: string,
    courseId: string
  ): Promise<CourseEnrollmentRecord | null> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .select('*')
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get enrollment: ${error.message}`);
    }

    return this.mapToEnrollmentRecord(data);
  }

  async createEnrollment(
    learnerId: string,
    courseId: string
  ): Promise<CourseEnrollmentRecord> {
    const now = new Date().toISOString();
    const initialHelixState: HelixState = {
      active_thread: 1,
      threads: {
        1: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
        2: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
        3: { seedOrder: [], currentSeedId: null, currentLegoIndex: 0 },
      },
      injected_content: {},
    };

    const { data, error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .insert({
        learner_id: learnerId,
        course_id: courseId,
        enrolled_at: now,
        last_practiced_at: null,
        total_practice_minutes: 0,
        helix_state: initialHelixState,
        last_completed_lego_id: null,
        last_completed_round_index: null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create enrollment: ${error.message}`);
    }

    return this.mapToEnrollmentRecord(data);
  }

  async updateHelixState(
    learnerId: string,
    courseId: string,
    state: HelixState
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        helix_state: state,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);

    if (error) {
      throw new Error(`Failed to update helix state: ${error.message}`);
    }
  }

  async updateEnrollmentProgress(
    learnerId: string,
    courseId: string,
    legoId: string,
    roundIndex: number
  ): Promise<void> {
    // Cursor advance is forward-only at the persistence layer. A round-
    // completion at index N never regresses the cursor — without this
    // guard, a single bug that zeroed the in-memory round index could
    // overwrite a learner's furthest position with "round 0" the next
    // time a cycle completed (which is exactly what happened to the
    // pod-stop reset before commit e09dc41).
    //
    // Intentional cursor regression — say, a future "track revisit
    // position" feature — would need a separate explicit method. All
    // current callers want forward-only progress.
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        last_completed_lego_id: legoId,
        last_completed_round_index: roundIndex,
        // Round just completed → next round starts at cycle 0. Resets
        // the mid-round cursor (see updateCurrentCycle / migration
        // 20260507_current_cycle_index.sql).
        current_cycle_index: 0,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .or(`last_completed_round_index.is.null,last_completed_round_index.lt.${roundIndex}`);

    if (error) {
      throw new Error(`Failed to update enrollment progress: ${error.message}`);
    }
  }

  /**
   * Mid-round cursor write — bumps `current_cycle_index` so an app
   * reload (PWA update, close+open) resumes from the cycle the learner
   * was on, not the start of the round. Fires on every cycle_completed.
   *
   * Bypasses the forward-only round guard because the round itself
   * isn't moving here; only the cycle within an in-progress round is.
   */
  async updateCurrentCycle(
    learnerId: string,
    courseId: string,
    cycleIndex: number
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        current_cycle_index: cycleIndex,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);

    if (error) {
      throw new Error(`Failed to update current cycle: ${error.message}`);
    }
  }

  /**
   * Explicit cursor write for intentional navigation events (belt-back,
   * jump-to-furthest, jump-to-belt). Bypasses the max-only guard in
   * updateEnrollmentProgress because the user has chosen this position —
   * "I am now at round X" — even if X is behind their high-water mark.
   *
   * The DB trigger still preserves the ceiling: a backward write here
   * doesn't lower highest_completed_round_index, and a forward one doesn't
   * lower the ceiling either (it ratchets only up).
   */
  /**
   * Switch playback mode. infplay_round_index is a LIFETIME counter —
   * once it crosses 0 it never goes back. Semantics:
   *   - First-ever 'infplay': counter initialised to 1
   *   - Re-entering 'infplay' after a 'main' detour: counter unchanged
   *     (carries over)
   *   - 'main': counter NOT reset — preserves "has this learner ever
   *     been in INF PLAY" so jumpToFurthest and the purple pill can
   *     keep showing the count after a back-belt-skip out.
   *
   * Optional `ratchetHighestTo`: when entering INF PLAY, also ratchet
   * highest_completed_lego_id + highest_completed_round_index to the
   * given (legoId, roundIndex). Per Tom 2026-05-20: belt-skipping
   * past content IS the legitimate way to enter INF PLAY, so the
   * data model has to accept that. Entering INF PLAY = "I've reached
   * the end of the new content I want to deal with" — highest should
   * reflect that even if the learner didn't literally play every belt.
   * Forward-only via .or filter; existing higher values never regress.
   */
  async setMode(
    learnerId: string,
    courseId: string,
    mode: 'main' | 'infplay',
    ratchetHighestTo?: { legoId: string; roundIndex: number }
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        current_mode: mode,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);
    if (error) {
      throw new Error(`Failed to set mode: ${error.message}`);
    }

    // First-ever INF PLAY entry: bump counter from 0/null to 1.
    // .or filter ensures we don't overwrite a non-zero lifetime count.
    if (mode === 'infplay') {
      const { error: initErr } = await this.client
        .schema(this.schema)
        .from('course_enrollments')
        .update({ infplay_round_index: 1 })
        .eq('learner_id', learnerId)
        .eq('course_id', courseId)
        .or('infplay_round_index.is.null,infplay_round_index.eq.0');
      if (initErr) {
        throw new Error(`Failed to initialise infplay counter: ${initErr.message}`);
      }

      // Ratchet highest_* to the course's final main-loop LEGO.
      //
      // CRITICAL: write LAST_completed_lego_id, not highest_*. The
      // ratchet trigger (migration 20260512_lego_id_independent_ratchet)
      // ONLY respects writes via last_completed_lego_id — its ELSE
      // branch overwrites any direct highest_completed_lego_id write
      // with OLD.highest_completed_lego_id, undoing direct ratchets
      // silently.
      //
      // So we update last_completed_lego_id = finalLegoId — the
      // trigger then lifts highest_completed_lego_id to match (and
      // leaves highest_completed_round_index alone, since we don't
      // touch last_completed_round_index here, which is correct:
      // the cursor's round_index may already be deep into infplay
      // territory and we don't want to regress it).
      //
      // Forward-only via the .or filter — never lowers an existing
      // higher last_completed_lego_id.
      if (ratchetHighestTo) {
        const { error: rErr } = await this.client
          .schema(this.schema)
          .from('course_enrollments')
          .update({
            last_completed_lego_id: ratchetHighestTo.legoId,
          })
          .eq('learner_id', learnerId)
          .eq('course_id', courseId)
          .or(`last_completed_lego_id.is.null,last_completed_lego_id.lt.${ratchetHighestTo.legoId}`);
        if (rErr) {
          throw new Error(`Failed to ratchet last_lego on infplay entry: ${rErr.message}`);
        }
      }
    }
  }

  /**
   * Increment infplay_round_index by 1 — call once per round_complete
   * while in INF PLAY mode. PostgREST has no "increment" verb; we read
   * the current value and write current+1. Race-condition safe enough
   * for single-device play (the only place writing).
   */
  async bumpInfplayRound(
    learnerId: string,
    courseId: string
  ): Promise<void> {
    const { data, error: readErr } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .select('current_mode, infplay_round_index')
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .single();
    if (readErr) {
      throw new Error(`Failed to read enrollment for bump: ${readErr.message}`);
    }
    if (!data || data.current_mode !== 'infplay') return;  // mode='main' → no-op
    const next = ((data.infplay_round_index as number) ?? 0) + 1;
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({ infplay_round_index: next })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);
    if (error) {
      throw new Error(`Failed to bump infplay round: ${error.message}`);
    }
  }

  async setEnrollmentCursor(
    learnerId: string,
    courseId: string,
    legoId: string,
    roundIndex: number
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        last_completed_lego_id: legoId,
        last_completed_round_index: roundIndex,
        // Backwards regressions (e.g. resume TTL belt-reset) imply the
        // learner is restarting the round; carry-over cycle indices
        // belong to a different round and would mislead the resume
        // logic. Always reset on cursor set.
        current_cycle_index: 0,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);

    if (error) {
      throw new Error(`Failed to set enrollment cursor: ${error.message}`);
    }
  }

  /**
   * Live-position write — the cursor IS where the playhead is right now
   * (the round currently playing + the cycle within it). Written on every
   * cycle during normal forward play. This is the "position, not completion"
   * model: last_completed_* names a position, not an achievement, so resume
   * lands here directly with no "+1".
   *
   * Sets all three of legoId / roundIndex / cycleIndex to the LIVE values —
   * crucially it does NOT reset current_cycle_index (unlike setEnrollmentCursor),
   * so a mid-round resume position is never wiped.
   *
   * Forward-only on round_index via `<=` so same-round cycle bumps pass while
   * a regression to a LOWER round (e.g. a glitched in-memory index) is
   * rejected — preserving the round-0-overwrite protection that
   * updateEnrollmentProgress added. Intentional backward moves (belt-back,
   * jump-to-belt) go through setEnrollmentCursor, which has no guard.
   */
  async setLivePosition(
    learnerId: string,
    courseId: string,
    legoId: string,
    roundIndex: number,
    cycleIndex: number
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        last_completed_lego_id: legoId,
        last_completed_round_index: roundIndex,
        current_cycle_index: cycleIndex,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .or(`last_completed_round_index.is.null,last_completed_round_index.lte.${roundIndex}`);

    if (error) {
      throw new Error(`Failed to set live position: ${error.message}`);
    }
  }

  async updateEnrollmentActivity(
    learnerId: string,
    courseId: string,
    highestSeed: number,
    practiceMinutes: number
  ): Promise<void> {
    // First get current values to take the max
    const { data: enrollment, error: readErr } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .select('highest_completed_seed, total_practice_minutes')
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .single();

    // PGRST116 = no row yet (the UPDATE below would no-op harmlessly). Any
    // other error (network, RLS) means we can't trust the current totals — bail
    // rather than overwrite total_practice_minutes from a false zero baseline,
    // which would wipe the learner's accumulated minutes.
    if (readErr && readErr.code !== 'PGRST116') {
      console.warn(`Skipping enrollment activity update (read failed): ${readErr.message}`);
      return;
    }

    const currentHighest = enrollment?.highest_completed_seed || 0;
    const currentMinutes = enrollment?.total_practice_minutes || 0;

    const { error } = await this.client
      .schema(this.schema)
      .from('course_enrollments')
      .update({
        highest_completed_seed: Math.max(currentHighest, highestSeed),
        total_practice_minutes: currentMinutes + practiceMinutes,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);

    if (error) {
      console.warn(`Failed to update enrollment activity: ${error.message}`);
    }
  }

  // ============================================
  // LEGO PROGRESS
  // ============================================

  async getLegoProgress(
    learnerId: string,
    courseId: string
  ): Promise<LegoProgressRecord[]> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('lego_progress')
      .select('*')
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);

    if (error) {
      throw new Error(`Failed to get LEGO progress: ${error.message}`);
    }

    return (data ?? []).map(this.mapToLegoProgressRecord);
  }

  async getLegoProgressById(
    learnerId: string,
    legoId: string
  ): Promise<LegoProgressRecord | null> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('lego_progress')
      .select('*')
      .eq('learner_id', learnerId)
      .eq('lego_id', legoId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get LEGO progress: ${error.message}`);
    }

    return this.mapToLegoProgressRecord(data);
  }

  async saveLegoProgress(
    progress: Omit<LegoProgressRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<LegoProgressRecord> {
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .schema(this.schema)
      .from('lego_progress')
      .insert({
        learner_id: progress.learner_id,
        lego_id: progress.lego_id,
        course_id: progress.course_id,
        thread_id: progress.thread_id,
        fibonacci_position: progress.fibonacci_position,
        skip_number: progress.skip_number,
        reps_completed: progress.reps_completed,
        is_retired: progress.is_retired,
        last_practiced_at: progress.last_practiced_at?.toISOString() ?? null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save LEGO progress: ${error.message}`);
    }

    return this.mapToLegoProgressRecord(data);
  }

  async updateLegoProgress(
    id: string,
    updates: Partial<LegoProgress>
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.fibonacci_position !== undefined) {
      updateData.fibonacci_position = updates.fibonacci_position;
    }
    if (updates.skip_number !== undefined) {
      updateData.skip_number = updates.skip_number;
    }
    if (updates.reps_completed !== undefined) {
      updateData.reps_completed = updates.reps_completed;
    }
    if (updates.is_retired !== undefined) {
      updateData.is_retired = updates.is_retired;
    }
    if (updates.last_practiced_at !== undefined) {
      updateData.last_practiced_at = updates.last_practiced_at?.toISOString() ?? null;
    }

    const { error } = await this.client
      .schema(this.schema)
      .from('lego_progress')
      .update(updateData)
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update LEGO progress: ${error.message}`);
    }
  }

  async bulkUpdateLegoProgress(
    updates: Array<{ id: string; updates: Partial<LegoProgress> }>
  ): Promise<void> {
    // Supabase doesn't have native bulk update, so we use a transaction via RPC
    // For now, we'll do sequential updates (can be optimized later)
    const promises = updates.map(({ id, updates: u }) =>
      this.updateLegoProgress(id, u)
    );

    await Promise.all(promises);
  }

  // ============================================
  // SEED PROGRESS
  // ============================================

  async getSeedProgress(
    learnerId: string,
    courseId: string
  ): Promise<SeedProgressRecord[]> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('seed_progress')
      .select('*')
      .eq('learner_id', learnerId)
      .eq('course_id', courseId);

    if (error) {
      throw new Error(`Failed to get SEED progress: ${error.message}`);
    }

    return (data ?? []).map(this.mapToSeedProgressRecord);
  }

  async saveSeedProgress(
    progress: Omit<SeedProgressRecord, 'id' | 'created_at' | 'updated_at'>
  ): Promise<SeedProgressRecord> {
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .schema(this.schema)
      .from('seed_progress')
      .insert({
        learner_id: progress.learner_id,
        seed_id: progress.seed_id,
        course_id: progress.course_id,
        thread_id: progress.thread_id,
        is_introduced: progress.is_introduced,
        introduced_at: progress.introduced_at?.toISOString() ?? null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save SEED progress: ${error.message}`);
    }

    return this.mapToSeedProgressRecord(data);
  }

  async updateSeedProgress(
    id: string,
    updates: Partial<SeedProgress>
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (updates.is_introduced !== undefined) {
      updateData.is_introduced = updates.is_introduced;
    }
    if (updates.introduced_at !== undefined) {
      updateData.introduced_at = updates.introduced_at?.toISOString() ?? null;
    }

    const { error } = await this.client
      .schema(this.schema)
      .from('seed_progress')
      .update(updateData)
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to update SEED progress: ${error.message}`);
    }
  }

  // ============================================
  // LEARNER BASELINE (Calibration)
  // ============================================

  async getBaseline(
    learnerId: string,
    courseId: string
  ): Promise<LearnerBaselineRecord | null> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('learner_baselines')
      .select('*')
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw new Error(`Failed to get learner baseline: ${error.message}`);
    }

    return this.mapToBaselineRecord(data);
  }

  async saveBaseline(
    learnerId: string,
    courseId: string,
    baseline: LearnerBaseline
  ): Promise<LearnerBaselineRecord> {
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .schema(this.schema)
      .from('learner_baselines')
      .insert({
        learner_id: learnerId,
        course_id: courseId,
        calibrated_at: baseline.calibrated_at.toISOString(),
        calibration_items: baseline.calibration_items,
        latency_mean: baseline.latency.mean,
        latency_std_dev: baseline.latency.stdDev,
        duration_delta_mean: baseline.durationDelta.mean,
        duration_delta_std_dev: baseline.durationDelta.stdDev,
        had_timing_data: baseline.hadTimingData,
        metadata: baseline.metadata ?? null,
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save learner baseline: ${error.message}`);
    }

    return this.mapToBaselineRecord(data);
  }

  async updateBaseline(
    learnerId: string,
    courseId: string,
    baseline: LearnerBaseline
  ): Promise<LearnerBaselineRecord> {
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .schema(this.schema)
      .from('learner_baselines')
      .update({
        calibrated_at: baseline.calibrated_at.toISOString(),
        calibration_items: baseline.calibration_items,
        latency_mean: baseline.latency.mean,
        latency_std_dev: baseline.latency.stdDev,
        duration_delta_mean: baseline.durationDelta.mean,
        duration_delta_std_dev: baseline.durationDelta.stdDev,
        had_timing_data: baseline.hadTimingData,
        metadata: baseline.metadata ?? null,
        updated_at: now,
      })
      .eq('learner_id', learnerId)
      .eq('course_id', courseId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update learner baseline: ${error.message}`);
    }

    return this.mapToBaselineRecord(data);
  }

  // ============================================
  // MAPPERS
  // ============================================

  private mapToLearnerRecord(data: Record<string, unknown>): LearnerRecord {
    return {
      id: data.id as string,
      user_id: data.user_id as string,
      display_name: data.display_name as string,
      created_at: new Date(data.created_at as string),
      updated_at: new Date(data.updated_at as string),
      preferences: data.preferences as LearnerPreferences,
    };
  }

  private mapToEnrollmentRecord(data: Record<string, unknown>): CourseEnrollmentRecord {
    return {
      id: data.id as string,
      learner_id: data.learner_id as string,
      course_id: data.course_id as string,
      enrolled_at: new Date(data.enrolled_at as string),
      last_practiced_at: data.last_practiced_at
        ? new Date(data.last_practiced_at as string)
        : null,
      total_practice_minutes: data.total_practice_minutes as number,
      helix_state: data.helix_state as HelixState,
      last_completed_lego_id: (data.last_completed_lego_id as string) ?? null,
      last_completed_round_index: (data.last_completed_round_index as number) ?? null,
      current_cycle_index: (data.current_cycle_index as number) ?? null,
      highest_completed_round_index: (data.highest_completed_round_index as number) ?? null,
      highest_completed_lego_id: (data.highest_completed_lego_id as string) ?? null,
      current_mode: ((data.current_mode as string) === 'infplay' ? 'infplay' : 'main') as 'main' | 'infplay',
      infplay_round_index: (data.infplay_round_index as number) ?? 0,
    };
  }

  private mapToLegoProgressRecord(data: Record<string, unknown>): LegoProgressRecord {
    return {
      id: data.id as string,
      learner_id: data.learner_id as string,
      lego_id: data.lego_id as string,
      course_id: data.course_id as string,
      thread_id: data.thread_id as number,
      fibonacci_position: data.fibonacci_position as number,
      skip_number: data.skip_number as number,
      reps_completed: data.reps_completed as number,
      is_retired: data.is_retired as boolean,
      last_practiced_at: data.last_practiced_at
        ? new Date(data.last_practiced_at as string)
        : null,
      // ROUND tracking
      introduction_played: (data.introduction_played as boolean) ?? false,
      introduction_index: (data.introduction_index as number) ?? 0,
      introduction_complete: (data.introduction_complete as boolean) ?? false,
      // Eternal selection
      eternal_urn: (data.eternal_urn as string[]) ?? [],
      last_eternal_phrase_id: (data.last_eternal_phrase_id as string) ?? null,
      created_at: new Date(data.created_at as string),
      updated_at: new Date(data.updated_at as string),
    };
  }

  private mapToSeedProgressRecord(data: Record<string, unknown>): SeedProgressRecord {
    return {
      id: data.id as string,
      learner_id: data.learner_id as string,
      seed_id: data.seed_id as string,
      course_id: data.course_id as string,
      thread_id: data.thread_id as number,
      is_introduced: data.is_introduced as boolean,
      introduced_at: data.introduced_at
        ? new Date(data.introduced_at as string)
        : null,
      created_at: new Date(data.created_at as string),
      updated_at: new Date(data.updated_at as string),
    };
  }

  private mapToBaselineRecord(data: Record<string, unknown>): LearnerBaselineRecord {
    return {
      id: data.id as string,
      learner_id: data.learner_id as string,
      course_id: data.course_id as string,
      calibrated_at: new Date(data.calibrated_at as string),
      calibration_items: data.calibration_items as number,
      latency: {
        mean: data.latency_mean as number,
        stdDev: data.latency_std_dev as number,
      },
      durationDelta: {
        mean: data.duration_delta_mean as number,
        stdDev: data.duration_delta_std_dev as number,
      },
      hadTimingData: data.had_timing_data as boolean,
      metadata: data.metadata as LearnerBaseline['metadata'],
      created_at: new Date(data.created_at as string),
      updated_at: new Date(data.updated_at as string),
    };
  }
}

/**
 * Factory function
 */
export function createProgressStore(config: ProgressStoreConfig): ProgressStore {
  return new ProgressStore(config);
}
