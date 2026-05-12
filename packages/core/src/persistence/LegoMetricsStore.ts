/**
 * LegoMetricsStore - Per-LEGO adaptive metrics persistence
 *
 * Drives per-LEGO pause adaptation. Sparse storage: one row per
 * (learner, lego) the learner has actually practiced. Read on player
 * mount, upserted every 10 cycles + on pagehide.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MasteryState } from '../learning/types';

export interface LegoMetricsRow {
  learner_id: string;
  lego_id: string;
  course_code: string;
  mastery_state: MasteryState;
  consecutive_smooth: number;
  consecutive_fast: number;
  n_samples: number;
  last_seen_at: Date;
  updated_at: Date;
}

export type LegoMetricsUpsert = Omit<LegoMetricsRow, 'updated_at'>;

export interface LegoMetricsStoreConfig {
  client: SupabaseClient;
  schema?: string;
}

export class LegoMetricsStore {
  private client: SupabaseClient;
  private schema: string;

  constructor(config: LegoMetricsStoreConfig) {
    this.client = config.client;
    this.schema = config.schema ?? 'public';
  }

  async loadAll(learnerId: string, courseCode: string): Promise<LegoMetricsRow[]> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('learner_lego_metrics')
      .select('*')
      .eq('learner_id', learnerId)
      .eq('course_code', courseCode);

    if (error) {
      throw new Error(`Failed to load lego metrics: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      learner_id: row.learner_id,
      lego_id: row.lego_id,
      course_code: row.course_code,
      mastery_state: row.mastery_state as MasteryState,
      consecutive_smooth: row.consecutive_smooth,
      consecutive_fast: row.consecutive_fast,
      n_samples: row.n_samples,
      last_seen_at: new Date(row.last_seen_at),
      updated_at: new Date(row.updated_at),
    }));
  }

  async upsertMany(rows: LegoMetricsUpsert[]): Promise<void> {
    if (rows.length === 0) return;

    const payload = rows.map((r) => ({
      learner_id: r.learner_id,
      lego_id: r.lego_id,
      course_code: r.course_code,
      mastery_state: r.mastery_state,
      consecutive_smooth: r.consecutive_smooth,
      consecutive_fast: r.consecutive_fast,
      n_samples: r.n_samples,
      last_seen_at: r.last_seen_at.toISOString(),
    }));

    const { error } = await this.client
      .schema(this.schema)
      .from('learner_lego_metrics')
      .upsert(payload, { onConflict: 'learner_id,lego_id' });

    if (error) {
      throw new Error(`Failed to upsert lego metrics: ${error.message}`);
    }
  }
}
