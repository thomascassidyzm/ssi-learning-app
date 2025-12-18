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
