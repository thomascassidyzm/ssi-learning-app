-- analytics_retention_days_active(p_weeks)
-- ============================================
-- Returns a weekly time-series of:
--   1. avg_days_active   — mean distinct active days per enrolled learner in that calendar week
--   2. w7_return_rate    — % of weekly-active learners who returned the following week  (7d)
--   3. w30_return_rate   — % of month-active learners who were still active 30 days later
--
-- Used by the Insight Engine 'retention' metric resolver (data/retention.ts) to build
-- the TimeSeriesData shape alongside analytics_retention_cohorts(p_weeks).
--
-- Source table: learner_speaking_opportunities (own-row RLS blocks anon/admin direct reads).
-- SECURITY DEFINER + is_god_user() gate matches all other analytics_* functions.
-- ============================================

CREATE OR REPLACE FUNCTION analytics_retention_days_active(p_weeks INT DEFAULT 12)
RETURNS TABLE(
  week_start       DATE,
  avg_days_active  NUMERIC,
  w7_return_rate   NUMERIC,
  w30_return_rate  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  RETURN QUERY
  WITH week_series AS (
    SELECT generate_series(
      date_trunc('week', NOW())::DATE - ((p_weeks - 1) * INTERVAL '1 week'),
      date_trunc('week', NOW())::DATE,
      INTERVAL '1 week'
    )::DATE AS w_start
  ),
  -- Distinct active (learner, day) pairs per calendar week
  active_days AS (
    SELECT
      date_trunc('week', lso.day)::DATE AS w_start,
      lso.learner_id,
      COUNT(DISTINCT lso.day)::INT       AS days_in_week
    FROM learner_speaking_opportunities lso
    GROUP BY 1, 2
  ),
  -- Learner count + avg_days per week
  weekly_agg AS (
    SELECT
      ad.w_start,
      COUNT(DISTINCT ad.learner_id)::INT          AS active_learners,
      ROUND(AVG(ad.days_in_week), 2)              AS avg_days
    FROM active_days ad
    GROUP BY 1
  ),
  -- 7-day return: learners active in week W who were also active in week W+1
  w7_return AS (
    SELECT
      a1.w_start,
      COUNT(DISTINCT a2.learner_id)::NUMERIC /
        NULLIF(COUNT(DISTINCT a1.learner_id), 0) * 100 AS return_pct
    FROM active_days a1
    LEFT JOIN active_days a2
      ON a2.learner_id = a1.learner_id
     AND a2.w_start    = a1.w_start + INTERVAL '1 week'
    GROUP BY 1
  ),
  -- 30-day return: learners active in week W who were active in any of the 4 weeks starting W+4
  w30_return AS (
    SELECT
      a1.w_start,
      COUNT(DISTINCT a2.learner_id)::NUMERIC /
        NULLIF(COUNT(DISTINCT a1.learner_id), 0) * 100 AS return_pct
    FROM active_days a1
    LEFT JOIN active_days a2
      ON a2.learner_id = a1.learner_id
     AND a2.w_start   >= a1.w_start + INTERVAL '4 weeks'
     AND a2.w_start   <= a1.w_start + INTERVAL '7 weeks'
    GROUP BY 1
  )
  SELECT
    ws.w_start                                       AS week_start,
    COALESCE(wa.avg_days,          0)                AS avg_days_active,
    ROUND(COALESCE(r7.return_pct,  0), 1)            AS w7_return_rate,
    ROUND(COALESCE(r30.return_pct, 0), 1)            AS w30_return_rate
  FROM week_series ws
  LEFT JOIN weekly_agg  wa  ON wa.w_start  = ws.w_start
  LEFT JOIN w7_return   r7  ON r7.w_start  = ws.w_start
  LEFT JOIN w30_return  r30 ON r30.w_start = ws.w_start
  ORDER BY ws.w_start;
END;
$function$;

COMMENT ON FUNCTION analytics_retention_days_active IS
  'Admin-only time-series: avg days-active per learner/week + 7d and 30d return rates. '
  'Source: learner_speaking_opportunities. SECURITY DEFINER, is_god_user() gated.';

NOTIFY pgrst, 'reload schema';
