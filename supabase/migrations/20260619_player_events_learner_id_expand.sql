-- 20260619_player_events_learner_id_expand.sql
--
-- Identity rationalisation, Phase 1 — EXPAND step only (of expand-contract).
--
-- player_events.user_id is uuid but holds the LEARNER pk (learners.id), not the
-- auth uid — the worst naming landmine. Goal: rename it to learner_id to join
-- the 18 correctly-named learner_id tables. dev/staging/prod share ONE DB, so a
-- bare rename would break un-deployed code; we expand-contract instead.
--
-- THIS migration is EXPAND only — purely additive, safe for prod:
--   * add learner_id, backfill from user_id, index it.
-- Going forward api/player-events.ts dual-writes user_id AND learner_id (the
-- sole writer), so learner_id becomes authoritative as old rows are backfilled
-- and new rows carry it.
--
-- DELIBERATELY NOT DONE HERE (sequencing — readers migrate only AFTER dual-write
-- is live in prod, else prod undercounts rows whose learner_id is still null):
--   * migrate readers off user_id → learner_id: admin_practice_minutes,
--     admin_practice_minutes_by_course (ours), plus analytics_trial_conversion,
--     analytics_health, analytics_friction_extended, admin_user_course_stats,
--     admin_user_navigation, course_navigation_friction.
--   * CONTRACT: re-run the backfill for stragglers, then drop user_id + its
--     index. Only after every reader above is migrated and deployed everywhere.

alter table public.player_events add column if not exists learner_id uuid;
update public.player_events set learner_id = user_id where learner_id is null and user_id is not null;
create index if not exists idx_player_events_learner_time on public.player_events (learner_id, occurred_at desc);

notify pgrst, 'reload schema';
