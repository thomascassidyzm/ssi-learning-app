-- ============================================================================
-- METRICS B4 — persist the per-(learner, LEGO) difficulty SERIES the curvature
-- sensor reads.
-- ============================================================================
-- Status: DRAFT — reviewable, NOT YET APPLIED (Tom applies migrations).
-- Companion: docs/methodology/metrics-implementation-plan.md §1A (A3) / B4.
--
-- WHY
--   A3 gave `learner_lego_metrics` rolling SCALARS (mean_latency_ms, …). But the
--   curvature engine (B1) and local-difficulty sensor (B4) read a time-ordered
--   SERIES per (learner, unit) — they fit a local quadratic over a window of
--   recent samples. A single scalar has no curvature. So the rollup needs to
--   persist a bounded recent-sample series, which this adds.
--
--   Design decision (Option 2, via the BSC test, 2026-06-13): persist a bounded
--   recent-samples array on the Layer-1 row, rather than reconstruct the series
--   from Layer-0 events at read time. The plan's chain has the sensors reading
--   Layer 1 (B4 "depends on A3"); a one-row read is cheap; the cost is bounded
--   (the array is capped client-side at the last ~20 samples). Additive and
--   reversible.
--
-- SAFETY
--   Additive, nullable-with-default. The writer (LegoMetricsStore.upsertSeries)
--   writes this in a SEPARATE upsert from the existing mastery write, so code
--   shipped before this migration is applied does NOT regress mastery
--   persistence — the series write simply no-ops (logged) until the column
--   exists. Reversal: `ALTER TABLE public.learner_lego_metrics DROP COLUMN
--   recent_latency_samples;`
-- ============================================================================

ALTER TABLE public.learner_lego_metrics
  ADD COLUMN IF NOT EXISTS recent_latency_samples jsonb NOT NULL DEFAULT '[]'::jsonb;
  -- time-ordered, oldest→newest, normalized latency (ms/char). Capped to the
  -- last ~20 samples by the writer. The series B1 curvature / B4 difficulty read.

COMMENT ON COLUMN public.learner_lego_metrics.recent_latency_samples IS
  'Bounded time-ordered series (oldest→newest) of normalized latency for this (learner, lego) — the difficulty-bearing series the curvature/B4 sensors read. Capped ~20 by the writer. Added 2026-06-13 (metrics B4 rollup, Option 2).';

NOTIFY pgrst, 'reload schema';
