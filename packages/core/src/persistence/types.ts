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
  /** Supabase Auth user ID */
  user_id: string;
  display_name: string;
  created_at: Date;
  updated_at: Date;
  preferences: LearnerPreferences;
  /** All emails this learner has verified via OTP */
  verified_emails?: string[];
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
  /** Last accessed course code (cross-device persistence) */
  last_course_code?: string;
}

export interface CourseEnrollmentRecord {
  id: string;
  learner_id: string;
  course_id: string;
  enrolled_at: Date;
  last_practiced_at: Date | null;
  total_practice_minutes: number;
  helix_state: HelixState;
  /** Last completed LEGO ID - used for round-based resumption */
  last_completed_lego_id: string | null;
  /** Last completed round index - for faster resumption */
  last_completed_round_index: number | null;
  /** Cycle index within the in-progress round to resume from on reload.
   *  0 = start of round. Bumped on every cycle_completed; reset to 0 when
   *  the round completes. Lets a PWA update / app close+open mid-round
   *  resume from the cycle the learner was on rather than penalising
   *  them with a full round restart. */
  current_cycle_index: number | null;
  /** Furthest round the learner has ever reached - max-only, ratcheted by DB
   *  trigger. Used by the resting-state "skip to round N" jump when the
   *  cursor is behind the ceiling. */
  highest_completed_round_index: number | null;
  /** Companion to highest_completed_round_index - the lego at the ceiling.
   *  Used as the navigational hook to load the right chunk of content when
   *  the learner taps "skip to round N". Lego IDs have the form S0042L05, so
   *  the seed (and therefore the load target) is derivable from this field. */
  highest_completed_lego_id: string | null;
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
  updateEnrollmentProgress(learnerId: string, courseId: string, legoId: string, roundIndex: number): Promise<void>;
  updateCurrentCycle(learnerId: string, courseId: string, cycleIndex: number): Promise<void>;
  setEnrollmentCursor(learnerId: string, courseId: string, legoId: string, roundIndex: number): Promise<void>;
  updateEnrollmentActivity(learnerId: string, courseId: string, highestSeed: number, practiceMinutes: number): Promise<void>;

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
  checkpointSession(sessionId: string, itemsPracticed: number, durationSeconds: number): Promise<void>;
  // Per-cycle / per-play-segment counter — bypasses the session row entirely
  // so it works even when the session lifecycle has problems.
  bumpSpeakingOpportunities(learnerId: string, courseCode: string, oppsDelta: number, secondsDelta: number): Promise<void>;
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
