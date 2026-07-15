-- Real per-class Rate-compare data for schools roles (teacher/school_admin/
-- govt_admin), per docs/methodology/tutor-insights.md §2-3 (the COVERAGE lane
-- — the class as a learner) and insight-engine.md (one substrate, many lenses).
--
-- WHY A NEW FUNCTION rather than reusing analytics_class_coverage: that
-- function is admin-only (RAISE EXCEPTION unless is_god_user()) and returns
-- EVERY class course-wide with no scope filter — exactly the shape doctrine
-- says schools roles must never read directly (CLAUDE.md: "reads for
-- cross-entity aggregates go through server endpoints, not raw client org-
-- table reads"). This sibling function trusts an EXPLICIT class_id array
-- instead of an admin check, so authorization happens where it belongs: in
-- api/school/rate-compare.ts, via resolveVisibleScope, before this is ever
-- called. Not RLS, not a client-callable RPC — see the GRANT below.
--
-- It returns RAW ordinal-mapped session rows (not pre-aggregated numbers) so
-- the weekly-trend + cohort-average math can live in TypeScript, tested and
-- readable, exactly like coverage.ts already does for the admin board.
CREATE OR REPLACE FUNCTION public.analytics_class_sessions_scoped(
  p_class_ids uuid[],
  p_days integer DEFAULT 90
) RETURNS TABLE(
  class_id uuid,
  course_code text,
  start_lego_id text,
  end_lego_id text,
  start_ord integer,
  end_ord integer,
  duration_seconds integer,
  started_at timestamptz
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH lego_order AS (
    -- canonical position of every lego within its course (1-based) — same
    -- ground truth analytics_class_coverage uses for "legos advanced".
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
    WHERE s.class_id = ANY(p_class_ids)
      AND s.started_at >= now() - make_interval(days => GREATEST(p_days, 1))
      AND COALESCE(sc.is_demo, false) = false   -- drop demo schools; keep NULL-school (ACT)
  )
  SELECT
    se.class_id,
    se.course_code,
    se.start_lego_id,
    se.end_lego_id,
    lo_s.ord::integer AS start_ord,   -- ROW_NUMBER() is bigint; cast to match RETURNS TABLE
    lo_e.ord::integer AS end_ord,
    se.duration_seconds,
    se.started_at
  FROM sess se
  LEFT JOIN lego_order lo_s
    ON lo_s.course_code = se.course_code AND lo_s.lego_id = se.start_lego_id
  LEFT JOIN lego_order lo_e
    ON lo_e.course_code = se.course_code AND lo_e.lego_id = se.end_lego_id;
END;
$$;

-- No admin/RLS gate inside the function — it trusts its caller completely.
-- That is only safe because it is NEVER reachable from a browser session:
-- REVOKE the default PUBLIC/anon/authenticated grants and hand EXECUTE to
-- service_role only. The one caller is api/school/rate-compare.ts, which
-- resolves + checks the class_id scope server-side before invoking this.
REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer) FROM anon;
REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer) TO service_role;

NOTIFY pgrst, 'reload schema';
