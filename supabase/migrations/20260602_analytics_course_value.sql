-- analytics_course_value()
-- Per-course reach × stickiness × retention (LTV-proxy) for the Insight Engine courseValue metric.
--
-- Returns one row per course_code with:
--   reach            BIGINT   — distinct learners active last 30 days
--   enrolled         BIGINT   — total enrolled learners (denominator for retention)
--   stickiness_hours NUMERIC  — median total practice hours per active learner (last 30d)
--   retention_pct    NUMERIC  — pct of enrolled learners who practised in BOTH of the two most
--                               recent back-to-back 30-day windows (a simple return-rate proxy)
--   ltv_proxy        NUMERIC  — reach × stickiness_hours × (retention_pct / 100)
--
-- SECURITY DEFINER + is_god_user() gate — safe to call from the anon key via the admin client.
-- All tables read: learner_speaking_opportunities, course_enrollments.
-- Never writes data.

CREATE OR REPLACE FUNCTION analytics_course_value()
RETURNS TABLE(
  course_code      TEXT,
  reach            BIGINT,
  enrolled         BIGINT,
  stickiness_hours NUMERIC,
  retention_pct    NUMERIC,
  ltv_proxy        NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  RETURN QUERY
  WITH

  -- ── 1. reach: distinct learners active last 30 days (via learner_speaking_opportunities) ──
  reach_cte AS (
    SELECT
      lso.course_code,
      COUNT(DISTINCT lso.learner_id) AS reach
    FROM learner_speaking_opportunities lso
    WHERE lso.day >= CURRENT_DATE - 30
    GROUP BY lso.course_code
  ),

  -- ── 2. enrolled: all distinct learners ever enrolled per course ──
  enrolled_cte AS (
    SELECT
      ce.course_id AS course_code,
      COUNT(DISTINCT ce.learner_id) AS enrolled
    FROM course_enrollments ce
    GROUP BY ce.course_id
  ),

  -- ── 3. stickiness: per active learner, total practice hours in last 30d;
  --       then take the MEDIAN (percentile_cont 0.5) across active learners ──
  learner_hours_30d AS (
    SELECT
      lso.course_code,
      lso.learner_id,
      SUM(lso.play_seconds)::NUMERIC / 3600.0 AS hours_30d
    FROM learner_speaking_opportunities lso
    WHERE lso.day >= CURRENT_DATE - 30
    GROUP BY lso.course_code, lso.learner_id
  ),
  stickiness_cte AS (
    SELECT
      lh.course_code,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lh.hours_30d), 2) AS stickiness_hours
    FROM learner_hours_30d lh
    GROUP BY lh.course_code
  ),

  -- ── 4. retention: learners active in BOTH [60-31 days ago] AND [30-0 days ago] ──
  --       divided by learners active in [60-31 days ago] (rolling 30d return rate).
  --       Using course_enrollments.last_practiced_at for cheapness; if 0 denominator → 0%.
  active_window_new AS (
    SELECT
      ce.course_id AS course_code,
      COUNT(DISTINCT ce.learner_id) AS cnt
    FROM course_enrollments ce
    WHERE ce.last_practiced_at >= CURRENT_DATE - 30
    GROUP BY ce.course_id
  ),
  active_window_old AS (
    SELECT
      ce.course_id AS course_code,
      COUNT(DISTINCT ce.learner_id) AS cnt
    FROM course_enrollments ce
    WHERE ce.last_practiced_at >= CURRENT_DATE - 60
      AND ce.last_practiced_at <  CURRENT_DATE - 30
    GROUP BY ce.course_id
  ),
  -- Learners who were in the old window AND returned in the new window
  returned AS (
    SELECT
      lso_old.course_code,
      COUNT(DISTINCT lso_old.learner_id) AS ret_cnt
    FROM (
      SELECT DISTINCT course_code, learner_id
      FROM learner_speaking_opportunities
      WHERE day >= CURRENT_DATE - 60
        AND day <  CURRENT_DATE - 30
    ) lso_old
    INNER JOIN (
      SELECT DISTINCT course_code, learner_id
      FROM learner_speaking_opportunities
      WHERE day >= CURRENT_DATE - 30
    ) lso_new
      ON lso_new.course_code = lso_old.course_code
     AND lso_new.learner_id  = lso_old.learner_id
    GROUP BY lso_old.course_code
  ),
  retention_cte AS (
    SELECT
      aw.course_code,
      CASE WHEN aw.cnt > 0
           THEN ROUND(COALESCE(r.ret_cnt, 0)::NUMERIC / aw.cnt * 100, 1)
           ELSE 0
      END AS retention_pct
    FROM active_window_old aw
    LEFT JOIN returned r ON r.course_code = aw.course_code
  ),

  -- ── 5. union all known courses from enrollment + activity ──
  all_courses AS (
    SELECT course_code FROM reach_cte
    UNION
    SELECT course_code FROM enrolled_cte
  )

  SELECT
    ac.course_code,
    COALESCE(rc.reach, 0)                                          AS reach,
    COALESCE(ec.enrolled, 0)                                       AS enrolled,
    COALESCE(sc.stickiness_hours, 0)                               AS stickiness_hours,
    COALESCE(ret.retention_pct, 0)                                 AS retention_pct,
    ROUND(
      COALESCE(rc.reach, 0)::NUMERIC
      * COALESCE(sc.stickiness_hours, 0)
      * COALESCE(ret.retention_pct, 0) / 100.0
    , 3)                                                           AS ltv_proxy
  FROM all_courses ac
  LEFT JOIN reach_cte     rc  ON rc.course_code  = ac.course_code
  LEFT JOIN enrolled_cte  ec  ON ec.course_code  = ac.course_code
  LEFT JOIN stickiness_cte sc ON sc.course_code  = ac.course_code
  LEFT JOIN retention_cte  ret ON ret.course_code = ac.course_code
  ORDER BY ltv_proxy DESC NULLS LAST;

END;
$function$;

NOTIFY pgrst, 'reload schema';
