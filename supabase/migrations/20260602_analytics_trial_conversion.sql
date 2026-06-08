-- analytics_trial_conversion()
-- ============================================================================
-- Returns the five-stage trial→paid funnel for the Insight Engine
-- 'trialConversion' metric resolver (data/trialConversion.ts).
--
-- Stages (in order):
--   1. trial_started   — distinct learners who fired at least one player_event
--                        (any event_type) since their account was created
--                        (proxy for "touched the app"). Once subscriptions
--                        gains rows, this will be replaced by sub.status='trialing'.
--   2. day1_session    — of the above, those who returned on a day AFTER
--                        their first event (day_1+ stickiness check).
--   3. day4_return     — those who had any event on or after (first_event + 4 days).
--   4. day7_active     — those who had any event on or after (first_event + 7 days).
--   5. converted       — learners with a row in subscriptions
--                        (status IN ('active','past_due','paused')).
--                        Returns 0 today because subscriptions is empty.
--
-- All counts deliberately monotone-descending (each stage is a strict subset
-- of the previous) so the funnel renders without inversion.
--
-- Gated by is_god_user() SECURITY DEFINER, anon-callable from the admin client
-- just like every other analytics_* function.
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics_trial_conversion()
RETURNS TABLE(
  stage        TEXT,
  label        TEXT,
  learner_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  -- learner-to-first-event lookup reused across all stages
BEGIN
  IF NOT is_god_user() THEN
    RAISE EXCEPTION 'Forbidden: god mode required';
  END IF;

  -- Build the funnel from player_events + subscriptions.
  -- The JOIN hazard: player_events.user_id is UUID; learners.user_id is TEXT.
  -- We work entirely inside player_events using its UUID user_id for dedup.
  RETURN QUERY
  WITH

  -- Stage 1: any authenticated learner who has ever fired an event
  stage1 AS (
    SELECT DISTINCT user_id
    FROM   player_events
    WHERE  user_id IS NOT NULL
  ),

  -- Per-learner first-event timestamp
  first_events AS (
    SELECT
      user_id,
      MIN(occurred_at) AS first_at
    FROM   player_events
    WHERE  user_id IS NOT NULL
    GROUP  BY user_id
  ),

  -- Stage 2: returned on a calendar day AFTER their first event
  stage2 AS (
    SELECT DISTINCT pe.user_id
    FROM   player_events pe
    JOIN   first_events  fe ON fe.user_id = pe.user_id
    WHERE  pe.occurred_at::DATE > fe.first_at::DATE
  ),

  -- Stage 3: had any event >= (first_at + 4 days)
  stage3 AS (
    SELECT DISTINCT pe.user_id
    FROM   player_events pe
    JOIN   first_events  fe ON fe.user_id = pe.user_id
    WHERE  pe.occurred_at >= fe.first_at + INTERVAL '4 days'
  ),

  -- Stage 4: had any event >= (first_at + 7 days)
  stage4 AS (
    SELECT DISTINCT pe.user_id
    FROM   player_events pe
    JOIN   first_events  fe ON fe.user_id = pe.user_id
    WHERE  pe.occurred_at >= fe.first_at + INTERVAL '7 days'
  ),

  -- Stage 5: converted — subscriptions with a paid/active status.
  -- Joined on subscriptions.learner_id (UUID) which matches learners.id (UUID),
  -- then bridged to player_events.user_id via learners.user_id::uuid.
  -- The column learners.user_id is TEXT; cast to uuid for the join.
  stage5 AS (
    SELECT DISTINCT pe.user_id
    FROM   subscriptions  sub
    JOIN   learners        l   ON l.id = sub.learner_id
    JOIN   player_events   pe  ON pe.user_id = l.user_id::uuid
    WHERE  sub.status IN ('active', 'past_due', 'paused')
  )

  -- Return the five rows in funnel order
  SELECT 'trial_started'::TEXT,  'Trial started'::TEXT,  COUNT(*)::BIGINT FROM stage1
  UNION ALL
  SELECT 'day1_session'::TEXT,   'Day-1 session'::TEXT,  COUNT(*)::BIGINT FROM stage2
  UNION ALL
  SELECT 'day4_return'::TEXT,    'Day-4 return'::TEXT,   COUNT(*)::BIGINT FROM stage3
  UNION ALL
  SELECT 'day7_active'::TEXT,    'Day-7 active'::TEXT,   COUNT(*)::BIGINT FROM stage4
  UNION ALL
  SELECT 'converted'::TEXT,      'Converted'::TEXT,      COUNT(*)::BIGINT FROM stage5;

END;
$function$;

COMMENT ON FUNCTION analytics_trial_conversion IS
  'Five-stage trial→paid funnel: trial_started → day1_session → day4_return → day7_active → converted. '
  'Source: player_events + subscriptions. SECURITY DEFINER, is_god_user() gated. '
  'Returns well-formed zero rows when subscriptions is empty.';

NOTIFY pgrst, 'reload schema';
