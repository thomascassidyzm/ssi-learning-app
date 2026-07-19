-- THE LENS (2026-07-19): let the node-scoped engine read a DEMO node's own
-- sessions.
--
-- analytics_class_sessions_scoped bakes in a demo-school exclusion so demo
-- data can never pollute REAL cohorts (2026-06-14 insight-RPC demo-exclusion
-- pass — still correct, still the default). But the node-scoped engine
-- (api/groups/[id]/rate-compare.ts) serves the SAME node-home surface whose
-- stats row already tells a demo school's practice hours — with the RPC
-- hard-excluding demo, the engine went honestly-blank on the very node whose
-- header says 266 practice hours. Same node, two stories, which breaks the
-- founder's "every lens tells the same story" law.
--
-- Fix: an ADDITIVE p_include_demo parameter, DEFAULT false. Every existing
-- caller (api/school/rate-compare.ts passes named args) resolves to the same
-- exclusion byte-for-byte. The node engine passes true ONLY when the entity
-- node is itself demo (demo orgs are self-contained subtrees, so a demo
-- entity's ancestor cohorts are demo peers) — a real entity's cohort never
-- gains a demo row.
--
-- Signature change (2-arg -> 3-arg-with-default) requires DROP + CREATE in
-- one transaction; grants re-stated on the new signature per RLS doctrine.

DROP FUNCTION IF EXISTS public.analytics_class_sessions_scoped(uuid[], integer);

CREATE FUNCTION public.analytics_class_sessions_scoped(
  p_class_ids uuid[],
  p_days integer DEFAULT 90,
  p_include_demo boolean DEFAULT false
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
      -- demo schools dropped by default; a caller inspecting a demo node
      -- opts in explicitly. NULL-school (ACT) rows always kept.
      AND (p_include_demo OR COALESCE(sc.is_demo, false) = false)
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

-- Same posture as 20260714: never reachable from a browser session — EXECUTE
-- for service_role only; the two callers (api/school/rate-compare.ts,
-- api/groups/[id]/rate-compare.ts) authorize server-side before invoking.
REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_class_sessions_scoped(uuid[], integer, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
