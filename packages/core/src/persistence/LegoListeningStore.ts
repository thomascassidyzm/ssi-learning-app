/**
 * LegoListeningStore — per-learner per-seed Layer 1 listening fire counts.
 *
 * Keyed by lego_id (the seed's completing LEGO — highest lego_index for
 * that seed_number), per the codebase convention "always use LEGO number
 * which encrypts seed number within it".
 *
 * Drives the Stage 1 → Stage 4 playlist progression in generateLearningScript.
 * Without persistence the in-script seedL1FireCount Map resets every
 * generation, so every seed perpetually plays the Stage 1 slow-then-fast
 * playlist and the methodology's decay to a single 2× rep never happens.
 *
 * Read on player mount, upserted in batches after L1 cluster fires + on
 * pagehide.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface LegoListeningRow {
  learner_id: string;
  course_code: string;
  lego_id: string;          // e.g. 'S0001L03' — seed's completing LEGO
  fire_count: number;
  last_fired_at: Date | null;
}

export type LegoListeningUpsert = Omit<LegoListeningRow, 'last_fired_at'> & {
  last_fired_at: Date | null;
};

export interface LegoListeningStoreConfig {
  client: SupabaseClient;
  schema?: string;
}

export class LegoListeningStore {
  private client: SupabaseClient;
  private schema: string;

  constructor(config: LegoListeningStoreConfig) {
    this.client = config.client;
    this.schema = config.schema ?? 'public';
  }

  /**
   * Load all per-seed fire counts for this learner + course.
   * Returns a Map keyed by lego_id (the seed's completing LEGO).
   */
  async loadAll(learnerId: string, courseCode: string): Promise<Map<string, number>> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('learner_l1_state')
      .select('lego_id, fire_count')
      .eq('learner_id', learnerId)
      .eq('course_code', courseCode);

    if (error) {
      throw new Error(`Failed to load l1 state: ${error.message}`);
    }

    const map = new Map<string, number>();
    for (const row of (data ?? [])) {
      if (typeof row.lego_id === 'string' && typeof row.fire_count === 'number') {
        map.set(row.lego_id, row.fire_count);
      }
    }
    return map;
  }

  /** Upsert a batch of (learner, course, lego_id) → fire_count rows. */
  async upsertMany(rows: LegoListeningUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    const payload = rows.map((r) => ({
      learner_id: r.learner_id,
      course_code: r.course_code,
      lego_id: r.lego_id,
      fire_count: r.fire_count,
      last_fired_at: r.last_fired_at ? r.last_fired_at.toISOString() : null,
    }));

    const { error } = await this.client
      .schema(this.schema)
      .from('learner_l1_state')
      .upsert(payload, { onConflict: 'learner_id,course_code,lego_id' });

    if (error) {
      throw new Error(`Failed to upsert l1 state: ${error.message}`);
    }
  }
}
