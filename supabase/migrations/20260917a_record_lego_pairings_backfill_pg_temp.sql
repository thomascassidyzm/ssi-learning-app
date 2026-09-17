-- record_lego_pairings_backfill() landed in 20260917_lego_pairings_backfill_marker.sql
-- (job #59) as a SECURITY DEFINER function pinned to `search_path = public` —
-- without pg_temp. Postgres searches the temporary schema FIRST when pg_temp is
-- not named, so a caller who can CREATE TEMP TABLE could shadow an unqualified
-- relation inside the definer body — `learner_lego_pairings` here — with the
-- owner's rights. The manual's advice, and the rule
-- api/_utils/definerSearchPath.security.test.ts enforces over schema.sql, is
-- pg_temp explicit and LAST. Config-only: the body is untouched.
-- Nightly red on dev 2026-09-17 (job #69 → job #64). Exactly the same defect,
-- and the same one-line repair, as 20260915a for user_messages_from_support_reply.
-- It was the ONLY unpinned-or-pg_temp-less DEFINER function live at the time of
-- this migration: 78 SECURITY DEFINER functions in public, 0 unpinned, 1 pinned
-- without pg_temp (verified against pg_proc.proconfig, 2026-09-17).

ALTER FUNCTION public.record_lego_pairings_backfill(uuid, text, text[], integer[], text, timestamptz, timestamptz)
  SET search_path TO 'public', 'pg_temp';

NOTIFY pgrst, 'reload schema';
