-- ============================================================================
-- TEACHING-INSIGHTS (coverage lane) — analytics_class_coverage: the class as a
-- learner. One row per class: furthest LEGO reached, LEGOs advanced, active
-- minutes, and the wall-clock span needed to derive pace / dosage / efficiency.
-- ============================================================================
-- Status: DRAFT — reviewable, NOT YET APPLIED (Tom applies migrations).
-- Companion: docs/methodology/tutor-insights.md §2–§3 (the coverage lane).
--
-- WHY: "the class is itself a learner." The leadership distillation per class is
-- coverage (furthest LEGO), pace (coverage advance over wall-clock — LEGOs/wk),
-- dosage (active minutes/wk) and efficiency (LEGOs/min). Per §3 this is a pure
-- GROUP BY over class_sessions — which ALREADY EXISTS — so it needs ZERO new
-- event instrumentation and is INDEPENDENT of the Lane B teacher_user_id cleanup
-- (it groups by the clean class_id foreign key, never the dirty teacher_user_id).
-- The TS resolver (data/coverage.ts) turns these raw aggregates into the rates +
-- tones; the SQL does only the group-by so the heavy furthest/span work is indexed.
--
-- SAFETY / GATING: this names classes (a school's operational data), so it is
-- gated **admin-only** via is_god_user() — it RAISEs for any non-god caller (the
-- resolver catches → empty table). Teacher-scoping (a teacher sees only their own
-- classes via user_tags) is a FOLLOW-ON once the class-first-class-citizen
-- teacher↔class relationship lands (tutor-insights.md §5 / §7); admin-only is the
-- correct first cut and matches analytics_difficulty_turns.
--
-- LEGO ids are S####L## — parsed to an orderable integer (seed*100 + lego) so
-- "furthest reached" is a plain MAX. legos_advanced = furthest - earliest start,
-- floored at 0 (a class that only ever replayed the same LEGO covers 0 new ground).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.analytics_class_coverage(
  p_days integer DEFAULT 90
)
RETURNS TABLE (
  class_id uuid,
  class_name text,
  course_code text,
  furthest_lego_id text,
  legos_advanced integer,
  active_minutes numeric,
  active_weeks numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_god_user() THEN
    RAISE EXCEPTION 'analytics_class_coverage: admin only';
  END IF;

  RETURN QUERY
  WITH windowed AS (
    SELECT
      s.class_id,
      s.start_lego_id,
      s.end_lego_id,
      s.duration_seconds,
      s.started_at,
      -- parse S####L## -> seed*100 + lego (orderable). NULL-safe via regex guard.
      CASE WHEN s.start_lego_id ~ '^S[0-9]+L[0-9]+$'
        THEN (split_part(substring(s.start_lego_id from 2), 'L', 1))::int * 100
           + (split_part(s.start_lego_id, 'L', 2))::int
        ELSE NULL END AS start_order,
      CASE WHEN s.end_lego_id ~ '^S[0-9]+L[0-9]+$'
        THEN (split_part(substring(s.end_lego_id from 2), 'L', 1))::int * 100
           + (split_part(s.end_lego_id, 'L', 2))::int
        ELSE NULL END AS end_order
    FROM public.class_sessions s
    WHERE s.started_at >= now() - make_interval(days => p_days)
  ),
  agg AS (
    SELECT
      w.class_id,
      MAX(GREATEST(COALESCE(w.end_order, 0), COALESCE(w.start_order, 0))) AS furthest_order,
      MIN(COALESCE(w.start_order, w.end_order))                          AS earliest_order,
      SUM(w.duration_seconds)                                            AS total_seconds,
      MIN(w.started_at)                                                  AS first_at,
      MAX(w.started_at)                                                  AS last_at
    FROM windowed w
    GROUP BY w.class_id
  )
  SELECT
    a.class_id,
    c.class_name,
    c.course_code,
    -- render the furthest order back to S####L## (zero-padded seed to match ids)
    CASE WHEN a.furthest_order > 0
      THEN 'S' || lpad((a.furthest_order / 100)::text, 4, '0')
              || 'L' || lpad((a.furthest_order % 100)::text, 2, '0')
      ELSE NULL END                                                       AS furthest_lego_id,
    GREATEST(COALESCE(a.furthest_order, 0) - COALESCE(a.earliest_order, 0), 0)::int AS legos_advanced,
    ROUND(COALESCE(a.total_seconds, 0) / 60.0, 1)                         AS active_minutes,
    -- wall-clock span of activity in weeks, floored at one day so single-session
    -- classes don't divide by ~0 (the TS resolver also floors, belt-and-braces).
    GREATEST(EXTRACT(EPOCH FROM (a.last_at - a.first_at)) / 604800.0, 1.0 / 7.0)::numeric AS active_weeks
  FROM agg a
  JOIN public.classes c ON c.id = a.class_id
  ORDER BY legos_advanced DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_class_coverage(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.analytics_class_coverage(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
