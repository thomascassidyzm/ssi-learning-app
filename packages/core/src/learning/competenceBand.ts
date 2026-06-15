/**
 * Competence band — the flat, hours-on-task estimate (metrics workstream G1).
 *
 * SSi has observed across ~17 years and thousands of learners that practice
 * time predicts conversational ability on the central tendency: ~30 hours of
 * in-app practice ≈ able to get into conversations ("entry-conversational"),
 * ~100 hours ≈ genuinely conversational at roughly B1 (`docs/methodology/
 * metrics-architecture.md` §2, §10 Step 2a, §12 H2 row). This is empirical
 * ground truth requiring no external validation — but it is FLAT: the same
 * number for everyone, with no per-learner finesse.
 *
 * This module turns `total_practice_minutes` (which exists today on
 * `course_enrollments` / `learner_metrics`) into that band. It is the honest,
 * crude, ship-now version of the assessment story — the per-learner finesse
 * (execution axis, calibration, cluster discovery) is the longer roadmap.
 *
 * DISCIPLINE (Principle 5 / §10): this is **not** a CEFR assessment and never a
 * hard level. It is a time-on-task population anchor. The fields here carry the
 * honesty (`basis: 'time-on-task'`, `confidence: 'flat-anchor'`) so any surface
 * that renders a band inherits the caveat; the surface still owns the user-facing
 * wording and the admin/tutor gating.
 *
 * Pure function. No app, storage, or i18n coupling — `label` is a short neutral
 * English identifier for logs/admin, not learner-facing copy.
 */

/** The 17-year SSi anchors, in hours of in-app practice. */
export const ENTRY_CONVERSATIONAL_HOURS = 30;
export const B1_CONVERSATIONAL_HOURS = 100;

export type CompetenceBandId =
  | 'warming_up' // below the first anchor — too little data to anchor
  | 'entry_conversational' // ~30h: can get into conversations
  | 'b1_conversational' // ~100h: genuinely conversational, ~B1
  | 'beyond_anchor'; // past the 100h anchor — beyond what the flat anchor resolves

export interface CompetenceBand {
  /** Which flat anchor band the learner sits in. */
  band: CompetenceBandId;
  /** Short neutral label for logs / admin surfaces (NOT learner-facing copy). */
  label: string;
  /** Practice time in hours (minutes / 60), clamped at 0. */
  hoursOnTask: number;
  /**
   * Progress through the current band toward the next anchor, in [0, 1].
   * 1 at and beyond the final anchor.
   */
  progressToNext: number;
  /**
   * What the estimate is built on — time-on-task only, NOT prosody/execution
   * and NOT a formal assessment. Load-bearing for honest framing.
   */
  basis: 'time-on-task';
  /**
   * The single, deliberately-humble confidence tier for this estimate. The flat
   * anchor is a population average, not a per-learner measurement.
   */
  confidence: 'flat-anchor';
}

const LABELS: Record<CompetenceBandId, string> = {
  warming_up: 'Warming up',
  entry_conversational: 'Entry-conversational (~30h anchor)',
  b1_conversational: 'Conversational, ~B1 (~100h anchor)',
  beyond_anchor: 'Beyond the 100h anchor',
};

/**
 * Map total practice minutes to the flat hours-on-task competence band.
 *
 * Non-finite or negative input is treated as zero practice (warming up) rather
 * than throwing — callers pass raw DB values which may be null-coalesced.
 */
export function competenceBand(totalPracticeMinutes: number): CompetenceBand {
  const minutes =
    Number.isFinite(totalPracticeMinutes) && totalPracticeMinutes > 0
      ? totalPracticeMinutes
      : 0;
  const hoursOnTask = minutes / 60;

  let band: CompetenceBandId;
  let progressToNext: number;

  if (hoursOnTask < ENTRY_CONVERSATIONAL_HOURS) {
    band = 'warming_up';
    progressToNext = hoursOnTask / ENTRY_CONVERSATIONAL_HOURS;
  } else if (hoursOnTask < B1_CONVERSATIONAL_HOURS) {
    band = 'entry_conversational';
    progressToNext =
      (hoursOnTask - ENTRY_CONVERSATIONAL_HOURS) /
      (B1_CONVERSATIONAL_HOURS - ENTRY_CONVERSATIONAL_HOURS);
  } else {
    // At or past the final anchor. We keep b1_conversational as the band the
    // 100h anchor names, and only call it 'beyond_anchor' once a learner is well
    // past it (2x) where the flat anchor genuinely stops resolving.
    band = hoursOnTask >= 2 * B1_CONVERSATIONAL_HOURS ? 'beyond_anchor' : 'b1_conversational';
    progressToNext = 1;
  }

  return {
    band,
    label: LABELS[band],
    hoursOnTask,
    progressToNext,
    basis: 'time-on-task',
    confidence: 'flat-anchor',
  };
}
