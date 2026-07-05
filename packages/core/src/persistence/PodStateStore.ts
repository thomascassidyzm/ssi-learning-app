/**
 * PodStateStore — the shared per-sentence pod maturity counter
 * (`learner_pod_state`): the "two doors, one counter" bridge.
 *
 * `exposures` = exposures COMPLETED for a pod sentence, across BOTH doors:
 * main-flow pod laps and Listening Mode Drill. The main flow serves a
 * sentence at view `effective + 1` where
 * `effective = max(derived alive − 1, exposures)`; Drill serves fusion rung
 * `effective` (rung 0 = first exposure). Each door writes back
 * `effective + 1` after a completed lap / drill pass — forward-only by
 * construction, so a lost row can never send a learner backwards (the
 * derived main-flow value remains the inheritance floor).
 *
 * Keyed by the client-side per-sentence id convention:
 * `listening_pod_sentences.id` for a whole-turn row, `${id}:s${index}` for a
 * June-split per-sentence unit. Mirrors LegoListeningStore (learner_l1_state).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PodStateUpsert {
  learner_id: string;
  course_code: string;
  sentence_id: string;
  exposures: number;
}

export interface PodStateStoreConfig {
  client: SupabaseClient;
  schema?: string;
}

export class PodStateStore {
  private client: SupabaseClient;
  private schema: string;

  constructor(config: PodStateStoreConfig) {
    this.client = config.client;
    this.schema = config.schema ?? 'public';
  }

  /** Load every sentence exposure count for this learner + course.
   *  Returns a Map keyed by sentence_id. */
  async loadAll(learnerId: string, courseCode: string): Promise<Map<string, number>> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('learner_pod_state')
      .select('sentence_id, exposures')
      .eq('learner_id', learnerId)
      .eq('course_code', courseCode);

    if (error) {
      throw new Error(`Failed to load pod state: ${error.message}`);
    }

    const map = new Map<string, number>();
    for (const row of data ?? []) {
      if (typeof row.sentence_id === 'string' && typeof row.exposures === 'number') {
        map.set(row.sentence_id, row.exposures);
      }
    }
    return map;
  }

  /** Upsert a batch of (learner, course, sentence_id) → exposures rows. */
  async upsertMany(rows: PodStateUpsert[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client
      .schema(this.schema)
      .from('learner_pod_state')
      .upsert(rows, { onConflict: 'learner_id,course_code,sentence_id' });

    if (error) {
      throw new Error(`Failed to upsert pod state: ${error.message}`);
    }
  }

  /** Delete every row for this learner + course (course reset). */
  async deleteAll(learnerId: string, courseCode: string): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('learner_pod_state')
      .delete()
      .eq('learner_id', learnerId)
      .eq('course_code', courseCode);

    if (error) {
      throw new Error(`Failed to delete pod state: ${error.message}`);
    }
  }
}
