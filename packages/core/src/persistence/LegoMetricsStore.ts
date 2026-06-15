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
  /** Rolling mean of `recent_latency_samples`; null until any sample lands. */
  mean_latency_ms: number | null;
  /**
   * Bounded, time-ordered (oldest→newest) normalized-latency series for this
   * (learner, lego) — the difficulty-bearing series the curvature (B1) /
   * local-difficulty (B4) sensors read. Empty array until samples land or when
   * the column is absent (pre-migration). Capped by the writer.
   */
  recent_latency_samples: number[];
  last_seen_at: Date;
  updated_at: Date;
}

export type LegoMetricsUpsert = Omit<
  LegoMetricsRow,
  'updated_at' | 'mean_latency_ms' | 'recent_latency_samples'
>;

/**
 * The B4 difficulty-series write — kept SEPARATE from the mastery upsert so
 * shipping it before the `recent_latency_samples` migration is applied cannot
 * regress mastery persistence (the series write simply fails in isolation).
 */
export interface LegoSeriesUpsert {
  learner_id: string;
  lego_id: string;
  course_code: string;
  recent_latency_samples: number[];
  mean_latency_ms: number | null;
}

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
      // Defensive: these columns may be absent (pre-migration) — default safely.
      mean_latency_ms: row.mean_latency_ms ?? null,
      recent_latency_samples: Array.isArray(row.recent_latency_samples)
        ? (row.recent_latency_samples as number[])
        : [],
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

  /**
   * Persist the per-(learner, lego) difficulty SERIES (B4). Call AFTER
   * `upsertMany` for the same legos so the row exists — this upsert touches only
   * the series columns and relies on the conflict→update path. Isolated from the
   * mastery write on purpose (see `LegoSeriesUpsert`).
   */
  async upsertSeries(rows: LegoSeriesUpsert[]): Promise<void> {
    if (rows.length === 0) return;

    const payload = rows.map((r) => ({
      learner_id: r.learner_id,
      lego_id: r.lego_id,
      course_code: r.course_code,
      recent_latency_samples: r.recent_latency_samples,
      mean_latency_ms: r.mean_latency_ms,
    }));

    const { error } = await this.client
      .schema(this.schema)
      .from('learner_lego_metrics')
      .upsert(payload, { onConflict: 'learner_id,lego_id' });

    if (error) {
      throw new Error(`Failed to upsert lego series: ${error.message}`);
    }
  }
}
