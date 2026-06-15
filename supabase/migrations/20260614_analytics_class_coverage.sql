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
-- DEMO EXCLUSION: a class belongs to a school (hard FK), and demo schools carry
-- schools.is_demo. We LEFT JOIN schools and keep only rows where is_demo is not
-- true — so synthetic demo classes never appear in the REAL admin coverage league
-- (the ?demo board path is served entirely client-side from data/demo.ts). The
-- LEFT JOIN preserves any class with a NULL school_id (e.g. an ACT single-tutor
-- class with no school).
--
-- LEGO COUNT (the fix): coverage is a position in the course's LEGO sequence, so
-- "LEGOs advanced" must be a TRUE COUNT of legos between two positions — NOT a
-- subtraction of the packed S####L## id. We derive each lego's canonical ordinal
-- from course_legos (ROW_NUMBER over seed_number, lego_index, per course) and
-- subtract ORDINALS. (An earlier draft subtracted a packed seed*100+lego key as
-- if it were a distance, which over-counts by ~100 every seed boundary — that is
-- what this rewrite fixes.) furthest_lego_id is the real lego_id at the max
-- ordinal, looked up straight from course_legos (no id reconstruction).
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
  WITH lego_order AS (
    -- canonical position of every lego within its course (1-based, dense by design
    -- since lego_id is unique per course). This is the ground truth for "how many
    -- legos lie between two positions" — the thing legos_advanced must measure.
    SELECT
      cl.course_code,
      cl.lego_id,
      ROW_NUMBER() OVER (
        PARTITION BY cl.course_code
        ORDER BY cl.seed_number, cl.lego_index
      ) AS ord
    FROM public.course_legos cl
  ),
  sess AS (
    -- the window's sessions, scoped to non-demo classes, carrying the class's course
    SELECT
      s.class_id,
      c.course_code,
      s.start_lego_id,
      s.end_lego_id,
      s.duration_seconds,
      s.started_at
    FROM public.class_sessions s
    JOIN public.classes c ON c.id = s.class_id
    LEFT JOIN public.schools sc ON sc.id = c.school_id
    WHERE s.started_at >= now() - make_interval(days => p_days)
      AND COALESCE(sc.is_demo, false) = false      -- drop demo schools; keep NULL-school (ACT)
  ),
  windowed AS (
    -- map each session's start/end lego_id to its canonical ordinal (per course)
    SELECT
      se.class_id,
      se.course_code,
      se.duration_seconds,
      se.started_at,
      lo_s.ord AS start_ord,
      lo_e.ord AS end_ord
    FROM sess se
    LEFT JOIN lego_order lo_s
      ON lo_s.course_code = se.course_code AND lo_s.lego_id = se.start_lego_id
    LEFT JOIN lego_order lo_e
      ON lo_e.course_code = se.course_code AND lo_e.lego_id = se.end_lego_id
  ),
  agg AS (
    SELECT
      w.class_id,
      w.course_code,
      MAX(GREATEST(COALESCE(w.end_ord, 0), COALESCE(w.start_ord, 0))) AS furthest_ord,
      MIN(COALESCE(w.start_ord, w.end_ord))                           AS earliest_ord,
      SUM(w.duration_seconds)                                         AS total_seconds,
      MIN(w.started_at)                                               AS first_at,
      MAX(w.started_at)                                               AS last_at
    FROM windowed w
    GROUP BY w.class_id, w.course_code
  )
  SELECT
    a.class_id,
    c.class_name,
    c.course_code,
    fl.lego_id                                                         AS furthest_lego_id,
    -- true count of legos advanced: furthest ordinal minus earliest start ordinal,
    -- floored at 0 (a class that only ever replayed the same lego covers 0 ground).
    GREATEST(COALESCE(a.furthest_ord, 0) - COALESCE(a.earliest_ord, a.furthest_ord), 0)::int AS legos_advanced,
    ROUND(COALESCE(a.total_seconds, 0) / 60.0, 1)                      AS active_minutes,
    -- wall-clock span of activity in weeks, floored at one day so single-session
    -- classes don't divide by ~0 (the TS resolver also floors, belt-and-braces).
    GREATEST(EXTRACT(EPOCH FROM (a.last_at - a.first_at)) / 604800.0, 1.0 / 7.0)::numeric AS active_weeks
  FROM agg a
  JOIN public.classes c ON c.id = a.class_id
  LEFT JOIN lego_order fl
    ON fl.course_code = a.course_code AND fl.ord = NULLIF(a.furthest_ord, 0)
  ORDER BY legos_advanced DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_class_coverage(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.analytics_class_coverage(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
