-- ============================================================================
-- METRICS M1 — analytics_difficulty_turns: admin-gated read of the live
-- per-(learner, lego) difficulty SERIES for the "who's struggling / just
-- turned" consumer.
-- ============================================================================
-- Status: DRAFT — reviewable, NOT YET APPLIED (Tom applies migrations).
-- Companion: docs/methodology/metrics-implementation-plan.md §1 B4 / D3 / M1.
--
-- WHY: the curvature (B1) / local-difficulty (B4) sensors are TypeScript
-- (@ssi/core) and read a time-ordered series per (learner, unit). The series
-- now persists live in learner_lego_metrics.recent_latency_samples (M0). This
-- RPC is the admin-gated READ that hands those series to the Insight Engine
-- resolver (data/difficultyTurns.ts), which runs the sensor and ranks the
-- "needs attention" list. The sensor stays in TS; this just does the gated read.
--
-- PII: the rows are per-learner (who is struggling), so this is **admin-only** —
-- it RAISEs for any non-god caller (the resolver catches → empty table). This is
-- NOT an anon-callable aggregate like analytics_friction_map.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_difficulty_turns(
  p_days integer DEFAULT 30,
  p_min_samples integer DEFAULT 5
)
RETURNS TABLE (
  learner_id uuid,
  learner_name text,
  lego_id text,
  course_code text,
  recent_latency_samples jsonb,
  last_seen_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_god_user() THEN
    RAISE EXCEPTION 'analytics_difficulty_turns: admin only';
  END IF;

  RETURN QUERY
  SELECT
    m.learner_id,
    l.display_name AS learner_name,
    m.lego_id,
    m.course_code,
    m.recent_latency_samples,
    m.last_seen_at
  FROM public.learner_lego_metrics m
  JOIN public.learners l ON l.id = m.learner_id
  WHERE m.last_seen_at >= now() - make_interval(days => p_days)
    AND jsonb_array_length(COALESCE(m.recent_latency_samples, '[]'::jsonb)) >= p_min_samples
  ORDER BY m.last_seen_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_difficulty_turns(integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.analytics_difficulty_turns(integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
