/**
 * Executable spec for the gated backfill migration
 * `supabase/migrations/20260724_backfill_meta_commentary_exposure.sql.gated`.
 *
 * Not runtime code — this mirrors the SQL's derivation rule exactly so the
 * backfill logic is unit-tested (the SQL itself can't run under vitest). If
 * the rule changes, change BOTH in lockstep.
 *
 * Rule: a learner's server-side instruction exposure is restored from the
 * furthest of three signals — the existing row, telemetry (distinct
 * `commentary_start` instruction events), and a practice-time estimate
 * (instructions fire ~1 per 10 active minutes, capped at the nominal
 * 30-instruction sequence). Complete when the index reaches the sequence end.
 * No evidence at all ⇒ no row (genuinely new learners start at 0).
 */

export const MINUTES_PER_INSTRUCTION = 10
export const NOMINAL_SEQUENCE_LENGTH = 30
/** Minimum practice minutes to count as evidence at all (SQL: `total_minutes >= 30`). */
export const MIN_EVIDENCE_MINUTES = 30

export interface BackfillEvidence {
  existingIndex: number
  existingComplete: boolean
  telemetryInstructionCount: number
  totalPracticeMinutes: number
}

export interface BackfillResult {
  /** null ⇒ no row written (no evidence). */
  instructionIndex: number | null
  instructionsComplete: boolean
}

export function backfillInstructionState(e: BackfillEvidence): BackfillResult {
  const hasEvidence =
    e.telemetryInstructionCount > 0 || e.totalPracticeMinutes >= MIN_EVIDENCE_MINUTES
  if (!hasEvidence && e.existingIndex === 0 && !e.existingComplete) {
    return { instructionIndex: null, instructionsComplete: false }
  }
  const minutesEstimate = Math.min(
    Math.floor(e.totalPracticeMinutes / MINUTES_PER_INSTRUCTION),
    NOMINAL_SEQUENCE_LENGTH,
  )
  const derived = hasEvidence
    ? Math.max(e.telemetryInstructionCount, minutesEstimate)
    : 0
  const index = Math.max(e.existingIndex, derived)
  return {
    instructionIndex: index,
    instructionsComplete: e.existingComplete || derived >= NOMINAL_SEQUENCE_LENGTH,
  }
}
