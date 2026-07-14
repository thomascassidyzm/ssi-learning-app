-- ============================================================================
-- ADAPTATION V2 — persist the shared evidence-aggregator series per (learner,
-- LEGO): docs/adaptation/adaptation-v2-build-spec.md §2 (WP-0) / WP-4.
-- ============================================================================
-- Status: DRAFT — reviewable, NOT YET APPLIED (Tom applies migrations).
--
-- WHY
--   The 20260613 migration (recent_latency_samples, now applied — see
--   schema.sql) persisted ONLY the latency producer's series. Adaptation v2's
--   EvidenceAggregator (evidence.ts, WP-0) merges latency + behavioural (+
--   eventually envelope) evidence into ONE series per unit — this column
--   persists THAT merged series so it carries across sessions, same reasoning
--   as the latency-only column it sits beside.
--
-- SHAPE
--   `{ values: number[], x: number[] }` — EvidenceSeries verbatim (evidence.ts),
--   ring-capped at 20 by the writer (EVIDENCE_SERIES_RING_CAP).
--
-- SAFETY
--   Additive, nullable-with-default. The writer (LegoMetricsStore.
--   upsertEvidenceSeries) writes this in a SEPARATE upsert, isolated from both
--   the mastery write and the recent_latency_samples write — code shipped
--   before this migration is applied does not regress either. Reversal:
--   `ALTER TABLE public.learner_lego_metrics DROP COLUMN evidence_series;`
-- ============================================================================

ALTER TABLE public.learner_lego_metrics
  ADD COLUMN IF NOT EXISTS evidence_series jsonb DEFAULT '{"values":[],"x":[]}'::jsonb NOT NULL;
  -- { values: number[], x: number[] } — the merged latency+behavioural (+
  -- envelope, stage 2) series the shared EvidenceAggregator reads/writes.
  -- Ring-capped ~20 by the writer. Same RLS posture as every other column on
  -- this table (own-row, matching the table's existing policies).

COMMENT ON COLUMN public.learner_lego_metrics.evidence_series IS
  'Adaptation v2 (WP-0/WP-4): the shared EvidenceAggregator''s merged series for this (learner, lego) — { values: number[], x: number[] }, oldest→newest, ring-capped ~20. Superset of recent_latency_samples (which stays as the pre-v2 latency-only signal). Added 2026-07-14.';

NOTIFY pgrst, 'reload schema';
