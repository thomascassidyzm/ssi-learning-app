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

  async endSession(
    sessionId: string,
    metrics: SessionMetrics
  ): Promise<SessionRecord> {
    const endedAt = metrics.ended_at ?? new Date();
    const durationSeconds = Math.floor(
      (endedAt.getTime() - metrics.started_at.getTime()) / 1000
    );

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
