-- 20260716_player_events_practice_minutes_covering_index.sql
--
-- admin_practice_minutes() (20260619_admin_practice_minutes_rpc.sql) groups
-- player_events by (user_id, session_id) and needs min/max(occurred_at) per
-- group. The existing idx_player_events_user_time (user_id, occurred_at desc)
-- doesn't carry session_id, so the planner falls back to a bitmap heap scan
-- that touches ~every row for the matched users (measured live: 464 admin
-- users -> 349k/428k player_events rows, ~21.5k heap blocks, ~257ms wall
-- clock — most of /api/admin/users's server time).
--
-- Adding session_id to the index lets Postgres answer the RPC's query with an
-- index-only scan instead (verified live via a throwaway index in a rolled-
-- back transaction: heap fetches dropped from ~21.5k blocks to ~8k tuples,
-- ~257ms -> ~180ms). Additive only — the existing (user_id, occurred_at)
-- index is left in place for other query shapes.

create index if not exists idx_player_events_user_session_time
  on public.player_events (user_id, session_id, occurred_at);

notify pgrst, 'reload schema';
