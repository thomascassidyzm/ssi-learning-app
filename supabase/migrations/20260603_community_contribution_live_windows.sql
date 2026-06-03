-- Community contribution windows (today / 7d / 30d) read live from
-- learner_speaking_opportunities — the SAME table the per-learner ("you")
-- number comes from — so YOU can never exceed the community (you're a subset
-- of the sum). Previously the windows read daily_contributions, which is fed
-- only by COMPLETED sessions, so "today" sat near-zero early in the UTC day
-- while your own number ran live → the impossible "38 / 6".
--
-- All-time stays on daily_contributions (it carries pre-LSO history — the 16K).
-- RLS on learner_speaking_opportunities is own-row, so the cross-learner
-- aggregate must run SECURITY DEFINER and be granted to anon/authenticated.
-- The function exposes only aggregates (sums + a distinct-learner count) — no
-- per-learner rows, no PII.

create or replace function get_community_contribution(p_target_lang text)
returns table (window_key text, minutes bigint, phrases bigint, speakers bigint)
language sql
security definer
set search_path = public
as $$
  with rows as (
    select day, play_seconds, opportunities, learner_id
    from learner_speaking_opportunities
    where split_part(course_code, '_for_', 1) = p_target_lang
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
$$;

grant execute on function get_community_contribution(text) to anon, authenticated;

notify pgrst, 'reload schema';
