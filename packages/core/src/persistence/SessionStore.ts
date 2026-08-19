/**
 * SessionStore - Manages session and metrics persistence
 *
 * Provides abstraction over Supabase for:
 * - Session records
 * - Response metrics
 * - Spike events
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionMetrics, ResponseMetric, SpikeEvent } from '../learning/types';
import type {
  ISessionStore,
  SessionRecord,
  MetricRecord,
  SpikeRecord,
} from './types';

export interface SessionStoreConfig {
  /** Supabase client instance */
  client: SupabaseClient;
  /** Schema to use (default: 'public') */
  schema?: string;
}

export class SessionStore implements ISessionStore {
  private client: SupabaseClient;
  private schema: string;

  constructor(config: SessionStoreConfig) {
    this.client = config.client;
    this.schema = config.schema ?? 'public';
  }

  // ============================================
  // SESSION MANAGEMENT
  // ============================================

  async startSession(
    learnerId: string,
    courseId: string
  ): Promise<SessionRecord> {
    const now = new Date().toISOString();

    const { data, error } = await this.client
      .schema(this.schema)
      .from('sessions')
      .insert({
        learner_id: learnerId,
        course_id: courseId,
        started_at: now,
        ended_at: null,
        duration_seconds: 0,
        items_practiced: 0,
        spikes_detected: 0,
        final_rolling_average: 0,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to start session: ${error.message}`);
    }

    return this.mapToSessionRecord(data);
  }

  /**
   * Close a session row.
   *
   * `playSeconds` is REQUIRED and is the only accepted source of
   * duration_seconds. Time counts as in-app time when the app is PLAYING —
   * including listening — and does not count when it is not (owner ruling,
   * 2026-08-19). The caller measures that directly by accumulating segments
   * between playback start and stop; this method must never re-derive it.
   *
   * This used to compute `ended_at - started_at` instead, which is wall-clock
   * and counts every minute the tab sat idle. It also OVERWROTE the correct
   * play-seconds value that checkpointSession had already written. That is
   * what produced sessions claiming 128 hours with items_practiced = 0 — a
   * timer that was never closed, not a learner who studied for five days.
   * There is deliberately no wall-clock fallback: the parameter is required
   * so the old behaviour cannot creep back in as a default.
   */
  async endSession(
    sessionId: string,
    metrics: SessionMetrics,
    playSeconds: number
  ): Promise<SessionRecord> {
    const endedAt = metrics.ended_at ?? new Date();
    const durationSeconds = Math.max(0, Math.floor(playSeconds));

    const { data, error } = await this.client
      .schema(this.schema)
      .from('sessions')
      .update({
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds,
        items_practiced: metrics.items_practiced,
        spikes_detected: metrics.spikes_detected,
        final_rolling_average: metrics.final_rolling_average,
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to end session: ${error.message}`);
    }

    return this.mapToSessionRecord(data);
  }

  async checkpointSession(
    sessionId: string,
    itemsPracticed: number,
    durationSeconds: number
  ): Promise<void> {
    const { error } = await this.client
      .schema(this.schema)
      .from('sessions')
      .update({
        items_practiced: itemsPracticed,
        duration_seconds: durationSeconds,
        ended_at: new Date().toISOString(),  // Always update ended_at so we have a timestamp even if tab closes
      })
      .eq('id', sessionId);

    if (error) {
      // Don't throw — this is fire-and-forget. But log the full error so
      // RLS / type-cast / column-missing failures are visible in DevTools;
      // without code + details we can't tell why a checkpoint silently
      // never reaches the row.
      console.error('[SessionStore] checkpointSession FAILED:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        sessionId,
        itemsPracticed,
        durationSeconds,
      });
    }
  }

  /**
   * Bump the per-learner-per-course-per-UTC-day speaking opportunities
   * counter. Called per cycle (oppsDelta=1) and periodically with
   * accumulated play time delta. Fire-and-forget — must never block
   * playback. Errors are logged with full Postgres detail for diagnosis.
   *
   * Replaces the old sessions.items_practiced / duration_seconds path,
   * which silently failed when sessionStore was null at init.
   */
  async bumpSpeakingOpportunities(
    learnerId: string,
    courseCode: string,
    oppsDelta: number,
    secondsDelta: number
  ): Promise<void> {
    if (oppsDelta <= 0 && secondsDelta <= 0) return; // nothing to bump
    const { error } = await this.client.rpc('bump_speaking_opportunities', {
      p_learner_id: learnerId,
      p_course_code: courseCode,
      p_opps_delta: oppsDelta,
      p_seconds_delta: secondsDelta,
    });
    if (error) {
      console.error('[SessionStore] bumpSpeakingOpportunities FAILED:', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        learnerId,
        courseCode,
        oppsDelta,
        secondsDelta,
      });
    }
  }

  async getSession(sessionId: string): Promise<SessionRecord | null> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null;
      throw new Error(`Failed to get session: ${error.message}`);
    }

    return this.mapToSessionRecord(data);
  }

  async getRecentSessions(
    learnerId: string,
    limit: number = 10
  ): Promise<SessionRecord[]> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('sessions')
      .select('*')
      .eq('learner_id', learnerId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to get recent sessions: ${error.message}`);
    }

    return (data ?? []).map(this.mapToSessionRecord);
  }

  // ============================================
  // METRICS
  // ============================================

  async saveMetrics(
    sessionId: string,
    metrics: ResponseMetric[]
  ): Promise<void> {
    if (metrics.length === 0) return;

    // Get session info for learner_id and course_id
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const records = metrics.map((m) => ({
      id: m.id,
      session_id: sessionId,
      learner_id: session.learner_id,
      course_id: session.course_id,
      lego_id: m.lego_id,
      timestamp: m.timestamp.toISOString(),
      response_latency_ms: m.response_latency_ms,
      phrase_length: m.phrase_length,
      normalized_latency: m.normalized_latency,
      thread_id: m.thread_id,
      triggered_spike: m.triggered_spike,
      mode: m.mode,
    }));

    const { error } = await this.client
      .schema(this.schema)
      .from('response_metrics')
      .insert(records);

    if (error) {
      throw new Error(`Failed to save metrics: ${error.message}`);
    }
  }

  async saveSpikes(
    sessionId: string,
    spikes: SpikeEvent[]
  ): Promise<void> {
    if (spikes.length === 0) return;

    // Get session info
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const records = spikes.map((s) => ({
      id: s.id,
      session_id: sessionId,
      learner_id: session.learner_id,
      course_id: session.course_id,
      lego_id: s.lego_id,
      timestamp: s.timestamp.toISOString(),
      latency: s.latency,
      rolling_average: s.rolling_average,
      spike_ratio: s.spike_ratio,
      response: s.response,
      thread_id: s.thread_id,
    }));

    const { error } = await this.client
      .schema(this.schema)
      .from('spike_events')
      .insert(records);

    if (error) {
      throw new Error(`Failed to save spikes: ${error.message}`);
    }
  }

  async getSessionMetrics(sessionId: string): Promise<MetricRecord[]> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('response_metrics')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (error) {
      throw new Error(`Failed to get session metrics: ${error.message}`);
    }

    return (data ?? []).map(this.mapToMetricRecord);
  }

  async getSessionSpikes(sessionId: string): Promise<SpikeRecord[]> {
    const { data, error } = await this.client
      .schema(this.schema)
      .from('spike_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('timestamp', { ascending: true });

    if (error) {
      throw new Error(`Failed to get session spikes: ${error.message}`);
    }

    return (data ?? []).map(this.mapToSpikeRecord);
  }

  // ============================================
  // MAPPERS
  // ============================================

  private mapToSessionRecord(data: Record<string, unknown>): SessionRecord {
    return {
      id: data.id as string,
      learner_id: data.learner_id as string,
      course_id: data.course_id as string,
      started_at: new Date(data.started_at as string),
      ended_at: data.ended_at ? new Date(data.ended_at as string) : null,
      duration_seconds: data.duration_seconds as number,
      items_practiced: data.items_practiced as number,
      spikes_detected: data.spikes_detected as number,
      final_rolling_average: data.final_rolling_average as number,
    };
  }

  private mapToMetricRecord(data: Record<string, unknown>): MetricRecord {
    return {
      db_id: data.db_id as string,
      id: data.id as string,
      session_id: data.session_id as string,
      learner_id: data.learner_id as string,
      course_id: data.course_id as string,
      lego_id: data.lego_id as string,
      timestamp: new Date(data.timestamp as string),
      response_latency_ms: data.response_latency_ms as number,
      phrase_length: data.phrase_length as number,
      normalized_latency: data.normalized_latency as number,
      thread_id: data.thread_id as number,
      triggered_spike: data.triggered_spike as boolean,
      mode: data.mode as string,
    };
  }

  private mapToSpikeRecord(data: Record<string, unknown>): SpikeRecord {
    return {
      db_id: data.db_id as string,
      id: data.id as string,
      session_id: data.session_id as string,
      learner_id: data.learner_id as string,
      course_id: data.course_id as string,
      lego_id: data.lego_id as string,
      timestamp: new Date(data.timestamp as string),
      latency: data.latency as number,
      rolling_average: data.rolling_average as number,
      spike_ratio: data.spike_ratio as number,
      response: data.response as 'repeat' | 'breakdown',
      thread_id: data.thread_id as number,
    };
  }
}

/**
 * Factory function
 */
export function createSessionStore(config: SessionStoreConfig): SessionStore {
  return new SessionStore(config);
}
