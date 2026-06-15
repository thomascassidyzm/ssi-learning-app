-- ============================================================================
-- FEATURE #17 — first-class demo-data separation (is_demo)
-- ============================================================================
-- Tom 2026-06-10: demo data must be "kept separate from all our aggregation
-- stats — or at least with the ability to include or exclude". This replaces
-- the ad-hoc educational_role='student' filter with a real flag.
--
-- RULE (bank it): every GLOBAL aggregate (community stats, leaderboards,
-- reach counts, insights) excludes is_demo learners by default. School-scoped
-- dashboard reads need no exclusion — a demo school only ever contains demo
-- learners. To include demo in an analysis, join learners and drop the filter
-- deliberately.
--
-- Touched aggregates (all global ones found in live defs):
--   * daily_contributions trigger (update_daily_contributions) — recompute
--     now excludes demo sessions, so demo play (e.g. Tom demoing as a demo
--     teacher in Dublin) never pollutes community numbers.
--   * weekly_leaderboard view — demo learners never rank. REPLACEd WITH
--     (security_invoker=on) — REPLACE resets reloptions (the secfix_05/12
--     lesson), so the option is restated explicitly.
--   * get_community_contribution() — live community windows exclude demo.

ALTER TABLE public.learners ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.schools  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.groups   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- demo set stays small: cheap partial index for the exclusion anti-joins
CREATE INDEX IF NOT EXISTS learners_is_demo_true_idx ON public.learners (id) WHERE is_demo;

-- ====== daily_contributions trigger: demo sessions never aggregate ======
CREATE OR REPLACE FUNCTION public.update_daily_contributions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_lang TEXT;
  v_date DATE;
BEGIN
  v_target_lang := SPLIT_PART(NEW.course_id, '_for_', 1);
  v_date := NEW.started_at::date;

  -- Recompute the whole row for (language, date) from sessions, EXCLUDING
  -- demo learners. SUM seconds first, divide by 60 after.
  INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
  SELECT
    v_target_lang,
    v_date,
    COALESCE(SUM(s.items_practiced), 0),
    COALESCE(SUM(s.duration_seconds), 0) / 60,
    COUNT(DISTINCT s.learner_id)
  FROM sessions s
  WHERE SPLIT_PART(s.course_id, '_for_', 1) = v_target_lang
    AND s.started_at::date = v_date
    AND NOT EXISTS (SELECT 1 FROM learners ld WHERE ld.id = s.learner_id AND ld.is_demo)
  ON CONFLICT (target_language, contribution_date)
  DO UPDATE SET
    phrases_count = EXCLUDED.phrases_count,
    minutes_practiced = EXCLUDED.minutes_practiced,
    unique_speakers = EXCLUDED.unique_speakers,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

-- ====== weekly_leaderboard: demo learners never rank ======
CREATE OR REPLACE VIEW public.weekly_leaderboard
WITH (security_invoker = on) AS
 WITH weekly_stats AS (
         SELECT s.learner_id,
            s.course_id,
            sum(s.points_earned) AS weekly_points,
            count(*) AS session_count
           FROM sessions s
          WHERE s.started_at >= date_trunc('week'::text, CURRENT_TIMESTAMP)
          GROUP BY s.learner_id, s.course_id
        ), ranked AS (
         SELECT ws.learner_id,
            ws.course_id,
            ws.weekly_points,
            ws.session_count,
            l.display_name,
            row_number() OVER (PARTITION BY ws.course_id ORDER BY ws.weekly_points DESC) AS rank,
            percent_rank() OVER (PARTITION BY ws.course_id ORDER BY ws.weekly_points) AS percentile
           FROM weekly_stats ws
             JOIN learners l ON l.id = ws.learner_id
          WHERE NOT l.is_demo
        )
 SELECT learner_id,
    display_name,
    course_id,
    weekly_points,
    session_count,
    rank,
    round((1::double precision - percentile) * 100::double precision)::integer AS top_percentile
   FROM ranked;
REVOKE ALL ON public.weekly_leaderboard FROM anon;

-- ====== get_community_contribution: live windows exclude demo ======
CREATE OR REPLACE FUNCTION public.get_community_contribution(p_target_lang text)
 RETURNS TABLE(window_key text, minutes bigint, phrases bigint, speakers bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with rows as (
    select o.day, o.play_seconds, o.opportunities, o.learner_id
    from learner_speaking_opportunities o
    where split_part(o.course_code, '_for_', 1) = p_target_lang
      and not exists (select 1 from learners ld where ld.id = o.learner_id and ld.is_demo)
  ),
  utc_today as (select (now() at time zone 'utc')::date as d)
  select 'today'::text,
         coalesce(sum(play_seconds), 0) / 60,
         coalesce(sum(opportunities), 0),
         count(distinct learner_id)
    from rows, utc_today where day = utc_today.d
  union all
  select 'days7'::text,
         coalesce(sum(play_seconds), 0) / 60,
         coalesce(sum(opportunities), 0),
         count(distinct learner_id)
    from rows, utc_today where day >= utc_today.d - 7
  union all
  select 'days30'::text,
         coalesce(sum(play_seconds), 0) / 60,
         coalesce(sum(opportunities), 0),
         count(distinct learner_id)
    from rows, utc_today where day >= utc_today.d - 30;
$function$;

NOTIFY pgrst, 'reload schema';
