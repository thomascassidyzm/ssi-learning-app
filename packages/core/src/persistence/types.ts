/**
 * Types for data persistence layer
 *
 * Supports:
 * - Learner progress (per LEGO, per SEED)
 * - Session history
 * - Metrics and analytics
 * - Offline sync queue
 */

import type {
  LegoProgress,
  SeedProgress,
  HelixState,
} from '../data/types';
import type { SessionMetrics, ResponseMetric, SpikeEvent, LearnerBaseline } from '../learning/types';

// ============================================
// DATABASE RECORDS (what gets stored)
// ============================================

export interface LearnerRecord {
  id: string;
  /** Clerk user ID (string, e.g., "user_2abc123") */
  user_id: string;
  display_name: string;
  created_at: Date;
  updated_at: Date;
  preferences: LearnerPreferences;
}

export interface LearnerPreferences {
  /** Preferred session duration in minutes */
  session_duration_minutes: number;
  /** Whether to show encouragements */
  encouragements_enabled: boolean;
  /** Whether turbo mode is enabled */
  turbo_mode_enabled: boolean;
  /** Volume level (0-1) */
  volume: number;
}

export interface CourseEnrollmentRecord {
  id: string;
  learner_id: string;
  course_id: string;
  enrolled_at: Date;
  last_practiced_at: Date | null;
  total_practice_minutes: number;
  helix_state: HelixState;
}

export interface LegoProgressRecord extends LegoProgress {
  /** Database ID */
  id: string;
  /** Learner ID */
  learner_id: string;
  /** When created */
  created_at: Date;
  /** When last updated */
  updated_at: Date;
}

export interface SeedProgressRecord extends SeedProgress {
  /** Database ID */
  id: string;
  /** Learner ID */
  learner_id: string;
  /** When created */
  created_at: Date;
  /** When last updated */
  updated_at: Date;
}

export interface SessionRecord {
  id: string;
  learner_id: string;
  course_id: string;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: number;
  items_practiced: number;
  spikes_detected: number;
  final_rolling_average: number;
}

export interface MetricRecord extends ResponseMetric {
  /** Database ID */
  db_id: string;
  /** Session ID */
  session_id: string;
  /** Learner ID */
  learner_id: string;
  /** Course ID */
  course_id: string;
}

export interface SpikeRecord extends SpikeEvent {
  /** Database ID */
  db_id: string;
  /** Session ID */
  session_id: string;
  /** Learner ID */
  learner_id: string;
  /** Course ID */
  course_id: string;
}

/**
 * Learner baseline record for Supabase storage.
 * Stores the calibrated timing baseline per learner per course.
 */
export interface LearnerBaselineRecord extends LearnerBaseline {
  /** Database ID */
  id: string;
  /** Learner ID */
  learner_id: string;
  /** Course ID (baseline may vary by language pair) */
  course_id: string;
  /** When created */
  created_at: Date;
  /** When last updated */
  updated_at: Date;
}

// ============================================
// SYNC QUEUE (for offline support)
// ============================================

export type SyncOperation = 'create' | 'update' | 'delete';
export type SyncEntity =
  | 'lego_progress'
  | 'seed_progress'
  | 'session'
  | 'metric'
  | 'spike'
  | 'enrollment'
  | 'learner_baseline';

export interface SyncQueueItem {
  id: string;
  entity: SyncEntity;
  operation: SyncOperation;
  entity_id: string;
  payload: unknown;
  created_at: Date;
  attempts: number;
  last_attempt_at: Date | null;
  error: string | null;
}

export interface SyncStatus {
  pending_count: number;
  last_sync_at: Date | null;
  is_syncing: boolean;
  last_error: string | null;
}

// ============================================
// STORE INTERFACES
// ============================================

export interface IProgressStore {
  // Learner management
  getLearner(learnerId: string): Promise<LearnerRecord | null>;
  updateLearnerPreferences(learnerId: string, prefs: Partial<LearnerPreferences>): Promise<void>;

  // Course enrollment
  getEnrollment(learnerId: string, courseId: string): Promise<CourseEnrollmentRecord | null>;
  createEnrollment(learnerId: string, courseId: string): Promise<CourseEnrollmentRecord>;
  updateHelixState(learnerId: string, courseId: string, state: HelixState): Promise<void>;

  // LEGO progress
  getLegoProgress(learnerId: string, courseId: string): Promise<LegoProgressRecord[]>;
  getLegoProgressById(learnerId: string, legoId: string): Promise<LegoProgressRecord | null>;
  saveLegoProgress(progress: Omit<LegoProgressRecord, 'id' | 'created_at' | 'updated_at'>): Promise<LegoProgressRecord>;
  updateLegoProgress(id: string, updates: Partial<LegoProgress>): Promise<void>;
  bulkUpdateLegoProgress(updates: Array<{ id: string; updates: Partial<LegoProgress> }>): Promise<void>;

  // SEED progress
  getSeedProgress(learnerId: string, courseId: string): Promise<SeedProgressRecord[]>;
  saveSeedProgress(progress: Omit<SeedProgressRecord, 'id' | 'created_at' | 'updated_at'>): Promise<SeedProgressRecord>;
  updateSeedProgress(id: string, updates: Partial<SeedProgress>): Promise<void>;

  // Learner baseline (calibration data)
  getBaseline(learnerId: string, courseId: string): Promise<LearnerBaselineRecord | null>;
  saveBaseline(learnerId: string, courseId: string, baseline: LearnerBaseline): Promise<LearnerBaselineRecord>;
  updateBaseline(learnerId: string, courseId: string, baseline: LearnerBaseline): Promise<LearnerBaselineRecord>;
}

export interface ISessionStore {
  // Session management
  startSession(learnerId: string, courseId: string): Promise<SessionRecord>;
  endSession(sessionId: string, metrics: SessionMetrics): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | null>;
  getRecentSessions(learnerId: string, limit?: number): Promise<SessionRecord[]>;

  // Metrics
  saveMetrics(sessionId: string, metrics: ResponseMetric[]): Promise<void>;
  saveSpikes(sessionId: string, spikes: SpikeEvent[]): Promise<void>;
  getSessionMetrics(sessionId: string): Promise<MetricRecord[]>;
  getSessionSpikes(sessionId: string): Promise<SpikeRecord[]>;
}

export interface ISyncService {
  // Queue management
  queueOperation(entity: SyncEntity, operation: SyncOperation, entityId: string, payload: unknown): Promise<void>;
  processQueue(): Promise<number>;
  getQueueStatus(): Promise<SyncStatus>;
  clearQueue(): Promise<void>;

  // Sync control
  startAutoSync(intervalMs?: number): void;
  stopAutoSync(): void;
  forcSync(): Promise<void>;

  // Events
  onSyncComplete(callback: (count: number) => void): void;
  onSyncError(callback: (error: Error) => void): void;
}

// ============================================
// SUPABASE SPECIFIC
// ============================================

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** Schema to use (default: 'public') */
  schema?: string;
}

export interface SupabaseClientOptions {
  /** Whether to persist session (default: true) */
  persistSession?: boolean;
  /** Auto-refresh token (default: true) */
  autoRefreshToken?: boolean;
}
